const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenQSBVService = require('../services/MigrationAuditLuanchuyenQSBVService');

class MigrationAuditLuanchuyenQSBVController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenQSBVService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-qsbv:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động qsbv
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_QSBV thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenQSBVController();