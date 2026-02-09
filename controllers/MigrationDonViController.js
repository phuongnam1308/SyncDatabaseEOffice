/**
 * ============================================================
 * FILE 4: controllers/MigrationDonViController.js
 * ============================================================
 * Mục đích: Controller xử lý các API endpoints cho DonVi
 * Kế thừa: BaseController
 * ============================================================
 */

const BaseController = require('./BaseController');
const MigrationDonViService = require('../services/MigrationDonViService');
const logger = require('../utils/logger');
/**
 * @swagger
 * tags:
 *   name: Dong bo don vi
 *   description: Đồng bộ đơn vị , đươn vị xử lý đến vào phần mềm cũ
 */
class MigrationDonViController extends BaseController {
  constructor() {
    super();
    this.migrationService = null;
  }

  /**
   * KHỞI TẠO SERVICE
   * Lazy initialization - chỉ khởi tạo khi cần
   */
  async initService() {
    if (!this.migrationService) {
      this.migrationService = new MigrationDonViService();
      await this.migrationService.initialize();
    }
  }

  /**
   * API: LẤY THỐNG KÊ MIGRATION ĐƠN VỊ
   * Endpoint: GET /statistics/donvi
   * 
   * Response:
   * {
   *   success: true,
   *   message: "Lấy thống kê đơn vị thành công",
   *   data: {
   *     source: { database, table, count },
   *     destination: { database, table, count },
   *     migrated: number,
   *     remaining: number,
   *     percentage: number
   *   }
   * }
   */
  /**
 * @swagger
 * /statistics/donvi:
 *   get:
 *     summary: Thống kê Đơn vị
 *     tags: [Dong bo don vi]
 */

  getStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.migrationService.getStatistics();
      return this.success(res, stats, 'Lấy thống kê đơn vị thành công');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê đơn vị', 500, error);
    }
  });

  /**
   * API: THỰC HIỆN MIGRATION ĐƠN VỊ
   * Endpoint: GET /migrate/donvi
   * 
   * Response:
   * {
   *   success: true,
   *   message: "Migration đơn vị hoàn thành",
   *   data: {
   *     total: number,
   *     inserted: number,
   *     savedToBackup: number,
   *     skipped: number,
   *     errors: number,
   *     duration: string
   *   }
   * }
   */

  /**
 * @swagger
 * /migrate/donvi:
 *   get:
 *     summary: Đồng bộ dữ liệu đơn vị
 *     tags: [Dong bo don vi]
 */

  migrateDonVi = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu migration đơn vị qua API...');
      const result = await this.migrationService.migrateDonVi();
      return this.success(res, result, 'Migration đơn vị hoàn thành');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình migration đơn vị', 500, error);
    }
  });
}

module.exports = new MigrationDonViController();