const Task3ToTaskModel = require('../models/Task3ToTaskModel');
const { tableMappings } = require('../config/tablesTask3ToTask');
const { mapFieldValues, chunkArray, formatNumber, calculatePercentage } = require('../utils/helpers');
const logger = require('../utils/logger');

class MigrationTask3ToTaskService {
  constructor() {
    this.model = new Task3ToTaskModel();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '100');
  }

  async initialize() {
    await this.model.initialize();
    logger.info('MigrationTask3ToTaskService đã được khởi tạo');
  }

  async migrateTaskRecords() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU MIGRATION TASK3 → TASK (CÙNG DB) ===');

    try {
      const config = tableMappings.task3toTask;

      // ✅ task3 là SOURCE trong DB mới
      const totalRecords = await this.model.countSource();
      logger.info(`Tổng số bản ghi cần migrate: ${formatNumber(totalRecords)}`);

      if (totalRecords === 0) {
        return { success: true, total: 0, inserted: 0, skipped: 0, errors: 0 };
      }

      const sourceRecords = await this.model.getAllSource();
      const batches = chunkArray(sourceRecords, this.batchSize);

      let totalInserted = 0;
      let totalSkipped = 0;
      let totalErrors = 0;

      for (let i = 0; i < batches.length; i++) {
        logger.info(`Đang xử lý batch ${i + 1}/${batches.length}`);
        for (const record of batches[i]) {
          try {
            const exists = await this.model.findByBackupId(record.ID);
            if (exists) {
              totalSkipped++;
              continue;
            }

            const newRecord = mapFieldValues(
              record,
              config.fieldMapping,
              config.defaultValues
            );

            await this.model.insertTarget(newRecord);
            totalInserted++;

          } catch (err) {
            totalErrors++;
            logger.error(`Lỗi migrate ID ${record.ID}: ${err.message}`);
          }
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('=== HOÀN THÀNH MIGRATION TASK3 → TASK ===');
      logger.info(`Inserted: ${totalInserted} | Skipped: ${totalSkipped} | Errors: ${totalErrors}`);

      return {
        success: true,
        total: totalRecords,
        inserted: totalInserted,
        skipped: totalSkipped,
        errors: totalErrors,
        duration
      };

    } catch (error) {
      logger.error('Lỗi trong quá trình migration task3 sang task:', error);
      throw error;
    }
  }

  async getStatistics() {
    const sourceCount = await this.model.countSource();
    const targetCount = await this.model.countTarget();

    return {
      source: { table: 'task3', count: sourceCount },
      destination: { table: 'task', count: targetCount },
      migrated: targetCount,
      remaining: sourceCount - targetCount,
      percentage: calculatePercentage(targetCount, sourceCount)
    };
  }

  async close() {
    await this.model.close();
  }
}

module.exports = MigrationTask3ToTaskService;
