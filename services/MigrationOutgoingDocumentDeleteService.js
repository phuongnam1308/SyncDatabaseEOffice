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
//         destination: { database: 'camunda', table: 'outgoing_documents', count: newCount },
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

  // async migrateOutgoingDocuments() {
  //   const startTime = Date.now();
  //   logger.info('=== BẮT ĐẦU MIGRATION VĂN BẢN BAN HÀNH ===');

  //   try {
  //     const config = tableMappings.outgoingdocument2;
  //     if (!config) {
  //       throw new Error('Config outgoingdocument2 không tồn tại');
  //     }

  //     const totalRecords = await this.model.countOldDb();
  //     logger.info(`Tổng số văn bản ban hành cần migrate: ${formatNumber(totalRecords)}`);

  //     if (totalRecords === 0) {
  //       logger.warn('Không có dữ liệu để migrate');
  //       return { success: true, total: 0, inserted: 0, skipped: 0, errors: 0 };
  //     }

  //     const oldRecords = await this.model.getAllFromOldDb();
  //     const batches = chunkArray(oldRecords, this.batchSize);

  //     let totalInserted = 0;
  //     let totalSkipped = 0;
  //     let totalErrors = 0;

  //     for (let i = 0; i < batches.length; i++) {
  //       const batch = batches[i];
  //       logger.info(`Đang xử lý batch ${i + 1}/${batches.length}`);

  //       for (const oldRecord of batch) {
  //         try {
  //           const existed = await this.model.findByBackupId(oldRecord.ID);
  //           if (existed) {
  //             totalSkipped++;
  //             logger.warn(`SKIP: ID cũ ${oldRecord.ID} đã tồn tại`);
  //             continue;
  //           }

  //           const newRecord = mapFieldValues(
  //             oldRecord,
  //             config.fieldMapping,
  //             config.defaultValues
  //           );

  //           /* ===== CLEAN INT ===== */
  //           newRecord.SoBan = safeParseInt(oldRecord.SoBan);
  //           newRecord.SoTrang = safeParseInt(oldRecord.SoTrang);
  //           newRecord.ModuleId = safeParseInt(oldRecord.ModuleId);
  //           newRecord.ItemId = safeParseInt(oldRecord.ItemId);
  //           newRecord.MigrateFlg = safeParseInt(oldRecord.MigrateFlg);
  //           newRecord.MigrateErrFlg = safeParseInt(oldRecord.MigrateErrFlg);
  //           newRecord.DGPId = safeParseInt(oldRecord.DGPId);
  //           newRecord.CodeItemId = safeParseInt(oldRecord.CodeItemId);
  //           newRecord.DocSignType = safeParseInt(oldRecord.DocSignType);

  //           /* ===== CLEAN BIT ===== */
  //           newRecord.ChenSo = safeParseBit(oldRecord.ChenSo);
  //           newRecord.PhanCong = safeParseBit(oldRecord.PhanCong);
  //           newRecord.IsLibrary = safeParseBit(oldRecord.IsLibrary);
  //           newRecord.IsKyQuyChe = safeParseBit(oldRecord.IsKyQuyChe);
  //           newRecord.IsConverting = safeParseBit(oldRecord.IsConverting);

  //           /* ===== CLEAN DATE ===== */
  //           newRecord.NgayBanHanh = safeParseDate(oldRecord.NgayBanHanh);
  //           newRecord.NgayHieuLuc = safeParseDate(oldRecord.NgayHieuLuc);
  //           newRecord.NgayHoanTat = safeParseDate(oldRecord.NgayHoanTat);

  //           /* ===== BOOK DOCUMENT ===== */
  //           const bookId = await this.model.findBookDocumentIdBySoVanBan(
  //             oldRecord.SoVanBan
  //           );
  //           newRecord.book_document_id = bookId;

  //           await this.model.insertToNewDb(newRecord);
  //           totalInserted++;

  //         } catch (error) {
  //           totalErrors++;
  //           logger.error(
  //             `Lỗi migrate văn bản ban hành ID ${oldRecord.ID}: ${error.message}`
  //           );
  //         }
  //       }
  //     }

  //     const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  //     logger.info('=== HOÀN THÀNH MIGRATION VĂN BẢN BAN HÀNH ===');
  //     logger.info(
  //       `Thời gian: ${duration}s | Inserted: ${totalInserted} | Skipped: ${totalSkipped} | Errors: ${totalErrors}`
  //     );

  //     return {
  //       success: true,
  //       total: totalRecords,
  //       inserted: totalInserted,
  //       skipped: totalSkipped,
  //       errors: totalErrors,
  //       duration
  //     };

  //   } catch (error) {
  //     logger.error('Lỗi trong quá trình migration Outgoing Documents:', error);
  //     throw error;
  //   }
  // }
  async migrateOutgoingDocuments({ lastSyncDate = null } = {}) {
  const startTime = Date.now();
  logger.info('=== START MIGRATE OUTGOING DOCUMENTS (BATCH MODE) ===');

  const batchSize = this.batchSize || 500;

  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  try {
    /* ===== 1. COUNT ===== */
    const totalRecords = await this.model.countOldDb();
    logger.info(`Total records in old DB: ${totalRecords}`);

    if (totalRecords === 0) {
      return {
        success: true,
        total: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: 0
      };
    }

    /* ===== 2. CALC BATCH ===== */
    const totalBatches = Math.ceil(totalRecords / batchSize);
    logger.info(`Batch size: ${batchSize}, Total batches: ${totalBatches}`);

    /* ===== 3. LOOP BATCH ===== */
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const offset = batchIndex * batchSize;

      logger.info(
        `--- Processing batch ${batchIndex + 1}/${totalBatches} (offset=${offset}) ---`
      );

      const oldRecords = await this.model.getBatchFromOldDb({
        offset,
        limit: batchSize,
        lastSyncDate
      });

      if (!oldRecords || oldRecords.length === 0) {
        logger.warn('No records in this batch, skip');
        continue;
      }

      /* ===== 4. LOOP RECORD ===== */
      for (const oldRecord of oldRecords) {
        try {
          /* ===== 4.1 CHECK ACTION ===== */
          const checkResult = await this.model.checkSyncAction(oldRecord);

          if (checkResult.action === 'skip') {
            totalSkipped++;
            logger.info(
              `[SKIP] ID=${oldRecord.ID} | reason=${checkResult.reason}`
            );
            continue;
          }

          /* ===== 4.2 MAP DATA ===== */
          const newRecord = mapFieldValues(
            oldRecord,
            tableMappings.outgoingdocument2.fieldMapping,
            tableMappings.outgoingdocument2.defaultValues
          );

          // BẮT BUỘC: backup id để update
          newRecord.id_outgoing_bak = oldRecord.ID;

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
          newRecord.book_document_id =
            await this.model.findBookDocumentIdBySoVanBan(oldRecord.SoVanBan);

          /* ===== 4.3 EXECUTE ===== */
          if (checkResult.action === 'insert') {
            await this.model.insertToNewDb(newRecord);
            totalInserted++;

            logger.info(`[INSERT] ID=${oldRecord.ID}`);
          }

          if (checkResult.action === 'update') {
            const affected = await this.model.updateInNewDb(newRecord);

            if (affected > 0) {
              totalUpdated++;
              logger.info(`[UPDATE] ID=${oldRecord.ID}`);
            } else {
              // fallback insert nếu update không trúng
              await this.model.insertToNewDb(newRecord);
              totalInserted++;
              logger.warn(`[UPDATE→INSERT] ID=${oldRecord.ID}`);
            }
          }
        } catch (err) {
          totalErrors++;
          logger.error(
            `[ERROR] ID=${oldRecord.ID} | ${err.message}`
          );
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    logger.info('=== FINISH MIGRATE OUTGOING DOCUMENTS ===');
    logger.info(
      `Inserted=${totalInserted} | Updated=${totalUpdated} | Skipped=${totalSkipped} | Errors=${totalErrors} | Time=${duration}s`
    );

    return {
      success: true,
      total: totalRecords,
      inserted: totalInserted,
      updated: totalUpdated,
      skipped: totalSkipped,
      errors: totalErrors,
      duration
    };
  } catch (error) {
    logger.error('MIGRATION FAILED:', error);
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
          database: 'camunda',
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
