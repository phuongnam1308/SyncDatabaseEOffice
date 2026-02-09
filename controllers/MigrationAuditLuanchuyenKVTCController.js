const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenKVTCService = require('../services/MigrationAuditLuanchuyenKVTCService');

class MigrationAuditLuanchuyenKVTCController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenKVTCService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-kvtc:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động kvtc
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_KVTC thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenKVTCController();