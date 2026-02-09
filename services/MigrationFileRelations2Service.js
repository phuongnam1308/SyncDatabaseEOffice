// services/MigrationFileRelations2Service.js
const FileRelations2Model = require('../models/FileRelations2Model');
const { tableMappings } = require('../config/tablesFileRelations');
const { mapFieldValues, chunkArray, formatNumber, calculatePercentage } = require('../utils/helpers');
const logger = require('../utils/logger');

class MigrationFileRelations2Service {
  constructor() {
    this.model = new FileRelations2Model();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '100');  // Batch insert size
    this.pageSize = 1000;  // THÊM: Page size cho paging query (tăng/giảm tùy performance, ví dụ 1000-5000)
  }

  async initialize() {
    try {
      await this.model.initialize();
      logger.info('MigrationFileRelations2Service đã được khởi tạo');
    } catch (error) {
      logger.error('Lỗi khởi tạo MigrationFileRelations2Service:', error);
      throw error;
    }
  }

  async migrateFileRelations2() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU MIGRATION FILES2 → FILE_RELATIONS2 ===');

    try {
      const config = tableMappings.file_relations2;
      const totalRecords = await this.model.countOldDb();
      logger.info(`Tổng số bản ghi cần migrate: ${formatNumber(totalRecords)}`);

      if (totalRecords === 0) {
        logger.warn('Không có dữ liệu để migrate');
        return { success: true, total: 0, inserted: 0, skipped: 0, errors: 0 };
      }

      const totalPages = Math.ceil(totalRecords / this.pageSize);
      let totalInserted = 0;
      let totalSkipped = 0;
      let totalErrors = 0;

      for (let page = 0; page < totalPages; page++) {
        logger.info(`Đang lấy và xử lý page ${page + 1}/${totalPages} (pageSize: ${this.pageSize})...`);

        const oldRecords = await this.model.getFromOldDbPaged(page, this.pageSize);  // SỬA: Dùng paging thay getAllFromOldDb
        const batches = chunkArray(oldRecords, this.batchSize);

        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i];
          logger.info(`  Đang xử lý batch ${i + 1}/${batches.length} trong page ${page + 1}...`);

          for (const oldRecord of batch) {
            try {
              const existing = await this.model.findByBackupId(oldRecord.id_bak);
              if (existing) {
                totalSkipped++;
                logger.warn(`SKIP: ID cũ ${oldRecord.id} đã tồn tại`);
                continue;
              }

              const newRecord = mapFieldValues(oldRecord, config.fieldMapping, config.defaultValues);

              await this.model.insertToNewDb(newRecord);
              totalInserted++;

            } catch (error) {
              totalErrors++;
              logger.error(`Lỗi migrate bản ghi ID ${oldRecord.id}:`, error.message);
            }
          }
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('=== HOÀN THÀNH MIGRATION FILE_RELATIONS2 ===');
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
      logger.error('Lỗi trong quá trình migration FileRelations2:', error);
      throw error;
    }
  }

  async getStatistics() {
    try {
      const oldCount = await this.model.countOldDb();
      const newCount = await this.model.countNewDb();

      return {
        source: { database: 'camunda', schema: 'dbo', table: 'files2', count: oldCount },
        destination: { database: 'camunda', schema: 'dbo', table: 'file_relations2', count: newCount },
        migrated: newCount,
        remaining: oldCount - newCount,
        percentage: calculatePercentage(newCount, oldCount)
      };
    } catch (error) {
      logger.error('Lỗi lấy thống kê FileRelations2:', error);
      throw error;
    }
  }

  async close() {
    await this.model.close();
  }
}

module.exports = MigrationFileRelations2Service;