// controllers/MigrationTaskController.js
const BaseController = require('./BaseController');
const MigrationTaskService = require('../services/MigrationTaskService');
const logger = require('../utils/logger');
/**
 * @swagger
 * tags:
 *   name: Dong bo cong viec
 *   description: Đồng bộ công việc từ phần mềm cũ sang phần mềm mới
 */
class MigrationTaskController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationTaskService();
      await this.service.initialize();
    }
  }
  /**
   * @swagger
   * /statistics/task:
   *   get:
   *     summary: Thông kê đồng bộ công việc văn bản đến
   *     tags: [Dong bo cong viec]
   */
  getStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.service.getStatistics();
      return this.success(res, stats, 'Lấy thống kê Task thành công');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê Task', 500, error);
    }
  });
 /**
   * @swagger
   * /migrate/task-vbden:
   *   get:
   *     summary: Đông bộ công việc văn bản đến về bảng trung gian
   *     tags: [Dong bo cong viec]
   */
  migrateTaskRecords = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu migration TaskVBDen qua API...');
      const result = await this.service.migrateTaskRecords();
      return this.success(res, result, 'Migration Task hoàn thành');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình migration Task', 500, error);
    }
  });
}

module.exports = new MigrationTaskController();