// services/MigrationIncomingDocumentDeleteService.js
const IncomingDocumentDeleteModel = require('../models/IncomingDocumentDeleteModel');
const { tableMappings } = require('../config/tablesIncomingDocumentsDelete');
const { mapFieldValues, chunkArray, formatNumber, calculatePercentage } = require('../utils/helpers');
const logger = require('../utils/logger');

class MigrationIncomingDocumentDeleteService {
  constructor() {
    this.model = new IncomingDocumentDeleteModel();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '100');
  }

  async initialize() {
    try {
      await this.model.initialize();
      logger.info('MigrationIncomingDocumentDeleteService đã được khởi tạo');
    } catch (error) {
      logger.error('Lỗi khởi tạo MigrationIncomingDocumentDeleteService:', error);
      throw error;
    }
  }

  async migrateIncomingDocumentsDelete() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU MIGRATION VĂN BẢN ĐẾN DELETE ===');

    try {
      const config = tableMappings.incomingdocumentdelete;
      const totalRecords = await this.model.countOldDb();
      logger.info(`Tổng số văn bản delete cần migrate: ${formatNumber(totalRecords)}`);

      if (totalRecords === 0) {
        logger.warn('Không có dữ liệu văn bản đến delete để migrate');
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
            const existingByBackup = await this.model.findByBackupId(oldRecord.ID);
            if (existingByBackup) {
              totalSkipped++;
              logger.warn(`SKIP: ID cũ ${oldRecord.ID} đã tồn tại`);
              continue;
            }

            const newRecord = mapFieldValues(oldRecord, config.fieldMapping, config.defaultValues);

            // Tra cứu book_document_id dựa trên SoDen và type_document
            const bookId = await this.model.findBookDocumentIdBySoDen(oldRecord.SoDen);
            newRecord.book_document_id = bookId;  // Gán nếu tìm thấy, null nếu không

            await this.model.insertToNewDb(newRecord);
            totalInserted++;

          } catch (error) {
            totalErrors++;
            logger.error(`Lỗi migrate văn bản delete ID ${oldRecord.ID}: ${error.message}`);
          }
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('=== HOÀN THÀNH MIGRATION VĂN BẢN ĐẾN DELETE ===');
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
      logger.error('Lỗi trong quá trình migration Incoming Documents Delete:', error);
      throw error;
    }
  }

  async getStatistics() {
    try {
      const oldCount = await this.model.countOldDb();
      const newCount = await this.model.countNewDb();

      return {
        source: { database: 'DataEOfficeSNP', schema: 'dbo', table: 'VanBanDenDelete', count: oldCount },
        destination: { database: 'DiOffice', table: 'incomming_documents', count: newCount },
        migrated: newCount,
        remaining: oldCount - newCount,
        percentage: calculatePercentage(newCount, oldCount)
      };
    } catch (error) {
      logger.error('Lỗi lấy thống kê Incoming Documents Delete:', error);
      throw error;
    }
  }

  async close() {
    await this.model.close();
  }
}

module.exports = MigrationIncomingDocumentDeleteService;