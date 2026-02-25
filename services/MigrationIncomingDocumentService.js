// services/MigrationIncomingDocumentService.js
const IncomingDocumentModel = require('../models/IncomingDocumentModel');
const { tableMappings } = require('../config/tablesIncomingDocuments');
const { mapFieldValues, chunkArray, formatNumber, calculatePercentage } = require('../utils/helpers');
const logger = require('../utils/logger');

class MigrationIncomingDocumentService {
  constructor() {
    this.model = new IncomingDocumentModel();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '100');
  }

  async initialize() {
    try {
      await this.model.initialize();
      logger.info('MigrationIncomingDocumentService đã được khởi tạo');
    } catch (error) {
      logger.error('Lỗi khởi tạo MigrationIncomingDocumentService:', error);
      throw error;
    }
  }

  async migrateIncomingDocuments() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU MIGRATION VĂN BẢN ĐẾN ===');

    try {
      const config = tableMappings.incomingdocument;
      const totalRecords = await this.model.countOldDb();
      logger.info(`Tổng số văn bản cần migrate: ${formatNumber(totalRecords)}`);

      if (totalRecords === 0) {
        logger.warn('Không có dữ liệu văn bản đến để migrate');
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

            // Map dữ liệu
            const newRecord = mapFieldValues(oldRecord, config.fieldMapping, config.defaultValues);

            // Tra cứu book_document_id - ĐẢM BẢO TRẢ VỀ INT hoặc NULL
            let bookId = null;
            if (oldRecord.SoDen) {
              bookId = await this.model.findBookDocumentIdBySoDen(oldRecord.SoDen);
              
              // Chuyển đổi sang integer hoặc null
              if (bookId !== null && bookId !== undefined) {
                bookId = parseInt(bookId, 10);
                if (isNaN(bookId)) {
                  logger.warn(`book_document_id không hợp lệ cho SoDen ${oldRecord.SoDen}, set null`);
                  bookId = null;
                }
              }
            }
            newRecord.book_document_id = bookId;

            // Validate các trường datetime
            const dateFields = [
              'created_at', 'updated_at', 'receive_date', 'to_book_date', 
              'deadline_reply', 'document_date', 'deadline', 'resolution_deadline'
            ];
            dateFields.forEach(field => {
              if (newRecord[field]) {
                const dateValue = new Date(newRecord[field]);
                if (isNaN(dateValue.getTime())) {
                  logger.warn(`Ngày tháng không hợp lệ cho field ${field}: "${newRecord[field]}" → set null`);
                  newRecord[field] = null;
                }
              }
            });

            // Validate các trường integer
            const intFields = [
              'book_document_id', 'status', 'copy_count', 'page_count', 
              'ModuleId', 'ItemId', 'MigrateFlg', 'MigrateErrFlg', 
              'DGPId', 'SoBan', 'SoTrang'
            ];
            intFields.forEach(field => {
              if (newRecord[field] !== null && newRecord[field] !== undefined) {
                const intValue = parseInt(newRecord[field], 10);
                if (isNaN(intValue)) {
                  logger.warn(`Integer không hợp lệ cho field ${field}: "${newRecord[field]}" → set null`);
                  newRecord[field] = null;
                } else {
                  newRecord[field] = intValue;
                }
              }
            });

            await this.model.insertToNewDb(newRecord);
            totalInserted++;

          } catch (error) {
            totalErrors++;
            logger.error(`Lỗi migrate văn bản ID ${oldRecord.ID}:`, error.message);
          }
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('=== HOÀN THÀNH MIGRATION VĂN BẢN ĐẾN ===');
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
      logger.error('Lỗi trong quá trình migration Incoming Documents:', error);
      throw error;
    }
  }

  async getStatistics() {
    try {
      const oldCount = await this.model.countOldDb();
      const newCount = await this.model.countNewDb();

      return {
        source: { database: 'DataEOfficeSNP', schema: 'dbo', table: 'VanBanDen', count: oldCount },
        destination: { database: 'camunda', table: 'incomming_documents', count: newCount },
        migrated: newCount,
        remaining: oldCount - newCount,
        percentage: calculatePercentage(newCount, oldCount)
      };
    } catch (error) {
      logger.error('Lỗi lấy thống kê Incoming Documents:', error);
      throw error;
    }
  }

  async close() {
    await this.model.close();
  }
}

module.exports = MigrationIncomingDocumentService;