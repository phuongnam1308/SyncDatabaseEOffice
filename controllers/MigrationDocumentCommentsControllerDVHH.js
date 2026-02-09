const BaseController = require('./BaseController');
const MigrationDocumentCommentsServiceDVHH =
  require('../services/updates/MigrateIncomingDocumentsServiceDVHH');
/**
 * @swagger
 * tags:
 *   name: Dong bo binh luan y kien
 *   description: Đồng bộ bình luận ý kiến từ phần mềm cũ sang phần mềm mới
 */
class MigrationDocumentCommentsControllerDVHH extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationDocumentCommentsServiceDVHH();
      await this.service.initialize();
    }
  }
 /**
   * @swagger
   * /migration/document-commentsDVHH:
   *   get:
   *     summary: Đông bộ bình luận ý kiến đến về bảng trung gian
   *     tags: [Dong bo binh luan y kien]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.initService();
    const result = await this.service.migrate();
    return this.success(
      res,
      result,
      'Migration document_comments2 thành công'
    );
  });
}

module.exports = new MigrationDocumentCommentsControllerDVHH();
