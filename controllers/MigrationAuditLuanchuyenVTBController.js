const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenVTBService = require('../services/MigrationAuditLuanchuyenVTBService');

class MigrationAuditLuanchuyenVTBController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenVTBService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-vtb:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động vtb
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_VTB thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenVTBController();