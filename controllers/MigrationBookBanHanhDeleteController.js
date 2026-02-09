// controllers/MigrationBookBanHanhDeleteController.js
const BaseController = require('./BaseController');
const MigrationBookBanHanhDeleteService = require('../services/MigrationBookBanHanhDeleteService');
const logger = require('../utils/logger');

class MigrationBookBanHanhDeleteController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationBookBanHanhDeleteService();
      await this.service.initialize();
    }
  }

  getStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.service.getStatistics();
      return this.success(res, stats, 'Lấy thống kê Văn bản ban hành Delete thành công');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê Văn bản ban hành Delete', 500, error);
    }
  });
  /**
   * @swagger
   * /migrate/bookbanhanhdelete:
   *   get:
   *     summary: Lưu sổ dữ liệu văn bản đã ban hành đã ở trạng thái xóa
   *     tags: [Dong bo so van ban]
   */
  migrateBookBanHanhDelete = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu migration Văn bản ban hành Delete (gộp theo SoVanBan) qua API...');
      const result = await this.service.migrateBookBanHanhDelete();
      return this.success(res, result, 'Migration Văn bản ban hành Delete hoàn thành');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình migration Văn bản ban hành Delete', 500, error);
    }
  });
}

module.exports = new MigrationBookBanHanhDeleteController();