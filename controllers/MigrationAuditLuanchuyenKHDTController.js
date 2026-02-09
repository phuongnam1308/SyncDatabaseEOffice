const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenKHDTService = require('../services/MigrationAuditLuanchuyenKHDTService');

class MigrationAuditLuanchuyenKHDTController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenKHDTService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-khdt:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động khdt
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_KHDT thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenKHDTController();