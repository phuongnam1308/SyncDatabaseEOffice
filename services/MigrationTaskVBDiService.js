// services/MigrationTaskVBDiService.js
const TaskVBDiModel = require('../models/TaskVBDiModel');  // <-- Import đúng cách
const { tableMappings } = require('../config/tablesTaskVBDi');
const { mapFieldValues, chunkArray, formatNumber, calculatePercentage } = require('../utils/helpers');
const logger = require('../utils/logger');

class MigrationTaskVBDiService {
  constructor() {
    this.model = new TaskVBDiModel();  // <-- Khởi tạo class
    this.batchSize = parseInt(process.env.BATCH_SIZE || '100');
  }

  async initialize() {
    try {
      await this.model.initialize();
      logger.info('MigrationTaskVBDiService đã được khởi tạo');
    } catch (error) {
      logger.error('Lỗi khởi tạo MigrationTaskVBDiService:', error);
      throw error;
    }
  }

  async migrateTaskVBDiRecords() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU MIGRATION TASKVBDI → TASK3 ===');

    try {
      const config = tableMappings.taskvbdi;
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
              logger.warn(`SKIP: ID cũ ${oldRecord.ID} đã tồn tại trong task3`);
              continue;
            }

            let newRecord = mapFieldValues(oldRecord, config.fieldMapping, config.defaultValues);

            if (newRecord.name && newRecord.name.startsWith('Tổ chức thực hiện ')) {
              newRecord.name = newRecord.name.replace('Tổ chức thực hiện ', '');
            }

            switch (oldRecord.TrangThai?.trim()) {
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
                newRecord.status = 1;
            }

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

            newRecord.update_at = new Date();

            await this.model.insertToNewDb(newRecord);
            totalInserted++;

          } catch (error) {
            totalErrors++;
            logger.error(`Lỗi migrate bản ghi ID ${oldRecord.ID} vào task3:`, error.message);
          }
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('=== HOÀN THÀNH MIGRATION TASK3 VBDI ===');
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
      logger.error('Lỗi trong quá trình migration TaskVBDi vào task3:', error);
      throw error;
    }
  }

  async getStatistics() {
    try {
      const oldCount = await this.model.countOldDb();
      const newCount = await this.model.countNewDb();

      return {
        source: { database: 'DataEOfficeSNP', schema: 'dbo', table: 'TaskVBDi', count: oldCount },
        destination: { database: 'camunda', schema: 'dbo', table: 'task3', count: newCount },
        migrated: newCount,
        remaining: oldCount - newCount,
        percentage: calculatePercentage(newCount, oldCount)
      };
    } catch (error) {
      logger.error('Lỗi lấy thống kê TaskVBDi (task3):', error);
      throw error;
    }
  }

  async close() {
    await this.model.close();
  }
}

module.exports = MigrationTaskVBDiService;