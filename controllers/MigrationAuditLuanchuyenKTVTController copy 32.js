const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenKTVTService = require('../services/MigrationAuditLuanchuyenKTVTService');

class MigrationAuditLuanchuyenKTVTController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenKTVTService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-ktvt:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động ktvt
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_KTVT thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenKTVTController();