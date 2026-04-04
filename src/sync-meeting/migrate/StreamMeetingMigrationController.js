const BaseController = require('../../../controllers/BaseController');
const logger = require('../../../utils/logger');
const StreamMeetingMigrationService = require('./StreamMeetingMigrationService');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class StreamMeetingMigrationController extends BaseController {
    constructor() {
        super();
        this.service = new StreamMeetingMigrationService();
    }

    /**
     * @openapi
     * /sync-meeting/migrate/test-get-list:
     *   post:
     *     tags: [Sync Meeting]
     *     summary: Thử nghiệm lấy danh sách lịch họp cần đồng bộ.
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
     *         description: Danh sách các lịch họp tìm được.
     */
    testGetList = this.asyncHandler(async (req, res) => {
        const lastSyncTime = req.body?.lastSyncTime || req.query?.lastSyncTime || DEFAULT_SYNC_TIME;
        const syncJobId = req.body?.syncJobId || req.query?.syncJobId || null;

        try {
            await this.service.initialize();
            const result = await this.service.testGetList({ lastSyncTime, syncJobId });
            return this.success(res, result, 'Unit test getList thành công.');
        } catch (error) {
            logger.error('[StreamMeetingMigrationController.testGetList] Error:', error);
            return this.error(res, 'Unit test getList thất bại.', 500, error);
        }
    });

    /**
     * @openapi
     * /sync-meeting/migrate/test-process-one:
     *   post:
     *     tags: [Sync Meeting]
     *     summary: Thử nghiệm xử lý một bản ghi lịch họp.
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
     *                 description: ID bản ghi để xử lý.
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
            return this.success(res, result, 'Unit test processOne thành công.');
        } catch (error) {
            logger.error('[StreamMeetingMigrationController.testProcessOne] Error:', error);
            return this.error(res, 'Unit test processOne thất bại.', 500, error);
        }
    });
}

module.exports = new StreamMeetingMigrationController();
