// controllers/FormatOutgoing2Controller.js
const BaseController = require('./BaseController');
const FormatOutgoing2Service = require('../services/FormatOutgoing2Service');
const logger = require('../utils/logger');

class FormatOutgoing2Controller extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new FormatOutgoing2Service();
      await this.service.initialize();
    }
  }
  /**
   * @swagger
   * /format/outgoing2:
   *   get:
   *     summary: Format/clean dữ liệu văn bản đi ở bảng trung gian
   *     tags: [Dong bo van ban di]
   */
  formatOutgoing2 = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu format/clean outgoing_documents2 qua API...');

      const result = await this.service.runFormat();

      return this.success(res, result, 'Format/clean outgoing_documents2 hoàn tất');
    } catch (error) {
      logger.error('Lỗi format outgoing_documents2:', error);
      return this.error(res, 'Lỗi trong quá trình format outgoing_documents2', 500, error);
    }
  });

  getFormatStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.service.getCurrentStatistics();
      return this.success(res, stats, 'Thống kê hiện tại sau format');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê format', 500, error);
    }
  });
}

module.exports = new FormatOutgoing2Controller();