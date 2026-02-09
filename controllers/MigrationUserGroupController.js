const BaseController = require('./BaseController');
const MigrationUserGroupService = require('../services/MigrationUserGroupService');
const logger = require('../utils/logger');

class MigrationUserGroupController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationUserGroupService();
      await this.service.initialize();
    }
  }
  /**
   * @swagger
   * /statistics/usergroup:
   *   get:
   *     summary: Thống kê nhóm người dùng
   *     tags: [Dong bo nhom]
   */
  getStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.service.getStatistics();
      return this.success(res, stats, 'Lấy thống kê UserGroup thành công');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê UserGroup', 500, error);
    }
  });
  /**
   * @swagger
   * /migrate/usergroup:
   *   get:
   *     summary: Đồng bộ nhóm người dùng 
   *     tags: [Dong bo nhom]
   */
  migrateUserGroup = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu migration UserGroup qua API...');
      const result = await this.service.migrateUserGroup();
      return this.success(res, result, 'Migration UserGroup hoàn thành');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình migration UserGroup', 500, error);
    }
  });
}

module.exports = new MigrationUserGroupController();