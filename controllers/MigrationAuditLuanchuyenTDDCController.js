const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenTTDTCService = require('../services/MigrationAuditLuanchuyenTCCTService');

class MigrationAuditLuanchuyenTTDTCController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenTTDTCService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-TTDTC:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động TTDTC
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_TTDTC thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenTTDTCController();