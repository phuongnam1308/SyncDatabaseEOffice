const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenTCOService = require('../services/MigrationAuditLuanchuyenTCOService');

class MigrationAuditLuanchuyenTCOController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenTCOService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-tco:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động tco
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_TCO thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenTCOController();