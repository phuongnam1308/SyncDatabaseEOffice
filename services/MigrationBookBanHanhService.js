// services/MigrationBookBanHanhService.js
const BookBanHanhModel = require('../models/BookBanHanhModel');
const { tableMappings } = require('../config/tablesBookBanHanh');
const logger = require('../utils/logger');

class MigrationBookBanHanhService {
  constructor() {
    this.model = new BookBanHanhModel();
  }

  async initialize() {
    try {
      await this.model.initialize();
      logger.info('MigrationBookBanHanhService đã được khởi tạo');
    } catch (error) {
      logger.error('Lỗi khởi tạo MigrationBookBanHanhService:', error);
      throw error;
    }
  }

  async migrateBookBanHanh() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU MIGRATION SỔ VĂN BẢN BAN HÀNH (GỘP THEO SoVanBan) ===');

    try {
      const totalRecords = await this.model.countOldDb();
      logger.info(`Tổng số văn bản ban hành cũ: ${totalRecords}`);

      if (totalRecords === 0) {
        logger.warn('Không có dữ liệu văn bản ban hành để migrate');
        return { success: true, total_old: 0, books_inserted: 0, skipped: 0, errors: 0 };
      }

      const oldRecords = await this.model.getAllFromOldDb();

      // Gộp theo SoVanBan (to_book_code / name của sổ)
      const grouped = oldRecords.reduce((acc, record) => {
        const key = record.SoVanBan?.trim() || 'Không tên';
        if (!acc[key]) {
          acc[key] = {
            name: key,  // name = SoVanBan (tên sổ)
            to_book_code: key,  // to_book_code = SoVanBan (unique)
            sender_unit: record.NoiLuuTru || null,
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
          const group = grouped[groupKey];

          // Check trùng lặp theo to_book_code (name)
          const exists = await this.model.checkIfToBookCodeExists(group.to_book_code);
          if (exists) {
            totalSkipped++;
            logger.warn(`SKIP: Sổ "${group.to_book_code}" đã tồn tại (to_book_code duplicate)`);
            continue;
          }

          const newRecord = {
            name: group.name,
            year: 2014,
            sender_unit: group.sender_unit,
            private_level: group.private_level,
            count: group.count,
            status: 1,
            type_document: 'OutGoingDocument',
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

      logger.info('=== HOÀN THÀNH MIGRATION SỔ VĂN BẢN BAN HÀNH ===');
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
      logger.error('Lỗi tổng thể migration Book Ban Hanh:', error);
      throw error;
    }
  }

  async getStatistics() {
    try {
      const oldCount = await this.model.countOldDb();
      const newCount = await this.model.countNewDb();

      return {
        source: { database: 'DataEOfficeSNP', schema: 'dbo', table: 'VanBanBanHanh', count: oldCount },
        destination: { database: 'DiOffice', table: 'book_documents', count: newCount },
        migrated_books: newCount,
        remaining: oldCount - newCount,
        percentage: oldCount > 0 ? ((newCount / oldCount) * 100).toFixed(2) + '%' : '0%'
      };
    } catch (error) {
      logger.error('Lỗi lấy thống kê Book Ban Hanh:', error);
      throw error;
    }
  }

  async close() {
    await this.model.close();
  }
}

module.exports = MigrationBookBanHanhService;