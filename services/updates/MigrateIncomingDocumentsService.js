const IncomingDocumentsMigrateModel =
  require('../../models/IncomingDocumentsMigrateModel');
const logger = require('../../utils/logger');

class MigrateIncomingDocumentsService {
  constructor() {
    this.model = new IncomingDocumentsMigrateModel();
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

module.exports = MigrateIncomingDocumentsService;
