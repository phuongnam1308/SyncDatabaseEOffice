const BaseController = require('../../../controllers/BaseController');
const logger = require('../../../utils/logger');
const SyncIncomingDocumentService = require('./SyncIncomingDocumentService');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class SyncIncomingDocumentController extends BaseController {
    constructor() {
        super();
        this.service = new SyncIncomingDocumentService();
    }
    /**
   * HTTP endpoint (POST) để test việc lấy danh sách user cần sync.
   * Body/query: { lastSyncTime?, syncJobId? }
   * Trả về object kết quả từ `service.testGetList`.
   */
    testGetList = this.asyncHandler(async (req, res) => {
        const lastSyncTime = req.body?.lastSyncTime || req.query?.lastSyncTime || DEFAULT_SYNC_TIME;
        const syncJobId = req.body?.syncJobId || req.query?.syncJobId || null;
        try {
            await this.service.initialize();
            const result = await this.service.testGetList({ lastSyncTime, syncJobId });
            return this.success(res, result, 'Unit test getList thành công.');
        } catch (error) {
            logger.error('[SyncIncomingDocumentController.testGetList] Error:', error);
            return this.error(res, 'Unit test getList thất bại.', 500, error);
        }
    });
    /**
   * HTTP endpoint (POST) để test xử lý một mục trong buffer của job.
   * Body/query: { syncJobId }
   * Trả về kết quả từ `service.testProcessOne`.
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
            logger.error('[StreamUserMigrationController.testProcessOne] Error:', error);
            return this.error(res, 'Unit test processOne thất bại.', 500, error);
        }
    });

   
}

module.exports = new SyncIncomingDocumentController();
