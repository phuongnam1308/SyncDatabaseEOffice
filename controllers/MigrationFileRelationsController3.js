// controllers/MigrationFileRelationsController.js
const BaseController = require('./BaseController');
const MigrationFileRelationsService = require('../services/MigrationFileRelationsService3');
const logger = require('../utils/logger');

/**
 * @swagger
 * tags:
 *   name: Migration File Relations
 *   description: Di chuyển dữ liệu từ files2 sang file_relations2
 */
class MigrationFileRelationsController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationFileRelationsService();
      await this.service.initialize();
    }
  }

  getStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.service.getStatistics();
      logger.info('Thống kê migration file_relations2: ' + JSON.stringify(stats));
      return this.success(res, { status: 1, data: stats, message: 'Lấy thống kê migration file_relations2 thành công' });
    } catch (error) {
      logger.error('Lỗi lấy thống kê migration file_relations2:', error);
      return this.error(res, 'Lỗi lấy thống kê migration file_relations2', 500, error);
    }
  });

  /**
   * @swagger
   * /migrate/file-relations:
   *   get:
   *     summary: Di chuyển dữ liệu từ files2 sang file_relations2
   *     tags: [Migration File Relations]
   */
  migrate = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu migration từ files2 sang file_relations2...');
      const result = await this.service.migrateFileRelations();
      logger.info('Kết quả migration file_relations2: ' + JSON.stringify(result));
      return this.success(res, { status: 1, data: result, message: 'Migration file_relations2 hoàn thành' });
    } catch (error) {
      logger.error('Lỗi trong quá trình migration file_relations2:', error);
      return this.error(res, 'Lỗi trong quá trình migration file_relations2', 500, error);
    }
  });
}

module.exports = new MigrationFileRelationsController();