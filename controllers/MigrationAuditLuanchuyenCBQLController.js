const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenCBQLService = require('../services/MigrationAuditLuanchuyenCBQLService');

class MigrationAuditLuanchuyenCBQLController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenCBQLService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-cbql:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động cbql
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_CBQL thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenCBQLController();