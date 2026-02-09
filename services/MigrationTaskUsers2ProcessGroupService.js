const TaskUsers2ProcessGroupMappingModel =
  require('../models/TaskUsers2ProcessGroupMappingModel');
const logger = require('../utils/logger');

class MigrationTaskUsers2ProcessGroupService {
  constructor() {
    this.model = new TaskUsers2ProcessGroupMappingModel();
  }

  async initialize() {
    await this.model.initialize();
  }

  async mapping() {
    logger.info('=== MAP process_id / process_name theo group_users ===');

    const records = await this.model.getNeedMapping();

    let updated = 0;
    let skipped = 0;

    for (const record of records) {
      const group = await this.model.findGroupByBackupId(record.userId_bak);

      if (!group) {
        skipped++;
        logger.warn(
          `Không tìm thấy group_users cho id_group_bk=${record.userId_bak}`
        );
        continue;
      }

      await this.model.updateProcess(record.id, group);
      updated++;
    }

    return {
      total: records.length,
      updated,
      skipped
    };
  }
}

module.exports = MigrationTaskUsers2ProcessGroupService;
