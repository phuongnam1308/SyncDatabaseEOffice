// // controllers/MigrationUserDeleteController.js
// const BaseController = require('./BaseController');
// const MigrationUserDeleteService = require('../services/MigrationUserDeleteService');
// const logger = require('../utils/logger');

// class MigrationUserDeleteController extends BaseController {
//   constructor() {
//     super();
//     this.service = null;
//   }

//   async initService() {
//     if (!this.service) {
//       this.service = new MigrationUserDeleteService();
//       await this.service.initialize();
//     }
//   }

//   getStatistics = this.asyncHandler(async (req, res) => {
//     try {
//       await this.initService();
//       const stats = await this.service.getStatistics();
//       return this.success(res, stats, 'Lấy thống kê User Delete thành công');
//     } catch (error) {
//       return this.error(res, 'Lỗi lấy thống kê User Delete', 500, error);
//     }
//   });

//   migrateUserDelete = this.asyncHandler(async (req, res) => {
//     try {
//       await this.initService();
//       logger.info('Bắt đầu migration User Delete qua API...');
//       const result = await this.service.migrateUserDelete();
//       return this.success(res, result, 'Migration User Delete hoàn thành');
//     } catch (error) {
//       return this.error(res, 'Lỗi trong quá trình migration User Delete', 500, error);
//     }
//   });
// }

// module.exports = new MigrationUserDeleteController();

// controllers/MigrationUserDeleteController.js
const BaseController = require('./BaseController');
const MigrationUserDeleteService = require('../services/MigrationUserDeleteService');
const logger = require('../utils/logger');

class MigrationUserDeleteController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationUserDeleteService();
      await this.service.initialize();
    }
  }

  getStatistics = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      const stats = await this.service.getStatistics();
      return this.success(res, stats, 'Lấy thống kê User Delete thành công');
    } catch (error) {
      return this.error(res, 'Lỗi lấy thống kê User Delete', 500, error);
    }
  });

  migrateUserDelete = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu migration User Delete qua API...');
      const result = await this.service.migrateUserDelete();
      return this.success(res, result, 'Migration User Delete hoàn thành');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình migration User Delete', 500, error);
    }
  });

  // Thêm endpoint test
  testMigration = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('Bắt đầu test migration User Delete...');
      const result = await this.service.testMigration();
      return this.success(res, result, 'Test migration User Delete hoàn thành');
    } catch (error) {
      return this.error(res, 'Lỗi trong quá trình test migration User Delete', 500, error);
    }
  });
}

module.exports = new MigrationUserDeleteController();