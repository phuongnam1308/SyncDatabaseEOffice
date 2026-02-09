const BaseController = require('../BaseController');
const IncommingBackupBeforeTestService =
  require('../../services/IncommingBackupBeforeTestService');

class IncommingBackupBeforeTestController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new IncommingBackupBeforeTestService();
      await this.service.initialize();
    }
  }

  /**
   * @swagger
   * /test/incomming/backup-before-test:
   *   get:
   *     summary: Backup status_code, sender_unit, receiver_unit trước khi test
   *     tags: [Dong bo van ban den]
   *     responses:
   *       200:
   *         description: Backup thành công
   */
  backup = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const result = await this.service.backup();
      return this.success(
        res,
        result,
        'Backup incomming_documents trước khi test thành công'
      );
    } catch (error) {
      return this.error(
        res,
        error.message || 'Lỗi backup incomming_documents',
        500,
        error
      );
    }
  });
}

module.exports = new IncommingBackupBeforeTestController();
