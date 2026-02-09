// const UserGroupModel = require('../models/UserGroupModel');
// const { tableMappings } = require('../config/tablesUserGroup');
// const { mapFieldValues, chunkArray, formatNumber, calculatePercentage } = require('../utils/helpers');
// const logger = require('../utils/logger');
// const { v4: uuidv4 } = require('uuid');

// class MigrationUserGroupService {
//   constructor() {
//     this.userGroupModel = new UserGroupModel();
//     this.batchSize = parseInt(process.env.BATCH_SIZE || '100');
//   }

//   async initialize() {
//     try {
//       await this.userGroupModel.initialize();
//       logger.info('MigrationUserGroupService đã được khởi tạo');
//     } catch (error) {
//       logger.error('Lỗi khởi tạo MigrationUserGroupService:', error);
//       throw error;
//     }
//   }

//   generateGuid() {
//     return uuidv4().toUpperCase();
//   }

//   async migrateUserGroup() {
//     const startTime = Date.now();
//     logger.info('=== BẮT ĐẦU MIGRATION USERGROUP ===');

//     try {
//       const config = tableMappings.usergroup;
//       const totalRecords = await this.userGroupModel.countOldDb();
//       logger.info(`Tổng số bản ghi cần migrate: ${formatNumber(totalRecords)}`);

//       if (totalRecords === 0) {
//         logger.warn('Không có dữ liệu để migrate');
//         return { success: true, total: 0, inserted: 0, skipped: 0, errors: 0 };
//       }

//       const oldRecords = await this.userGroupModel.getAllFromOldDb();
//       const batches = chunkArray(oldRecords, this.batchSize);

//       let totalInserted = 0;
//       let totalSkipped = 0;
//       let totalErrors = 0;

//       for (let i = 0; i < batches.length; i++) {
//         const batch = batches[i];
//         logger.info(`Đang xử lý batch ${i + 1}/${batches.length}...`);

//         for (const oldRecord of batch) {
//           try {
//             // Kiểm tra đã migrate chưa qua id_group_bk
//             const existingByBackup = await this.userGroupModel.findByBackupId(oldRecord.ID);
//             if (existingByBackup) {
//               totalSkipped++;
//               logger.warn(`SKIP: ID cũ ${oldRecord.ID} đã tồn tại (code: ${oldRecord.AccountName})`);
//               continue;
//             }

//             // Kiểm tra trùng code (UNIQUE constraint)
//             const codeExists = await this.userGroupModel.checkCodeExists(oldRecord.AccountName);
//             if (codeExists) {
//               totalSkipped++;
//               logger.warn(`SKIP: Code ${oldRecord.AccountName} đã tồn tại trong bảng mới`);
//               continue;
//             }

//             // Map dữ liệu
//             const newRecord = mapFieldValues(oldRecord, config.fieldMapping, config.defaultValues);

//             // Tạo id mới (GUID)
//             newRecord.id = this.generateGuid();

//             // Insert
//             await this.userGroupModel.insertToNewDb(newRecord);
//             totalInserted++;

//           } catch (error) {
//             totalErrors++;
//             logger.error(`Lỗi migrate record ID ${oldRecord.ID}: ${error.message}`);
//           }
//         }
//       }

//       const duration = ((Date.now() - startTime) / 1000).toFixed(2);

//       logger.info('=== HOÀN THÀNH MIGRATION USERGROUP ===');
//       logger.info(`Tổng thời gian: ${duration}s | Inserted: ${totalInserted} | Skipped: ${totalSkipped} | Errors: ${totalErrors}`);

//       return {
//         success: true,
//         total: totalRecords,
//         inserted: totalInserted,
//         skipped: totalSkipped,
//         errors: totalErrors,
//         duration
//       };

//     } catch (error) {
//       logger.error('Lỗi trong quá trình migration UserGroup:', error);
//       throw error;
//     }
//   }

//   async getStatistics() {
//     try {
//       const oldCount = await this.userGroupModel.countOldDb();
//       const newCount = await this.userGroupModel.countNewDb();

//       return {
//         source: { database: 'DataEOfficeSNP', schema: 'SNP', table: 'UserGroup', count: oldCount },
//         destination: { database: 'camunda', table: 'group_users', count: newCount },
//         migrated: newCount,
//         remaining: oldCount - newCount,
//         percentage: calculatePercentage(newCount, oldCount)
//       };
//     } catch (error) {
//       logger.error('Lỗi lấy thống kê UserGroup:', error);
//       throw error;
//     }
//   }

//   async close() {
//     await this.userGroupModel.close();
//   }
// }

// module.exports = MigrationUserGroupService;

const UserGroupModel = require('../models/UserGroupModel');
const { tableMappings } = require('../config/tablesUserGroup');
const { mapFieldValues, chunkArray, formatNumber, calculatePercentage } = require('../utils/helpers');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class MigrationUserGroupService {
  constructor() {
    this.userGroupModel = new UserGroupModel();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '100');
  }

  async initialize() {
    try {
      await this.userGroupModel.initialize();
      logger.info('MigrationUserGroupService đã được khởi tạo');
    } catch (error) {
      logger.error('Lỗi khởi tạo MigrationUserGroupService:', error);
      throw error;
    }
  }

  generateGuid() {
    return uuidv4().toUpperCase();
  }

  async migrateUserGroup() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU MIGRATION USERGROUP ===');

    try {
      const config = tableMappings.usergroup;
      const totalRecords = await this.userGroupModel.countOldDb();
      logger.info(`Tổng số bản ghi cần migrate: ${formatNumber(totalRecords)}`);

      if (totalRecords === 0) {
        logger.warn('Không có dữ liệu để migrate');
        return { success: true, total: 0, inserted: 0, skipped: 0, errors: 0 };
      }

      // Lấy tất cả records từ DB cũ
      const oldRecords = await this.userGroupModel.getAllFromOldDb();
      const batches = chunkArray(oldRecords, this.batchSize);

      let totalInserted = 0;
      let totalSkipped = 0;
      let totalErrors = 0;

      logger.info(`Tổng số batches: ${batches.length}, mỗi batch ${this.batchSize} records`);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        logger.info(`Đang xử lý batch ${i + 1}/${batches.length} (${batch.length} records)...`);

        for (const oldRecord of batch) {
          try {
            // === FIX: XỬ LÝ CODE NULL HOẶC RỖNG ===
            const accountName = oldRecord.AccountName;
            const originalCode = accountName ? accountName.toString().trim() : '';
            
            if (!originalCode) {
              totalSkipped++;
              logger.warn(`SKIP: Record ID ${oldRecord.ID} có AccountName rỗng hoặc null`);
              continue;
            }

            // === FIX: CHUẨN HÓA CODE ===
            // Loại bỏ khoảng trắng thừa và đảm bảo không rỗng
            const normalizedCode = originalCode;
            
            // Kiểm tra đã migrate chưa qua id_group_bk
            const existingByBackup = await this.userGroupModel.findByBackupId(oldRecord.ID);
            if (existingByBackup) {
              totalSkipped++;
              logger.warn(`SKIP: ID cũ ${oldRecord.ID} đã tồn tại trong bảng mới`);
              continue;
            }

            // Kiểm tra trùng code (UNIQUE constraint)
            const codeExists = await this.userGroupModel.checkCodeExists(normalizedCode);
            if (codeExists) {
              totalSkipped++;
              logger.warn(`SKIP: Code '${normalizedCode}' đã tồn tại trong bảng mới`);
              continue;
            }

            // Map dữ liệu với config
            const newRecord = mapFieldValues(oldRecord, config.fieldMapping, config.defaultValues);

            // === FIX: ĐẢM BẢO CODE KHÔNG NULL ===
            // Ghi đè code đã được chuẩn hóa
            newRecord.code = normalizedCode;

            // Tạo id mới (GUID)
            newRecord.id = this.generateGuid();

            // === FIX: VALIDATE CÁC TRƯỜNG BẮT BUỘC ===
            if (!newRecord.name || newRecord.name.trim() === '') {
              // Nếu name rỗng, sử dụng code hoặc ID
              newRecord.name = oldRecord.Name ? oldRecord.Name.trim() : normalizedCode;
              logger.warn(`Record ${oldRecord.ID}: name rỗng, đã gán '${newRecord.name}'`);
            }

            // Insert vào DB mới
            await this.userGroupModel.insertToNewDb(newRecord);
            totalInserted++;

            // Log progress mỗi 50 records
            if (totalInserted % 50 === 0) {
              logger.info(`Đã insert ${totalInserted} records...`);
            }

          } catch (error) {
            totalErrors++;
            logger.error(`Lỗi migrate record ID ${oldRecord.ID}: ${error.message}`);
            // Log thêm thông tin để debug
            logger.error(`Record details: ID=${oldRecord.ID}, AccountName=${oldRecord.AccountName}`);
          }
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('=== HOÀN THÀNH MIGRATION USERGROUP ===');
      logger.info(`Tổng thời gian: ${duration}s`);
      logger.info(`Inserted: ${totalInserted} | Skipped: ${totalSkipped} | Errors: ${totalErrors}`);

      // Thống kê chi tiết
      const stats = {
        success: totalErrors === 0,
        total: totalRecords,
        inserted: totalInserted,
        skipped: totalSkipped,
        errors: totalErrors,
        duration,
        insertedPercentage: calculatePercentage(totalInserted, totalRecords),
        errorPercentage: calculatePercentage(totalErrors, totalRecords)
      };

      logger.info(`Tỷ lệ thành công: ${stats.insertedPercentage}%`);
      
      return stats;

    } catch (error) {
      logger.error('Lỗi trong quá trình migration UserGroup:', error);
      throw error;
    }
  }

  async getStatistics() {
    try {
      const oldCount = await this.userGroupModel.countOldDb();
      const newCount = await this.userGroupModel.countNewDb();

      return {
        source: { 
          database: 'DataEOfficeSNP', 
          schema: 'SNP', 
          table: 'UserGroup', 
          count: oldCount 
        },
        destination: { 
          database: 'camunda', 
          table: 'group_users', 
          count: newCount 
        },
        migrated: newCount,
        remaining: oldCount - newCount,
        percentage: calculatePercentage(newCount, oldCount),
        status: oldCount === newCount ? 'Hoàn thành' : 'Đang thực hiện'
      };
    } catch (error) {
      logger.error('Lỗi lấy thống kê UserGroup:', error);
      throw error;
    }
  }

  async close() {
    await this.userGroupModel.close();
  }
}

module.exports = MigrationUserGroupService;