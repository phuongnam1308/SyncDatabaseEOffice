const logger = require('../../../utils/logger');
const dbConnection = require('../../../db/connection');
const Extractor = require('./Extractor');
const Loader = require('./Loader');

class SyncTaskSharePointModel {
  constructor() {
    this.modelName = 'STREAM_TASK_SHAREPOINT';
    this.instanceId = null;
    this.syncJobId = null;
    this.isRunning = false;
    this.shouldStop = false;

    this.extractor = new Extractor();
    this.loader = null;
    this.newPool = null;
    this.oldPool = null;
  }

  async initialize(instanceId, syncJobId) {
    this.instanceId = instanceId || `pid_${process.pid}`;
    this.syncJobId = syncJobId;

    await dbConnection.connectAll();
    this.oldPool = dbConnection.getOldPool();
    this.newPool = dbConnection.getNewPool();

    await this.extractor.initialize(this.newPool);
    this.loader = new Loader(this.newPool, this.oldPool);
    await this.loader.initialize();

    logger.info(`[${this.modelName}] Initialized instanceId=${this.instanceId}`);
  }

  async run() {
    this.isRunning = true;
    this.shouldStop = false;

    let totalExtracted = 0;
    let totalProcessed = 0;
    let totalSuccess = 0;
    let totalFailed = 0;

    try {
      // 1. Extraction Phase
      const extractResult = await this.extractor.runExtract();
      totalExtracted = extractResult.extractedCount;

      // Update sync_jobs with total
      if (this.syncJobId) {
        await this.newPool.request()
          .input('syncJobId', this.syncJobId)
          .input('total', totalExtracted)
          .query(`UPDATE sync_jobs SET total_to_sync = @total, updated_at = SYSUTCDATETIME() WHERE job_id = @syncJobId`);
      }

      // 2. Loading Phase (Batch Processing)
      const batchSize = Number(process.env.SYNC_BATCH_SIZE || 100);
      
      while (!this.shouldStop) {
        const records = await this.loader.fetchBatchFromStaging(batchSize);
        if (records.length === 0) break;

        const result = await this.loader.processRecords(records);
        
        totalProcessed += records.length;
        totalSuccess += result.successIds.length;
        totalFailed += result.failedRecords.length;

        // Update sync_jobs progress
        if (this.syncJobId) {
          await this._updateJobStats(result.successIds.length, result.failedRecords.length);
        }

        logger.info(`[${this.modelName}] Processed batch of ${records.length}. Total success: ${totalSuccess}`);
      }

      return {
        extractedCount: totalExtracted,
        processedCount: totalProcessed,
        successCount: totalSuccess,
        failedCount: totalFailed
      };
    } finally {
      this.isRunning = false;
    }
  }

  async _updateJobStats(successInc, errorInc) {
    await this.newPool.request()
      .input('syncJobId', this.syncJobId)
      .input('successInc', successInc)
      .input('errorInc', errorInc)
      .query(`
        UPDATE sync_jobs
        SET total_processed = ISNULL(total_processed, 0) + (@successInc + @errorInc),
            total_success = ISNULL(total_success, 0) + @successInc,
            total_errors = ISNULL(total_errors, 0) + @errorInc,
            updated_at = SYSUTCDATETIME()
        WHERE job_id = @syncJobId
      `);
  }

  stop() {
    this.shouldStop = true;
    logger.info(`[${this.modelName}] Stop requested`);
  }

  async getProgress() {
    if (!this.syncJobId) return { isRunning: this.isRunning };
    const result = await this.newPool.request()
      .input('jobId', this.syncJobId)
      .query(`SELECT total_to_sync, total_processed, total_success, total_errors FROM sync_jobs WHERE job_id = @jobId`);
    const stats = result.recordset?.[0] || {};
    return {
      isRunning: this.isRunning,
      instanceId: this.instanceId,
      syncJobId: this.syncJobId,
      stats
    };
  }
}

module.exports = SyncTaskSharePointModel;
