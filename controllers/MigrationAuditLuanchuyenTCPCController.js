const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenTCPCService = require('../services/MigrationAuditLuanchuyenTCPCService');

class MigrationAuditLuanchuyenTCPCController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenTCPCService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-tcpc:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động tcpc
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_TCPC thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenTCPCController();