// controllers/IncomingFileMigrationController.js
const IncomingFileMigrationModel = require('../models/IncomingFileMigrationModel');
const IncomingFileMigrationService = require('../services/IncomingFileMigrationService');

class IncomingFileMigrationController {
  /**
   * @swagger
   * /migrate/files-vbden:
   *   get:
   *     summary: Đông bộ file văn bản đến về bảng trung gian
   *     tags: [Dong bo file]
   */
  migrate = async (req, res) => {
    const model = new IncomingFileMigrationModel();
    await model.initialize();

    const service = new IncomingFileMigrationService(model);
    const result = await service.migrate();

    res.json({
      status: 1,
      message: 'Migrate files VanBanDen thành công',
      data: result
    });
  };
}

module.exports = new IncomingFileMigrationController();
