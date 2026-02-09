// controllers/MigrationGroupController.js
const BaseController = require('./BaseController');
const MigrationSharePointGroupService = require('../services/MigrationSharePointGroupService');
const logger = require('../utils/logger');
/**
 * @swagger
 * tags:
 *   name: Dong bo nhom
 *   description: Đồng bộ nhóm người tổ chức , đơn vị , nhóm từ phần mềm cũ sang phần mềm mới
 */

class MigrationGroupController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationSharePointGroupService();
      await this.service.initialize();
    }
  }

  // Test endpoint
  testConnection = this.asyncHandler(async (req, res) => {
    try {
      const model = new (require('../models/SharePointGroupModel'))();
      await model.initialize();
      
      const testResult = await model.testConnection();
      
      return this.success(res, testResult, 'Test kết nối');
    } catch (error) {
      return this.error(res, 'Lỗi test kết nối', 500, error);
    }
  });


  getStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.service.getStatistics();
      return this.success(res, stats, '✅ Thống kê Group');
    } catch (error) {
      logger.error('❌ Lỗi thống kê:', error);
      return this.error(res, 'Lỗi thống kê Group', 500, error);
    }
  });
/**
 * @swagger
 * /migrate/group:
 *   get:
 *     summary: Đồng bộ nhóm người dùng
 *     tags: [Dong bo nhom]
 */

  migrateGroups = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('🚀 Bắt đầu migration Group...');
      const result = await this.service.migrateGroups();
      return this.success(res, result, '✅ Migration Group hoàn thành');
    } catch (error) {
      logger.error('❌ Lỗi migration:', error);
      return this.error(res, 'Lỗi migration Group', 500, error);
    }
  });
}

module.exports = new MigrationGroupController();