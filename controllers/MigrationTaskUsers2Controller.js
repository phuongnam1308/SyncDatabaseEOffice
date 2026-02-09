// controllers/MigrationTaskUsers2Controller.js
const BaseController = require('./BaseController');
const MigrationTaskUsers2Service = require('../services/MigrationTaskUsers2Service');
const logger = require('../utils/logger');

class MigrationTaskUsers2Controller extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationTaskUsers2Service();
      await this.service.initialize();
    }
  }
  /**
   * @swagger
   * /statistics/task-users2:
   *   get:
   *     summary: Thông kê đồng bộ công việc của người của công việc của văn bản đến nào về bảng trung gian
   *     tags: [Dong bo cong viec]
   */
  getStatistics = this.asyncHandler(async (req, res) => {
    await this.initService();
    const stats = await this.service.getStatistics();
    return this.success(res, stats, 'Thống kê task_users2 thành công');
  });
 /**
   * @swagger
   * /migrate/task-users2:
   *   get:
   *     summary: Đông bộ công việc của người nào của văn bản đến về bảng trung gian
   *     tags: [Dong bo cong viec]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.initService();
    logger.info('Bắt đầu migrate task_users2 qua API...');
    const result = await this.service.migrateTaskUsers2();
    return this.success(res, result, 'Migration task_users2 hoàn tất');
  });
}

module.exports = new MigrationTaskUsers2Controller();