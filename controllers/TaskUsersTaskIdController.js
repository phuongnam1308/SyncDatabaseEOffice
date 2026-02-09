// controllers/TaskUsersTaskIdController.js
const BaseController = require('./BaseController');
const TaskUsersTaskIdService = require('../services/TaskUsersTaskIdService');
const logger = require('../utils/logger');

class TaskUsersTaskIdController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new TaskUsersTaskIdService();
      await this.service.initialize();
    }
  }
  /**
   * @swagger
   * /statistics/task-users-taskid:
   *   get:
   *     summary: thông kê các cập nhật chưa khớp mã công việc cũ so với mã mới
   *     tags: [Dong bo cong viec]
   */
  statistics = this.asyncHandler(async (req, res) => {
    await this.initService();
    const stats = await this.service.getStatistics();
    return this.success(res, stats, 'Thống kê gán task_id cho task_users2');
  });
 /**
   * @swagger
   * /update/task-users-taskid:
   *   get:
   *     summary: đồng bộ về mã mới công việc về phần mềm mới
   *     tags: [Dong bo cong viec]
   */
  update = this.asyncHandler(async (req, res) => {
    await this.initService();
    logger.info('API gọi gán task_id vào task_users2');
    const result = await this.service.performUpdate();
    return this.success(res, result, 'Hoàn thành gán task_id');
  });
}

module.exports = new TaskUsersTaskIdController();