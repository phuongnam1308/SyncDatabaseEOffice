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

  async run(syncFn) {
    const jobId = Date.now();
    this.job = new SyncJob(jobId, this.modelName);
    this.job.startTime = new Date();
    this.job.status = 'running';
    logger.info(`[SyncManager][${this.modelName}] Job ${jobId} started.`);

    try {
      const lastSyncTime = await this.getLastSyncTime();
      await syncFn(lastSyncTime, this.job);
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
