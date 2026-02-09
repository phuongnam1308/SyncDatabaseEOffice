const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenTCOTService = require('../services/MigrationAuditLuanchuyenTCOTService');

class MigrationAuditLuanchuyenTCOTController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenTCOTService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-tcot:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động tcot
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_TCOT thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenTCOTController();