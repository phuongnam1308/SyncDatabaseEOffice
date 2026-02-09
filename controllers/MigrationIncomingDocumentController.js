// controllers/MigrationIncomingDocumentController.js
const BaseController = require('./BaseController');
const MigrationIncomingDocumentService = require('../services/MigrationIncomingDocumentService');
const logger = require('../utils/logger');
/**
 * @swagger
 * tags:
 *   name: Dong bo van ban den
 *   description: Đồng bộ văn bản đến từ phần mềm cũ sang phần mềm mới
 */

class MigrationIncomingDocumentController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationIncomingDocumentService();
      await this.service.initialize();
    }
  }
/**
 * @swagger
 * /statistics/incomingdocuments:
 *   get:
 *     summary: Thống kê văn bản đến
 *     tags: [Dong bo van ban den]
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
 * /migrate/incomingdocuments:
 *   get:
 *     summary: Đồng bộ hóa văn bản đến về với bảng trung gian
 *     tags: [Dong bo van ban den]
 */

  migrateIncomingDocuments = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu migration Văn bản đến qua API...');
      const result = await this.service.migrateIncomingDocuments();
      return this.success(res, result, 'Migration Văn bản đến hoàn thành');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình migration Văn bản đến', 500, error);
    }
  });
}

module.exports = new MigrationIncomingDocumentController();