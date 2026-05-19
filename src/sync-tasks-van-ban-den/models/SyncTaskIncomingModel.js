const logger = require('../../../utils/logger');
const dbConnection = require('../../../db/connection');
const Extractor = require('./Extractor');
const Loader = require('./Loader');

/**
 * Sync model for incoming tasks (TaskVBDen).
 * Structured similarly to sync-outgoing-v2: Extractor -> Loader.
 */
class SyncTaskIncomingModel {
  constructor() {
    this.modelName = 'SYNC_TASK_INCOMING';
    this.instanceId = null;
    this.syncJobId = null;
    this.isRunning = false;
    this.shouldStop = false;

    this.oldPool = null;
    this.newPool = null;
    this.extractor = new Extractor();
    this.loader = null;
  }

  async initialize(instanceId, syncJobId) {
    this.instanceId = instanceId || `pid_${process.pid}`;
    this.syncJobId = syncJobId;

    if (!this.syncJobId) {
      throw new Error('syncJobId is required');
    }

    await dbConnection.connectAll();
    this.oldPool = dbConnection.getOldPool();
    this.newPool = dbConnection.getNewPool();

    this.extractor.oldPool = this.oldPool;
    this.extractor.newPool = this.newPool;
    await this.extractor.initialize();
    // await this.extractor.ensureStagingTableExists(this.instanceId);

    this.loader = new Loader(this.newPool, this.oldPool);
    await this.loader.initialize();

    logger.info(`[${this.modelName}] Initialized instanceId=${this.instanceId}, syncJobId=${this.syncJobId}`);
  }

  async runExtract() {
    const result = await this.extractor.runExtract();
    await this.newPool.request()
      .input('syncJobId', this.syncJobId)
      .input('total', Number(result?.extractedCount || 0))
      .query(`
        UPDATE sync_jobs
        SET total_to_sync = @total,
            updated_at = SYSUTCDATETIME()
        WHERE job_id = @syncJobId
      `);
    return result;
  }

  async runLoad() {
    let totalProcessed = 0;
    let totalSuccess = 0;
    let totalFailed = 0;
    let heartbeatTimer = null;
    let currentRowId = null;

    const startHeartbeat = (rowId) => {
      currentRowId = rowId;
      heartbeatTimer = setInterval(async () => {
        if (!currentRowId) return;
        try {
          await this.loader.updateHeartbeat(this.instanceId, currentRowId);
        } catch (e) {
          // keep processing loop resilient
        }
      }, Number(process.env.HEARTBEAT_INTERVAL_MS || 30000));
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
        if (!row) break;

        totalProcessed += 1;
        startHeartbeat(row.ID);
        try {
          const result = await this.loader.processRecord(row);
          if (result?.success) {
            await this.loader.markSuccess(this.instanceId, row.ID);
            totalSuccess += 1;
            await this.incrementSyncJobCounters(1, 1, 0);
          } else {
            await this.loader.markFailed(this.instanceId, row.ID, result?.error || 'Unknown load error');
            totalFailed += 1;
            await this.incrementSyncJobCounters(1, 0, 1);
          }
        } catch (error) {
          await this.loader.markFailed(this.instanceId, row.ID, error.message);
          totalFailed += 1;
          await this.incrementSyncJobCounters(1, 0, 1);
        }
        stopHeartbeat();
      }
    } finally {
      stopHeartbeat();
    }

    return { processedCount: totalProcessed, successCount: totalSuccess, failedCount: totalFailed };
  }

  async run() {
    this.isRunning = true;
    this.shouldStop = false;

    try {
      const extractResult = await this.runExtract();
      if (this.shouldStop) {
        return {
          extractedCount: Number(extractResult?.extractedCount || 0),
          processedCount: 0,
          successCount: 0,
          failedCount: 0
        };
      }

      const loadResult = await this.runLoad();
      return {
        extractedCount: Number(extractResult?.extractedCount || 0),
        processedCount: Number(loadResult?.processedCount || 0),
        successCount: Number(loadResult?.successCount || 0),
        failedCount: Number(loadResult?.failedCount || 0)
      };
    } finally {
      this.isRunning = false;
    }
  }

  stop() {
    this.shouldStop = true;
    logger.info(`[${this.modelName}] Stop requested`);
  }

  async processOne() {
    if (!this.syncJobId) {
      throw new Error('syncJobId is required');
    }
    const row = await this.loader.fetchOneFromStaging(this.instanceId);
    if (!row) {
      return { done: true, processed: false };
    }
    const result = await this.loader.processRecord(row);
    if (result?.success) {
      await this.loader.markSuccess(this.instanceId, row.ID);
      await this.incrementSyncJobCounters(1, 1, 0);
      return { done: false, processed: true, result };
    }
    await this.loader.markFailed(this.instanceId, row.ID, result?.error || 'Unknown load error');
    await this.incrementSyncJobCounters(1, 0, 1);
    return { done: false, processed: false, result };
  }

  async getProgress() {
    if (!this.syncJobId) {
      return { isRunning: this.isRunning, instanceId: this.instanceId };
    }

    const stats = await this.getSyncJobState(this.syncJobId);
    return {
      isRunning: this.isRunning,
      instanceId: this.instanceId,
      syncJobId: this.syncJobId,
      stats
    };
  }

  async cleanupStaging() {
    const tableRef = `${process.env.NEW_DB_NAME}.dbo.task_sync`;
    await this.newPool.request().query(`TRUNCATE TABLE ${tableRef}`);
    return { success: true, message: `Truncated ${tableRef}` };
  }

  async getSyncJobState(syncJobId) {
    const result = await this.newPool.request()
      .input('syncJobId', syncJobId)
      .query(`
        SELECT TOP 1
          job_id,
          total_to_sync,
          total_processed,
          total_success,
          total_errors,
          last_sync_time,
          last_sync_id
        FROM sync_jobs
        WHERE job_id = @syncJobId
      `);
    return result.recordset?.[0] || null;
  }

  async incrementSyncJobCounters(processedInc, successInc, errorInc) {
    await this.newPool.request()
      .input('syncJobId', this.syncJobId)
      .input('processedInc', processedInc)
      .input('successInc', successInc)
      .input('errorInc', errorInc)
      .query(`
        UPDATE sync_jobs
        SET total_processed = ISNULL(total_processed, 0) + @processedInc,
            total_success = ISNULL(total_success, 0) + @successInc,
            total_errors = ISNULL(total_errors, 0) + @errorInc,
            updated_at = SYSUTCDATETIME()
        WHERE job_id = @syncJobId
      `);
  }
}

module.exports = SyncTaskIncomingModel;
