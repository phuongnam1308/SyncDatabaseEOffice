const BaseController = require('./BaseController');
const MigrationService = require('../services/MigrationOrganizationUnitsService');
const logger = require('../utils/logger');

class MigrationController extends BaseController {
  constructor() {
    super();
    this.migrationService = null;
  }

  async initService() {
    if (!this.migrationService) {
      this.migrationService = new MigrationService();
      await this.migrationService.initialize();
    }
  }

  checkConnection = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const result = await this.migrationService.checkConnections();
      return this.success(res, result, 'Kiểm tra kết nối thành công');
    } catch (error) {
      return this.error(res, 'Lỗi kiểm tra kết nối', 500, error);
    }
  });

  getStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.migrationService.getAllStatistics();
      return this.success(res, stats, 'Lấy thống kê thành công');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê', 500, error);
    }
  });

  getPhongBanStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.migrationService.getPhongBanStatistics();
      return this.success(res, stats, 'Lấy thống kê phòng ban thành công');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê phòng ban', 500, error);
    }
  });

  getPositionStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.migrationService.getPositionStatistics();
      return this.success(res, stats, 'Lấy thống kê position thành công');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê position', 500, error);
    }
  });

  migratePhongBan = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu migration phòng ban qua API...');
      const result = await this.migrationService.migratePhongBan();
      return this.success(res, result, 'Migration phòng ban hoàn thành');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình migration phòng ban', 500, error);
    }
  });

  migratePosition = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu migration position qua API...');
      const result = await this.migrationService.migratePosition();
      return this.success(res, result, 'Migration position hoàn thành');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình migration position', 500, error);
    }
  });

  healthCheck = this.asyncHandler(async (req, res) => {
    return this.success(res, {
      status: 'OK',
      timestamp: new Date(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV
    }, 'Server đang hoạt động');
  });
}

module.exports = new MigrationController();