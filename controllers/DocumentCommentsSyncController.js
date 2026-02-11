const BaseController = require('./BaseController');
const DocumentCommentsSyncService =
  require('../services/DocumentCommentsSyncService');

/**
 * @swagger
 * tags:
 *   name: Sync Binh luan sang bang final
 *   description: Đồng bộ bình luận từ bảng trung gian sang bảng final
 */
class DocumentCommentsSyncController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new DocumentCommentsSyncService();
      await this.service.initialize();
    }
  }

  /**
   * @swagger
   * /sync/document-comments:
   *   get:
   *     summary: Đồng bộ bình luận từ document_comments2 → document_comments
   *     tags: [Sync Binh luan sang bang final]
   */
  sync = this.asyncHandler(async (req, res) => {
    await this.initService();
    const result = await this.service.sync();
    return this.success(
      res,
      result,
      result.message
    );
  });
}

module.exports = new DocumentCommentsSyncController();
