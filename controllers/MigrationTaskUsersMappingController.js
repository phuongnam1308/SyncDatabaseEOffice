// controllers/MigrationTaskUsersMappingController.js
const BaseController = require('./BaseController');
const MigrationTaskUsersMappingService = require('../services/MigrationTaskUsersMappingService');
const logger = require('../utils/logger');

class MigrationTaskUsersMappingController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationTaskUsersMappingService();
      await this.service.initialize();
    }
  }

  getStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.service.getStatistics();
      return this.success(res, stats, 'Thống kê mapping task_id cho task_users2');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê mapping task_id', 500, error);
    }
  });

  updateMapping = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu update task_id trong task_users2...');
      const result = await this.service.updateTaskIdMapping();
      return this.success(res, result, 'Update mapping task_id hoàn tất');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình update mapping task_id', 500, error);
    }
  });
}

module.exports = new MigrationTaskUsersMappingController();