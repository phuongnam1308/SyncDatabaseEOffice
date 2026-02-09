// services/MigrationTaskUsers2Service.js
const TaskUsers2Model = require('../models/TaskUsers2Model');
const { tableMappings } = require('../config/tablesTaskUsers');
const { mapFieldValues, chunkArray, formatNumber, calculatePercentage } = require('../utils/helpers');
const logger = require('../utils/logger');

class MigrationTaskUsers2Service {
  constructor() {
    this.model = new TaskUsers2Model();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '200');
  }

  async initialize() {
    await this.model.initialize();
    logger.info('MigrationTaskUsers2Service đã khởi tạo');
  }

  async migrateTaskUsers2() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU MIGRATION TaskVBDenPermission → task_users2 ===');

    try {
      const config = tableMappings.task_users2;
      const totalRecords = await this.model.countOldDb();
      logger.info(`Tổng số bản ghi cần migrate: ${formatNumber(totalRecords)}`);

      if (totalRecords === 0) return { success: true, total: 0, inserted: 0, skipped: 0, errors: 0 };

      const oldRecords = await this.model.getAllFromOldDb();
      const batches = chunkArray(oldRecords, this.batchSize);

      let totalInserted = 0;
      let totalSkipped = 0;
      let totalErrors = 0;

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        logger.info(`Xử lý batch ${i + 1}/${batches.length}`);

        for (const old of batch) {
          try {
            // Check trùng theo cặp khóa (task + user)
            const exists = await this.model.findByBackupKeys(old.TaskId, old.UserId);
            if (exists) {
              totalSkipped++;
              continue;
            }

            // Mapping cơ bản
            let newRecord = mapFieldValues(old, config.fieldMapping, config.defaultValues);

            // Mapping role đặc biệt
            const originalRole = old.UserFieldName;
            newRecord.role = config.roleValueMapping[originalRole] 
              || originalRole 
              || null;

            // Nếu cần convert Modified → ISO string (nếu chưa phải string)
            if (newRecord.update_at && !(typeof newRecord.update_at === 'string')) {
              newRecord.update_at = new Date(newRecord.update_at).toISOString();
            }

            await this.model.insertToNewDb(newRecord);
            totalInserted++;

          } catch (err) {
            totalErrors++;
            logger.error(`Lỗi migrate TaskId=${old.TaskId} UserId=${old.UserId}: ${err.message}`);
          }
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info(`Hoàn thành | Inserted: ${totalInserted} | Skipped: ${totalSkipped} | Errors: ${totalErrors} | Thời gian: ${duration}s`);

      return {
        success: true,
        total: totalRecords,
        inserted: totalInserted,
        skipped: totalSkipped,
        errors: totalErrors,
        duration
      };

    } catch (error) {
      logger.error('Lỗi migration task_users2:', error);
      throw error;
    }
  }

  async getStatistics() {
    const oldCount = await this.model.countOldDb();
    const newCount = await this.model.countNewDb();

    return {
      source: { database: 'DataEOfficeSNP', table: 'TaskVBDenPermission + UserField', count: oldCount },
      destination: { database: 'camunda', table: 'task_users2', count: newCount },
      migrated: newCount,
      remaining: oldCount - newCount,
      percentage: calculatePercentage(newCount, oldCount)
    };
  }

  async close() {
    await this.model.close();
  }
}

module.exports = MigrationTaskUsers2Service;