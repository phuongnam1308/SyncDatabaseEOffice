// controllers/FileMigrationController.js
const FileMigrationModel = require('../models/FileMigrationModel');
const FileMigrationService = require('../services/FileMigrationService');

class FileMigrationController {
  migrate = async (req, res) => {
    const model = new FileMigrationModel();
    await model.initialize();

    const service = new FileMigrationService(model);
    const result = await service.migrate();

    res.json({
      status: 1,
      message: 'Migrate files thành công',
      data: result
    });
  };
}

module.exports = new FileMigrationController();
