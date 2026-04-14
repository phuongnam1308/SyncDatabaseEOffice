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
   * @openapi
   * /sync-passport/migrate/test-get-list:
   *   post:
   *     tags: [Sync Passport]
   *     summary: Thử nghiệm lấy danh sách phiếu mượn hộ chiếu cần đồng bộ.
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               lastSyncTime:
   *                 type: string
   *                 format: date-time
   *                 description: Thời điểm đồng bộ cuối (mặc định 1970).
   *               syncJobId:
   *                 type: string
   *                 description: ID của job đồng bộ hiện tại.
   *     responses:
   *       200:
   *         description: Danh sách các phiếu mượn hộ chiếu tìm được.
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
   * @openapi
   * /sync-passport/migrate/test-process-one:
   *   post:
   *     tags: [Sync Passport]
   *     summary: Thử nghiệm xử lý (đồng bộ) một bản ghi phiếu mượn hộ chiếu.
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - syncJobId
   *             properties:
   *               syncJobId:
   *                 type: string
   *                 description: ID của bản ghi/ID Job để xử lý.
   *     responses:
   *       200:
   *         description: Kết quả xử lý bản ghi.
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
