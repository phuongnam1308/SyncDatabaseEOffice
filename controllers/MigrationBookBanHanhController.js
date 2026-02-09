// controllers/MigrationBookBanHanhController.js
const BaseController = require('./BaseController');
const MigrationBookBanHanhService = require('../services/MigrationBookBanHanhService');
const logger = require('../utils/logger');
/**
 * @swagger
 * tags:
 *   name: Dong bo so van ban
 *   description: Đồng bộ số văn bản ban hành số văn bản đến , số văn bản đi
 */
class MigrationBookBanHanhController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationBookBanHanhService();
      await this.service.initialize();
    }
  }

  getStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.service.getStatistics();
      return this.success(res, stats, 'Lấy thống kê Văn bản ban hành thành công');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê Văn bản ban hành', 500, error);
    }
  });
  /**
   * @swagger
   * /migrate/bookbanhanh:
   *   get:
   *     summary: đồng bộ sô ban hành đang hoạt động
   *     tags: [Dong bo so van ban]
   */
  migrateBookBanHanh = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu migration Văn bản ban hành (gộp theo SoVanBan) qua API...');
      const result = await this.service.migrateBookBanHanh();
      return this.success(res, result, 'Migration Văn bản ban hành hoàn thành');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình migration Văn bản ban hành', 500, error);
    }
  });
}

module.exports = new MigrationBookBanHanhController();