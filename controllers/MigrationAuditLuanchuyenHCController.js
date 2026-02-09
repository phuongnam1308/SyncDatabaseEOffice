// controllers/MigrationAuditLuanchuyenHCController.js
const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenHCService = require('../services/MigrationAuditLuanchuyenHCService');

class MigrationAuditLuanchuyenHCController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenHCService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-hc:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động hc
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_HC thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenHCController();