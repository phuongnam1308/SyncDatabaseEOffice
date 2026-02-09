const BaseController = require('./BaseController');
const UpdateIncomingSenderUnitService =
  require('../services/UpdateIncomingSenderUnitService');

class UpdateIncomingSenderUnitController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new UpdateIncomingSenderUnitService();
      await this.service.initialize();
    }
  }
/**
 * @swagger
 * /update/incoming-sender-unit:
 *   get:
 *     summary: Cập nhật tên đơn vị thành mã đơn vị cho văn bản đến ở bảng trung gian
 *     tags: [Dong bo van ban den]
 *     responses:
 *       200:
 *         description: Lấy thống kê thành công
 *       500:
 *         description: Lỗi hệ thống
 */
  update = this.asyncHandler(async (req, res) => {
    await this.initService();
    const result = await this.service.update();

    return this.success(
      res,
      result,
      'Update sender_unit cho văn bản đến thành công'
    );
  });
}

module.exports = new UpdateIncomingSenderUnitController();
