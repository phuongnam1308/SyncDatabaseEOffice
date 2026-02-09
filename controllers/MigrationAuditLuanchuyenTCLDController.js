const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenTCLDService = require('../services/MigrationAuditLuanchuyenTCLDService');

class MigrationAuditLuanchuyenTCLDController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenTCLDService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-tcld:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động tcld
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_TCLD thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenTCLDController();