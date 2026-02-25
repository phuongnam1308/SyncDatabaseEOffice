// services/MigrationAuditService.js
const AuditModel = require('../models/AuditModel');
const { tableMappings } = require('../config/tablesAudit');
const { mapFieldValues, chunkArray, formatNumber, calculatePercentage } = require('../utils/helpers');
const logger = require('../utils/logger');

class MigrationAuditService {
  constructor() {
    this.model = new AuditModel();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '100');
  }

  async initialize() {
    try {
      await this.model.initialize();
      logger.info('MigrationAuditService đã được khởi tạo');
    } catch (error) {
      logger.error('Lỗi khởi tạo MigrationAuditService:', error);
      throw error;
    }
  }

  async migrateAuditRecords() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU MIGRATION LUAN CHUYEN VAN BAN → AUDIT2 ===');

    try {
      const config = tableMappings.audit;
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

            const newRecord = mapFieldValues(oldRecord, config.fieldMapping, config.defaultValues);

            // Thêm logic mapping nâng cao nếu cần (ví dụ: tra cứu document_id từ IDVanBan)
            // newRecord.document_id = await this.model.findDocumentIdByIDVanBan(oldRecord.IDVanBan);

            await this.model.insertToNewDb(newRecord);
            totalInserted++;

          } catch (error) {
            totalErrors++;
            logger.error(`Lỗi migrate bản ghi ID ${oldRecord.ID}:`, error.message);
          }
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('=== HOÀN THÀNH MIGRATION AUDIT2 ===');
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
      logger.error('Lỗi trong quá trình migration Audit2:', error);
      throw error;
    }
  }

  async getStatistics() {
    try {
      const oldCount = await this.model.countOldDb();
      const newCount = await this.model.countNewDb();

      return {
        source: { database: 'DataEOfficeSNP', schema: 'dbo', table: 'LuanChuyenVanBan', count: oldCount },
        destination: { database: 'DiOffice', schema: 'dbo', table: 'audit2', count: newCount },
        migrated: newCount,
        remaining: oldCount - newCount,
        percentage: calculatePercentage(newCount, oldCount)
      };
    } catch (error) {
      logger.error('Lỗi lấy thống kê Audit2:', error);
      throw error;
    }
  }

  async close() {
    await this.model.close();
  }
}

module.exports = MigrationAuditService;