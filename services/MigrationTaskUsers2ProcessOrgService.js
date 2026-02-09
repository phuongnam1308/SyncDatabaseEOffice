const TaskUsers2ProcessOrgMappingModel =
  require('../models/TaskUsers2ProcessOrgMappingModel');
const logger = require('../utils/logger');

class MigrationTaskUsers2ProcessOrgService {
  constructor() {
    this.model = new TaskUsers2ProcessOrgMappingModel();
  }

  async initialize() {
    await this.model.initialize();
  }

  async mapping() {
    logger.info('=== MAP process_id / process_name theo organization_units ===');

    const records = await this.model.getNeedMapping();

    let updated = 0;
    let skipped = 0;

    for (const record of records) {
      const org = await this.model.findOrgByBackupId(record.userId_bak);

      if (!org) {
        skipped++;
        logger.warn(
          `Không tìm thấy organization_unit cho Id_backups=${record.userId_bak}`
        );
        continue;
      }

      await this.model.updateProcess(record.id, org);
      updated++;
    }

    return {
      total: records.length,
      updated,
      skipped
    };
  }
}

module.exports = MigrationTaskUsers2ProcessOrgService;
