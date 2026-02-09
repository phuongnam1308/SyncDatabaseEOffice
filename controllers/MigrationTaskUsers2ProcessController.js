const BaseController = require('./BaseController');
const MigrationTaskUsers2ProcessService =
  require('../services/MigrationTaskUsers2ProcessService');

class MigrationTaskUsers2ProcessController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationTaskUsers2ProcessService();
      await this.service.initialize();
    }
  }
 /**
   * @swagger
   * /mapping/task-users2-process:
   *   get:
   *     summary: Đồng bộ người xử lý công việc ở bảng trung gian
   *     tags: [Dong bo cong viec]
   */
  mapProcess = this.asyncHandler(async (req, res) => {
    await this.initService();
    const result = await this.service.mappingProcess();
    return this.success(
      res,
      result,
      'Mapping process_id & process_name cho task_users2 thành công'
    );
  });
}

module.exports = new MigrationTaskUsers2ProcessController();
