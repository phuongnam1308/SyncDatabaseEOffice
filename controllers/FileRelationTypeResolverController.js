// controllers/FileRelationTypeResolverController.js
const FileRelationTypeResolverService = require('../services/FileRelationTypeResolverService');
const FileRelationTypeResolverModel = require('../models/FileRelationTypeResolverModel');
const logger = require('../utils/logger');

class FileRelationTypeResolverController {
  constructor() {
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      const model = new FileRelationTypeResolverModel();
      this.service = new FileRelationTypeResolverService(model, logger);
    }
  }

  resolve = async (req, res) => {
    try {
      await this.initService();

      const result = await this.service.resolve();

      return res.status(200).json({
        status: 1,
        message: 'Resolve object_type từ type_doc thành công',
        count: result.resolved,
        data: result.data
      });
    } catch (error) {
      logger.error('Lỗi resolve object_type', error);
      return res.status(500).json({
        status: 0,
        message: 'Lỗi resolve object_type',
        error: error.message
      });
    }
  };
}

module.exports = new FileRelationTypeResolverController();
