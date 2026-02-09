const OutgoingBackupBeforeTestModel =
  require('../models/OutgoingBackupBeforeTestModel');
const logger = require('../utils/logger');

class OutgoingBackupBeforeTestService {
  constructor() {
    this.model = new OutgoingBackupBeforeTestModel();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '500');
  }

  async initialize() {
    await this.model.initialize();
  }

  async backup() {
    const startTime = Date.now();
    logger.info('=== START BACKUP outgoing_documents BEFORE TEST ===');

    const total = await this.model.countNeedBackup();
    let updated = 0;

    while (true) {
      const affected = await this.model.backupFields(this.batchSize);
      if (!affected) break;
      updated += affected;
      logger.info(`Backup progress: ${updated}/${total}`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    logger.info('=== END BACKUP outgoing_documents ===');

    return {
      success: true,
      total,
      updated,
      duration
    };
  }
}

module.exports = OutgoingBackupBeforeTestService;
