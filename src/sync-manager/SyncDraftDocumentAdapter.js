/**
 * SyncDraftDocumentAdapter - Wrapper để SyncDraftDocumentModel hoạt động với SyncManagerService
 *
 * SyncDraftDocumentModel v3 cần được adapter để implement interface tương tự SyncOutgoingAdapter
 * để có thể đăng ký với SyncManagerService
 */

const logger = require('../../utils/logger');
const dbConnection = require('../../db/connection');
const SyncDraftDocumentModel = require('../sync-outgoing-v3/models/SyncDraftDocumentModel');

class SyncDraftDocumentAdapter {
  constructor() {
    this._instanceId = process.env.SYNC_INSTANCE_ID || process.env.INSTANCE_ID || '1';
    this._name = `DraftDocument_Instance_${this._instanceId}`;
    this._model = null;
    this._initialized = false;
  }

  /**
   * Initialize - kết nối DB và khởi tạo model
   */
  async initialize() {
    if (this._initialized) return;

    // Tạo instance của SyncDraftDocumentModel v3
    this._model = new SyncDraftDocumentModel();

    // Gọi initialize của model để khởi tạo đầy đủ (pools, upsert handler, staging table)
    await this._model.initialize(this._instanceId);

    this._initialized = true;
    logger.info(`[SyncDraftDocumentAdapter] Initialized as ${this._name}`);
  }

  /**
   * Trả về tên định danh duy nhất cho instance này
   */
  getName() {
    return this._name || 'DraftDocument_Unknown';
  }

  /**
   * Implement interface - Đếm tổng số bản ghi cần sync (bao gồm cả trong source DB và đang chờ trong staging)
   */
  async getCount(lastTime, lastSyncId = 0) {
    const stagingTable = `draft_documents_sync_${this._instanceId}`;

    // 1. Đếm số bản ghi đang chờ xử lý trong staging
    const stagingQuery = `
      SELECT COUNT(1) AS cnt
      FROM ${stagingTable}
      WHERE ISNULL(MigrateFlg, 0) = 0
        AND ISNULL(MigrateErrFlg, 0) = 0
    `;

    try {
      const pool = dbConnection.getNewPool();
      if (!pool) return 0;

      const stagingRes = await pool.request().query(stagingQuery);
      const inStaging = Number(stagingRes.recordset?.[0]?.cnt || 0);

      let inSource = 0;
      try {
        // 2. Đếm số bản ghi trong OLD DB chưa được fetch (theo cursor)
        inSource = await this._model.extractor.getTotalCount(lastTime, lastSyncId);
      } catch (sourceError) {
        logger.warn(`[SyncDraftDocumentAdapter] source count failed, fallback to staging only: ${sourceError.message}`);
      }

      const total = inStaging + inSource;
      logger.info(`[SyncDraftDocumentAdapter] getCount: ${total} (Staging: ${inStaging}, Source: ${inSource})`);
      return total;
    } catch (error) {
      logger.error(`[SyncDraftDocumentAdapter] getCount error: ${error.message}`);
      return 0;
    }
  }

  /**
   * Implement countListFromOldDb - used by SyncHandlerModel in full sync mode.
   */
  async countListFromOldDb(lastSyncTime, lastSyncId = 0) {
    if (!this._model || !this._model.extractor) return 0;
    return this._model.extractor.getTotalCount(lastSyncTime, lastSyncId);
  }

  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    const batchSize = Number(process.env.STAGING_FETCH_BATCH_SIZE || 2000);
    let extractedCount = 0;
    let hasMore = true;

    // Get last sync cursor from staging table to support incremental resume (ASC)
    const lastCursor = await this._model.extractor.getLastSyncCursor(this._instanceId);
    let cursorTime = lastCursor.time;
    let cursorId = lastCursor.id || 0;

    // If staging has no cursor, fallback to lastSyncTime passed by manager, or getInitialSyncTime
    if (!cursorTime) {
      const lastSyncDate = new Date(lastSyncTime);
      const isDateValid = !isNaN(lastSyncDate.getTime());
      const isValidTime = lastSyncTime &&
                          lastSyncTime !== '1970-01-01T00:00:00.000Z' &&
                          lastSyncTime !== '2100-01-01T00:00:00.000Z' &&
                          isDateValid &&
                          lastSyncDate.getFullYear() > 1753 &&
                          lastSyncDate.getFullYear() < 2100;

      cursorTime = isValidTime ? lastSyncTime : this._model.extractor.getInitialSyncTime();
      cursorId = isValidTime ? Number(lastSyncId || 0) : 0;
    }

    logger.info(`[SyncDraftDocumentAdapter] getList start: cursorTime=${cursorTime}, lastSyncId=${cursorId} [ASC direction]`);

    const stagingTable = `draft_documents_sync_${this._instanceId}`;
    const pendingQuery = `
      SELECT COUNT(1) AS cnt
      FROM ${stagingTable}
      WHERE ISNULL(MigrateFlg, 0) = 0
        AND ISNULL(MigrateErrFlg, 0) = 0
    `;
    const pendingRes = await dbConnection.getNewPool().request().query(pendingQuery);
    const pendingCount = Number(pendingRes.recordset?.[0]?.cnt || 0);

    if (pendingCount > 0) {
      const stagedCount = await this.getCount(cursorTime, cursorId);
      logger.info(`[SyncDraftDocumentAdapter] getList skipped extract because staging has pending rows: ${pendingCount}`);
      logger.info(`[SyncDraftDocumentAdapter] getList done: extracted=0, staged=${stagedCount}`);
      return {
        lastSyncTime: cursorTime,
        lastSyncId: cursorId,
        stagedCount,
        totalCount: stagedCount
      };
    }

    while (hasMore) {
      const batch = await this._model.extractor.fetchBatchFromOldDb(
        cursorTime,
        cursorId,
        batchSize
      );

      if (!batch || batch.length === 0) {
        hasMore = false;
        break;
      }

      await this._model.extractor.syncBatchToStaging(batch, this._instanceId);
      extractedCount += batch.length;

      const lastRow = batch[batch.length - 1];
      cursorTime = lastRow.__sync_time;
      cursorId = lastRow.__sync_id || lastRow.ID;

      if (batch.length < batchSize) {
        hasMore = false;
      }
    }

    const stagedCount = await this.getCount(cursorTime, cursorId);

    logger.info(`[SyncDraftDocumentAdapter] getList done: extracted=${extractedCount}, staged=${stagedCount}`);

    return {
      lastSyncTime: cursorTime,
      lastSyncId: cursorId,
      stagedCount,
      totalCount: stagedCount
    };
  }

  /**
   * Fetch batch từ staging table
   */
  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0, limit = null, offset = 0) {
    const batchSize = Number(limit) || Number(process.env.STAGING_FETCH_BATCH_SIZE || 2000);
    const effectiveOffset = Number(offset) || 0;
    
    const lastSyncDate = new Date(lastSyncTime);
    const isDateValid = !isNaN(lastSyncDate.getTime());
    const isValidTime = lastSyncTime &&
                        lastSyncTime !== '1970-01-01T00:00:00.000Z' &&
                        lastSyncTime !== '2100-01-01T00:00:00.000Z' &&
                        isDateValid &&
                        lastSyncDate.getFullYear() > 1753;
                        
    const effectiveSyncTime = isValidTime ? lastSyncTime : this._model.extractor.getInitialSyncTime();

    const rows = await this._model.extractor.fetchBatchFromOldDb(
      effectiveSyncTime,
      lastSyncId,
      batchSize,
      effectiveOffset
    );

    return rows || [];
  }

  /**
   * Implement interface - Xử lý một bản ghi từ staging
   */
  async processOne(syncJobId, options = {}) {
    try {
      const stagingTable = `draft_documents_sync_${this._instanceId}`;
      const batchSize = Number(options.batchSize || process.env.DRAFT_LOAD_BATCH_SIZE || 20);

      const pool = dbConnection.getNewPool();
      const selectQuery = `
        SELECT TOP (@batchSize) *
        FROM ${stagingTable} WITH (READPAST, ROWLOCK)
        WHERE ISNULL(MigrateFlg, 0) = 0
          AND ISNULL(MigrateErrFlg, 0) = 0
        ORDER BY __sync_time ASC, __sync_id ASC, ID ASC;
      `;

      const rows = await pool.request()
        .input('batchSize', batchSize)
        .query(selectQuery);

      if (!rows.recordset?.length) {
        return { done: true, affected: 0 };
      }

      const batchRows = rows.recordset || [];
      const ids = batchRows.map((row) => row.ID);
      const placeholders = ids.map((_, index) => `@id${index}`);
      const markQuery = `
        UPDATE ${stagingTable} WITH (ROWLOCK)
        SET MigrateFlg = 2,
            MigrateErrMess = 'Processing Batch...',
            processing_owner = @owner,
            processing_started_at = SYSUTCDATETIME(),
            processing_heartbeat_at = SYSUTCDATETIME()
        WHERE ID IN (${placeholders.join(', ')})
          AND ISNULL(MigrateFlg, 0) = 0
          AND ISNULL(MigrateErrFlg, 0) = 0;
      `;
      const markRequest = pool.request().input('owner', `pid_${process.pid}_${syncJobId}`);
      ids.forEach((id, index) => {
        markRequest.input(`id${index}`, id);
      });
      await markRequest.query(markQuery);

      const batchResult = await this._model.upsertHandler.processBatch(batchRows);

      for (const item of batchResult.results || []) {
        if (item.success) {
          await this._markSuccess(stagingTable, item.ID);
        } else {
          await this._markFailed(stagingTable, item.ID, item.error);
        }
      }

      return {
        done: false,
        affected: batchRows.length,
        successCount: batchResult.successCount || 0,
        failedCount: batchResult.failedCount || 0
      };
    } catch (error) {
      logger.error(`[SyncDraftDocumentAdapter] processOne error: ${error.message}`);
      return { done: false, affected: 0, error: error.message };
    }
  }

  /**
   * Mark record as success
   */
  async _markSuccess(stagingTable, id) {
    const query = `
      UPDATE ${stagingTable} WITH (ROWLOCK)
      SET MigrateFlg = 1,
          MigrateErrFlg = 0,
          MigrateErrMess = NULL
      WHERE ID = @ID
    `;
    await dbConnection.getNewPool().request().input('ID', id).query(query);
  }

  /**
   * Mark record as failed
   */
  async _markFailed(stagingTable, id, errorMessage) {
    const query = `
      UPDATE ${stagingTable} WITH (ROWLOCK)
      SET MigrateFlg = 3,
          MigrateErrFlg = 1,
          MigrateErrMess = @errorMessage
      WHERE ID = @ID
    `;
    await dbConnection.getNewPool().request()
      .input('ID', id)
      .input('errorMessage', errorMessage)
      .query(query);
  }

  /**
   * Update heartbeat để tránh bị coi là stale
   */
  async updateHeartbeat() {
    logger.debug(`[SyncDraftDocumentAdapter] Heartbeat update`);
  }

  /**
   * Get job state từ SyncManagerService
   */
  async getSyncJobState(syncJobId) {
    return null;
  }

  /**
   * Lấy stats hiện tại
   */
  async getStats() {
    const stagingTable = `draft_documents_sync_${this._instanceId}`;

    const query = `
      SELECT
        SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 0 AND ISNULL(MigrateErrFlg, 0) = 0 THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 2 THEN 1 ELSE 0 END) AS processing,
        SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 1 THEN 1 ELSE 0 END) AS success,
        SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 3 OR ISNULL(MigrateErrFlg, 0) = 1 THEN 1 ELSE 0 END) AS failed
      FROM ${stagingTable}
    `;

    try {
      const pool = dbConnection.getNewPool();
      const result = await pool.request().query(query);
      const row = result.recordset?.[0] || {};
      return {
        pending: Number(row.pending || 0),
        processing: Number(row.processing || 0),
        success: Number(row.success || 0),
        failed: Number(row.failed || 0)
      };
    } catch (error) {
      logger.error(`[SyncDraftDocumentAdapter] getStats error: ${error.message}`);
      return { pending: 0, processing: 0, success: 0, failed: 0 };
    }
  }
}

module.exports = SyncDraftDocumentAdapter;
