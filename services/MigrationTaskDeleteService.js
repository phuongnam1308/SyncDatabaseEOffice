const TaskDeleteModel = require('../models/TaskDeleteModel');
const { tableMappings } = require('../config/tablesTaskDelete');
const { mapFieldValues, chunkArray, formatNumber, calculatePercentage } = require('../utils/helpers');
const logger = require('../utils/logger');

class MigrationTaskDeleteService {
  constructor() {
    this.model = new TaskDeleteModel();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '100');
  }

  async initialize() {
    try {
      await this.model.initialize();
      logger.info('MigrationTaskDeleteService đã được khởi tạo');
    } catch (error) {
      logger.error('Lỗi khởi tạo MigrationTaskDeleteService:', error);
      throw error;
    }
  }

  async migrateTaskDeleteRecords() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU MIGRATION TASKVBDENDELETE → TASK2 ===');

    try {
      const config = tableMappings.taskdelete;
      const totalRecords = await this.model.countOldDb();
      logger.info(`Tổng số bản ghi cần migrate: ${formatNumber(totalRecords)}`);

      if (totalRecords === 0) {
        logger.warn('Không có dữ liệu để migrate');
        return { success: true, total: 0, inserted: 0, skipped: 0, errors: 0 };
      }

      const oldRecords = await this.model.getAllFromOldDb();
      const batches = chunkArray(oldRecords, this.batchSize);

      let totalInserted = 0;
      let totalSkipped = 0;
      let totalErrors = 0;

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        logger.info(`Đang xử lý batch ${i + 1}/${batches.length}...`);

        for (const oldRecord of batch) {
          try {
            const existing = await this.model.findByBackupId(oldRecord.ID);
            if (existing) {
              totalSkipped++;
              logger.warn(`SKIP: ID cũ ${oldRecord.ID} đã tồn tại`);
              continue;
            }

            let newRecord = mapFieldValues(oldRecord, config.fieldMapping, config.defaultValues);

            // Xử lý name
            if (newRecord.name && newRecord.name.startsWith('Tổ chức thực hiện ')) {
              newRecord.name = newRecord.name.replace('Tổ chức thực hiện ', '');
            }

            // Map TrangThai sang status, nhưng default là 3, vậy override nếu cần
            switch (oldRecord.TrangThai) {
              case 'Chưa bắt đầu':
                newRecord.status = 1;
                break;
              case 'Đang thực hiện':
                newRecord.status = 2;
                break;
              case 'Hoàn tất':
                newRecord.status = 4;
                break;
              case 'Hủy':
                newRecord.status = 7;
                break;
              default:
                newRecord.status = 3;  // Default 3 cho delete
            }

            // Map Priority
            switch (oldRecord.Priority) {
              case 0:
                newRecord.priority = 'binhthuong';
                break;
              case 1:
                newRecord.priority = 'gap';
                break;
              default:
                newRecord.priority = null;
            }

            // Update update_at
            newRecord.update_at = new Date();

            await this.model.insertToNewDb(newRecord);
            totalInserted++;

          } catch (error) {
            totalErrors++;
            logger.error(`Lỗi migrate bản ghi ID ${oldRecord.ID}:`, error.message);
          }
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('=== HOÀN THÀNH MIGRATION TASK2 DELETE ===');
      logger.info(`Thời gian: ${duration}s | Inserted: ${totalInserted} | Skipped: ${totalSkipped} | Errors: ${totalErrors}`);

      return {
        success: true,
        total: totalRecords,
        inserted: totalInserted,
        skipped: totalSkipped,
        errors: totalErrors,
        duration
      };

    } catch (error) {
      logger.error('Lỗi trong quá trình migration Task2 Delete:', error);
      throw error;
    }
  }

  async getStatistics() {
    try {
      const oldCount = await this.model.countOldDb();
      const newCount = await this.model.countNewDb();  // Note: countNewDb là tổng task2, có thể không chính xác cho delete, nhưng tạm dùng

      return {
        source: { database: 'DataEOfficeSNP', schema: 'dbo', table: 'TaskVBDenDelete', count: oldCount },
        destination: { database: 'camunda', schema: 'dbo', table: 'task2', count: newCount },
        migrated: newCount,  // Không chính xác, nhưng để giống
        remaining: oldCount - newCount,
        percentage: calculatePercentage(newCount, oldCount)
      };
    } catch (error) {
      logger.error('Lỗi lấy thống kê Task2 Delete:', error);
      throw error;
    }
  }

  async close() {
    await this.model.close();
  }
}

module.exports = MigrationTaskDeleteService;