const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenVPService = require('../services/MigrationAuditLuanchuyenVPService');

class MigrationAuditLuanchuyenVPController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenVPService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-vp:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động vp
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_VP thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenVPController();