const BaseController = require('../BaseController');
const UpdateIncomingStatusCodeService = require(
  '../../services/updates/UpdateIncomingStatusCodeService'
);

class UpdateIncomingStatusCodeController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new UpdateIncomingStatusCodeService();
      await this.service.initialize();
    }
  }
/**
 * @swagger
 * /update/incoming-status-code:
 *   get:
 *     summary: Cập nhật trạng thái văn bản đến ở bảng trung gian
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
      'Update status_code văn bản đến thành công'
    );
  });
}

module.exports = new UpdateIncomingStatusCodeController();
