// controllers/MigrationBookTotalStatisticsController.js
const BaseController = require('./BaseController');
const MigrationBookTotalStatisticsService = require('../services/MigrationBookTotalStatisticsService');
const logger = require('../utils/logger');

class MigrationBookTotalStatisticsController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationBookTotalStatisticsService();
  }
  /**
   * @swagger
   * /statistics/book-total:
   *   get:
   *     summary: Thống kê tổng hợp 4 nguồn văn bản
   *     tags: [Dong bo lien ket]
   *     responses:
   *       200:
   *         description: Thành công
   */
  getTotalStatistics = this.asyncHandler(async (req, res) => {
    try {
      const stats = await this.service.getTotalStatistics();
      return this.success(res, stats, 'Thống kê tổng quát 4 nguồn văn bản thành công');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê tổng quát', 500, error);
    }
  });
}

module.exports = new MigrationBookTotalStatisticsController();