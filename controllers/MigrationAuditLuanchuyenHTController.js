const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenHTService = require('../services/MigrationAuditLuanchuyenHTService');

class MigrationAuditLuanchuyenHTController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenHTService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-ht:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động ht
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_HT thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenHTController();