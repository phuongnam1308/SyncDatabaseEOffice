const TaskUsers2ProcessMappingModel =
  require('../models/TaskUsers2ProcessMappingModel');
const logger = require('../utils/logger');

class MigrationTaskUsers2ProcessService {
  constructor() {
    this.model = new TaskUsers2ProcessMappingModel();
  }

  async initialize() {
    await this.model.initialize();
  }

  async mappingProcess() {
    logger.info('=== MAP process_id / process_name cho task_users2 ===');

    const records = await this.model.getNeedMapping();

    let updated = 0;
    let skipped = 0;

    for (const record of records) {
      const user = await this.model.findUserByBakId(record.userId_bak);

      if (!user) {
        skipped++;
        logger.warn(`Không tìm thấy user cho userId_bak=${record.userId_bak}`);
        continue;
      }

      await this.model.updateProcess(record.id, user);
      updated++;
    }

    return {
      total: records.length,
      updated,
      skipped
    };
  }
}

module.exports = MigrationTaskUsers2ProcessService;
