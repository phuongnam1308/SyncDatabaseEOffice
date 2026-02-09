// controllers/MigrationFileRelationsController.js
const BaseController = require('./BaseController');
const MigrationFileRelationsService = require('../services/MigrationFileRelationsService');
const logger = require('../utils/logger');

/**
 * @swagger
 * tags:
 *   name: Migration File Relations
 *   description: Đồng bộ quan hệ file từ file2 sang file_relations2
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
      logger.info('[API] Get statistics file_relations');

      const stats = await this.service.getStatistics();

      return this.success(res, {
        data: stats,
        count: Object.keys(stats).length
      }, 'Lấy thống kê file_relations thành công');
    } catch (error) {
      logger.error(error);
      return this.error(res, 'Lỗi lấy thống kê file_relations', 500, error);
    }
  });

  /**
   * @swagger
   * /migrate/file-relations:
   *   get:
   *     summary: Thực hiện migration file_relations từ files2
   *     tags: [Migration File Relations]
   */
  migrateFileRelations = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('[API] Bắt đầu migration file_relations');

      const result = await this.service.migrateFileRelationsRecords();

      logger.info('[API] Migration DONE', result);

      return this.success(res, {
        data: result,
        count: result.total
      }, 'Migration file_relations hoàn thành');
    } catch (error) {
      logger.error(error);
      return this.error(res, 'Lỗi trong quá trình migration file_relations', 500, error);
    }
  });
}

module.exports = new MigrationFileRelationsController();
