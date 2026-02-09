// controllers/MigrationIncomingDocumentDeleteController.js
const BaseController = require('./BaseController');
const MigrationIncomingDocumentDeleteService = require('../services/MigrationIncomingDocumentDeleteService');
const logger = require('../utils/logger');


class MigrationIncomingDocumentDeleteController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationIncomingDocumentDeleteService();
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
 * /migrate/incomingdocumentsdelete:
 *   get:
 *     summary: đồng bộ văn bản đến với trạng thái đã xóa về bảng trung gian
 *     tags: [Dong bo van ban den]
 */

  migrateIncomingDocumentsDelete = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu migration Văn bản đến Delete qua API...');
      const result = await this.service.migrateIncomingDocumentsDelete();
      return this.success(res, result, 'Migration Văn bản đến Delete hoàn thành');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình migration Văn bản đến Delete', 500, error);
    }
  });
}

module.exports = new MigrationIncomingDocumentDeleteController();