const FileRelations2ToMainModel =
  require('../models/FileRelations2ToMainModel');
const logger = require('../utils/logger');

class FileRelations2ToMainService {
  constructor() {
    this.model = new FileRelations2ToMainModel();
  }

  async migrate() {
    logger.info('[MIGRATE FILE_RELATIONS2 → FILE_RELATIONS] START');

    const total = await this.model.countSource();
    const success = await this.model.migrateAll();

    logger.info('[MIGRATE FILE_RELATIONS2 → FILE_RELATIONS] DONE');

    return {
      total,
      success,
      error: total - success
    };
  }

  async statistics() {
    return {
      source: await this.model.countSource(),
      target: await this.model.countTarget()
    };
  }
}

module.exports = FileRelations2ToMainService;
