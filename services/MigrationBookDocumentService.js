// services/MigrationBookDocumentService.js
const BookDocumentModel = require('../models/BookDocumentModel');
const { tableMappings } = require('../config/tablesBookDocuments');
const logger = require('../utils/logger');

class MigrationBookDocumentService {
  constructor() {
    this.model = new BookDocumentModel();
  }

  async initialize() {
    try {
      await this.model.initialize();
      logger.info('MigrationBookDocumentService đã được khởi tạo');
    } catch (error) {
      logger.error('Lỗi khởi tạo MigrationBookDocumentService:', error);
      throw error;
    }
  }

  async migrateBookDocuments() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU MIGRATION SỔ VĂN BẢN (GỘP THEO TITLE) ===');

    try {
      const totalRecords = await this.model.countOldDb();
      logger.info(`Tổng số văn bản cũ: ${totalRecords}`);

      if (totalRecords === 0) {
        logger.warn('Không có dữ liệu văn bản để migrate');
        return { success: true, total_old: 0, books_inserted: 0, errors: 0 };
      }

      const oldRecords = await this.model.getAllFromOldDb();

      // Gộp theo Title (name của sổ)
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
      let totalErrors = 0;

      for (const groupKey in grouped) {
        try {
          const group = grouped[groupKey];
          const newRecord = {
            name: group.name,
            year: 2014,  // Mặc định 2014 cho toàn bộ sổ
            sender_unit: group.sender_unit,
            private_level: group.private_level,
            count: group.count,  // Đếm số văn bản trong nhóm Title
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

      logger.info('=== HOÀN THÀNH MIGRATION SỔ VĂN BẢN ===');
      logger.info(`Thời gian: ${duration}s | Sổ insert: ${totalInserted} | Errors: ${totalErrors}`);

      return {
        success: true,
        total_old_documents: totalRecords,
        books_inserted: totalInserted,
        errors: totalErrors,
        duration
      };

    } catch (error) {
      logger.error('Lỗi tổng thể migration Book Documents:', error);
      throw error;
    }
  }

  async getStatistics() {
    try {
      const oldCount = await this.model.countOldDb();
      const newCount = await this.model.countNewDb();

      return {
        source: { database: 'DataEOfficeSNP', schema: 'dbo', table: 'VanBanDen', count: oldCount },
        destination: { database: 'DiOffice', table: 'book_documents', count: newCount },
        migrated_books: newCount,
        remaining: oldCount - newCount,
        percentage: oldCount > 0 ? ((newCount / oldCount) * 100).toFixed(2) + '%' : '0%'
      };
    } catch (error) {
      logger.error('Lỗi lấy thống kê Book Documents:', error);
      throw error;
    }
  }

  async close() {
    await this.model.close();
  }
}

module.exports = MigrationBookDocumentService;