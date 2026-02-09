// controllers/DrafterMigrationController.js
const BaseController = require('./BaseController');
const DrafterMigrationService = require('../services/DrafterMigrationService');
const OutgoingDocument2Model = require('../models/OutgoingDocument2Model');

class DrafterMigrationController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      const model = new OutgoingDocument2Model();
      await model.initialize();
      this.service = new DrafterMigrationService(model);
    }
  }

    /**
   * @swagger
   * /migrate/drafter:
   *   get:
   *     summary: Đồng bộ văn bản đi người soạn văn bản của văn bản đi của bảng trung gian
   *     tags: [Dong bo van ban di]
   */
  preview = this.asyncHandler(async (req, res) => {
    await this.initService();
    const data = await this.service.preview();
    return this.success(res, data, 'Preview drafter & draft_signer');
  });

  migrate = this.asyncHandler(async (req, res) => {
    await this.initService();
    const batchSize = parseInt(req.query.batchSize) || 5000;
    const result = await this.service.migrate(batchSize);
    return this.success(res, result, 'Migrate thành công');
  });
}

module.exports = new DrafterMigrationController();
