const BaseController = require('../../../controllers/BaseController');
const logger = require('../../../utils/logger');
const StreamTaskMigrationService = require('./StreamTaskMigrationService');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class StreamTaskMigrationController extends BaseController {
  constructor() {
    super();
    this.service = new StreamTaskMigrationService();
  }

  /**
   * HTTP endpoint (POST) để test việc lấy danh sách task cần sync.
   * Body/query: { lastSyncTime?, syncJobId? }
   * Trả về object kết quả từ `service.taskGetList`.
   */
  taskGetList = this.asyncHandler(async (req, res) => {
    const lastSyncTime = req.body?.lastSyncTime || req.query?.lastSyncTime || DEFAULT_SYNC_TIME;
    const syncJobId = req.body?.syncJobId || req.query?.syncJobId || null;

    try {
      await this.service.initialize();
      const result = await this.service.taskGetList({ lastSyncTime, syncJobId });
      return this.success(res, result, 'Unit test getList thành công.');
    } catch (error) {
      logger.error('[StreamTaskMigrationController.taskGetList] Error:', error);
      return this.error(res, 'Unit test getList thất bại.', 500, error);
    }
  });

  /**
   * HTTP endpoint (POST) để test xử lý một mục trong buffer của job.
   * Body/query: { syncJobId }
   * Trả về kết quả từ `service.taskProcessOne`.
   */
  taskProcessOne = this.asyncHandler(async (req, res) => {
    const syncJobId = req.body?.syncJobId || req.query?.syncJobId;

    if (!syncJobId) {
      return this.error(res, 'syncJobId là bắt buộc.', 400);
    }

    try {
      await this.service.initialize();
      const result = await this.service.taskProcessOne(syncJobId);
      return this.success(res, result, 'Unit test processOne thành công.');
    } catch (error) {
      logger.error('[StreamTaskMigrationController.taskProcessOne] Error:', error);
      return this.error(res, 'Unit test processOne thất bại.', 500, error);
    }
  });
}

module.exports = new StreamTaskMigrationController();
