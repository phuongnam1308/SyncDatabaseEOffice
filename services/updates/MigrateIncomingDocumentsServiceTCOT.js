const DocumentCommentsMigrationModelTCOT =
  require('../../models/DocumentCommentsMigrationModelTCOT');
const logger = require('../../utils/logger');

class MigrateIncomingDocumentsServiceTCOT {
  constructor() {
    this.model = new DocumentCommentsMigrationModelTCOT();
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

module.exports = MigrateIncomingDocumentsServiceTCOT;
