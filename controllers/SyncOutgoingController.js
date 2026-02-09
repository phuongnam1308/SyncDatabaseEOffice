// controllers/SyncOutgoingController.js
const BaseController = require('./BaseController');
const SyncOutgoingService = require('../services/SyncOutgoingService');
const OutgoingSyncModel = require('../models/OutgoingSyncModel');

class SyncOutgoingController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      const model = new OutgoingSyncModel();
      await model.initialize();
      this.service = new SyncOutgoingService(model);
    }
  }

  preview = this.asyncHandler(async (req, res) => {
    await this.initService();
    const data = await this.service.preview();
    return this.success(res, data, 'Preview sync outgoing_documents2 → outgoing_documents');
  });
  /**
   * @swagger
   * /sync/outgoing:
   *   get:
   *     summary: Đồng bộ văn bản đi từ bảng trung gian về với bảng chính
   *     tags: [Dong bo van ban di]
   */
  sync = this.asyncHandler(async (req, res) => {
    await this.initService();
    const batchSize = parseInt(req.query.batchSize) || 2000;
    const result = await this.service.sync(batchSize);
    return this.success(res, result, 'Sync outgoing_documents thành công');
  });
}

module.exports = new SyncOutgoingController();
