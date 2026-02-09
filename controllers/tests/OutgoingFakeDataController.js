const BaseController = require('../BaseController');
const OutgoingFakeDataService =
  require('../../services/OutgoingFakeDataService');

class OutgoingFakeDataController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new OutgoingFakeDataService();
      await this.service.initialize();
    }
  }

  /**
   * @swagger
   * /test/fake-outgoing-data:
   *   post:
   *     summary: Fake toàn bộ outgoing_documents (1 query, chạy lâu)
   *     tags: [Dong bo van ban di]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           example:
   *             senderUnit: "FAKE_SENDER_UNIT"
   *             drafter: "FAKE_DRAFTER"
   *     responses:
   *       200:
   *         description: Fake dữ liệu thành công
   */
  fake = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const result = await this.service.fake(req.body);
      return this.success(
        res,
        result,
        'Fake outgoing_documents thành công'
      );
    } catch (error) {
      return this.error(
        res,
        error.message || 'Lỗi fake outgoing_documents',
        500,
        error
      );
    }
  });
}

module.exports = new OutgoingFakeDataController();
