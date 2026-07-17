const BaseLoader = require('../../sync-base/BaseLoader');
const logger = require('../../../utils/logger');
const UpsertHandler = require('./UpsertHandler');

/**
 * Loader for incoming documents
 * (incomming_documents_sync → incomming_documents)
 *
 * KEY DIFFERENCES vs Outgoing Loader:
 * - stagingTableBaseName: 'incomming_documents_sync'
 * - mainTableName: 'incomming_documents'
 * - Partition column: NgayDen (not Created)
 * - fetchOneFromStaging dùng RANGE-BASED partitioning theo ID
 *
 * WORKER PARTITIONING STRATEGY (Range-based):
 * - Worker 1: ID 1   → 200
 * - Worker 2: ID 201 → 400
 * - Worker 3: ID 401 → 600
 * - Worker 4: ID 601 → 800
 * - Worker 5: ID 801 → 1000
 * 
 * Mỗi worker chỉ SELECT/UPDATE trong khoảng ID của mình
 * → Không cần lo race condition giữa các worker
 * → Không cần READPAST (vì không có overlap)
 * → UPDLOCK + ROWLOCK vẫn giữ để an toàn khi chạy multi-instance
 */
class Loader extends BaseLoader {
  constructor(newPool, oldPool, workerCount = null, rangeSize = null, startId = null) {
    super({
      modelName: 'INCOMING_LOADER',
      stagingTableBaseName: 'incomming_documents_sync',
      mainTableName: 'incomming_documents',
      partitionColumn: 'NgayDen'
    });

    this.newPool = newPool;
    this.oldPool = oldPool;
    this.upsertHandler = null;

    // Đọc từ environment variables hoặc tham số constructor
    // Default: 8 workers, mỗi worker xử lý 1250 IDs (round-based progression = 10k/round)
    this.workerCount = workerCount || parseInt(process.env.WORKER_COUNT, 10) || 6;
    this.rangeSize = rangeSize || parseInt(process.env.RANGE_SIZE, 10) || 10000;
    this.startId = startId || parseInt(process.env.START_ID, 10) || 1;
  }

  getStagingTableName(instanceId) {
    return 'incomming_documents_sync';
  }

  async initialize() {
    this.upsertHandler = new UpsertHandler(this.newPool, this.oldPool);
    await this.upsertHandler.initialize();
    logger.info(`[${this.modelName}] Initialized with UpsertHandler`);
  }

  /**
   * Tính khoảng ID cho worker.
   * Worker 1 → [1, 200], Worker 2 → [201, 400], ...
   * 
   * @param {number} workerId - 1-based worker ID (1..5)
   * @returns {{ idMin: number, idMax: number }}
   */
  /**
   * Get ID range for a worker for a given round.
   * roundIndex = 0 => first round (1..rangeSize for worker 1)
   * Subsequent rounds shift by workerCount * rangeSize.
   *
   * @param {number} workerId - 1-based worker ID
   * @param {number} [roundIndex=0] - 0-based round index
   * @returns {{ idMin: number, idMax: number }}
   */
  getWorkerIdRange(workerId, roundIndex = 0) {
    const baseMin = (workerId - 1) * this.rangeSize + 1;
    const baseMax = workerId * this.rangeSize;
    const shift = roundIndex * this.workerCount * this.rangeSize;
    const startOffset = this.startId - 1;
    const idMin = baseMin + shift + startOffset;
    const idMax = baseMax + shift + startOffset;
    return { idMin, idMax };
  }

  /**
   * Process one staging record.
   */
  async processRecord(row) {
    if (!this.upsertHandler) {
      throw new Error('UpsertHandler not initialized');
    }
    return this.upsertHandler.processRecord(row);
  }

  // ──────────────────────────────────────────────
  // Fetch one row from staging (range-based claim)
  // ──────────────────────────────────────────────

