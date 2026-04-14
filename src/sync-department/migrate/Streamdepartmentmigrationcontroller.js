const BaseController = require('../../../controllers/BaseController');
const logger = require('../../../utils/logger');
const StreamDepartmentMigrationService = require('./StreamDepartmentMigrationService');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class StreamDepartmentMigrationController extends BaseController {
  constructor() {
    super();
    this.service = new StreamDepartmentMigrationService();
  }

  /**
   * POST /migrate/dept/test-get-list
   * Body/query: { lastSyncTime?, syncJobId? }
   * Trả về danh sách phòng ban distinct từ CSDL cũ + thông tin staging.
   */
  testGetList = this.asyncHandler(async (req, res) => {
    const lastSyncTime = req.body?.lastSyncTime || req.query?.lastSyncTime || DEFAULT_SYNC_TIME;
    const syncJobId    = req.body?.syncJobId    || req.query?.syncJobId    || null;

    try {
      await this.service.initialize();
      const result = await this.service.testGetList({ lastSyncTime, syncJobId });
      return this.success(res, result, 'Unit test getList phòng ban thành công.');
    } catch (error) {
      logger.error('[StreamDepartmentMigrationController.testGetList] Error:', error);
      return this.error(res, 'Unit test getList phòng ban thất bại.', 500, error);
    }
  });

  /**
   * POST /migrate/dept/test-process-one
   * Body/query: { syncJobId }
   * Xử lý một phòng ban tiếp theo trong staging → insert vào organization_units nếu chưa có.
   */
  testProcessOne = this.asyncHandler(async (req, res) => {
    const syncJobId = req.body?.syncJobId || req.query?.syncJobId;

    if (!syncJobId) {
      return this.error(res, 'syncJobId là bắt buộc.', 400);
    }

    try {
      await this.service.initialize();
      const result = await this.service.testProcessOne(syncJobId);
      return this.success(res, result, 'Unit test processOne phòng ban thành công.');
    } catch (error) {
      logger.error('[StreamDepartmentMigrationController.testProcessOne] Error:', error);
      return this.error(res, 'Unit test processOne phòng ban thất bại.', 500, error);
    }
  });
}

module.exports = new StreamDepartmentMigrationController();