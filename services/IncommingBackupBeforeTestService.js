const IncommingBackupBeforeTestModel =
  require('../models/IncommingBackupBeforeTestModel');
const logger = require('../utils/logger');

class IncommingBackupBeforeTestService {
  constructor() {
    this.model = new IncommingBackupBeforeTestModel();
  }

  async initialize() {
    await this.model.initialize();
  }

  async backup() {
    logger.info('=== START BACKUP incomming_documents BEFORE TEST ===');

    const total = await this.model.countData();
    const updated = await this.model.backupFields();

    logger.info(
      `Backup incomming_documents2 | total=${total} | updated=${updated}`
    );

    logger.info('=== END BACKUP incomming_documents ===');

    return {
      success: true,
      total,
      updated
    };
  }
}

module.exports = IncommingBackupBeforeTestService;
