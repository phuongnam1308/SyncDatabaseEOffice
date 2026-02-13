// // services/MigrationOutgoingDocumentService.js
// const OutgoingDocumentModel = require('../models/OutgoingDocumentModel');
// const { tableMappings } = require('../config/tablesOutgoingDocuments');
// const { mapFieldValues, chunkArray, formatNumber, calculatePercentage } = require('../utils/helpers');
// const logger = require('../utils/logger');

// class MigrationOutgoingDocumentService {
//   constructor() {
//     this.model = new OutgoingDocumentModel();
//     this.batchSize = parseInt(process.env.BATCH_SIZE || '100');
//   }

//   async initialize() {
//     try {
//       await this.model.initialize();
//       logger.info('MigrationOutgoingDocumentService đã được khởi tạo');
//     } catch (error) {
//       logger.error('Lỗi khởi tạo MigrationOutgoingDocumentService:', error);
//       throw error;
//     }
//   }

//   async migrateOutgoingDocuments() {
//     const startTime = Date.now();
//     logger.info('=== BẮT ĐẦU MIGRATION VĂN BẢN BAN HÀNH ===');

//     try {
//       const config = tableMappings.outgoingdocument;
//       const totalRecords = await this.model.countOldDb();
//       logger.info(`Tổng số văn bản ban hành cần migrate: ${formatNumber(totalRecords)}`);

//       if (totalRecords === 0) {
//         logger.warn('Không có dữ liệu văn bản ban hành để migrate');
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
//             logger.error(`Lỗi migrate văn bản ban hành ID ${oldRecord.ID}: ${error.message}`);
//           }
//         }
//       }

//       const duration = ((Date.now() - startTime) / 1000).toFixed(2);

//       logger.info('=== HOÀN THÀNH MIGRATION VĂN BẢN BAN HÀNH ===');
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
//       logger.error('Lỗi trong quá trình migration Outgoing Documents:', error);
//       throw error;
//     }
//   }

//   async getStatistics() {
//     try {
//       const oldCount = await this.model.countOldDb();
//       const newCount = await this.model.countNewDb();

//       return {
//         source: { database: 'DataEOfficeSNP', schema: 'dbo', table: 'VanBanBanHanh', count: oldCount },
//         destination: { database: 'camunda', table: 'outgoing_documents', count: newCount },
//         migrated: newCount,
//         remaining: oldCount - newCount,
//         percentage: calculatePercentage(newCount, oldCount)
//       };
//     } catch (error) {
//       logger.error('Lỗi lấy thống kê Outgoing Documents:', error);
//       throw error;
//     }
//   }

//   async close() {
//     await this.model.close();
//   }
// }

// module.exports = MigrationOutgoingDocumentService;

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
    if (isNaN(parsed.getTime())) return null;
    const year = parsed.getFullYear();
    // SQL Server 'datetime' minimum is 1753-01-01. Discard dates before that.
    if (year < 1753) return null;
    return parsed;
  }
  return null;
}

/**
 * 🔥 HÀM QUYẾT ĐỊNH
 * Diệt sạch 'NULL' string / '' còn sót lại
 */
function normalizeRecord(record) {
  const cleaned = {};
  for (const key of Object.keys(record)) {
    const value = record[key];

    if (typeof value === 'string') {
      const trimmed = value.trim();
      cleaned[key] =
        trimmed === '' || trimmed.toUpperCase() === 'NULL'
          ? null
          : trimmed;
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
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
    await this.model.initialize();
    logger.info('MigrationOutgoingDocumentService đã được khởi tạo');
  }


  async migrateOutgoingDocuments(stateJson) {
  const startTime = Date.now();
  logger.info("=== START MIGRATE OUTGOING DOCUMENTS ===");

  const moduleKey = "outgoingdocument2";
  const state = stateJson[moduleKey] || {};
  const lastSyncDate = state.lastSyncDate
    ? new Date(state.lastSyncDate)
    : null;

  const batchSize = state.batchSize || this.batchSize || 200;

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  try {
    const total = await this.model.countOldDb();
    logger.info(`[${moduleKey}] total old records: ${total}`);

    let offset = 0;

    while (true) {
      const rows = await this.model.getBatchFromOldDb({
        offset,
        limit: batchSize,
        lastSyncDate
      });

      if (!rows || rows.length === 0) break;

      for (const oldRecord of rows) {
        try {
          const decision = await this.model.checkSyncAction(oldRecord);

          if (decision.action === "skip") {
            skipped++;
            continue;
          }

          const newRecord = mapFieldValues(
            oldRecord,
            tableMappings.outgoingdocument2.fieldMapping,
            tableMappings.outgoingdocument2.defaultValues
          );

          // ===== CLEAN DATA (giữ logic cũ) =====
          newRecord.SoBan = safeParseInt(oldRecord.SoBan);
          newRecord.SoTrang = safeParseInt(oldRecord.SoTrang);
          newRecord.ModuleId = safeParseInt(oldRecord.ModuleId);
          newRecord.ItemId = safeParseInt(oldRecord.ItemId);
          newRecord.DocSignType = safeParseInt(oldRecord.DocSignType);

          newRecord.ChenSo = safeParseBit(oldRecord.ChenSo);
          newRecord.IsLibrary = safeParseBit(oldRecord.IsLibrary);
          newRecord.IsKyQuyChe = safeParseBit(oldRecord.IsKyQuyChe);

          newRecord.NgayBanHanh = safeParseDate(oldRecord.NgayBanHanh);
          newRecord.NgayHieuLuc = safeParseDate(oldRecord.NgayHieuLuc);

          // map backup id
          newRecord.id_outgoing_bak = oldRecord.ID;
          newRecord.Modified = oldRecord.Modified;

          if (decision.action === "insert") {
            await this.model.insertToNewDb(newRecord);
            inserted++;
          }

          if (decision.action === "update") {
            await this.model.updateInNewDb(newRecord);
            updated++;
          }

        } catch (err) {
          errors++;
          logger.error(
            `[${moduleKey}] ERROR record ID ${oldRecord.ID}: ${err.message}`
          );
        }
      }

      offset += batchSize;

      // 👉 update state sau mỗi batch
      stateJson[moduleKey] = {
        ...stateJson[moduleKey],
        lastSyncDate: new Date().toISOString(),
        processed: offset
      };
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    logger.info(
      `[${moduleKey}] DONE | insert=${inserted}, update=${updated}, skip=${skipped}, error=${errors}`
    );

    return {
      success: true,
      inserted,
      updated,
      skipped,
      errors,
      duration
    };

  } catch (err) {
    logger.error(`[${moduleKey}] FATAL ERROR: ${err.message}`);
    throw err;
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
  //     logger.info(`Tổng số văn bản cần migrate: ${formatNumber(totalRecords)}`);

  //     const oldRecords = await this.model.getAllFromOldDb();
  //     const batches = chunkArray(oldRecords, this.batchSize);

  //     let totalInserted = 0;
  //     let totalSkipped = 0;
  //     let totalErrors = 0;

  //     for (let i = 0; i < batches.length; i++) {
  //       logger.info(`Xử lý batch ${i + 1}/${batches.length}`);
  //       const batch = batches[i];

  //       for (const oldRecord of batch) {
  //         try {
  //           const existed = await this.model.findByBackupId(oldRecord.ID);
  //           if (existed) {
  //             totalSkipped++;
  //             continue;
  //           }

  //           let newRecord = mapFieldValues(
  //             oldRecord,
  //             config.fieldMapping,
  //             config.defaultValues
  //           );

  //           /* ===== CLEAN KIỂU SỐ ===== */
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
  //           newRecord.book_document_id =
  //             await this.model.findBookDocumentIdBySoVanBan(
  //               oldRecord.SoVanBan
  //             );

  //           // 🔥 CLEAN CUỐI – BẮT BUỘC
  //           newRecord = normalizeRecord(newRecord);

  //           await this.model.insertToNewDb(newRecord);
  //           totalInserted++;

  //         } catch (error) {
  //           totalErrors++;
  //           logger.error(
  //             `Lỗi migrate ID ${oldRecord.ID}: ${error.message}`
  //           );
  //         }
  //       }
  //     }

  //     const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  //     logger.info(
  //       `HOÀN THÀNH | ${duration}s | Inserted: ${totalInserted} | Skipped: ${totalSkipped} | Errors: ${totalErrors}`
  //     );

  //     return {
  //       success: true,
  //       inserted: totalInserted,
  //       skipped: totalSkipped,
  //       errors: totalErrors,
  //       duration
  //     };

  //   } catch (error) {
  //     logger.error('Lỗi migration:', error);
  //     throw error;
  //   }
  // }
  async migrateOutgoingDocuments() {
  const startTime = Date.now();
  logger.info('=== BẮT ĐẦU MIGRATION VĂN BẢN BAN HÀNH (BATCH MODE) ===');

  try {
    const config = tableMappings.outgoingdocument2;
    if (!config) {
      throw new Error('Config outgoingdocument2 không tồn tại');
    }

    // 1️⃣ Đếm tổng số bản ghi DB cũ
    const totalRecords = await this.model.countOldDb();
    logger.info(`Tổng số văn bản ban hành cần sync: ${totalRecords}`);

    if (totalRecords === 0) {
      return { success: true, total: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };
    }

    let offset = 0;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    // 2️⃣ Chạy theo batch
    while (offset < totalRecords) {
      logger.info(`👉 Lấy batch: offset=${offset}, limit=${this.batchSize}`);

      const rows = await this.model.getBatchFromOldDb({
        offset,
        limit: this.batchSize
      });

      if (!rows || rows.length === 0) {
        break;
      }

      // 3️⃣ Xử lý từng record
      for (const oldRecord of rows) {
        try {
          const { action, reason } =
            await this.model.checkSyncAction(oldRecord);

          if (action === 'skip') {
            skipped++;
            continue;
          }

          // MAP DATA
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

          /* ===== SYNC META ===== */
          newRecord.id_outgoing_bak = oldRecord.ID;
          newRecord.Modified = oldRecord.Modified;

          /* ===== BOOK DOCUMENT ===== */
          newRecord.book_document_id =
            await this.model.findBookDocumentIdBySoVanBan(oldRecord.SoVanBan);

          // 4️⃣ Thực thi theo action
          if (action === 'insert') {
            await this.model.insertToNewDb(newRecord);
            inserted++;
          }

          if (action === 'update') {
            await this.model.updateInNewDb(newRecord);
            updated++;
          }

        } catch (err) {
          errors++;
          logger.error(
            `❌ Lỗi sync ID=${oldRecord.ID}: ${err.message}`
          );
        }
      }

      offset += this.batchSize;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    logger.info('=== HOÀN THÀNH SYNC VĂN BẢN BAN HÀNH ===');
    logger.info(
      `⏱ ${duration}s | Insert=${inserted} | Update=${updated} | Skip=${skipped} | Error=${errors}`
    );

    return {
      success: true,
      total: totalRecords,
      inserted,
      updated,
      skipped,
      errors,
      duration
    };

  } catch (error) {
    logger.error('❌ Lỗi migrateOutgoingDocuments:', error);
    throw error;
  }
}


  async getStatistics() {
    const oldCount = await this.model.countOldDb();
    const newCount = await this.model.countNewDb();

    return {
      oldCount,
      newCount,
      remaining: oldCount - newCount,
      percentage: calculatePercentage(newCount, oldCount)
    };
  }

  async close() {
    await this.model.close();
  }
}

module.exports = MigrationOutgoingDocumentService;
