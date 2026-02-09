// controllers/MigrationUserInGroupController.js
const BaseController = require('./BaseController');
const MigrationUserInGroupService = require('../services/MigrationUserInGroupService');
const logger = require('../utils/logger');
/**
 * @swagger
 * tags:
 *   name: Dong bo lien ket 
 *   description: Đồng bộ liên kết của đơn vị , tổ chức
 */
class MigrationUserInGroupController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationUserInGroupService();
      await this.service.initialize();
    }
  }

  getStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.service.getStatistics();
      return this.success(res, stats, 'Lấy thống kê UserInGroup thành công');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê UserInGroup', 500, error);
    }
  });
  /**
   * @swagger
   * /migrate/useringroup:
   *   get:
   *     summary: Đồng bộ liên kết người dùng trong nhóm
   *     tags: [Dong bo lien ket]
   */
  migrateUserInGroup = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu migration UserInGroup qua API...');
      const result = await this.service.migrateUserInGroup();
      return this.success(res, result, 'Migration UserInGroup hoàn thành');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình migration UserInGroup', 500, error);
    }
  });
}

module.exports = new MigrationUserInGroupController();