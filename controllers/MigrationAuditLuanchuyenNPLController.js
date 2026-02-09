const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenNPLService = require('../services/MigrationAuditLuanchuyenNPLService');

class MigrationAuditLuanchuyenNPLController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenNPLService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-npl:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động npl
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_NPL thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenNPLController();