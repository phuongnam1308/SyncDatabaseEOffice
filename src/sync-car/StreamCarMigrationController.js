const BaseController = require('../../controllers/BaseController');
const logger = require('../../utils/logger');
const StreamCarMigrationService = require('./StreamCarMigrationService');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class StreamCarMigrationController extends BaseController {
  constructor() {
    super();
    this.service = new StreamCarMigrationService();
  }

  testGetList = this.asyncHandler(async (req, res) => {
    const lastSyncTime = req.body?.lastSyncTime || req.query?.lastSyncTime || DEFAULT_SYNC_TIME;
    const syncJobId = req.body?.syncJobId || req.query?.syncJobId || null;
    try {
      await this.service.initialize();
      const result = await this.service.testGetList({ lastSyncTime, syncJobId });
      return this.success(res, result, 'Unit test getList thành công.');
    } catch (error) {
      logger.error('[StreamCarMigrationController.testGetList] Error:', error);
      return this.error(res, 'Unit test getList thất bại.', 500, error);
    }
  });

  testProcessOne = this.asyncHandler(async (req, res) => {
    const syncJobId = req.body?.syncJobId || req.query?.syncJobId;
    if (!syncJobId) return this.error(res, 'syncJobId là bắt buộc.', 400);
    try {
      await this.service.initialize();
      const result = await this.service.testProcessOne(syncJobId);
      return this.success(res, result, 'Unit test processOne thành công.');
    } catch (error) {
      logger.error('[StreamCarMigrationController.testProcessOne] Error:', error);
      return this.error(res, 'Unit test processOne thất bại.', 500, error);
    }
  });
}

module.exports = new StreamCarMigrationController();
