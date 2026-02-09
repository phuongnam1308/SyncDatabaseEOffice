const FileRelationsModel = require('../models/FileRelationsModel');

class MigrationFileRelationsService {
  constructor() {
    this.model = new FileRelationsModel();
  }

  async initialize() {
    await this.model.initialize();
  }

  async getStatistics() {
    const filesCount = await this.model.countFiles();
    const relationsCount = await this.model.countRelations();

    return {
      files2: filesCount,
      file_relations2: relationsCount,
      pending: filesCount - relationsCount
    };
  }

  async migrateFileRelationsRecords() {
    console.log('[SERVICE] migrateFileRelationsRecords START');

    const rows = await this.model.getAllFiles();

    let inserted = 0;
    let skipped = 0;

    for (const row of rows) {
      const exists = await this.model.findByBackupId(row.id_bak);
      if (exists) {
        skipped++;
        continue;
      }
      await this.model.insertRelation(row);
      inserted++;
    }

    console.log('[SERVICE] DONE', { total: rows.length, inserted, skipped });

    return {
      total: rows.length,
      inserted,
      skipped
    };
  }
}

module.exports = MigrationFileRelationsService;