  /**
   * Fetch một row từ staging trong khoảng ID được phân công cho worker.
   *
   * THAY ĐỔI SO VỚI PHIÊN BẢN CŨ (modulo → range):
   * - Cũ: ID % workerCount = workerIdIndex  → phân bố xấp xỉ, overlap khi multi-instance
   * - Mới: TRY_CAST(ID AS BIGINT) BETWEEN @idMin AND @idMax → không overlap, rõ ràng
   * - Không dùng filter theo ngày nữa; chỉ dựa trên ID
   * - UPDLOCK + ROWLOCK giữ lại để an toàn khi chạy nhiều process
   *
   * @param {string} instanceId - Instance ID cho tracking
   * @param {number} workerId   - ID của worker (1-based, 1..5)
   * @returns {object|null} - Row từ staging hoặc null nếu không có
   */
  async fetchOneFromStaging(instanceId, workerId = 1, roundIndex = 0) {
    const stagingTable = this.getStagingTableName(instanceId);
    const { idMin, idMax } = this.getWorkerIdRange(workerId, roundIndex);

    try {
      if (!this.newPool) {
        throw new Error('Loader: newPool chưa được kết nối.');
      }

      const reqClaim = this.newPool.request();
      reqClaim.input('idMin', idMin)
              .input('idMax', idMax)
              .input('owner', `pid_${process.pid}_w${workerId}_${instanceId}`);

      const claimResult =
        await reqClaim.query(`
          ;WITH Candidate AS (
            SELECT TOP (1) *
            FROM ${stagingTable}
            WITH (
              UPDLOCK,
              ROWLOCK,
              READPAST
            )
            WHERE ISNULL(MigrateFlg, 0) = 0
              AND ISNULL(MigrateErrFlg, 0) = 0
              AND ID IS NOT NULL
              AND ID BETWEEN @idMin
                          AND @idMax
          )
          UPDATE Candidate
          SET
            MigrateFlg = 2,
            MigrateErrMess =
              'Processing...',
            processing_owner =
              @owner,
            processing_started_at =
              SYSUTCDATETIME(),
            processing_heartbeat_at =
              SYSUTCDATETIME()
          OUTPUT inserted.*
          OPTION (MAXDOP 1);
        `);

      const rows = claimResult?.recordset;
      if (!rows?.length) {
        return null;
      }

      return rows[0];

    } catch (error) {
      const isDeadlock =
        error?.message?.includes(
          'deadlocked'
        );

      logger.error(
        `[${this.modelName}] ` +
        `fetchOneFromStaging ` +
        `[W${workerId}] failed: ` +
        `${error.message}`
      );

      if (isDeadlock) {
        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              200
            )
        );

        return null;
      }

      throw error;
    }
  }

  // ──────────────────────────────────────────────
  // Mark success / failure  (không thay đổi)
  // ──────────────────────────────────────────────

  async countPendingInRange(instanceId, idMin, idMax) {
    const stagingTable = this.getStagingTableName(instanceId);
    const result = await this.newPool.request()
      .input('idMin', idMin)
      .input('idMax', idMax)
      .query(`
        SELECT COUNT(1) AS cnt
        FROM ${stagingTable}
        WHERE ISNULL(MigrateFlg, 0) = 0
          AND ISNULL(MigrateErrFlg, 0) = 0
          AND ID IS NOT NULL
          AND TRY_CAST(ID AS BIGINT) BETWEEN @idMin AND @idMax
      `);

    return Number(result?.recordset?.[0]?.cnt || 0);
  }

  async markSuccess(instanceId, rowId) {
    const stagingTable = this.getStagingTableName(instanceId);
    await this.newPool.request()
      .input('ID', rowId)
      .query(`
        UPDATE ${stagingTable} WITH (ROWLOCK)
        SET MigrateFlg              = 1,
            MigrateErrFlg           = 0,
            MigrateErrMess          = NULL,
            processing_owner        = NULL,
            processing_started_at   = NULL,
            processing_heartbeat_at = NULL
        WHERE ID = @ID
      `);
  }

  async markFailed(instanceId, rowId, errorMessage) {
    const stagingTable = this.getStagingTableName(instanceId);
    await this.newPool.request()
      .input('ID', rowId)
      .input('errMsg', String(errorMessage || '').slice(0, 1000))
      .query(`
        UPDATE ${stagingTable} WITH (ROWLOCK)
        SET MigrateFlg              = 0,
            MigrateErrFlg           = 1,
            MigrateErrMess          = @errMsg,
            processing_owner        = NULL,
            processing_started_at   = NULL,
            processing_heartbeat_at = NULL
        WHERE ID = @ID
      `);
  }

  async updateHeartbeat(instanceId, rowId) {
    if (!rowId) return;
    const stagingTable = this.getStagingTableName(instanceId);
    try {
      await this.newPool.request()
        .input('ID', rowId)
        .query(`
          UPDATE ${stagingTable} WITH (ROWLOCK)
          SET processing_heartbeat_at = SYSUTCDATETIME()
          WHERE ID = @ID AND MigrateFlg = 2
        `);
    } catch (err) {
      logger.warn(`[${this.modelName}] Heartbeat failed for ID=${rowId}: ${err.message}`);
    }
  }

  // ──────────────────────────────────────────────
  // Stats  (không thay đổi)
  // ──────────────────────────────────────────────

  async getStats(instanceId) {
    const stagingTable = this.getStagingTableName(instanceId);
    try {
      const result = await this.newPool.request().query(`
        SELECT
          SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 0 AND ISNULL(MigrateErrFlg, 0) = 0 THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN MigrateFlg = 1 THEN 1 ELSE 0 END) AS success,
          SUM(CASE WHEN MigrateErrFlg = 1 THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN MigrateFlg = 2 THEN 1 ELSE 0 END) AS processing
        FROM ${stagingTable}
      `);
      return result.recordset?.[0] || { pending: 0, success: 0, failed: 0, processing: 0 };
    } catch {
      return { pending: 0, success: 0, failed: 0, processing: 0 };
    }
  }
}

module.exports = Loader;