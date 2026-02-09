const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenYTEService = require('../services/MigrationAuditLuanchuyenYTEService');

class MigrationAuditLuanchuyenYTEController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenYTEService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-yte:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động yte
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_YTE thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenYTEController();