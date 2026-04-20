const logger = require('../../../utils/logger');
const dbConnection = require('../../../db/connection');
const BaseSyncModel = require('../../sync-base/BaseSyncModel');
const Extractor = require('./Extractor');
const Loader = require('./Loader');

/**
 * Sync model for outgoing documents.
 * Coordinates Extract → Load phases with multi-instance support.
 */
class SyncOutgoingModel extends BaseSyncModel {
  constructor() {
    const extractor = new Extractor();
    const loader = null; // Will be created after we have pools

    super({
      modelName: 'SYNC_OUTGOING',
      extractor,
      loader
    });

    this.oldPool = null;
    this.newPool = null;
    this.loader = null;
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

    // Initialize database pools via dbConnection
    await dbConnection.connectAll();
    this.oldPool = dbConnection.getOldPool();
    this.newPool = dbConnection.getNewPool();

    // Set pools on extractor (skip its initialize to avoid double-connect)
    this.extractor.oldPool = this.oldPool;
    this.extractor.newPool = this.newPool;

    // Ensure staging table exists
    await this.extractor.ensureStagingTableExists(instanceId);

    // Initialize loader with pools
    this.loader = new Loader(this.newPool, this.oldPool);
    await this.loader.initialize();

    logger.info(`[${this.modelName}] Initialized with instanceId=${instanceId}`);
  }

  /**
   * Run the extract phase (OLD DB → Staging)
   * @returns {Promise<{extractedCount: number}>}
   */
  async runExtract() {
    logger.info(`[${this.modelName}] Starting extract phase...`);
    let totalExtracted = 0;
    let lastSyncTime = '2999-12-31T23:59:59.999Z'; // Start from max time for DESC ordering
    let lastSyncId = 0;
    let hasMore = true;

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
   * Run the load phase (Staging → Main Table)
   * @returns {Promise<{processedCount: number, successCount: number, failedCount: number}>}
   */
  async runLoad() {
    logger.info(`[${this.modelName}] Starting load phase...`);
    let totalProcessed = 0;
    let totalSuccess = 0;
    let totalFailed = 0;

    // Start heartbeat timer
    let heartbeatTimer = null;
    let currentRowId = null;

    const startHeartbeat = (rowId) => {
      currentRowId = rowId;
      heartbeatTimer = setInterval(async () => {
        if (currentRowId) {
          await this.loader.updateHeartbeat(this.instanceId, currentRowId);
        }
      }, this.heartbeatIntervalMs);
    };

    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      currentRowId = null;
    };

    try {
      while (!this.shouldStop) {
        const row = await this.loader.fetchOneFromStaging(this.instanceId);

        if (!row) {
          break;
        }

        totalProcessed++;
        startHeartbeat(row.ID);

        try {
          const result = await this.loader.processRecord(row);

          if (result.success) {
            await this.loader.markSuccess(this.instanceId, row.ID);
            totalSuccess++;
          } else {
            await this.loader.markFailed(this.instanceId, row.ID, result.error);
            totalFailed++;
          }
        } catch (error) {
          await this.loader.markFailed(this.instanceId, row.ID, error.message);
          totalFailed++;
          logger.error(`[${this.modelName}] Failed to process row ID=${row.ID}: ${error.message}`);
        }

        stopHeartbeat();

        if (totalProcessed % 100 === 0) {
          const stats = await this.loader.getStats(this.instanceId);
          logger.info(`[${this.modelName}] Progress: ${totalProcessed} processed, ${stats.pending} pending, ${stats.success} success, ${stats.failed} failed`);
        }
      }
    } finally {
      stopHeartbeat();
    }

    logger.info(`[${this.modelName}] Load phase complete. Total: ${totalProcessed}, Success: ${totalSuccess}, Failed: ${totalFailed}`);
    return { processedCount: totalProcessed, successCount: totalSuccess, failedCount: totalFailed };
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
    if (!this.loader) {
      return { isRunning: this.isRunning, instanceId: this.instanceId };
    }

    const stats = await this.loader.getStats(this.instanceId);
    return {
      isRunning: this.isRunning,
      instanceId: this.instanceId,
      ...stats
    };
  }
}

module.exports = SyncOutgoingModel;
