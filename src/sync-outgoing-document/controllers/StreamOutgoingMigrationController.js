const BaseController = require('../../../controllers/BaseController');
const logger = require('../../../utils/logger');
const StreamOutgoingMigrationService = require('../services/StreamOutgoingMigrationService');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class StreamOutgoingMigrationController extends BaseController {
  constructor() {
    super();
    this.service = new StreamOutgoingMigrationService();
  }

  testGetList = this.asyncHandler(async (req, res) => {
    const lastSyncTime =
      req.body?.lastSyncTime ||
      req.query?.lastSyncTime ||
      DEFAULT_SYNC_TIME;

    const syncJobId =
      req.body?.syncJobId ||
      req.query?.syncJobId ||
      null;

    try {
      await this.service.initialize();
      const result = await this.service.testGetList({ lastSyncTime, syncJobId });

      return this.success(res, result, 'Test getList thành công.');
    } catch (error) {
      logger.error('[StreamOutgoingMigrationController.testGetList]', error);
      return this.error(res, 'Test getList thất bại.', 500, error);
    }
  });

  testProcessOne = this.asyncHandler(async (req, res) => {
    const syncJobId =
      req.body?.syncJobId ||
      req.query?.syncJobId;

    if (!syncJobId) {
      return this.error(res, 'syncJobId là bắt buộc.', 400);
    }

    try {
      await this.service.initialize();
      const result = await this.service.testProcessOne(syncJobId);

      return this.success(res, result, 'Test processOne thành công.');
    } catch (error) {
      logger.error('[StreamOutgoingMigrationController.testProcessOne]', error);
      return this.error(res, 'Test processOne thất bại.', 500, error);
    }
  });
}

module.exports = new StreamOutgoingMigrationController();