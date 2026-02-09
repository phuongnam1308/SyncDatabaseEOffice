const BaseController = require('./BaseController');
const Audit2MappingUserIdService =
  require('../services/Audit2MappingUserIdService');

class Audit2MappingUserIdController extends BaseController {
  constructor() {
    super();
    this.service = null;

    // 🔴 RẤT QUAN TRỌNG:
    // bind để express nhìn thấy hàm
    this.mapUserId = this.mapUserId.bind(this);
  }

  async initService() {
    if (!this.service) {
      this.service = new Audit2MappingUserIdService();
      await this.service.initialize();
    }
  }
  /**
   * @swagger
   * /mapping/audit2-user:
   *   get:
   *     summary: Đồng bộ tên người dùng luân chuyển chuyển văn bản
   *     tags: [Dong bo luan chuyen van ban]
   */
  async mapUserId(req, res) {
    try {
      await this.initService();
      const result = await this.service.mapUserIdForAudit2();
      return this.success(
        res,
        result,
        'Mapping user_id cho audit2 thành công'
      );
    } catch (error) {
      return this.error(
        res,
        'Lỗi mapping user_id cho audit2',
        500,
        error
      );
    }
  }
}

module.exports = new Audit2MappingUserIdController();
