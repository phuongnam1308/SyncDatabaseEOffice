const BaseController = require('../../../controllers/BaseController');
const logger = require('../../../utils/logger');
const StreamTaskMigrationService = require('../services/StreamTaskMigrationService');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

/**
 * Task sync controller - HTTP layer
 */
class StreamTaskMigrationController extends BaseController {
  constructor() {
    super();
    this.service = new StreamTaskMigrationService();
  }

  /**
   * Get task list from old DB and stage in new DB
   */
  testGetList = this.asyncHandler(async (req, res) => {
    const lastSyncTime = req.body?.lastSyncTime || req.query?.lastSyncTime || DEFAULT_SYNC_TIME;
    const syncJobId = req.body?.syncJobId || req.query?.syncJobId || null;

    try {
      await this.service.initialize();
      const result = await this.service.testGetList(syncJobId);
      return this.success(res, result, 'Fetched and staged tasks successfully');
    } catch (error) {
      logger.error('[StreamTaskMigrationController.testGetList]', error);
      return this.error(res, 'Failed to get task list', 500, error);
    }
  });

  /**
   * Process one staged task (with transaction: task + users + logs)
   */
  testProcessOne = this.asyncHandler(async (req, res) => {
    const syncJobId = req.body?.syncJobId || req.query?.syncJobId || null;

    try {
      await this.service.initialize();
      const result = await this.service.testProcessOne(syncJobId);
      return this.success(res, result, 'Processed one task successfully');
    } catch (error) {
      logger.error('[StreamTaskMigrationController.testProcessOne]', error);
      return this.error(res, 'Failed to process one task', 500, error);
    }
  });

  /**
   * Process all staged tasks: fetch → stage → process with transaction → cleanup
   */
  processAll = this.asyncHandler(async (req, res) => {
    const syncJobId = req.body?.syncJobId || req.query?.syncJobId || null;

    try {
      await this.service.initialize();
      const result = await this.service.processAllAsync(syncJobId);
      return this.success(res, result, 'Synced all tasks successfully (task + task_users + system_logs in atomic transactions)');
    } catch (error) {
      logger.error('[StreamTaskMigrationController.processAll]', error);
      return this.error(res, 'Failed to process all tasks', 500, error);
    }
  });

  /**
   * Get sync stats (pending count, status, etc)
   */
  getSyncStats = this.asyncHandler(async (req, res) => {
    const { syncJobId } = req.params;

    if (!syncJobId) {
      return this.error(res, 'syncJobId is required', 400);
    }

    try {
      await this.service.initialize();
      const result = await this.service.getSyncStats(syncJobId);
      return this.success(res, result, 'Retrieved sync statistics successfully');
    } catch (error) {
      logger.error('[StreamTaskMigrationController.getSyncStats]', error);
      return this.error(res, 'Failed to get sync statistics', 500, error);
    }
  });

  /**
   * Reset sync job: cleanup staging
   */
  resetSync = this.asyncHandler(async (req, res) => {
    const { syncJobId } = req.params;

    if (!syncJobId) {
      return this.error(res, 'syncJobId is required', 400);
    }

    try {
      await this.service.initialize();
      const result = await this.service.resetSync(syncJobId);
      return this.success(res, result, 'Reset sync job successfully');
    } catch (error) {
      logger.error('[StreamTaskMigrationController.resetSync]', error);
      return this.error(res, 'Failed to reset sync job', 500, error);
    }
  });
}

module.exports = new StreamTaskMigrationController();
