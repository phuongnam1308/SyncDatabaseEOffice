const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenSNPLService = require('../services/MigrationAuditLuanchuyenSNPLService');

class MigrationAuditLuanchuyenSNPLController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenSNPLService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-snpl:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động snpl
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_SNPL thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenSNPLController();