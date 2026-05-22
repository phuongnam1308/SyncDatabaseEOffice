const BaseLoader = require('../../sync-base/BaseLoader');
const logger = require('../../../utils/logger');
const UpsertHandler = require('./UpsertHandler');

/**
 * Loader for incoming documents
 * (incomming_documents_sync_{instanceId} → incomming_documents)
 *
 * KEY DIFFERENCES vs Outgoing Loader:
 * - stagingTableBaseName: 'incomming_documents_sync'
 * - mainTableName: 'incomming_documents'
 * - Partition column: NgayDen (not Created)
 * - fetchOneFromStaging uses UPDLOCK + READPAST (safe for multi-instance)
 */
class Loader extends BaseLoader {
  constructor(newPool, oldPool) {
    super({
      modelName: 'INCOMING_LOADER',
      stagingTableBaseName: 'incomming_document_sync',
      mainTableName: 'incomming_documents',
      partitionColumn: 'NgayDen'
    });

    this.newPool = newPool;
    this.oldPool = oldPool;
    this.upsertHandler = null;
  }

  getStagingTableName(instanceId) {
    return 'incomming_document_sync';
  }

  async initialize() {
    this.upsertHandler = new UpsertHandler(this.newPool, this.oldPool);
    await this.upsertHandler.initialize();
    logger.info(`[${this.modelName}] Initialized with UpsertHandler`);
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
  // Fetch one row from staging (atomic claim)
  // ──────────────────────────────────────────────

  /**
   * Atomic CTE UPDATE + OUTPUT để claim row an toàn trong môi trường multi-instance.
   * Sử dụng UPDLOCK + ROWLOCK + READPAST (bỏ qua row đang bị lock, không chờ).
   */
  async fetchOneFromStaging(instanceId) {
    const stagingTable = this.getStagingTableName(instanceId);
    const startDate = process.env.SYNC_START_DATE || null;
    const endDate   = process.env.SYNC_END_DATE   || null;

    try {
      let dateConditions = '';
      const reqCount = this.newPool.request();
      const reqClaim = this.newPool.request();

      const dateExpr = `COALESCE(
        TRY_CONVERT(datetime2, [Created], 121),
        TRY_CONVERT(datetime2, [Modified], 121),
        TRY_CONVERT(datetime2, [NgayDen], 105),
        TRY_CONVERT(datetime2, [NgayDen], 120),
        TRY_CONVERT(datetime2, [NgayDen], 121),
        TRY_CONVERT(datetime2, [NgayDen])
      )`;

      if (startDate) {
        dateConditions += ` AND ${dateExpr} >= @startDate`;
        reqCount.input('startDate', startDate);
        reqClaim.input('startDate', startDate);
      }
      if (endDate) {
        dateConditions += ` AND ${dateExpr} <= @endDate`;
        reqCount.input('endDate', endDate);
        reqClaim.input('endDate', endDate);
      }

      // Debug count trước khi fetch
      const countResult = await reqCount.query(`
          SELECT COUNT(1) AS cnt,
                 MIN(${dateExpr}) AS minDate,
                 MAX(${dateExpr}) AS maxDate
          FROM ${stagingTable}
          WHERE ISNULL(MigrateFlg, 0) = 0
            AND ISNULL(MigrateErrFlg, 0) = 0
            ${dateConditions}
        `);

      const available = Number(countResult?.recordset?.[0]?.cnt || 0);
      logger.debug(
        `[${this.modelName}] Available in staging: ${available} | ` +
        `range=[${countResult?.recordset?.[0]?.minDate} → ${countResult?.recordset?.[0]?.maxDate}] | ` +
        `filter=[${startDate} → ${endDate}]`
      );

      if (available === 0) return null;

      // Atomic claim with CTE
      const claimQuery = `
        WITH CTE AS (
          SELECT TOP (1) *
          FROM ${stagingTable} WITH (UPDLOCK, ROWLOCK, READPAST)
          WHERE ISNULL(MigrateFlg, 0) = 0
            AND ISNULL(MigrateErrFlg, 0) = 0
            ${dateConditions}
          ORDER BY TRY_CONVERT(datetime2, Modified) DESC,
                   TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(ID)), '')) DESC
        )
        UPDATE CTE
        SET MigrateFlg          = 2,
            MigrateErrMess      = 'Processing...',
            processing_owner    = @owner,
            processing_started_at   = SYSUTCDATETIME(),
            processing_heartbeat_at = SYSUTCDATETIME()
        OUTPUT inserted.*
      `;

      reqClaim.input('owner', `pid_${process.pid}_${instanceId}`);
      const claimResult = await reqClaim.query(claimQuery);

      const rows = claimResult?.recordset;
      if (!rows?.length) return null;

      logger.info(`[${this.modelName}] Claimed staging row ID=${rows[0].ID}`);
      return rows[0];

    } catch (error) {
      logger.error(`[${this.modelName}] fetchOneFromStaging failed: ${error.message}`);
      throw error;
    }
  }

  // ──────────────────────────────────────────────
  // Mark success / failure
  // ──────────────────────────────────────────────

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
  // Stats
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
