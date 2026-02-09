// services/MigrationTaskUsers2ToTaskUsersService.js
const TaskUsers2ToTaskUsersModel = require('../models/TaskUsers2ToTaskUsersModel');
const { chunkArray, calculatePercentage } = require('../utils/helpers');
const logger = require('../utils/logger');

class MigrationTaskUsers2ToTaskUsersService {
  constructor() {
    this.model = new TaskUsers2ToTaskUsersModel();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '200');
  }

  async initialize() {
    await this.model.initialize();
    logger.info('MigrationTaskUsers2ToTaskUsersService initialized');
  }

  async migrate() {
    const startTime = Date.now();
    logger.info('=== START MIGRATION task_users2 → task_users (FIX FK) ===');

    const total = await this.model.countSource();
    if (!total) {
      return { success: true, total: 0, inserted: 0, skipped: 0, errors: 0 };
    }

    const records = await this.model.getAllSource();
    const batches = chunkArray(records, this.batchSize);

    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    for (const batch of batches) {
      for (const r of batch) {
        try {
          // ✅ MAP task_id mới
          const newTaskId = await this.model.findNewTaskIdByBackupId(r.id_task_bak);

          if (!newTaskId) {
            skipped++;
            logger.warn(
              `Skip task_users2 ID ${r.id} – không tìm thấy task với id_taskBackups=${r.id_task_bak}`
            );
            continue;
          }

          const exists = await this.model.existsByBackup(r.id_task_bak, r.userId_bak);
          if (exists) {
            skipped++;
            continue;
          }

          await this.model.insertTarget({
            task_id: newTaskId,            // 🔥 ID MỚI (FK OK)
            process_id: r.process_id,
            process_name: r.process_name,
            role: r.role,
            type: r.type,
            update_at: r.update_at,
            created_at: r.created_at,
            id_task_bak: r.id_task_bak,
            userId_bak: r.userId_bak,
            table_bak: 'task_users2',
            UserType: r.UserType,
            ModuleId: r.ModuleId,
            Description: r.Description,
            Split: r.Split
          });

          inserted++;
        } catch (err) {
          errors++;
          logger.error(
            `Error migrate task_users2 ID ${r.id}: ${err.message}`
          );
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    return {
      success: true,
      total,
      inserted,
      skipped,
      errors,
      duration
    };
  }

  async statistics() {
    const source = await this.model.countSource();
    const target = await this.model.countTarget();

    return {
      source: { table: 'task_users2', count: source },
      destination: { table: 'task_users', count: target },
      migrated: target,
      remaining: source - target,
      percentage: calculatePercentage(target, source)
    };
  }
}

module.exports = MigrationTaskUsers2ToTaskUsersService;
