const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenMKTService = require('../services/MigrationAuditLuanchuyenMKTService');

class MigrationAuditLuanchuyenMKTController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenMKTService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-mkt:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động mkt
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_MKT thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenMKTController();