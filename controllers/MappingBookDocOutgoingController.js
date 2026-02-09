// controllers/MappingBookDocOutgoingController.js
const BaseController = require('./BaseController');
const MappingBookDocOutgoingService = require('../services/MappingBookDocOutgoingService');
const logger = require('../utils/logger');

class MappingBookDocOutgoingController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MappingBookDocOutgoingService();
      await this.service.initialize();
    }
  }
  /**
   * @swagger
   * /mapping/bookdoc-outgoing:
   *   get:
   *     summary: từ tên sổ văn bản đưa ra được mã số văn bản phù hợp với phần mềm mới 
   *     tags: [Dong bo van ban di]
   */
  mapBookDocToOutgoing = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu mapping book_document_id cho outgoing_documents2...');
      const result = await this.service.mapBookDocumentIds();
      return this.success(res, result, 'Mapping book_document_id hoàn tất');
    } catch (error) {
      logger.error('Lỗi mapping book_document_id:', error);
      return this.error(res, 'Lỗi trong quá trình mapping', 500, error);
    }
  });

  getMappingStats = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.service.getMappingStatistics();
      return this.success(res, stats, 'Thống kê mapping hiện tại');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê mapping', 500, error);
    }
  });
}

module.exports = new MappingBookDocOutgoingController();