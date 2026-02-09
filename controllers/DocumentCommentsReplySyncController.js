const BaseController = require('./BaseController');
const DocumentCommentsReplySyncService =
  require('../services/DocumentCommentsReplySyncService');

class DocumentCommentsReplySyncController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new DocumentCommentsReplySyncService();
      await this.service.initialize();
    }
  }
 /**
   * @swagger
   * /sync/document-comments-reply:
   *   get:
   *     summary: Cập nhật trang thái có phải trả lời bình luận hay ý kiến về bảng trung gian
   *     tags: [Dong bo binh luan y kien]
   */
  sync = this.asyncHandler(async (req, res) => {
    await this.initService();
    const result = await this.service.sync();
    return this.success(
      res,
      result,
      'Đồng bộ reply comment thành công'
    );
  });
}

module.exports = new DocumentCommentsReplySyncController();
