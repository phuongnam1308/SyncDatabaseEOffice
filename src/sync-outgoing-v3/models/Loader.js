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
   * Process a batch of staging records
   * @param {Array} rows - Staging records
   * @returns {Promise<{successIds: Array, failedRecords: Array}>}
   */
  async processBatch(rows) {
    if (!this.upsertHandler) {
      throw new Error('UpsertHandler not initialized');
    }
    return this.upsertHandler.processBatch(rows);
  }

  /**
   * Fetch a batch of records from staging for batch processing
   */
  async fetchBatchFromStaging(instanceId, batchSize = 50) {
    const stagingTable = this.getStagingTableName(instanceId);

    try {
      const countQuery = `
        SELECT COUNT(1) AS cnt
        FROM ${stagingTable}
        WHERE ISNULL(MigrateFlg, 0) = 0
          AND ISNULL(MigrateErrFlg, 0) = 0
      `;
      const countResult = await this.newPool.request().query(countQuery);
      const availableCount = Number(countResult?.recordset?.[0]?.cnt || 0);

      if (availableCount === 0) {
        return [];
      }

      const query = `
        UPDATE TOP (@batchSize) ${stagingTable} WITH (UPDLOCK, READPAST, ROWLOCK)
        SET MigrateFlg = 2,
            MigrateErrMess = 'Processing Batch...',
            processing_owner = @owner,
            processing_started_at = SYSUTCDATETIME(),
            processing_heartbeat_at = SYSUTCDATETIME()
        OUTPUT inserted.*
        WHERE ISNULL(MigrateFlg, 0) = 0
          AND ISNULL(MigrateErrFlg, 0) = 0
          ;
      `;

      const request = this.newPool.request()
        .input('batchSize', batchSize)
        .input('owner', `pid_${process.pid}_${instanceId}`);

      const updateResult = await request.query(query);

      const rows = updateResult.recordset || [];
      if (rows.length > 0) {
        logger.info(`[${this.modelName}] Fetched batch of ${rows.length} staging records for processing`);
      }
      return rows;
    } catch (error) {
      logger.error(`[${this.modelName}] Failed to fetch batch from staging: ${error.message}`);
      throw error;
    }
  }

  /**
   * Mark a batch of staging records as successfully processed
   */
  async markBatchSuccess(instanceId, rowIds) {
    if (!rowIds || rowIds.length === 0) return;
    
    const stagingTable = this.getStagingTableName(instanceId);
    const idList = rowIds.join(',');

    const query = `
      UPDATE ${stagingTable} WITH (ROWLOCK)
      SET MigrateFlg = 1,
          MigrateErrFlg = 0,
          MigrateErrMess = NULL,
          processing_owner = NULL,
          processing_heartbeat_at = NULL
      WHERE ID IN (${idList})
    `;

    await this.newPool.request().query(query);
    logger.info(`[${this.modelName}] Marked success for ${rowIds.length} staging rows`);
  }

  /**
   * Mark a batch of staging records as failed
   */
  async markBatchFailed(instanceId, failedRecords) {
    if (!failedRecords || failedRecords.length === 0) return;
    
    const stagingTable = this.getStagingTableName(instanceId);
    const request = this.newPool.request();
    let queryParts = [];
    
    failedRecords.forEach((item, index) => {
      queryParts.push(`
        UPDATE ${stagingTable} WITH (ROWLOCK)
        SET MigrateFlg = 0,
            MigrateErrFlg = 1,
            MigrateErrMess = @err${index},
            processing_owner = NULL,
            processing_heartbeat_at = NULL
        WHERE ID = @id${index};
      `);
      request.input(`id${index}`, item.id);
      request.input(`err${index}`, String(item.error || 'Unknown error').substring(0, 4000));
    });

    await request.query(queryParts.join('\n'));
    logger.info(`[${this.modelName}] Marked failed for ${failedRecords.length} staging rows`);
  }
}

module.exports = Loader;
