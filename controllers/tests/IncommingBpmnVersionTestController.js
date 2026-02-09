const BaseController = require('../BaseController');
const IncommingBpmnVersionTestService =
  require('../../services/IncommingBpmnVersionTestService');

class IncommingBpmnVersionTestController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new IncommingBpmnVersionTestService();
      await this.service.initialize();
    }
  }

  /**
   * @swagger
   * /test/incomming/update-bpmn-version:
   *   post:
   *     summary: Update bpmn_version cho incomming_documents2
   *     tags: [Dong bo van ban den]
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           example:
   *             bpmn_version: "PHUC_DAP_DV_CON"
   *     responses:
   *       200:
   *         description: Update thành công
   */
  update = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const result = await this.service.update(req.body || {});
      return this.success(
        res,
        result,
        'Update bpmn_version incomming_documents thành công'
      );
    } catch (error) {
      return this.error(
        res,
        error.message || 'Lỗi update bpmn_version',
        500,
        error
      );
    }
  });
}

module.exports = new IncommingBpmnVersionTestController();
