const BaseController = require('../BaseController');
const OutgoingBpmnVersionSyncService =
  require('../../services/OutgoingBpmnVersionSyncService');

class OutgoingBpmnVersionSyncController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new OutgoingBpmnVersionSyncService();
      await this.service.initialize();
    }
  }
  /**
   * @swagger
   * /sync/outgoing-bpmn-version:
   *   get:
   *     summary: Cập nhật bpmn_version văn bản đi cho dữ liệu cũ
   *     tags: [Dong bo van ban di]
   */
  sync = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const result = await this.service.sync();
      return this.success(
        res,
        result,
        'Sync bpmn_version outgoing_documents thành công'
      );
    } catch (error) {
      return this.error(
        res,
        'Lỗi sync bpmn_version outgoing_documents',
        500,
        error
      );
    }
  });
}

module.exports = new OutgoingBpmnVersionSyncController();
