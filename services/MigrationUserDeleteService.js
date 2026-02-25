// // services/MigrationUserDeleteService.js
// const UserDeleteModel = require('../models/UserDeleteModel');
// const { tableMappings } = require('../config/tablesUserDelete');
// const { mapFieldValues, chunkArray, formatNumber, calculatePercentage } = require('../utils/helpers');
// const logger = require('../utils/logger');
// const { v4: uuidv4 } = require('uuid');

// class MigrationUserDeleteService {
//   constructor() {
//     this.userDeleteModel = new UserDeleteModel();
//     this.batchSize = parseInt(process.env.BATCH_SIZE || '100');
//   }

//   async initialize() {
//     try {
//       await this.userDeleteModel.initialize();
//       logger.info('MigrationUserDeleteService đã được khởi tạo');
//     } catch (error) {
//       logger.error('Lỗi khởi tạo MigrationUserDeleteService:', error);
//       throw error;
//     }
//   }

//   generateGuid() {
//     return uuidv4().toUpperCase();
//   }

//   async migrateUserDelete() {
//     const startTime = Date.now();
//     logger.info('=== BẮT ĐẦU MIGRATION USER DELETE ===');

//     try {
//       const config = tableMappings.userdelete;
//       const totalRecords = await this.userDeleteModel.countOldDb();
//       logger.info(`Tổng số bản ghi cần migrate: ${formatNumber(totalRecords)}`);

//       if (totalRecords === 0) {
//         logger.warn('Không có dữ liệu để migrate');
//         return { success: true, total: 0, inserted: 0, skipped: 0, errors: 0 };
//       }

//       const oldRecords = await this.userDeleteModel.getAllFromOldDb();
//       const batches = chunkArray(oldRecords, this.batchSize);

//       let totalInserted = 0;
//       let totalSkipped = 0;
//       let totalErrors = 0;

//       for (let i = 0; i < batches.length; i++) {
//         const batch = batches[i];
//         logger.info(`Đang xử lý batch ${i + 1}/${batches.length}...`);

//         for (const oldRecord of batch) {
//           try {
//             const existingByBackup = await this.userDeleteModel.findByBackupId(oldRecord.ID);
//             if (existingByBackup) {
//               totalSkipped++;
//               logger.warn(`SKIP: ID cũ ${oldRecord.ID} đã tồn tại (username: ${oldRecord.AccountName})`);
//               continue;
//             }

//             const usernameExists = await this.userDeleteModel.checkUsernameExists(oldRecord.AccountName);
//             if (usernameExists) {
//               totalSkipped++;
//               logger.warn(`SKIP: Username ${oldRecord.AccountName} đã tồn tại trong bảng mới`);
//               continue;
//             }

//             const newRecord = mapFieldValues(oldRecord, config.fieldMapping, config.defaultValues);
//             newRecord.id = this.generateGuid();

//             await this.userDeleteModel.insertToNewDb(newRecord);
//             totalInserted++;

//           } catch (error) {
//             totalErrors++;
//             logger.error(`Lỗi migrate record ID ${oldRecord.ID}: ${error.message}`);
//           }
//         }
//       }

//       const duration = ((Date.now() - startTime) / 1000).toFixed(2);

//       logger.info('=== HOÀN THÀNH MIGRATION USER DELETE ===');
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
//       logger.error('Lỗi trong quá trình migration User Delete:', error);
//       throw error;
//     }
//   }

//   async getStatistics() {
//     try {
//       const oldCount = await this.userDeleteModel.countOldDb();
//       const newCount = await this.userDeleteModel.countNewDb();

//       return {
//         source: { database: 'DataEOfficeSNP', schema: 'dbo', table: 'PersonalProfileDelete', count: oldCount },
//         destination: { database: process.env.NEW_DB_NAME, table: 'users', count: newCount },
//         migrated: newCount,
//         remaining: oldCount - newCount,
//         percentage: calculatePercentage(newCount, oldCount)
//       };
//     } catch (error) {
//       logger.error('Lỗi lấy thống kê User Delete:', error);
//       throw error;
//     }
//   }

