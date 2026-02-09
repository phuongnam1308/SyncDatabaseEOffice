const DocumentCommentsMigrationModelTCIDI =
  require('../../models/DocumentCommentsMigrationModelTCIDI');
const logger = require('../../utils/logger');

class MigrateIncomingDocumentsServiceTCIDI {
  constructor() {
    this.model = new DocumentCommentsMigrationModelTCIDI();
    this.batchSize = 500;
  }

  async migrate() {
    await this.model.initialize();

    let total = 0;

    while (true) {
      const inserted = await this.model.migrate(this.batchSize);
      if (!inserted) break;

      total += inserted;
      logger.info(`[MIGRATE] Inserted ${inserted} records`);
    }

    return { totalInserted: total };
  }
}

module.exports = MigrateIncomingDocumentsServiceTCIDI;
