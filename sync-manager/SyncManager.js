const logger = require('../utils/logger');
const { EventEmitter } = require('events');

class SyncJob extends EventEmitter {
  constructor(id, modelName) {
    super();
    this.id = id;
    this.modelName = modelName;
    this.status = 'pending';
    this.progress = 0;
    this.totalItems = 0;
    this.startTime = null;
    this.endTime = null;
    this.error = null;
  }

  async updateProgress(processedItems) {
    this.progress = (processedItems / this.totalItems) * 100;
    this.emit('progress', this);
  }
}

class SyncManager {
  constructor(modelName) {
    this.modelName = modelName;
    this.job = null;
  }

  async run(syncFn, options = {}) {
    const jobId = Date.now();
    this.job = new SyncJob(jobId, this.modelName);
    this.job.startTime = new Date();
    this.job.status = 'running';
    logger.info(`[SyncManager][${this.modelName}] Job ${jobId} started.`);

    try {
      const lastSyncTime = await this.getLastSyncTime();
      
      // Nếu syncFn là một object chứa count, fetch, process (theo pattern mới)
      if (typeof syncFn === 'object' && syncFn.count && syncFn.fetch && syncFn.process) {
        const total = await syncFn.count(lastSyncTime);
        this.job.totalItems = total;
        logger.info(`[SyncManager][${this.modelName}] Total items to sync: ${total}`);
        
        const batchSize = options.batchSize || 100;
        let processedCount = 0;

        for (let offset = 0; offset < total; offset += batchSize) {
          const batch = await syncFn.fetch(lastSyncTime, batchSize, offset);
          if (!batch || batch.length === 0) break;

          for (const item of batch) {
            await syncFn.process(item, this.job);
            processedCount++;
            await this.job.updateProgress(processedCount);
          }
          logger.info(`[SyncManager][${this.modelName}] Processed ${processedCount}/${total}`);
        }
      } else {
        // Fallback cho syncFn cũ (function duy nhất)
        await syncFn(lastSyncTime, this.job);
      }

      this.job.status = 'completed';
      this.job.endTime = new Date();
      logger.info(`[SyncManager][${this.modelName}] Job ${jobId} completed.`);
      await this.setLastSyncTime(this.job.startTime);
    } catch (error) {
      this.job.status = 'failed';
      this.job.error = error.message;
      this.job.endTime = new Date();
      logger.error(`[SyncManager][${this.modelName}] Job ${jobId} failed: ${error.message}`);
    }
  }

  async getLastSyncTime() {
    // This should be implemented to retrieve the last sync time from a persistent storage
    return null;
  }

  async setLastSyncTime(time) {
    // This should be implemented to store the last sync time in a persistent storage
  }
}

module.exports = SyncManager;
