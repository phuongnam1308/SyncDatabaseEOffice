// services/MigrationTaskUsersVBDiService.js
const TaskUsersVBDiModel = require('../models/TaskUsersVBDiModel');
const { tableMappings } = require('../config/tablesTaskUsersVBDi');
const { mapFieldValues, chunkArray, formatNumber, calculatePercentage } = require('../utils/helpers');
const logger = require('../utils/logger');

class MigrationTaskUsersVBDiService {
  constructor() {
    this.model = new TaskUsersVBDiModel();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '200');
  }

  async initialize() {
    await this.model.initialize();
    logger.info('MigrationTaskUsersVBDiService đã khởi tạo');
  }

  async migrateTaskUsersVBDi() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU MIGRATION TaskVBDiPermission → task_users2 ===');

    try {
      const config = tableMappings.task_users_vbdi;
      const totalRecords = await this.model.countOldDb();
      logger.info(`Tổng số bản ghi VBĐi cần migrate: ${formatNumber(totalRecords)}`);

      if (totalRecords === 0) {
        return { success: true, total: 0, inserted: 0, skipped: 0, errors: 0 };
      }

      const oldRecords = await this.model.getAllFromOldDb();
      const batches = chunkArray(oldRecords, this.batchSize);

      let totalInserted = 0;
      let totalSkipped = 0;
      let totalErrors = 0;

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        logger.info(`Xử lý batch VBĐi ${i + 1}/${batches.length}`);

        for (const old of batch) {
          try {
            const exists = await this.model.findByBackupKeys(old.TaskId, old.UserId);
            if (exists) {
              totalSkipped++;
              continue;
            }

            let newRecord = mapFieldValues(old, config.fieldMapping, config.defaultValues);

            // Mapping role đặc biệt cho VBĐi
            const original = old.UserFieldName?.trim();
            newRecord.role = config.roleValueMapping[original] || original || null;

            if (newRecord.update_at && !(typeof newRecord.update_at === 'string')) {
              newRecord.update_at = new Date(newRecord.update_at).toISOString();
            }

            await this.model.insertToNewDb(newRecord);
            totalInserted++;

          } catch (err) {
            totalErrors++;
            logger.error(`Lỗi migrate VBĐi TaskId=${old.TaskId} UserId=${old.UserId}: ${err.message}`);
          }
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info(`Hoàn thành VBĐi | Inserted: ${totalInserted} | Skipped: ${totalSkipped} | Errors: ${totalErrors} | ${duration}s`);

      return {
        success: true,
        total: totalRecords,
        inserted: totalInserted,
        skipped: totalSkipped,
        errors: totalErrors,
        duration
      };

    } catch (error) {
      logger.error('Lỗi migration task_users2 VBĐi:', error);
      throw error;
    }
  }

  async getStatistics() {
    const oldCount = await this.model.countOldDb();
    const newCount = await this.model.countNewDb();

    return {
      source: { database: 'DataEOfficeSNP', table: 'TaskVBDiPermission + UserField', count: oldCount },
      destination: { database: 'camunda', table: 'task_users2 (tổng)', count: newCount },
      migrated_estimate: oldCount,  // vì cùng đích, chỉ để tham khảo
      percentage: calculatePercentage(oldCount, oldCount) // dummy
    };
  }

  async close() {
    await this.model.close();
  }
}

module.exports = MigrationTaskUsersVBDiService;