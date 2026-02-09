const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenTCTTService = require('../services/MigrationAuditLuanchuyenTCCTService');

class MigrationAuditLuanchuyenTCTTController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenTCTTService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-tctt:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động tctt
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_TCTT thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenTCTTController();