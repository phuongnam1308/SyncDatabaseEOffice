const BaseController = require('./BaseController');
const MigrationTaskUsers2ProcessOrgService =
  require('../services/MigrationTaskUsers2ProcessOrgService');

class MigrationTaskUsers2ProcessOrgController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationTaskUsers2ProcessOrgService();
      await this.service.initialize();
    }
  }
 /**
   * @swagger
   * /mapping/task-users2-process-org:
   *   get:
   *     summary: Đồng bộ đơn vị số lý công việc ở bảng trung gian
   *     tags: [Dong bo cong viec]
   */
  map = this.asyncHandler(async (req, res) => {
    await this.initService();
    const result = await this.service.mapping();
    return this.success(
      res,
      result,
      'Mapping process_id & process_name từ organization_units thành công'
    );
  });
}

module.exports = new MigrationTaskUsers2ProcessOrgController();
