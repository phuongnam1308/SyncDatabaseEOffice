const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenXDCTService = require('../services/MigrationAuditLuanchuyenXDCTService');

class MigrationAuditLuanchuyenXDCTController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenXDCTService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-xdct:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động xdct
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_XDCT thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenXDCTController();