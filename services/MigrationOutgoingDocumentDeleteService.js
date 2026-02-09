// // services/MigrationOutgoingDocumentDeleteService.js
// const OutgoingDocumentDeleteModel = require('../models/OutgoingDocumentDeleteModel');
// const { tableMappings } = require('../config/tablesOutgoingDocumentsDelete');
// const { mapFieldValues, chunkArray, formatNumber, calculatePercentage } = require('../utils/helpers');
// const logger = require('../utils/logger');

// class MigrationOutgoingDocumentDeleteService {
//   constructor() {
//     this.model = new OutgoingDocumentDeleteModel();
//     this.batchSize = parseInt(process.env.BATCH_SIZE || '100');
//   }

//   async initialize() {
//     try {
//       await this.model.initialize();
//       logger.info('MigrationOutgoingDocumentDeleteService đã được khởi tạo');
//     } catch (error) {
//       logger.error('Lỗi khởi tạo MigrationOutgoingDocumentDeleteService:', error);
//       throw error;
//     }
//   }

//   async migrateOutgoingDocumentsDelete() {
//     const startTime = Date.now();
//     logger.info('=== BẮT ĐẦU MIGRATION VĂN BẢN BAN HÀNH DELETE ===');

//     try {
//       const config = tableMappings.outgoingdocumentdelete;
//       const totalRecords = await this.model.countOldDb();
//       logger.info(`Tổng số văn bản ban hành delete cần migrate: ${formatNumber(totalRecords)}`);

//       if (totalRecords === 0) {
//         logger.warn('Không có dữ liệu văn bản ban hành delete để migrate');
//         return { success: true, total: 0, inserted: 0, skipped: 0, errors: 0 };
//       }

//       const oldRecords = await this.model.getAllFromOldDb();
//       const batches = chunkArray(oldRecords, this.batchSize);

//       let totalInserted = 0;
//       let totalSkipped = 0;
//       let totalErrors = 0;

//       for (let i = 0; i < batches.length; i++) {
//         const batch = batches[i];
//         logger.info(`Đang xử lý batch ${i + 1}/${batches.length}...`);

//         for (const oldRecord of batch) {
//           try {
//             const existingByBackup = await this.model.findByBackupId(oldRecord.ID);
//             if (existingByBackup) {
//               totalSkipped++;
//               logger.warn(`SKIP: ID cũ ${oldRecord.ID} đã tồn tại`);
//               continue;
//             }

//             const newRecord = mapFieldValues(oldRecord, config.fieldMapping, config.defaultValues);

//             // Tra cứu book_document_id dựa trên SoVanBan và type_document
//             const bookId = await this.model.findBookDocumentIdBySoVanBan(oldRecord.SoVanBan);
//             newRecord.book_document_id = bookId;  // Gán nếu tìm thấy, null nếu không

//             await this.model.insertToNewDb(newRecord);
//             totalInserted++;

//           } catch (error) {
//             totalErrors++;
//             logger.error(`Lỗi migrate văn bản ban hành delete ID ${oldRecord.ID}: ${error.message}`);
//           }
//         }
//       }

//       const duration = ((Date.now() - startTime) / 1000).toFixed(2);

//       logger.info('=== HOÀN THÀNH MIGRATION VĂN BẢN BAN HÀNH DELETE ===');
//       logger.info(`Thời gian: ${duration}s | Inserted: ${totalInserted} | Skipped: ${totalSkipped} | Errors: ${totalErrors}`);

//       return {
//         success: true,
//         total: totalRecords,
//         inserted: totalInserted,
//         skipped: totalSkipped,
//         errors: totalErrors,
//         duration
//       };

//     } catch (error) {
//       logger.error('Lỗi trong quá trình migration Outgoing Documents Delete:', error);
//       throw error;
//     }
//   }

//   async getStatistics() {
//     try {
//       const oldCount = await this.model.countOldDb();
//       const newCount = await this.model.countNewDb();

//       return {
//         source: { database: 'DataEOfficeSNP', schema: 'dbo', table: 'VanBanBanHanhDelete', count: oldCount },
//         destination: { database: 'DiOffice', table: 'outgoing_documents', count: newCount },
//         migrated: newCount,
//         remaining: oldCount - newCount,
//         percentage: calculatePercentage(newCount, oldCount)
//       };
//     } catch (error) {
//       logger.error('Lỗi lấy thống kê Outgoing Documents Delete:', error);
//       throw error;
//     }
//   }

//   async close() {
//     await this.model.close();
//   }
// }

// module.exports = MigrationOutgoingDocumentDeleteService;
// services/MigrationOutgoingDocumentService.js
const OutgoingDocumentModel = require('../models/OutgoingDocumentModel');
const { tableMappings } = require('../config/tablesOutgoingDocuments');
const {
  mapFieldValues,
  chunkArray,
  formatNumber,
  calculatePercentage
} = require('../utils/helpers');
const logger = require('../utils/logger');

/* =======================
   HELPER CLEAN DATA
======================= */
function safeParseInt(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '' || trimmed.toUpperCase() === 'NULL') return null;
    const parsed = parseInt(trimmed, 10);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

