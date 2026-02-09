const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenVPTNBService = require('../services/MigrationAuditLuanchuyenVPTNBService');

class MigrationAuditLuanchuyenVPTNBController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenVPTNBService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-vptnb:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động vptnb
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_VPTNB thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenVPTNBController();