const BaseController = require('./BaseController');
const MigrationAuditLuanchuyenVPMBService = require('../services/MigrationAuditLuanchuyenVPMBService');

class MigrationAuditLuanchuyenVPMBController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationAuditLuanchuyenVPMBService();
  }
  /**
   * @swagger
   * /migrate/audit3-luanchuyen-vpmb:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động vpmb
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit3 từ LuanChuyenVanBan_VPMB thành công');
  });
}

module.exports = new MigrationAuditLuanchuyenVPMBController();