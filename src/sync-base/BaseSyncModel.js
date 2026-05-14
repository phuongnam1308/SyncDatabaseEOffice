const logger = require('../../utils/logger');

/**
 * Base class for orchestrating the sync process.
 * Coordinates Extract → Load phases and manages job state.
 */
class BaseSyncModel {
  /**
   * @param {object} config
   * @param {string} config.modelName - Name of the model
   * @param {object} config.extractor - Instance of BaseExtractor
   * @param {object} config.loader - Instance of BaseLoader
   */
  constructor(config) {
    this.modelName = config.modelName || 'BASE_SYNC_MODEL';
    this.extractor = config.extractor;
    this.loader = config.loader;

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

    // Initialize extractor and loader
    if (this.extractor) {
      await this.extractor.initialize();
      await this.extractor.ensureStagingTableExists(instanceId);
    }

    if (this.loader) {
      await this.loader.initialize();
      await this.loader.resetProcessingRecords(instanceId);
      await this.loader.cleanupStaleRecords(instanceId);
    }

    logger.info(`[${this.modelName}] Initialized with instanceId=${instanceId}`);
  }

  /**
   * Run the extract phase (OLD DB → Staging)
   * @returns {Promise<{extractedCount: number}>}
   */
  async runExtract() {
    if (!this.extractor) {
      throw new Error('Extractor not configured');
    }

    logger.info(`[${this.modelName}] Starting extract phase...`);
    let totalExtracted = 0;
    let lastSyncTime = process.env.SYNC_MIN_DATE || '2999-12-31T23:59:59.999Z';
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

      // Update cursor
      const lastRow = batch[batch.length - 1];
      lastSyncTime = lastRow.__sync_time;
      lastSyncId = lastRow.__sync_id;

      logger.info(`[${this.modelName}] Extracted ${totalExtracted} records so far...`);

      // If less than batch size, we're done
      if (batch.length < this.extractBatchSize) {
        hasMore = false;
      }
    }

    logger.info(`[${this.modelName}] Extract phase complete. Total: ${totalExtracted}`);
    return { extractedCount: totalExtracted };
  }

  /**
   * Run the load phase (Staging → Main Table)
   * @param {function} processRecordFn - Function to process each record
   * @returns {Promise<{processedCount: number, successCount: number, failedCount: number}>}
   */
  async runLoad(processRecordFn) {
    if (!this.loader) {
      throw new Error('Loader not configured');
    }

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
        // Fetch one pending record from staging
        const row = await this.loader.fetchOneFromStaging(this.instanceId);

        if (!row) {
          // No more pending records
          break;
        }

        totalProcessed++;
        startHeartbeat(row.ID);

        try {
          // Process the record
          await processRecordFn(row);

          // Mark as success
          await this.loader.markSuccess(this.instanceId, row.ID);
          totalSuccess++;

        } catch (error) {
          // Mark as failed
          await this.loader.markFailed(this.instanceId, row.ID, error.message);
          totalFailed++;
          logger.error(`[${this.modelName}] Failed to process row ID=${row.ID}: ${error.message}`);
        }

        stopHeartbeat();

        // Log progress periodically
        if (totalProcessed % 100 === 0) {
          const stats = await this.loader.getStats(this.instanceId);
          logger.info(`[${this.modelName}] Progress: ${totalProcessed} processed, ${stats.pending} pending`);
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
   * @param {function} processRecordFn - Function to process each record
   */
  async run(processRecordFn) {
    this.isRunning = true;
    this.shouldStop = false;

    try {
      // Extract phase
      await this.runExtract();

      // Load phase
      const result = await this.runLoad(processRecordFn);

      return result;
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
   * @returns {Promise<object>}
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

module.exports = BaseSyncModel;
