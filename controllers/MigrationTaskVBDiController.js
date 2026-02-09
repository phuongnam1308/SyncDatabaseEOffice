// controllers/MigrationTaskVBDiController.js
const BaseController = require('./BaseController');
const MigrationTaskVBDiService = require('../services/MigrationTaskVBDiService');
const logger = require('../utils/logger');

class MigrationTaskVBDiController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationTaskVBDiService();
      await this.service.initialize();
    }
  }
  /**
   * @swagger
   * /statistics/task-vbdi:
   *   get:
   *     summary: Thông kê đồng bộ công việc văn bản đi
   *     tags: [Dong bo cong viec]
   */
  getStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.service.getStatistics();
      return this.success(res, stats, 'Lấy thống kê TaskVBDi thành công');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê TaskVBDi', 500, error);
    }
  });
 /**
   * @swagger
   * /migrate/task-vbdi:
   *   get:
   *     summary: Đông bộ công việc văn bản đi về bảng trung gian
   *     tags: [Dong bo cong viec]
   */
  migrateTaskVBDiRecords = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu migration TaskVBDi → task3 qua API...');
      const result = await this.service.migrateTaskVBDiRecords();
      return this.success(res, result, 'Migration TaskVBDi vào task3 hoàn thành');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình migration TaskVBDi', 500, error);
    }
  });
}

module.exports = new MigrationTaskVBDiController();