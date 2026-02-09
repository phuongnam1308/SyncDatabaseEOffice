const BaseController = require('../BaseController');
const OutgoingToAuditTestService =
  require('../../services/OutgoingToAuditTestService');

class OutgoingToAuditTestController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new OutgoingToAuditTestService();
      await this.service.initialize();
    }
  }

  /**
   * @swagger
   * /test/outgoing-to-audit:
   *   post:
   *     summary: Sinh dữ liệu audit test từ outgoing_documents2
   *     tags: [Dong bo van ban di]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           example:
   *             user_id: "USER_TEST_01"
   *             role: "VAN_THU"
   *             action_code: "CREATE"
   *             receiver: "USER_TEST_01"
   *             receiver_unit: "DON_VI_TEST"
   *             roleProcess: "PROCESS_TEST"
   *             action: "CREATE"
   *             stage_status: "DRAFT"
   *     responses:
   *       200:
   *         description: Tạo audit test thành công
   */
  create = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const result = await this.service.createAudit(req.body);
      return this.success(
        res,
        result,
        'Tạo audit test từ outgoing_documents2 thành công'
      );
    } catch (error) {
      return this.error(
        res,
        error.message || 'Lỗi tạo audit test',
        500,
        error
      );
    }
  });
}

module.exports = new OutgoingToAuditTestController();
