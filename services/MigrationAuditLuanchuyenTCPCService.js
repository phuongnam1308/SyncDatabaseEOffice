const AuditLuanchuyenTCPCModel = require('../models/AuditLuanchuyenTCPCModel');
const logger = require('../utils/logger');

class MigrationAuditLuanchuyenTCPCService {
  constructor() {
    this.model = new AuditLuanchuyenTCPCModel();
  }

  async initialize() {
    await this.model.initialize();
  }

  async migrate() {
    const rows = await this.model.getAllFromOldDb();

    let inserted = 0;
    let skipped = 0;

    for (const row of rows) {
      const exists = await this.model.findByBackupId(String(row.ID));
      if (exists) {
        skipped++;
        continue;
      }

      await this.model.insertToNewDb(row);
      inserted++;
    }

    return {
      total: rows.length,
      inserted,
      skipped
    };
  }
}

module.exports = MigrationAuditLuanchuyenTCPCService;