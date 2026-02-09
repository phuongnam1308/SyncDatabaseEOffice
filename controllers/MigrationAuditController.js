// controllers/MigrationAuditController.js
const BaseController = require('./BaseController');
const MigrationAuditService = require('../services/MigrationAuditService');
const logger = require('../utils/logger');
/**
 * @swagger
 * tags:
 *   name: Dong bo luan chuyen van ban
 *   description: Đồng bộ luân chuyển văn bản từ phần mềm cũ sang phần mềm mới
 */
class MigrationAuditController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationAuditService();
      await this.service.initialize();
    }
  }

  getStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.service.getStatistics();
      return this.success(res, stats, 'Lấy thống kê Audit2 thành công');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê Audit2', 500, error);
    }
  });
  /**
   * @swagger
   * /migrate/audit:
   *   get:
   *     summary: Đồng bộ sô ban hành đang hoạt động
   *     tags: [Dong bo luan chuyen van ban]
   */
  migrateAuditRecords = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu migration Audit2 qua API...');
      const result = await this.service.migrateAuditRecords();
      return this.success(res, result, 'Migration Audit2 hoàn thành');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình migration Audit2', 500, error);
    }
  });
}

module.exports = new MigrationAuditController();