const BaseController = require('../../../controllers/BaseController');
const logger = require('../../../utils/logger');
const StreamPassportMigrationService = require('./StreamPassportMigrationService');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class StreamPassportMigrationController extends BaseController {
  constructor() {
    super();
    this.service = new StreamPassportMigrationService();
  }

  /**
   * HTTP endpoint (POST) để test lấy danh sách phiếu mượn hộ chiếu cần sync.
   * Body/query: { lastSyncTime?, syncJobId? }
   */
  testGetList = this.asyncHandler(async (req, res) => {
    const lastSyncTime = req.body?.lastSyncTime || req.query?.lastSyncTime || DEFAULT_SYNC_TIME;
    const syncJobId = req.body?.syncJobId || req.query?.syncJobId || null;

    try {
      await this.service.initialize();
      const result = await this.service.testGetList({ lastSyncTime, syncJobId });
      return this.success(res, result, 'Test getList phiếu mượn hộ chiếu thành công.');
    } catch (error) {
      logger.error('[StreamPassportMigrationController.testGetList] Error:', error);
      return this.error(res, 'Test getList phiếu mượn hộ chiếu thất bại.', 500, error);
    }
  });

  /**
   * HTTP endpoint (POST) để xử lý một phiếu mượn hộ chiếu (processOne).
   * Body/query: { syncJobId }
   */
  testProcessOne = this.asyncHandler(async (req, res) => {
    const syncJobId = req.body?.syncJobId || req.query?.syncJobId;

    if (!syncJobId) {
      return this.error(res, 'syncJobId là bắt buộc.', 400);
    }

    try {
      await this.service.initialize();
      const result = await this.service.testProcessOne(syncJobId);
      return this.success(res, result, 'Test processOne phiếu mượn hộ chiếu thành công.');
    } catch (error) {
      logger.error('[StreamPassportMigrationController.testProcessOne] Error:', error);
      return this.error(res, 'Test processOne phiếu mượn hộ chiếu thất bại.', 500, error);
    }
  });
}

module.exports = new StreamPassportMigrationController();
