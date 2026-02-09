const FileRelationsMappingModel = require('../models/FileRelationsMappingModel');
const logger = require('../utils/logger');

class FileRelationsMappingService {
  constructor() {
    this.model = new FileRelationsMappingModel();
  }

  async initialize() {
    await this.model.initialize();
  }

  async mappingObjectType() {
    logger.info('[SERVICE] Start mapping object_type');

    const mapped = await this.model.updateMappedObjectType();
    const fallback = await this.model.updateRemainObjectType();
    const total = await this.model.countAll();

    logger.info('[SERVICE] Mapping done', { mapped, fallback });

    return {
      mapped,
      fallback,
      total
    };
  }
}

module.exports = FileRelationsMappingService;
