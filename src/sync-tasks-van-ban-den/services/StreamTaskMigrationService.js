const logger = require('../../../utils/logger');
const SyncTaskIncomingModel = require('../models/SyncTaskIncomingModel');

/** Task sync service */
class StreamTaskMigrationService {
  constructor() {
    this.model = null;
    this.instanceId = `pid_${process.pid}`;
  }

  /** Initialize service */
  async initialize() {
    try {
      if (!this.model) {
        this.model = new SyncTaskIncomingModel();
      }
      logger.info('[StreamTaskMigrationService] Initialized');
    } catch (error) {
      logger.error('[StreamTaskMigrationService.initialize]', error);
      throw error;
    }
  }

  /** Ensure initialized before operations */
  async ensureInitialized() {
    if (!this.model) {
      await this.initialize();
    }
  }

  async ensureModelReady(jobId) {
    await this.ensureInitialized();
    await this.model.initialize(this.instanceId, jobId);
  }

  /** Get task list from old DB and stage in new DB */
  async testGetList(jobId) {
    try {
      await this.ensureModelReady(jobId);
      const result = await this.model.runExtract();

      logger.info('[StreamTaskMigrationService.testGetList] Result:', result);

      return {
        success: true,
        jobId,
        ...result
      };
    } catch (error) {
      logger.error('[StreamTaskMigrationService.testGetList]', error);
      return {
        success: false,
        jobId,
        message: error.message,
        error
      };
    }
  }

  /** Process one staged task (transaction: task + users + logs) */
  async testProcessOne(jobId) {
    try {
      await this.ensureModelReady(jobId);
      const result = await this.model.processOne();

      logger.info('[StreamTaskMigrationService.testProcessOne] Result:', result);

      return {
        success: true,
        jobId,
        result
      };
    } catch (error) {
      logger.error('[StreamTaskMigrationService.testProcessOne]', error);
      return {
        success: false,
        jobId,
        message: error.message,
        error
      };
    }
  }

  /** Process all staged tasks: fetch -> stage -> process with transaction -> cleanup */
  async processAllAsync(jobId) {
    try {
      await this.ensureModelReady(jobId);

      logger.info(`[StreamTaskMigrationService.processAllAsync] Starting job ${jobId}`);
      const result = await this.model.run();
      logger.info('[StreamTaskMigrationService.processAllAsync] Completed:', result);

      return {
        success: true,
        jobId,
        ...result
      };
    } catch (error) {
      logger.error('[StreamTaskMigrationService.processAllAsync]', error);
      return {
        success: false,
        jobId,
        message: error.message,
        error
      };
    }
  }

  /** Get sync stats for job (pending count, status, etc) */
  async getSyncStats(jobId) {
    try {
      await this.ensureModelReady(jobId);
      const state = await this.model.getProgress();

      return {
        success: true,
        jobId,
        stats: state?.stats || state
      };
    } catch (error) {
      logger.error('[StreamTaskMigrationService.getSyncStats]', error);
      return {
        success: false,
        jobId,
        message: error.message,
        error
      };
    }
  }

  /** Reset sync job: cleanup staging & state */
  async resetSync(jobId) {
    try {
      await this.ensureModelReady(jobId);
      const taskCleanup = await this.model.cleanupStaging();

      logger.info(`[StreamTaskMigrationService.resetSync] Job ${jobId} reset:`, taskCleanup);

      return {
        success: taskCleanup.success,
        jobId,
        message: taskCleanup.message,
        cleanup: taskCleanup
      };
    } catch (error) {
      logger.error('[StreamTaskMigrationService.resetSync]', error);
      return {
        success: false,
        jobId,
        message: error.message,
        error
      };
    }
  }

  /** Get underlying model instance */
  getModel() {
    return this.model;
  }
}

// Singleton instance
let serviceInstance = null;

/** Singleton factory */
function getService() {
  if (!serviceInstance) {
    serviceInstance = new StreamTaskMigrationService();
  }
  return serviceInstance;
}

module.exports = StreamTaskMigrationService;
module.exports.getService = getService;
