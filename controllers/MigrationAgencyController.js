// controllers/MigrationAgencyController.js
const BaseController = require('./BaseController');
const MigrationAgencyService = require('../services/MigrationAgencyService');
const logger = require('../utils/logger');

class MigrationAgencyController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationAgencyService();
      await this.service.initialize();
    }
  }

  getStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.service.getStatistics();
      return this.success(res, stats, 'Lấy thống kê Đơn vị thành công');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê Đơn vị', 500, error);
    }
  });

  migrateAgencies = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu migration Đơn vị qua API...');
      const result = await this.service.migrateAgencies();
      return this.success(res, result, 'Migration Đơn vị hoàn thành');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình migration Đơn vị', 500, error);
    }
  });
}

module.exports = new MigrationAgencyController();
