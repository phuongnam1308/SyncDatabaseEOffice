// controllers/MigrationTask3ToTaskController.js
const BaseController = require('./BaseController');
const MigrationTask3ToTaskService = require('../services/MigrationTask3ToTaskService');
const logger = require('../utils/logger');

class MigrationTask3ToTaskController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationTask3ToTaskService();
      await this.service.initialize();
    }
  }

  getStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.service.getStatistics();
      return this.success(res, stats, 'Lấy thống kê từ task3 sang task thành công');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê từ task3 sang task', 500, error);
    }
  });
  /**
   * @swagger
   * /migrate/task3toTask:
   *   get:
   *     summary: Đồng bộ từ task3 sang task
   *     tags: [Dong bo cong viec]
   */
  migrateTaskRecords = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu migration từ task3 sang task qua API...');
      const result = await this.service.migrateTaskRecords();
      return this.success(res, result, 'Migration từ task3 sang task hoàn thành');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình migration từ task3 sang task', 500, error);
    }
  });
}

module.exports = new MigrationTask3ToTaskController();