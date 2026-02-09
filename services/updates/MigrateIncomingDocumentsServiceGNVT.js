const DocumentCommentsMigrationModelGNVT =
  require('../../models/DocumentCommentsMigrationModelGNVT');
const logger = require('../../utils/logger');

class MigrateIncomingDocumentsServiceGNVT {
  constructor() {
    this.model = new DocumentCommentsMigrationModelGNVT();
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

module.exports = MigrateIncomingDocumentsServiceGNVT;
