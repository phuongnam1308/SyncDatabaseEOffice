// controllers/MigrationTaskUsers2ToTaskUsersController.js
const BaseController = require('./BaseController');
const MigrationTaskUsers2ToTaskUsersService =
  require('../services/MigrationTaskUsers2ToTaskUsersService');

/**
 * @swagger
 * tags:
 *   - name: Migration task_users2 → task_users
 *     description: Đồng bộ user xử lý công việc (map task_id mới)
 */
class MigrationTaskUsers2ToTaskUsersController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationTaskUsers2ToTaskUsersService();
      await this.service.initialize();
    }
  }

  /**
   * @swagger
   * /migrate/task-users2-to-task-users:
   *   get:
   *     summary: Migration task_users2 sang task_users (FIX FK)
   *     tags: [Migration task_users2 → task_users]
   */
  migrate = this.asyncHandler(async (req, res) => {
    await this.initService();
    const result = await this.service.migrate();
    return this.success(
      res,
      result,
      'Migration task_users2 → task_users thành công (FK OK)'
    );
  });

  /**
   * @swagger
   * /migrate/task-users2-to-task-users/stats:
   *   get:
   *     summary: Thống kê migration task_users2 → task_users
   *     tags: [Migration task_users2 → task_users]
   */
  statistics = this.asyncHandler(async (req, res) => {
    await this.initService();
    const stats = await this.service.statistics();
    return this.success(res, stats, 'Thống kê task_users2 → task_users');
  });
}

module.exports = new MigrationTaskUsers2ToTaskUsersController();
