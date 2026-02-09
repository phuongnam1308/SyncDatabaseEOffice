// controllers/MigrationOutgoingDocumentDeleteController.js
const BaseController = require('./BaseController');
const MigrationOutgoingDocumentDeleteService = require('../services/MigrationOutgoingDocumentDeleteService');
const logger = require('../utils/logger');

class MigrationOutgoingDocumentDeleteController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationOutgoingDocumentDeleteService();
      await this.service.initialize();
    }
  }

  getStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.service.getStatistics();
      return this.success(res, stats, 'Lấy thống kê Văn bản ban hành Delete thành công');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê Văn bản ban hành Delete', 500, error);
    }
  });

  migrateOutgoingDocumentsDelete = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu migration Văn bản ban hành Delete qua API...');
      const result = await this.service.migrateOutgoingDocumentsDelete();
      return this.success(res, result, 'Migration Văn bản ban hành Delete hoàn thành');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình migration Văn bản ban hành Delete', 500, error);
    }
  });
}

module.exports = new MigrationOutgoingDocumentDeleteController();