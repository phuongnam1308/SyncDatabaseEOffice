// controllers/MigrationOutgoingDocumentController.js
const BaseController = require('./BaseController');
const MigrationOutgoingDocumentService = require('../services/MigrationOutgoingDocumentService');
const logger = require('../utils/logger');
/**
 * @swagger
 * tags:
 *   name: Dong bo van ban di
 *   description: Đồng bộ văn bản đi về phần mềm trung gian
 */
class MigrationOutgoingDocumentController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationOutgoingDocumentService();
      await this.service.initialize();
    }
  }


  getStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.service.getStatistics();
      return this.success(res, stats, 'Lấy thống kê Văn bản ban hành thành công');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê Văn bản ban hành', 500, error);
    }
  });
/**
 * @swagger
 * /migrate/outgoingdocuments2:
 *   get:
 *     summary: Đồng bộ hóa văn bản đi về bảng dữ liệu trung gian
 *     tags: [Dong bo van ban di]
 */
  migrateOutgoingDocuments = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu migration Văn bản ban hành qua API...');
      const result = await this.service.migrateOutgoingDocuments();
      return this.success(res, result, 'Migration Văn bản ban hành hoàn thành');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình migration Văn bản ban hành', 500, error);
    }
  });
}

module.exports = new MigrationOutgoingDocumentController();