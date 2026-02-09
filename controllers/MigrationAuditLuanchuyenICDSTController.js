const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenICDSTService = require('../services/MigrationAuditLuanchuyenICDSTService');

class MigrationAuditLuanchuyenICDSTController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenICDSTService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-icdst:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động icdst
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_ICDST thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenICDSTController();