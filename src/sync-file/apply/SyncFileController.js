const BaseController = require('../../../controllers/BaseController');
const logger = require('../../../utils/logger');
const SyncFileService = require('./SyncFileService');

class SyncFileController extends BaseController {
  constructor() {
    super();
    this.service = new SyncFileService();
  }

  /**
   * @swagger
   * /sync/file-documents:
   *   post:
   *     summary: Sync file từ bảng sync sang bảng chính
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
        duration,
      });
    } catch (error) {
      logger.error('[SyncFileController.syncToMain] Error:', error);
      return this.error(res, error.message, 500);
    }
  });
}

module.exports = SyncFileController;
