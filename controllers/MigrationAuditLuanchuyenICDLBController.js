const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenICDLBService = require('../services/MigrationAuditLuanchuyenICDLBService');

class MigrationAuditLuanchuyenICDLBController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenICDLBService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-icdlb:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động icdlb
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_ICDLB thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenICDLBController();