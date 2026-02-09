const BaseController = require('../BaseController');
const IncommingBulkUpdateTestService =
  require('../../services/IncommingBulkUpdateTestService');

class IncommingBulkUpdateTestController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new IncommingBulkUpdateTestService();
      await this.service.initialize();
    }
  }

  /**
   * @swagger
   * /test/incomming/bulk-update:
   *   post:
   *     summary: Update hàng loạt status_code, sender_unit, receiver_unit cho incomming_documents2
   *     tags: [Dong bo van ban den]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           example:
   *             status_code: 7
   *             sender_unit: "DON_VI_GUI_MOI"
   *             receiver_unit: "DON_VI_NHAN_MOI"
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
        'Bulk update incomming_documents thành công'
      );
    } catch (error) {
      return this.error(
        res,
        error.message || 'Lỗi bulk update incomming_documents',
        500,
        error
      );
    }
  });
}

module.exports = new IncommingBulkUpdateTestController();
