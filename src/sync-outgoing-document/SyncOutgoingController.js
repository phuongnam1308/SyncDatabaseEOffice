// sync-outgoing.controller.js
const BaseController = require('../../controllers/BaseController');
const logger = require('../../utils/logger');
const SyncOutgoingService = require('./SyncOutgoingService');

class SyncOutgoingController extends BaseController {
  constructor() {
    super();
    this.service = new SyncOutgoingService();
  }

  /**
   * @swagger
   * /sync/outgoing-documents:
   *   post:
   *     summary: Sync dữ liệu từ bảng sync sang bảng chính
   *     tags: [Sync]
   */
  syncToMain = this.asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const { limit = 0, batch = 100, lastProcessedId = 0 } = req.body;

    if (batch <= 0) {
      return this.error(res, 'Batch size phải lớn hơn 0', 400);
    }

    logger.info(`🚀 BẮT ĐẦU SYNC - Limit: ${limit || 'ALL'}, Batch: ${batch}`);

    try {
      await this.service.initialize();
      const result = await this.service.sync({ limit, batch, lastProcessedId });
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info(`✅ SYNC HOÀN TẤT - Inserted: ${result.inserted}, Updated: ${result.updated}, Duration: ${duration}s`);

      return this.success(res, {
        inserted: result.inserted,
        updated: result.updated,
        totalProcessed: result.totalProcessed,
        batches: result.batches,
        duration: `${duration}s`
      }, 'Sync hoàn tất thành công');

    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.error(`❌ LỖI SYNC sau ${duration}s:`, error);
      return this.error(res, 'Sync bị lỗi', 500, { error: error.message, duration: `${duration}s` });
    }
  });

  getStatus = this.asyncHandler(async (req, res) => {
    try {
      await this.service.initialize();
      const status = await this.service.getStatus();
      return this.success(res, status, 'Lấy trạng thái thành công');
    } catch (error) {
      logger.error('Lỗi lấy status:', error);
      return this.error(res, 'Không thể lấy trạng thái', 500, { error: error.message });
    }
  });
}

module.exports = new SyncOutgoingController();