function safeParseBit(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value ? 1 : 0;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(trimmed)) return 1;
    if (['false', '0', 'no', 'null', ''].includes(trimmed)) return 0;
    return null;
  }
  return null;
}

function safeParseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (
      trimmed === '' ||
      trimmed.toUpperCase() === 'NULL' ||
      trimmed.includes('0000')
    ) {
      return null;
    }
    const parsed = new Date(trimmed);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/* =======================
   SERVICE
======================= */
class MigrationOutgoingDocumentService {
  constructor() {
    this.model = new OutgoingDocumentModel();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '100', 10);
  }

  async initialize() {
    try {
      await this.model.initialize();
      logger.info('MigrationOutgoingDocumentService đã được khởi tạo');
    } catch (error) {
      logger.error('Lỗi khởi tạo MigrationOutgoingDocumentService:', error);
      throw error;
    }
  }

  async migrateOutgoingDocuments() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU MIGRATION VĂN BẢN BAN HÀNH ===');

    try {
      const config = tableMappings.outgoingdocument2;
      if (!config) {
        throw new Error('Config outgoingdocument2 không tồn tại');
      }

      const totalRecords = await this.model.countOldDb();
      logger.info(`Tổng số văn bản ban hành cần migrate: ${formatNumber(totalRecords)}`);

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
        logger.info(`Đang xử lý batch ${i + 1}/${batches.length}`);

        for (const oldRecord of batch) {
          try {
            const existed = await this.model.findByBackupId(oldRecord.ID);
            if (existed) {
              totalSkipped++;
              logger.warn(`SKIP: ID cũ ${oldRecord.ID} đã tồn tại`);
              continue;
            }

            const newRecord = mapFieldValues(
              oldRecord,
              config.fieldMapping,
              config.defaultValues
            );

            /* ===== CLEAN INT ===== */
            newRecord.SoBan = safeParseInt(oldRecord.SoBan);
            newRecord.SoTrang = safeParseInt(oldRecord.SoTrang);
            newRecord.ModuleId = safeParseInt(oldRecord.ModuleId);
            newRecord.ItemId = safeParseInt(oldRecord.ItemId);
            newRecord.MigrateFlg = safeParseInt(oldRecord.MigrateFlg);
            newRecord.MigrateErrFlg = safeParseInt(oldRecord.MigrateErrFlg);
            newRecord.DGPId = safeParseInt(oldRecord.DGPId);
            newRecord.CodeItemId = safeParseInt(oldRecord.CodeItemId);
            newRecord.DocSignType = safeParseInt(oldRecord.DocSignType);

            /* ===== CLEAN BIT ===== */
            newRecord.ChenSo = safeParseBit(oldRecord.ChenSo);
            newRecord.PhanCong = safeParseBit(oldRecord.PhanCong);
            newRecord.IsLibrary = safeParseBit(oldRecord.IsLibrary);
            newRecord.IsKyQuyChe = safeParseBit(oldRecord.IsKyQuyChe);
            newRecord.IsConverting = safeParseBit(oldRecord.IsConverting);

            /* ===== CLEAN DATE ===== */
            newRecord.NgayBanHanh = safeParseDate(oldRecord.NgayBanHanh);
            newRecord.NgayHieuLuc = safeParseDate(oldRecord.NgayHieuLuc);
            newRecord.NgayHoanTat = safeParseDate(oldRecord.NgayHoanTat);

            /* ===== BOOK DOCUMENT ===== */
            const bookId = await this.model.findBookDocumentIdBySoVanBan(
              oldRecord.SoVanBan
            );
            newRecord.book_document_id = bookId;

            await this.model.insertToNewDb(newRecord);
            totalInserted++;

          } catch (error) {
            totalErrors++;
            logger.error(
              `Lỗi migrate văn bản ban hành ID ${oldRecord.ID}: ${error.message}`
            );
          }
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('=== HOÀN THÀNH MIGRATION VĂN BẢN BAN HÀNH ===');
      logger.info(
        `Thời gian: ${duration}s | Inserted: ${totalInserted} | Skipped: ${totalSkipped} | Errors: ${totalErrors}`
      );

      return {
        success: true,
        total: totalRecords,
        inserted: totalInserted,
        skipped: totalSkipped,
        errors: totalErrors,
        duration
      };

    } catch (error) {
      logger.error('Lỗi trong quá trình migration Outgoing Documents:', error);
      throw error;
    }
  }

  async getStatistics() {
    try {
      const oldCount = await this.model.countOldDb();
      const newCount = await this.model.countNewDb();

      return {
        source: {
          database: 'DataEOfficeSNP',
          schema: 'dbo',
          table: 'VanBanBanHanh',
          count: oldCount
        },
        destination: {
          database: 'DiOffice',
          table: 'outgoing_documents2',
          count: newCount
        },
        migrated: newCount,
        remaining: oldCount - newCount,
        percentage: calculatePercentage(newCount, oldCount)
      };
    } catch (error) {
      logger.error('Lỗi lấy thống kê Outgoing Documents:', error);
      throw error;
    }
  }

  async close() {
    await this.model.close();
  }
}

module.exports = MigrationOutgoingDocumentService;
