const BaseController = require('../BaseController');
const IncommingAuditCreateService =
  require('../../services/IncommingAuditCreateService');

class IncommingAuditCreateController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new IncommingAuditCreateService();
      await this.service.initialize();
    }
  }

  /**
   * @swagger
   * /test/incomming/create-audit:
   *   post:
   *     summary: Tạo audit từ từng văn bản đến (incomming_documents2)
   *     tags: [Dong bo van ban den]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           example:
   *             display_name: "Văn thư TCT"
   *             role: "VAN_THU"
   *             action_code: "CREATE"
   *             roleProcess: "VAN_THU"
   *             stage_status: "CHUA_XU_LY"
   *             curStatusCode: 1
   *     responses:
   *       200:
   *         description: Tạo audit thành công
   */
  create = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const result = await this.service.createAudit(req.body);
      return this.success(res, result, 'Tạo audit văn bản đến thành công');
    } catch (err) {
      return this.error(res, err.message, 500, err);
    }
  });
}

module.exports = new IncommingAuditCreateController();
