const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenTCIDIService = require('../services/MigrationAuditLuanchuyenTCIDIService');

class MigrationAuditLuanchuyenTCIDIController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenTCIDIService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-tcidi:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động tcidi
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_TCIDI thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenTCIDIController();