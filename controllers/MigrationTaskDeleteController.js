const BaseController = require('./BaseController');
const MigrationTaskDeleteService = require('../services/MigrationTaskDeleteService');
const logger = require('../utils/logger');

class MigrationTaskDeleteController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationTaskDeleteService();
      await this.service.initialize();
    }
  }
  /**
   * @swagger
   * /statistics/task-delete:
   *   get:
   *     summary: Thông kê đồng bộ công việc văn bản đến trạng thái đã xóa
   *     tags: [Dong bo cong viec]
   */
  getStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.service.getStatistics();
      return this.success(res, stats, 'Lấy thống kê Task Delete thành công');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê Task Delete', 500, error);
    }
  });
 /**
   * @swagger
   * /migrate/task-vbdendelete:
   *   get:
   *     summary: Đông bộ công việc văn bản đến trạng thái đã xóa về bảng trung gian
   *     tags: [Dong bo cong viec]
   */
  migrateTaskDeleteRecords = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu migration TaskVBDenDelete qua API...');
      const result = await this.service.migrateTaskDeleteRecords();
      return this.success(res, result, 'Migration Task Delete hoàn thành');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình migration Task Delete', 500, error);
    }
  });
}

module.exports = new MigrationTaskDeleteController();