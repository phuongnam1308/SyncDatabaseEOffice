const OutgoingDocumentSyncModel =
  require('../models/OutgoingDocumentSyncModel');
const logger = require('../utils/logger');

class OutgoingBpmnVersionSyncService {
  constructor() {
    this.model = new OutgoingDocumentSyncModel();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '500');
  }

  async initialize() {
    await this.model.initialize();
  }

  async sync() {
    const startTime = Date.now();
    logger.info('=== START SYNC BPMN_VERSION OUTGOING_DOCUMENTS ===');

    const total = await this.model.countNeedSync();
    let updated = 0;

    while (true) {
      const affected = await this.model.syncBpmnVersion(this.batchSize);
      if (affected === 0) break;

      updated += affected;
      logger.info(`UPDATED ${affected} RECORDS (TOTAL ${updated})`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    logger.info('=== END SYNC BPMN_VERSION ===');

    return {
      success: true,
      total,
      updated,
      duration
    };
  }
}

module.exports = OutgoingBpmnVersionSyncService;
