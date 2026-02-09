const BaseController = require('./BaseController');
const Service = require('../services/MigrationAuditLuanchuyenCTService');

class MigrationAuditLuanchuyenCTController extends BaseController {
  constructor() {
    super();
    this.service = new Service();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-ct:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động ct
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_CT thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenCTController();