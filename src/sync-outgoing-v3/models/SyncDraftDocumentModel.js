const logger = require('../../../utils/logger');
const dbConnection = require('../../../db/connection');
const BaseSyncModel = require('../../sync-base/BaseSyncModel');
const DraftDocumentExtractor = require('./DraftDocumentExtractor');
const DraftDocumentUpsertHandler = require('./DraftDocumentUpsertHandler');

/**
 * Sync model for Draft Documents (Văn bản dự thảo).
 * Coordinates Extract → Load phases with multi-instance support.
 * Source: SNP.CodeItem (same DB as VanBanBanHanh, different schema)
 * Target: outgoing_documents table (same as VanBanBanHanh)
 */
class SyncDraftDocumentModel extends BaseSyncModel {
  constructor() {
    const extractor = new DraftDocumentExtractor();

    super({
      modelName: 'SYNC_DRAFT_DOCUMENT',
      extractor,
      loader: null
    });

    this.oldPool = null;
    this.newPool = null;
    this.upsertHandler = null;
    this.instanceId = null;
    this.isRunning = false;
    this.shouldStop = false;

    // Configuration
    this.extractBatchSize = Number(process.env.EXTRACT_BATCH_SIZE || 1000);
    this.extractParallelBatches = Number(process.env.EXTRACT_PARALLEL_BATCHES || 3);
    this.loadBatchSize = Number(process.env.LOAD_BATCH_SIZE || 1);
    this.heartbeatIntervalMs = Number(process.env.HEARTBEAT_INTERVAL_MS || 30000);
  }

  /**
   * Initialize the sync model
   * @param {string} instanceId
   */
  async initialize(instanceId) {
    this.instanceId = instanceId;

    // Initialize database pools (old DB chứa cả VanBanBanHanh và SNP.CodeItem)
    await dbConnection.connectAll();

    this.oldPool = dbConnection.getOldPool();
    this.newPool = dbConnection.getNewPool();

    // Set pools on extractor
    this.extractor.oldPool = this.oldPool;
    this.extractor.newPool = this.newPool;

    // Ensure staging table exists
    await this.extractor.ensureStagingTableExists(instanceId);

    // Initialize upsert handler with pools
    this.upsertHandler = new DraftDocumentUpsertHandler(this.newPool, this.oldPool);
    await this.upsertHandler.initialize();

    logger.info(`[${this.modelName}] Initialized with instanceId=${instanceId}`);
  }

  /**
   * Run the extract phase (SNP.CodeItem → Staging)
   * @returns {Promise<{extractedCount: number}>}
   */
  async runExtract() {
    logger.info(`[${this.modelName}] Starting extract phase...`);
    let totalExtracted = 0;
    const lastCursor = await this.extractor.getLastSyncCursor(this.instanceId);
    let lastSyncTime = lastCursor.time || this.extractor.getInitialSyncTime();
    let lastSyncId = lastCursor.id || 0;
    let hasMore = true;

    logger.info(`[${this.modelName}] Resuming extraction from cursor: time=${lastSyncTime}, id=${lastSyncId}`);

    while (hasMore && !this.shouldStop) {
      const batch = await this.extractor.fetchBatchFromOldDb(
        lastSyncTime,
        lastSyncId,
        this.extractBatchSize
      );

      if (!batch || batch.length === 0) {
        hasMore = false;
        break;
      }

      await this.extractor.syncBatchToStaging(batch, this.instanceId);
      totalExtracted += batch.length;

      // Update cursor to last row in batch
      const lastRow = batch[batch.length - 1];
      lastSyncTime = lastRow.__sync_time;
      lastSyncId = lastRow.__sync_id;

      logger.info(`[${this.modelName}] Extracted ${totalExtracted} records so far...`);

      if (batch.length < this.extractBatchSize) {
        hasMore = false;
      }
    }

    logger.info(`[${this.modelName}] Extract phase complete. Total: ${totalExtracted}`);
    return { extractedCount: totalExtracted };
  }

  /**
   * Run the load phase (Staging → Main Table via UpsertHandler)
   * @returns {Promise<{processedCount: number, successCount: number, failedCount: number}>}
   */
  async runLoad() {
    logger.info(`[${this.modelName}] Starting load phase...`);
    let totalProcessed = 0;
    let totalSuccess = 0;
    let totalFailed = 0;

    const stagingTable = this.extractor.getStagingTableName(this.instanceId);
    const batchSize = Number(process.env.DRAFT_LOAD_BATCH_SIZE || 20);

    try {
      while (!this.shouldStop) {
        const rows = await this.fetchBatchFromStaging(stagingTable, batchSize);

        if (!rows || rows.length === 0) {
          break;
        }

        totalProcessed += rows.length;

        try {
          const batchResult = await this.upsertHandler.processBatch(rows);
          totalSuccess += batchResult.successCount || 0;
          totalFailed += batchResult.failedCount || 0;

          for (const item of batchResult.results || []) {
            if (item.success) {
              await this.markSuccess(stagingTable, item.ID);
            } else {
              await this.markFailed(stagingTable, item.ID, item.error);
              logger.error(`[${this.modelName}] Failed to process row ID=${item.ID}: ${item.error}`);
            }
          }
        } catch (error) {
          logger.error(`[${this.modelName}] Failed to process batch: ${error.message}`);
          for (const row of rows) {
            await this.markFailed(stagingTable, row.ID, error.message);
          }
          totalFailed += rows.length;
        }

        if (totalProcessed % 100 === 0) {
          logger.info(`[${this.modelName}] Progress: ${totalProcessed} processed, ${totalSuccess} success, ${totalFailed} failed`);
        }
      }
    } catch (error) {
      logger.error(`[${this.modelName}] Load phase error: ${error.message}`);
    }

    logger.info(`[${this.modelName}] Load phase complete. Total: ${totalProcessed}, Success: ${totalSuccess}, Failed: ${totalFailed}`);
    return { processedCount: totalProcessed, successCount: totalSuccess, failedCount: totalFailed };
  }

  /**
   * Fetch one pending record from staging table
   */
  async fetchOneFromStaging(stagingTable) {
    try {
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

      // Mark as processing
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
        .input('owner', `pid_${process.pid}_${this.instanceId}`)
        .query(updateQuery);

      if (updateResult.rowsAffected[0] === 0) {
        return this.fetchOneFromStaging(stagingTable);
      }

      logger.info(`[${this.modelName}] Fetched staging row ID=${row.ID}`);
      return row;
    } catch (error) {
      logger.error(`[${this.modelName}] Failed to fetch from staging: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch a batch of pending records from staging table
   */
  async fetchBatchFromStaging(stagingTable, batchSize = 20) {
    try {
      const selectQuery = `
        SELECT TOP (@batchSize) *
        FROM ${stagingTable} WITH (READPAST, ROWLOCK)
        WHERE ISNULL(MigrateFlg, 0) = 0
          AND ISNULL(MigrateErrFlg, 0) = 0
        ORDER BY __sync_time ASC, __sync_id ASC, ID ASC;
      `;

      const rows = await this.newPool.request()
        .input('batchSize', batchSize)
        .query(selectQuery);

      const batchRows = rows.recordset || [];
      if (batchRows.length === 0) {
        return [];
      }

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

      const markRequest = this.newPool.request().input('owner', `pid_${process.pid}_${this.instanceId}`);
      ids.forEach((id, index) => {
        markRequest.input(`id${index}`, id);
      });
      await markRequest.query(markQuery);

      return batchRows;
    } catch (error) {
      logger.error(`[${this.modelName}] Failed to fetch batch from staging: ${error.message}`);
      throw error;
    }
  }

  /**
   * Mark record as success
   */
  async markSuccess(stagingTable, id) {
    const query = `
      UPDATE ${stagingTable} WITH (ROWLOCK)
      SET MigrateFlg = 1,
          MigrateErrFlg = 0,
          MigrateErrMess = NULL
      WHERE ID = @ID
    `;
    await this.newPool.request().input('ID', id).query(query);
  }

  /**
   * Mark record as failed
   */
  async markFailed(stagingTable, id, errorMessage) {
    const query = `
      UPDATE ${stagingTable} WITH (ROWLOCK)
      SET MigrateFlg = 3,
          MigrateErrFlg = 1,
          MigrateErrMess = @errorMessage
      WHERE ID = @ID
    `;
    await this.newPool.request()
      .input('ID', id)
      .input('errorMessage', errorMessage)
      .query(query);
  }

  /**
   * Run the full sync process (Extract + Load)
   */
  async run() {
    this.isRunning = true;
    this.shouldStop = false;

    try {
      // Extract phase
      const extractResult = await this.runExtract();

      // Load phase
      const loadResult = await this.runLoad();

      return {
        extractedCount: extractResult.extractedCount,
        processedCount: loadResult.processedCount,
        successCount: loadResult.successCount,
        failedCount: loadResult.failedCount
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Request graceful stop
   */
  stop() {
    this.shouldStop = true;
    logger.info(`[${this.modelName}] Stop requested`);
  }

  /**
   * Get current progress
   */
  async getProgress() {
    return {
      isRunning: this.isRunning,
      instanceId: this.instanceId
    };
  }
}

module.exports = SyncDraftDocumentModel;
