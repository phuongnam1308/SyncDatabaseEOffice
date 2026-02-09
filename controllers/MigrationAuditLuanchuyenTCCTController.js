const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenTCCTService = require('../services/MigrationAuditLuanchuyenTCCTService');

class MigrationAuditLuanchuyenTCCTController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenTCCTService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-tcct:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động tcct
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_TCCT thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenTCCTController();