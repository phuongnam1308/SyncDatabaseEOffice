const DocumentCommentsMigrationModelTC =
  require('../../models/DocumentCommentsMigrationModelTC');
const logger = require('../../utils/logger');

class MigrateIncomingDocumentsServiceTC {
  constructor() {
    this.model = new DocumentCommentsMigrationModelTC();
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

module.exports = MigrateIncomingDocumentsServiceTC;
