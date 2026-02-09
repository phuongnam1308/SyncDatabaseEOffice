const FileMigrationModel = require('../models/FileMigrationModel');
const FileMigrationService = require('../services/FileMigrationService');
const logger = require('../utils/logger');
/**
 * @swagger
 * tags:
 *   name: Dong bo file 
 *   description: Đồng bộ file từ phần mềm cũ sang phần mềm mới
 */
class FileMigrationController {
   /**
   * @swagger
   * /migrate/files-vanbanbanhanh:
   *   get:
   *     summary: Đông bộ file văn bản ban hành về bảng trung gian
   *     tags: [Dong bo file]
   */
  migrate = async (req, res) => {
    logger.info('[API] migrate files vanbanbanhanh');

    const model = new FileMigrationModel();
    await model.initialize();

    const service = new FileMigrationService(model);
    const result = await service.migrate();

    res.json({
      status: 1,
      message: 'Migrate files VanBanBanHanh OK',
      data: result
    });
  };
}

module.exports = new FileMigrationController();
