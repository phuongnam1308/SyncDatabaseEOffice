// controllers/MigrationBookDocumentDeleteController.js
const BaseController = require('./BaseController');
const MigrationBookDocumentDeleteService = require('../services/MigrationBookDocumentDeleteService');
const logger = require('../utils/logger');

class MigrationBookDocumentDeleteController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationBookDocumentDeleteService();
      await this.service.initialize();
    }
  }

  getStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.service.getStatistics();
      return this.success(res, stats, 'Lấy thống kê Văn bản đến Delete thành công');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê Văn bản đến Delete', 500, error);
    }
  });

    /**
   * @swagger
   * /migrate/bookdocumentsdelete:
   *   get:
   *     summary: Đồng bộ số văn bản bản ban hành đã xóa
   *     tags: [Dong bo so van ban]
   */
  migrateBookDocumentsDelete = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu migration Văn bản đến Delete (gộp theo Title) qua API...');
      const result = await this.service.migrateBookDocumentsDelete();
      return this.success(res, result, 'Migration Văn bản đến Delete hoàn thành');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình migration Văn bản đến Delete', 500, error);
    }
  });
}

module.exports = new MigrationBookDocumentDeleteController();