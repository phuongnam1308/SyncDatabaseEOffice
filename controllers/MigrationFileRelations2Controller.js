// controllers/MigrationFileRelations2Controller.js
const BaseController = require('./BaseController');
const MigrationFileRelations2Service = require('../services/MigrationFileRelations2Service');
const logger = require('../utils/logger');

class MigrationFileRelations2Controller extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationFileRelations2Service();
      await this.service.initialize();
    }
  }

  getStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.service.getStatistics();
      return this.success(res, stats, 'Lấy thống kê FileRelations2 thành công');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê FileRelations2', 500, error);
    }
  });

  migrate = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu migration FileRelations2 qua API...');
      const result = await this.service.migrateFileRelations2();
      return this.success(res, result, 'Migration FileRelations2 hoàn thành');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình migration FileRelations2', 500, error);
    }
  });
}

module.exports = new MigrationFileRelations2Controller();