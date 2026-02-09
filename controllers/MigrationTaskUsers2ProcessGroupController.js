const BaseController = require('./BaseController');
const MigrationTaskUsers2ProcessGroupService =
  require('../services/MigrationTaskUsers2ProcessGroupService');

class MigrationTaskUsers2ProcessGroupController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationTaskUsers2ProcessGroupService();
      await this.service.initialize();
    }
  }
 /**
   * @swagger
   * /mapping/task-users2-process-group:
   *   get:
   *     summary: Đồng bộ nhóm xử lý công việc ở bảng trung gian
   *     tags: [Dong bo cong viec]
   */
  map = this.asyncHandler(async (req, res) => {
    await this.initService();
    const result = await this.service.mapping();
    return this.success(
      res,
      result,
      'Mapping process_id & process_name từ group_users thành công'
    );
  });
}

module.exports = new MigrationTaskUsers2ProcessGroupController;
