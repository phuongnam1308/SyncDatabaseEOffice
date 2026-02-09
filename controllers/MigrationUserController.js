// controllers/MigrationUserController.js
const BaseController = require('./BaseController');
const MigrationUserService = require('../services/MigrationUserService');
const logger = require('../utils/logger');


/**
 * @swagger
 * tags:
 *   name: Dong bo nguoi dung
 *   description: Các API phục vụ migrate dữ liệu người dùng
 */

class MigrationUserController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationUserService();
      await this.service.initialize();
    }
  }
  /**
   * @swagger
   * /statistics/user:
   *   get:
   *     summary: Lấy thống kê User
   *     description: Lấy số lượng user đã migrate, chưa migrate và lỗi
   *     tags: [Dong bo nguoi dung]
   *     responses:
   *       200:
   *         description: Lấy thống kê User thành công
   *         content:
   *           application/json:
   *             example:
   *               success: true
   *               message: Lấy thống kê User thành công
   *               data:
   *                 tongUser: 1000
   *                 daMigrate: 980
   *                 loi: 20
   *       500:
   *         description: Lỗi hệ thống
   */
  getStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.service.getStatistics();
      return this.success(res, stats, 'Lấy thống kê User thành công');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê User', 500, error);
    }
  });

  
  /**
   * @swagger
   * /migrate/user:
   *   get:
   *     summary: Thực hiện đồng bộ dữ liệu người dùng
   *     description: Chạy migrate toàn bộ dữ liệu user từ hệ thống cũ sang hệ thống mới
   *     tags: [Dong bo nguoi dung]
   *     responses:
   *       200:
   *         description: Migration User hoàn thành
   *         content:
   *           application/json:
   *             example:
   *               success: true
   *               message: Migration User hoàn thành
   *               data:
   *                 thanhCong: 980
   *                 thatBai: 20
   *       500:
   *         description: Lỗi trong quá trình migration User
   */

  migrateUser = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu migration User qua API...');
      const result = await this.service.migrateUser();
      return this.success(res, result, 'Migration User hoàn thành');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình migration User', 500, error);
    }
  });
}

module.exports = new MigrationUserController();