//   async close() {
//     await this.userDeleteModel.close();
//   }
// }

// module.exports = MigrationUserDeleteService;

// services/MigrationUserDeleteService.js
const UserDeleteModel = require('../models/UserDeleteModel');
const { tableMappings } = require('../config/tablesUserDelete');
const { mapFieldValues, chunkArray, formatNumber, calculatePercentage } = require('../utils/helpers');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class MigrationUserDeleteService {
  constructor() {
    this.userDeleteModel = new UserDeleteModel();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '100');
  }

  async initialize() {
    try {
      await this.userDeleteModel.initialize();
      logger.info('MigrationUserDeleteService đã được khởi tạo');
    } catch (error) {
      logger.error('Lỗi khởi tạo MigrationUserDeleteService:', error);
      throw error;
    }
  }

  generateGuid() {
    return uuidv4().toUpperCase();
  }

  // Helper methods
  safeString(value) {
    if (value === 'NULL' || value === 'null' || value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string' && value.trim() === '') {
      return null;
    }
    return String(value).trim();
  }

  safeNumber(value, defaultValue = 0) {
    if (value === 'NULL' || value === 'null' || value === null || value === undefined) {
      return defaultValue;
    }
    const num = Number(value);
    return isNaN(num) ? defaultValue : num;
  }

  safeDate(value) {
    if (value === 'NULL' || value === 'null' || value === null || value === undefined) {
      return null;
    }
    
    try {
      const dateStr = String(value).trim();
      if (!dateStr || dateStr === '') return null;
      
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        return null;
      }
      return date;
    } catch (error) {
      return null;
    }
  }

  parseGender(value) {
    const genderStr = String(value || '');
    if (genderStr === '1') return 'nam';
    if (genderStr === '0') return 'nu';
    return null;
  }

  parseBit(value) {
    if (value === '1' || value === 1 || value === true) return 1;
    if (value === '0' || value === 0 || value === false) return 0;
    return 0;
  }

  // Hàm map record an toàn cho delete
  safeMapRecord(oldRecord) {
    return {
      id: this.generateGuid(),
      password: '$10$mH.NYj.Bapxk4auiGaPKhOfCqUnA8jr1JO5fvP3miKbhIfwU3CVRa',
      name: (oldRecord.FullName || oldRecord.AccountName || 'Unknown').trim(),
      avatar: oldRecord.Image || '[]',
      code_nd: null,
      username: oldRecord.AccountName,
      email_user: this.safeString(oldRecord.Email),
      phone_number_user: this.safeString(oldRecord.Mobile),
      position: this.safeString(oldRecord.Position),
      leader: this.safeString(oldRecord.Manager),
      address_user: this.safeString(oldRecord.Address),
      description: null,
      role: null,
      roles_by_process: '[]',
      organization_name: null,
      organization_code: null,
      organization_type: null,
      orders: this.safeNumber(oldRecord.Orders, 1000),
      birthday: this.safeDate(oldRecord.BirthDay),
      gender: this.parseGender(oldRecord.Gender),
      identification_card: this.safeString(oldRecord.CMND),
      contact_time: null,
      parent: null,
      wso2_user_id: null,
      keycloak_user_id: null,
      status: 3, // Luôn là 3 cho delete
      author: '',
      role_group_source_authorized: '',
      created_at: new Date(),
      updated_at: new Date(),
      name_authorized: null,
      id_user_del_bak: oldRecord.ID, // Sử dụng id_user_del_bak cho delete
      AccountID: this.safeString(oldRecord.AccountID),
      FullName: this.safeString(oldRecord.FullName),
      Department: this.safeString(oldRecord.Department),
      DepartmentId: this.safeString(oldRecord.DepartmentId),
      PhongBanID: this.safeString(oldRecord.PhongBanID),
      SimKySo1: this.safeString(oldRecord.SimKySo1),
      SimKySo2: this.safeString(oldRecord.SimKySo2),
      DepartmentManager: this.safeString(oldRecord.DepartmentManager),
      IsTCT: this.parseBit(oldRecord.IsTCT),
      ImagePath: this.safeString(oldRecord.ImagePath),
      SignImage: this.safeString(oldRecord.SignImage),
      SignImageSmall: this.safeString(oldRecord.SignImageSmall),
      table_backups: 'PersonalProfileDelete' // Đánh dấu là delete
    };
  }

  async migrateUserDelete() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU MIGRATION USER DELETE ===');

    try {
      // Test kết nối
      logger.info('🔄 Testing kết nối và insert cơ bản...');
      const testResult = await this.userDeleteModel.testInsert();
      if (!testResult) {
        throw new Error('Test insert thất bại, kiểm tra kết nối database');
      }
      logger.info('✅ Test insert thành công!');
      
      // Lấy sample để debug
      logger.info('📊 Lấy mẫu dữ liệu delete để debug...');
      await this.userDeleteModel.getSampleRecords(5);
      
      const totalRecords = await this.userDeleteModel.countOldDb();
      logger.info(`Tổng số delete bản ghi cần migrate: ${formatNumber(totalRecords)}`);

      if (totalRecords === 0) {
        logger.warn('Không có dữ liệu delete để migrate');
        return { success: true, total: 0, inserted: 0, skipped: 0, errors: 0 };
      }

      const oldRecords = await this.userDeleteModel.getAllFromOldDb();
      logger.info(`Số lượng delete records hợp lệ: ${oldRecords.length}`);
      
      if (oldRecords.length === 0) {
        logger.warn('Không có delete records hợp lệ để migrate');
        return { success: true, total: 0, inserted: 0, skipped: 0, errors: 0 };
      }

      const batches = chunkArray(oldRecords, this.batchSize);

      let totalInserted = 0;
      let totalSkipped = 0;
      let totalErrors = 0;
      const errorDetails = [];

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        logger.info(`Đang xử lý batch delete ${i + 1}/${batches.length} (${batch.length} records)...`);

        for (const oldRecord of batch) {
          try {
            if (!oldRecord || !oldRecord.ID) {
              totalErrors++;
              errorDetails.push({ id: 'unknown', error: 'Record không có ID' });
              continue;
            }

            // Kiểm tra đã migrate chưa qua id_user_del_bak
            const existingByBackup = await this.userDeleteModel.findByBackupId(oldRecord.ID);
            if (existingByBackup) {
              totalSkipped++;
              logger.debug(`SKIP DELETE: ID cũ ${oldRecord.ID} đã tồn tại`);
              continue;
            }

            // Kiểm tra trùng username
            const usernameExists = await this.userDeleteModel.checkUsernameExists(oldRecord.AccountName);
            if (usernameExists) {
              totalSkipped++;
              logger.warn(`SKIP DELETE: Username ${oldRecord.AccountName} đã tồn tại`);
              continue;
            }

            // Map dữ liệu an toàn
            let newRecord;
            try {
              newRecord = this.safeMapRecord(oldRecord);
              
              if (totalInserted === 0 && i === 0) {
                logger.info('=== MẪU DELETE RECORD ĐẦU TIÊN ===');
                logger.info(`ID: ${newRecord.id}`);
                logger.info(`Name: ${newRecord.name}`);
                logger.info(`Username: ${newRecord.username}`);
                logger.info(`Status: ${newRecord.status} (luôn là 3 cho delete)`);
                logger.info(`table_backups: ${newRecord.table_backups}`);
                logger.info('====================================');
              }
              
            } catch (mapError) {
              totalErrors++;
              errorDetails.push({ id: oldRecord.ID, error: `Map error: ${mapError.message}` });
              logger.error(`Lỗi map delete record ${oldRecord.ID}: ${mapError.message}`);
              continue;
            }

            // Insert
            await this.userDeleteModel.insertToNewDb(newRecord);
            totalInserted++;

            if (totalInserted % 100 === 0) {
              logger.info(`Đã insert ${totalInserted} delete records...`);
            }

          } catch (error) {
            totalErrors++;
            errorDetails.push({ 
              id: oldRecord?.ID || 'unknown', 
              error: error.message,
              details: error.stack 
            });
            logger.error(`Lỗi migrate delete record ${oldRecord?.ID || 'unknown'}: ${error.message}`);
          }
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('\n=== HOÀN THÀNH MIGRATION USER DELETE ===');
      logger.info(`Tổng thời gian: ${duration}s`);
      logger.info(`Tổng delete records: ${totalRecords}`);
      logger.info(`Insert thành công: ${totalInserted}`);
      logger.info(`Đã skip: ${totalSkipped}`);
      logger.info(`Lỗi: ${totalErrors}`);
      
      if (totalErrors > 0) {
        logger.warn(`Chi tiết ${Math.min(5, totalErrors)} lỗi đầu tiên:`);
        errorDetails.slice(0, 5).forEach((err, idx) => {
          logger.warn(`  ${idx + 1}. ID: ${err.id} - ${err.error}`);
        });
      }

      return {
        success: totalErrors === 0,
        total: totalRecords,
        inserted: totalInserted,
        skipped: totalSkipped,
        errors: totalErrors,
        duration,
        errorDetails: errorDetails.slice(0, 10)
      };

    } catch (error) {
      logger.error('Lỗi trong quá trình migration User Delete:', error);
      logger.error('Stack trace:', error.stack);
      throw error;
    }
  }

  async testMigration() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU TEST MIGRATION DELETE (10 RECORDS) ===');

    try {
      const testResult = await this.userDeleteModel.testInsert();
      if (!testResult) {
        return { success: false, message: 'Test insert thất bại' };
      }

      const oldRecords = await this.userDeleteModel.getAllFromOldDb();
      const testRecords = oldRecords.slice(0, 10);
      
      logger.info(`Testing delete với ${testRecords.length} records đầu tiên`);

      let successCount = 0;
      let errorCount = 0;

      for (const oldRecord of testRecords) {
        try {
          const newRecord = this.safeMapRecord(oldRecord);
          await this.userDeleteModel.insertToNewDb(newRecord);
          successCount++;
          logger.info(`✓ Inserted delete ${oldRecord.ID}`);
          
        } catch (error) {
          errorCount++;
          logger.error(`✗ Error delete ${oldRecord.ID}: ${error.message}`);
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      logger.info('\n=== KẾT QUẢ TEST DELETE ===');
      logger.info(`Thành công: ${successCount}`);
      logger.info(`Thất bại: ${errorCount}`);
      logger.info(`Thời gian: ${duration}s`);

      return {
        success: errorCount === 0,
        total: testRecords.length,
        inserted: successCount,
        errors: errorCount,
        duration
      };

    } catch (error) {
      logger.error('Lỗi trong test migration delete:', error);
      return {
        success: false,
        message: error.message,
        error: error.stack
      };
    }
  }

  async getStatistics() {
    try {
      const oldCount = await this.userDeleteModel.countOldDb();
      const newCount = await this.userDeleteModel.countNewDb();

      return {
        source: { 
          database: process.env.OLD_DB_NAME, 
          schema: 'dbo', 
          table: 'PersonalProfileDelete', 
          count: oldCount 
        },
        destination: { 
          database: process.env.NEW_DB_NAME, 
          schema: 'dbo',
          table: 'users', 
          count: newCount 
        },
        migrated: newCount,
        remaining: Math.max(0, oldCount - newCount),
        percentage: calculatePercentage(newCount, oldCount)
      };
    } catch (error) {
      logger.error('Lỗi lấy thống kê User Delete:', error);
      throw error;
    }
  }

  async close() {
    await this.userDeleteModel.close();
  }
}

module.exports = MigrationUserDeleteService;