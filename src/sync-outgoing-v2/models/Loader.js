const BaseLoader = require('../../sync-base/BaseLoader');
const logger = require('../../../utils/logger');
const UpsertHandler = require('./UpsertHandler');
const dbUtils = require('../../../utils/dbUtils');

/**
 * Loader for outgoing documents (outgoing_documents_sync_{instanceId} → outgoing_documents)
 */
class Loader extends BaseLoader {
  constructor(newPool, oldPool) {
    super({
      modelName: 'OUTGOING_LOADER',
      stagingTableBaseName: 'outgoing_documents_sync',
      mainTableName: 'outgoing_documents',
      partitionColumn: 'Created'
    });

    this.newPool = newPool;
    this.oldPool = oldPool;
    this.upsertHandler = null;
  }

  /**
   * Initialize loader with upsert handler
   * Note: pools are already set via constructor, no need for super.initialize()
   */
  async initialize() {
    this.upsertHandler = new UpsertHandler(this.newPool, this.oldPool);
    await this.upsertHandler.initialize();

    logger.info(`[${this.modelName}] Initialized with UpsertHandler`);
  }

  /**
   * Process a single staging record
   * @param {object} row - Staging record
   * @returns {Promise<{success: boolean, documentId: string|null, error: string|null}>}
   */
  async processRecord(row) {
    if (!this.upsertHandler) {
      throw new Error('UpsertHandler not initialized');
    }

    return this.upsertHandler.processRecord(row);
  }

  /**
   * Override fetchOneFromStaging for outgoing-specific logic
   */
  async fetchOneFromStaging(instanceId) {
    const stagingTable = this.getStagingTableName(instanceId);
    const startDate = process.env.SYNC_START_DATE || null;
    const endDate = process.env.SYNC_END_DATE || null;

    try {
      // Count available records
      const countQuery = `
        SELECT COUNT(1) AS cnt
        FROM ${stagingTable}
        WHERE ISNULL(MigrateFlg, 0) = 0
          AND ISNULL(MigrateErrFlg, 0) = 0
      `;
      const countResult = await this.newPool.request().query(countQuery);
      const availableCount = Number(countResult?.recordset?.[0]?.cnt || 0);

      if (availableCount === 0) {
        return null;
      }

      // Fetch one pending record
      const selectQuery = `
        SELECT TOP (1) *
        FROM ${stagingTable}
        WHERE ISNULL(MigrateFlg, 0) = 0
          AND ISNULL(MigrateErrFlg, 0) = 0
        ORDER BY Modified DESC, ID DESC
      `;

      const rows = await this.newPool.request().query(selectQuery);
      if (!rows.recordset?.length) {
        return null;
      }

      const row = rows.recordset[0];

      // Mark as processing with heartbeat
      const updateQuery = `
        UPDATE ${stagingTable} WITH (ROWLOCK)
        SET MigrateFlg = 2,
            MigrateErrMess = 'Processing...',
            processing_owner = @owner,
            processing_started_at = SYSUTCDATETIME(),
            processing_heartbeat_at = SYSUTCDATETIME()
        WHERE ID = @ID AND ISNULL(MigrateFlg, 0) = 0
      `;

      const updateResult = await this.newPool.request()
        .input('ID', row.ID)
        .input('owner', `pid_${process.pid}_${instanceId}`)
        .query(updateQuery);

      if (updateResult.rowsAffected[0] === 0) {
        // Another process got it, try again
        return this.fetchOneFromStaging(instanceId);
      }

      logger.info(`[${this.modelName}] Fetched staging row ID=${row.ID}`);
      return row;
    } catch (error) {
      logger.error(`[${this.modelName}] Failed to fetch from staging: ${error.message}`);
      throw error;
    }
  }
}

module.exports = Loader;
