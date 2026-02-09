const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenKHKDService = require('../services/MigrationAuditLuanchuyenKHKDService');

class MigrationAuditLuanchuyenKHKDController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenKHKDService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-khkd:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động khkd
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_KHKD thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenKHKDController();