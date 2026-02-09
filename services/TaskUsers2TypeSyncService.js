const TaskUsers2TypeSyncModel =
  require('../models/TaskUsers2TypeSyncModel');
const logger = require('../utils/logger');

class TaskUsers2TypeSyncService {
  constructor() {
    this.model = new TaskUsers2TypeSyncModel();
  }

  async initialize() {
    await this.model.initialize();
  }

  async sync() {
    logger.info('=== BẮT ĐẦU SYNC UserType → type (task_users2) ===');

    const updated = await this.model.updateTypeFromUserType();

    logger.info(`Hoàn thành sync type, updated: ${updated}`);

    return { updated };
  }
}

module.exports = TaskUsers2TypeSyncService;
