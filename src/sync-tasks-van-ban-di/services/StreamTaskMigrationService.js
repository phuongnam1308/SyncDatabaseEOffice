const logger = require('../../../utils/logger');
const StreamTaskOutIncrementalModel = require('../models/StreamTaskOutIncrementalModel');

/** Task sync service */
class StreamTaskMigrationService {
  constructor() {
    this.model = null;
  }

  /** Initialize service */
  async initialize() {
    try {
      if (!this.model) {
        this.model = new StreamTaskOutIncrementalModel();
        await this.model.initialize();
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

  /** Get task list from old DB and stage in new DB */
  async testGetList(jobId) {
    try {
      await this.ensureInitialized();

      // Thực hiện fetch + stage
      const result = await this.model.getList(null, jobId);

      logger.info(`[StreamTaskMigrationService.testGetList] Result:`, result);

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
        error: error
      };
    }
  }

  /** Process one staged task (transaction: task + users + logs) */
  async testProcessOne(jobId) {
    try {
      await this.ensureInitialized();

      // Lấy 1 task từ staging và xử lý
      const result = await this.model.processOne(jobId);

      logger.info(`[StreamTaskMigrationService.testProcessOne] Result:`, result);

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
        error: error
      };
    }
  }

  /** Process all staged tasks: fetch → stage → process with transaction → cleanup */
  async processAllAsync(jobId) {
    try {
      await this.ensureInitialized();

      logger.info(`[StreamTaskMigrationService.processAllAsync] Starting job ${jobId}`);

      // Delegate to model
      const result = await this.model.processAllAsync(jobId);

      logger.info(`[StreamTaskMigrationService.processAllAsync] Completed:`, result);

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
        error: error
      };
    }
  }

  /** Get sync stats for job (pending count, status, etc) */
  async getSyncStats(jobId) {
    try {
      await this.ensureInitialized();

      const state = await this.model.getSyncJobState(jobId);

      return {
        success: true,
        jobId,
        stats: state
      };
    } catch (error) {
      logger.error('[StreamTaskMigrationService.getSyncStats]', error);
      return {
        success: false,
        jobId,
        message: error.message,
        error: error
      };
    }
  }

  /** Reset sync job: cleanup staging & state */
  async resetSync(jobId) {
    try {
      await this.ensureInitialized();

      // Cleanup staging tables
      const taskCleanup = await this.model.cleanupStagingTable();

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
        error: error
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
