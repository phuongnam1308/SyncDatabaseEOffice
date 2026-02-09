const BaseController = require('../BaseController');
const OutgoingBackupBeforeTestService =
  require('../../services/OutgoingBackupBeforeTestService');

class OutgoingBackupBeforeTestController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new OutgoingBackupBeforeTestService();
      await this.service.initialize();
    }
  }
  /**
   * @swagger
   * /test/backup-outgoing-before-status-test:
   *   get:
   *     summary: Backup outgoing_documents trước khi test
   *     tags: [Dong bo van ban di]
   */
  backup = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const result = await this.service.backup();
      return this.success(
        res,
        result,
        'Backup outgoing_documents trước khi test thành công'
      );
    } catch (error) {
      return this.error(
        res,
        'Lỗi backup outgoing_documents trước khi test',
        500,
        error
      );
    }
  });
}

module.exports = new OutgoingBackupBeforeTestController();
