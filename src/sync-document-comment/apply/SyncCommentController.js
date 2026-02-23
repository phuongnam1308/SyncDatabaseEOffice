const BaseController = require("../../../controllers/BaseController");
const logger = require("../../../utils/logger");
const SyncCommentService = require("./SyncCommentService");

class SyncCommentController extends BaseController {
  constructor() {
    super();
    this.service = new SyncCommentService();
  }

  /**
   * @swagger
   * /document-comments/sync:
   *   post:
   *     summary: Sync comments từ document_comments_sync sang document_comments
   *     tags: [Document Comments]
   */
  syncToMain = this.asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const { limit = 0, batch = 100, lastProcessedId = 0 } = req.body;

    if (batch <= 0) return this.error(res, "Batch size phải lớn hơn 0", 400);

    logger.info(`🚀 BẮT ĐẦU SYNC COMMENT - Limit: ${limit || "ALL"}, Batch: ${batch}`);

    try {
      await this.service.initialize();
      const result = await this.service.sync({ limit, batch, lastProcessedId });
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info(`✅ SYNC COMMENT HOÀN TẤT - Inserted: ${result.inserted}, Updated: ${result.updated}, Duration: ${duration}s`);

      return this.success(res, {
        inserted: result.inserted,
        updated: result.updated,
        totalProcessed: result.totalProcessed,
        batches: result.batches,
        duration: `${duration}s`,
      }, "Sync document_comments hoàn tất thành công");
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.error(`❌ LỖI SYNC COMMENT sau ${duration}s:`, error);
      return this.error(res, "Sync comment bị lỗi", 500, { error: error.message, duration: `${duration}s` });
    }
  });

  /**
   * @swagger
   * /document-comments/sync/status:
   *   get:
   *     summary: Kiểm tra trạng thái sync document_comments
   *     tags: [Document Comments]
   */
  getStatus = this.asyncHandler(async (req, res) => {
    try {
      await this.service.initialize();
      const status = await this.service.getStatus();
      return this.success(res, status, "Lấy trạng thái comment thành công");
    } catch (error) {
      logger.error("Lỗi lấy status comment:", error);
      return this.error(res, "Không thể lấy trạng thái comment", 500, { error: error.message });
    }
  });
}

module.exports = new SyncCommentController();
