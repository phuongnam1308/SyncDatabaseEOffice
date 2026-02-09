const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenTCService = require('../services/MigrationAuditLuanchuyenTCService');

class MigrationAuditLuanchuyenTCController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenTCService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-tc:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động tc
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_TC thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenTCController();