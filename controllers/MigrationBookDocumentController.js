// controllers/MigrationBookDocumentController.js
const BaseController = require('./BaseController');
const MigrationBookDocumentService = require('../services/MigrationBookDocumentService');
const logger = require('../utils/logger');


class MigrationBookDocumentController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationBookDocumentService();
      await this.service.initialize();
    }
  }
 /**
   * @swagger
   * /statistics/bookbanhanh:
   *   get:
   *     summary: Thống kê sổ văn bản đến
   *     tags: [Dong bo so van ban]
   */
  getStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.service.getStatistics();
      return this.success(res, stats, 'Lấy thống kê Văn bản đến thành công');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê Văn bản đến', 500, error);
    }
  });
  /**
   * @swagger
   * /migrate/bookdocuments:
   *   get:
   *     summary: Đồng bộ sổ văn bản đến 
   *     tags: [Dong bo so van ban]
   */
  migrateBookDocuments = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu migration Văn bản  (gộp theo name) qua API...');
      const result = await this.service.migrateBookDocuments();
      return this.success(res, result, 'Migration Văn bản đến hoàn thành');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình migration Văn bản đến', 500, error);
    }
  });
}

module.exports = new MigrationBookDocumentController();