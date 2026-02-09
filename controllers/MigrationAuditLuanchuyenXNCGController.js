const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenXNCGService = require('../services/MigrationAuditLuanchuyenXNCGService');

class MigrationAuditLuanchuyenXNCGController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenXNCGService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-XNCG:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động XNCG
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_XNCG thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenXNCGController();