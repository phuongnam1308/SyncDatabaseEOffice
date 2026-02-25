// services/MigrationBookDocumentDeleteService.js
const BookDocumentDeleteModel = require('../models/BookDocumentDeleteModel');
const { tableMappings } = require('../config/tablesBookDocumentsDelete');
const logger = require('../utils/logger');

class MigrationBookDocumentDeleteService {
  constructor() {
    this.model = new BookDocumentDeleteModel();
  }

  async initialize() {
    try {
      await this.model.initialize();
      logger.info('MigrationBookDocumentDeleteService đã được khởi tạo');
    } catch (error) {
      logger.error('Lỗi khởi tạo MigrationBookDocumentDeleteService:', error);
      throw error;
    }
  }

  async migrateBookDocumentsDelete() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU MIGRATION SỔ VĂN BẢN DELETE (GỘP THEO TITLE) ===');

    try {
      const totalRecords = await this.model.countOldDb();
      logger.info(`Tổng số văn bản delete cũ: ${totalRecords}`);

      if (totalRecords === 0) {
        logger.warn('Không có dữ liệu văn bản delete để migrate');
        return { success: true, total_old: 0, books_inserted: 0, skipped: 0, errors: 0 };
      }

      const oldRecords = await this.model.getAllFromOldDb();

      // Gộp theo Title (name/to_book_code)
      const grouped = oldRecords.reduce((acc, record) => {
        const key = record.Title?.trim() || 'Không tên';
        if (!acc[key]) {
          acc[key] = {
            name: key,
            sender_unit: record.CoQuanGuiText || null,
            private_level: record.DoKhan || null,
            count: 0
          };
        }
        acc[key].count++;
        return acc;
      }, {});

      let totalInserted = 0;
      let totalSkipped = 0;
      let totalErrors = 0;

      for (const groupKey in grouped) {
        try {
          // Check trùng lặp theo name (to_book_code)
          const exists = await this.model.checkIfNameExists(groupKey);
          if (exists) {
            totalSkipped++;
            logger.warn(`SKIP: Sổ "${groupKey}" đã tồn tại (to_book_code duplicate)`);
            continue;
          }

          const group = grouped[groupKey];
          const newRecord = {
            name: group.name,
            year: 2014,
            sender_unit: group.sender_unit,
            private_level: group.private_level,
            count: group.count,
            status: 1,
            type_document: 'IncommingDocument',
            manager_book: null,
            active: 1,
            order: null,
            created_by: null,
            created_at: new Date(),
            updated_at: new Date()
          };

          await this.model.insertToNewDb(newRecord);
          totalInserted++;
          logger.info(`Insert sổ "${group.name}" với count = ${group.count}`);

        } catch (error) {
          totalErrors++;
          logger.error(`Lỗi insert sổ "${groupKey}": ${error.message}`);
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('=== HOÀN THÀNH MIGRATION SỔ VĂN BẢN DELETE ===');
      logger.info(`Thời gian: ${duration}s | Inserted: ${totalInserted} | Skipped (duplicate): ${totalSkipped} | Errors: ${totalErrors}`);

      return {
        success: true,
        total_old_documents: totalRecords,
        books_inserted: totalInserted,
        skipped_duplicate: totalSkipped,
        errors: totalErrors,
        duration
      };

    } catch (error) {
      logger.error('Lỗi tổng thể migration Book Documents Delete:', error);
      throw error;
    }
  }

  async getStatistics() {
    try {
      const oldCount = await this.model.countOldDb();
      const newCount = await this.model.countNewDb();

      return {
        source: { database: 'DataEOfficeSNP', schema: 'dbo', table: 'VanBanDenDelete', count: oldCount },
        destination: { database: 'camunda', table: 'book_documents', count: newCount },
        migrated_books: newCount,
        remaining: oldCount - newCount,
        percentage: oldCount > 0 ? ((newCount / oldCount) * 100).toFixed(2) + '%' : '0%'
      };
    } catch (error) {
      logger.error('Lỗi lấy thống kê Book Documents Delete:', error);
      throw error;
    }
  }

  async close() {
    await this.model.close();
  }
}

module.exports = MigrationBookDocumentDeleteService;