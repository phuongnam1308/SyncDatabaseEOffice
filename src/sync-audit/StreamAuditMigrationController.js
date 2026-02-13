const BaseController = require("../../controllers/BaseController");
const logger = require("../../utils/logger");
const Service = require("./StreamAuditMigrationService");

class StreamAuditSyncController extends BaseController {
  constructor() {
    super();
    this.service = new Service();
  }

  run = this.asyncHandler(async (req, res) => {
    const tables = req.body?.tables;
    const limit = parseInt(req.body?.limit || 0);
    const batch = parseInt(req.body?.batch || 100);

    if (!tables || !Array.isArray(tables))
      return this.error(res, "Thiếu tables", 400);

    try {
      const result = await this.service.migrate({
        tables,
        limit,
        batch,
      });

      return this.success(res, result, "Sync audit_sync thành công");
    } catch (error) {
      logger.error("Audit sync multi-table error:", error);
      return this.error(res, "Sync thất bại", 500);
    }
  });
}

module.exports = new StreamAuditSyncController();
