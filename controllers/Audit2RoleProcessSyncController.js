const BaseController = require('./BaseController');
const Audit2RoleProcessSyncService =
  require('../services/Audit2RoleProcessSyncService');

class Audit2RoleProcessSyncController extends BaseController {
  constructor() {
    super();
    this.service = null;

    this.sync = this.sync.bind(this);
  }

  async initService() {
    if (!this.service) {
      this.service = new Audit2RoleProcessSyncService();
      await this.service.initialize();
    }
  }
  /**
   * @swagger
   * /audit2/sync-role-process:
   *   get:
   *     summary: Đồng bộ quyền xử lý văn bản ( role & roleProcess ) cho luân chuyển văn bản
   *     tags: [Dong bo luan chuyen van ban]
   */
  async sync(req, res) {
    try {
      await this.initService();
      const result = await this.service.syncRoleProcess();
      return this.success(
        res,
        result,
        'Đồng bộ role & roleProcess cho audit2 thành công'
      );
    } catch (error) {
      return this.error(
        res,
        'Lỗi đồng bộ role & roleProcess audit2',
        500,
        error
      );
    }
  }
}

module.exports = new Audit2RoleProcessSyncController();
