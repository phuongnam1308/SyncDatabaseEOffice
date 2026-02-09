const BaseController = require('./BaseController');
const Service = require('../services/MigrationAuditLuanchuyenCLLService');

class MigrationAuditLuanchuyenCLLController extends BaseController {
  constructor() {
    super();
    this.service = new Service();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-cll:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động cll
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_CLL thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenCLLController();