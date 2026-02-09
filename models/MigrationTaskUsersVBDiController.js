// controllers/MigrationTaskUsersVBDiController.js
const BaseController = require('./BaseController');
const MigrationTaskUsersVBDiService = require('../services/MigrationTaskUsersVBDiService');
const logger = require('../utils/logger');

class MigrationTaskUsersVBDiController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationTaskUsersVBDiService();
      await this.service.initialize();
    }
  }

  getStatistics = this.asyncHandler(async (req, res) => {
    await this.initService();
    const stats = await this.service.getStatistics();
    return this.success(res, stats, 'Thống kê TaskVBDiPermission → task_users2');
  });

  migrate = this.asyncHandler(async (req, res) => {
    await this.initService();
    logger.info('Bắt đầu migrate TaskVBDiPermission → task_users2...');
    const result = await this.service.migrateTaskUsersVBDi();
    return this.success(res, result, 'Migration TaskVBDiPermission hoàn tất');
  });
}

module.exports = new MigrationTaskUsersVBDiController();