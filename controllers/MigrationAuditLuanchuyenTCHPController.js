const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenTCHPService = require('../services/MigrationAuditLuanchuyenTCHPService');

class MigrationAuditLuanchuyenTCHPController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenTCHPService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-tchp:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động tchp
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_TCHP thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenTCHPController();