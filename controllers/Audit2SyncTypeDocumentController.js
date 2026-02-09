const BaseController = require('./BaseController');
const Audit2SyncTypeDocumentService =
  require('../services/Audit2SyncTypeDocumentService');

class Audit2SyncTypeDocumentController extends BaseController {
  constructor() {
    super();
    this.service = null;
    this.sync = this.sync.bind(this);
  }

  async initService() {
    if (!this.service) {
      this.service = new Audit2SyncTypeDocumentService();
      await this.service.initialize();
    }
  }
  /**
   * @swagger
   * /sync/audit2-type-document:
   *   get:
   *     summary: Đồng bộ loại văn bản ( type_document ) cho luân chuyển văn bản
   *     tags: [Dong bo luan chuyen van ban]
   */
  async sync(req, res) {
    try {
      await this.initService();
      const result = await this.service.syncTypeDocument();
      return this.success(
        res,
        result,
        'Đồng bộ type_document cho audit2 thành công'
      );
    } catch (error) {
      return this.error(
        res,
        'Lỗi đồng bộ type_document cho audit2',
        500,
        error
      );
    }
  }
}

module.exports = new Audit2SyncTypeDocumentController();
