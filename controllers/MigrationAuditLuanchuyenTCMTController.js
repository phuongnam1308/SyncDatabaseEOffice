const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenTCMTService = require('../services/MigrationAuditLuanchuyenTCMTService');

class MigrationAuditLuanchuyenTCMTController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenTCMTService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-tcmt:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động tcmt
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_TCMT thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenTCMTController();