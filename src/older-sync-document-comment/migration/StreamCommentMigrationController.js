const BaseController = require("../../../controllers/BaseController");
const logger = require("../../../utils/logger");
const Service = require("./StreamCommentMigrationService");

class StreamCommentMigrationController extends BaseController {
  constructor() {
    super();
    this.service = new Service();
  }

  /**
   * @swagger
   * /document-comments/migrate:
   *   post:
   *     summary: Migrate comments từ các bảng nguồn sang document_comments_sync
   *     tags: [Document Comments]
   */
  run = this.asyncHandler(async (req, res) => {
    const tables = req.body?.tables;
    const limit = parseInt(req.body?.limit || 0);
    const batch = parseInt(req.body?.batch || 100);

    if (!tables || !Array.isArray(tables))
      return this.error(res, "Thiếu tables", 400);

    try {
      const result = await this.service.migrate({ tables, limit, batch });
      return this.success(res, result, "Migrate document_comments_sync thành công");
    } catch (error) {
      logger.error("Document comments migrate error:", error);
      return this.error(res, "Migrate thất bại", 500);
    }
  });
}

module.exports = new StreamCommentMigrationController();
