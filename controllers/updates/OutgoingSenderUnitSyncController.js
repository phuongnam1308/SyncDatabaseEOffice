const BaseController = require('../BaseController');
const OutgoingSenderUnitSyncService =
  require('../../services/OutgoingSenderUnitSyncService');

class OutgoingSenderUnitSyncController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new OutgoingSenderUnitSyncService();
      await this.service.initialize();
    }
  }
  /**
   * @swagger
   * /sync/outgoing-sender-unit:
   *   get:
   *     summary: Chuẩn hóa lại sender_unit văn bản đi cho dữ liệu cũ
   *     tags: [Dong bo van ban di]
   */
  sync = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const result = await this.service.sync();
      return this.success(
        res,
        result,
        'Sync sender_unit outgoing_documents thành công'
      );
    } catch (error) {
      return this.error(
        res,
        'Lỗi sync sender_unit outgoing_documents',
        500,
        error
      );
    }
  });
}

module.exports = new OutgoingSenderUnitSyncController();
