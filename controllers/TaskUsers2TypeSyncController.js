const BaseController = require('./BaseController');
const TaskUsers2TypeSyncService =
  require('../services/TaskUsers2TypeSyncService');

class TaskUsers2TypeSyncController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new TaskUsers2TypeSyncService();
      await this.service.initialize();
    }
  }
 /**
   * @swagger
   * /sync/task-users2-type:
   *   get:
   *     summary: Đồng bộ trạng thái xử lý công việc ở bảng trung gian
   *     tags: [Dong bo cong viec]
   */
  sync = this.asyncHandler(async (req, res) => {
    await this.initService();
    const result = await this.service.sync();
    return this.success(
      res,
      result,
      'Đồng bộ UserType → type cho task_users2 thành công'
    );
  });
}

module.exports = new TaskUsers2TypeSyncController();
