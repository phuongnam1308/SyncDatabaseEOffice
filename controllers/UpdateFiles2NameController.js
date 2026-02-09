// controllers/UpdateFiles2NameController.js
const BaseController = require('./BaseController');
const UpdateFiles2NameService = require('../services/UpdateFiles2NameService');
const logger = require('../utils/logger');

/**
 * @swagger
 * tags:
 *   name: Update File Names in files2
 *   description: Cập nhật file_name từ file_path trong bảng files2
 */
class UpdateFiles2NameController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new UpdateFiles2NameService();
      await this.service.initialize();
    }
  }

  getStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.service.getStatistics();
      logger.info('Thống kê cập nhật file_name: ' + JSON.stringify(stats));
      return this.success(res, stats, 'Lấy thống kê cập nhật file_name thành công');
    } catch (error) {
      logger.error('Lỗi lấy thống kê cập nhật file_name:', error);
      return this.error(res, 'Lỗi lấy thống kê cập nhật file_name', 500, error);
    }
  });

  /**
   * @swagger
   * /update/files2-name-from-path:
   *   get:
   *     summary: Cập nhật file_name từ file_path trong bảng files2
   *     tags: [Update File Names in files2]
   */
  update = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu cập nhật file_name từ file_path trong files2...');
      const result = await this.service.updateFileNames();
      logger.info('Kết quả cập nhật file_name: ' + JSON.stringify(result));
      return this.success(res, result, 'Cập nhật file_name hoàn thành');
    } catch (error) {
      logger.error('Lỗi trong quá trình cập nhật file_name:', error);
      return this.error(res, 'Lỗi trong quá trình cập nhật file_name', 500, error);
    }
  });
}

module.exports = new UpdateFiles2NameController();