const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenVTTService = require('../services/MigrationAuditLuanchuyenVTTService');

class MigrationAuditLuanchuyenVTTController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenVTTService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-vtt:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động vtt
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_VTT thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenVTTController();