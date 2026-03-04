const BaseController = require('../../../controllers/BaseController');
const logger = require('../../../utils/logger');
const StreamDepartmentMigrationService = require('./StreamDepartmentMigrationService');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

/**
 * Controller for department migration.
 */
class StreamDepartmentMigrationController extends BaseController {
  constructor() {
    super();
    this.service = new StreamDepartmentMigrationService();
  }

  /**
   * HTTP endpoint (POST) to test fetching departments.
   */
  testGetList = this.asyncHandler(async (req, res) => {
    const lastSyncTime = req.body?.lastSyncTime || req.query?.lastSyncTime || DEFAULT_SYNC_TIME;
    const syncJobId = req.body?.syncJobId || req.query?.syncJobId || null;

    try {
      await this.service.initialize();
      const result = await this.service.testGetList({ lastSyncTime, syncJobId });
      return this.success(res, result, 'Unit test getList succeeded.');
    } catch (error) {
      logger.error('[StreamDepartmentMigrationController.testGetList] Error:', error);
      return this.error(res, 'Unit test getList failed.', 500, error);
    }
  });

  /**
   * HTTP endpoint (POST) to test processing one department.
   */
  testProcessOne = this.asyncHandler(async (req, res) => {
    const syncJobId = req.body?.syncJobId || req.query?.syncJobId;

    if (!syncJobId) {
      return this.error(res, 'syncJobId is required.', 400);
    }

    try {
      await this.service.initialize();
      const result = await this.service.testProcessOne(syncJobId);
      return this.success(res, result, 'Unit test processOne succeeded.');
    } catch (error) {
      logger.error('[StreamDepartmentMigrationController.testProcessOne] Error:', error);
      return this.error(res, 'Unit test processOne failed.', 500, error);
    }
  });
}

module.exports = new StreamDepartmentMigrationController();
