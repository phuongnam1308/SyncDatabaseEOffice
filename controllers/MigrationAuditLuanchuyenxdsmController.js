const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenxdsmService = require('../services/MigrationAuditLuanchuyenxdsmService');

class MigrationAuditLuanchuyenxdsmController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenxdsmService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-xdsm:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động xdsm
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_xdsm thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenxdsmController();