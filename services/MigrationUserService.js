// // services/MigrationUserService.js
// const UserModel = require('../models/UserModel');
// const { tableMappings } = require('../config/tablesUser');
// const { mapFieldValues, chunkArray, formatNumber, calculatePercentage } = require('../utils/helpers');
// const logger = require('../utils/logger');
// const { v4: uuidv4 } = require('uuid');

// class MigrationUserService {
//   constructor() {
//     this.userModel = new UserModel();
//     this.batchSize = parseInt(process.env.BATCH_SIZE || '100');
//   }

//   async initialize() {
//     try {
//       await this.userModel.initialize();
//       logger.info('MigrationUserService đã được khởi tạo');
//     } catch (error) {
//       logger.error('Lỗi khởi tạo MigrationUserService:', error);
//       throw error;
//     }
//   }

//   generateGuid() {
//     return uuidv4().toUpperCase();
//   }

//   async migrateUser() {
//     const startTime = Date.now();
//     logger.info('=== BẮT ĐẦU MIGRATION USER ===');

//     try {
//       const config = tableMappings.user;
//       const totalRecords = await this.userModel.countOldDb();
//       logger.info(`Tổng số bản ghi cần migrate: ${formatNumber(totalRecords)}`);

//       if (totalRecords === 0) {
//         logger.warn('Không có dữ liệu để migrate');
//         return { success: true, total: 0, inserted: 0, skipped: 0, errors: 0 };
//       }

//       const oldRecords = await this.userModel.getAllFromOldDb();
//       const batches = chunkArray(oldRecords, this.batchSize);

//       let totalInserted = 0;
//       let totalSkipped = 0;
//       let totalErrors = 0;

//       for (let i = 0; i < batches.length; i++) {
//         const batch = batches[i];
//         logger.info(`Đang xử lý batch ${i + 1}/${batches.length}...`);

//         for (const oldRecord of batch) {
//           try {
//             // Kiểm tra đã migrate chưa qua id_user_bak
//             const existingByBackup = await this.userModel.findByBackupId(oldRecord.ID);
//             if (existingByBackup) {
//               totalSkipped++;
//               logger.warn(`SKIP: ID cũ ${oldRecord.ID} đã tồn tại (username: ${oldRecord.AccountName})`);
//               continue;
//             }

//             // Kiểm tra trùng username (UNIQUE constraint)
//             const usernameExists = await this.userModel.checkUsernameExists(oldRecord.AccountName);
//             if (usernameExists) {
//               totalSkipped++;
//               logger.warn(`SKIP: Username ${oldRecord.AccountName} đã tồn tại trong bảng mới`);
//               continue;
//             }

//             // Map dữ liệu
//             const newRecord = mapFieldValues(oldRecord, config.fieldMapping, config.defaultValues);

//             // Tạo id mới (GUID)
//             newRecord.id = this.generateGuid();

//             // Insert
//             await this.userModel.insertToNewDb(newRecord);
//             totalInserted++;

//           } catch (error) {
//             totalErrors++;
//             logger.error(`Lỗi migrate record ID ${oldRecord.ID}: ${error.message}`);
//           }
//         }
//       }

//       const duration = ((Date.now() - startTime) / 1000).toFixed(2);

//       logger.info('=== HOÀN THÀNH MIGRATION USER ===');
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
//       logger.error('Lỗi trong quá trình migration User:', error);
//       throw error;
//     }
//   }

//   async getStatistics() {
//     try {
//       const oldCount = await this.userModel.countOldDb();
//       const newCount = await this.userModel.countNewDb();

//       return {
//         source: { database: 'DataEOfficeSNP', schema: 'SNP', table: 'User', count: oldCount },
//         destination: { database: 'camunda', table: 'users', count: newCount },
//         migrated: newCount,
//         remaining: oldCount - newCount,
//         percentage: calculatePercentage(newCount, oldCount)
//       };
//     } catch (error) {
//       logger.error('Lỗi lấy thống kê User:', error);
//       throw error;
//     }
//   }

//   async close() {
//     await this.userModel.close();
//   }
// }

// module.exports = MigrationUserService;

// services/MigrationUserService.js
const UserModel = require('../models/UserModel');
const { tableMappings } = require('../config/tablesUser');
const { chunkArray, formatNumber, calculatePercentage } = require('../utils/helpers');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class MigrationUserService {
  constructor() {
    this.userModel = new UserModel();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '100');
  }

  async initialize() {
    try {
      await this.userModel.initialize();
      logger.info('MigrationUserService đã được khởi tạo');
    } catch (error) {
      logger.error('Lỗi khởi tạo MigrationUserService:', error);
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

  parseStatus(value) {
    const statusStr = String(value || '');
    if (statusStr === '-1') return 3;
    return 1; // Mặc định là active
  }

  parseBit(value) {
    if (value === '1' || value === 1 || value === true) return 1;
    if (value === '0' || value === 0 || value === false) return 0;
    return 0; // Mặc định là 0
  }

  // Hàm map record an toàn
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
      status: this.parseStatus(oldRecord.WorkStatus),
      author: '',
      role_group_source_authorized: '',
      created_at: new Date(),
      updated_at: new Date(),
      name_authorized: null,
      id_user_bak: oldRecord.ID,
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
      table_backups: 'PersonalProfile'
    };
  }

  async migrateUser() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU MIGRATION USER ===');

    try {
      // Test kết nối và insert
      logger.info('🔄 Testing kết nối và insert cơ bản...');
      const testResult = await this.userModel.testInsert();
      if (!testResult) {
        throw new Error('Test insert thất bại, kiểm tra kết nối database');
      }
      logger.info('✅ Test insert thành công!');
      
      // Lấy sample để debug
      logger.info('📊 Lấy mẫu dữ liệu để debug...');
      await this.userModel.getSampleRecords(5);
      
      const totalRecords = await this.userModel.countOldDb();
      logger.info(`Tổng số bản ghi cần migrate: ${formatNumber(totalRecords)}`);

      if (totalRecords === 0) {
        logger.warn('Không có dữ liệu để migrate');
        return { success: true, total: 0, inserted: 0, skipped: 0, errors: 0 };
      }

      const oldRecords = await this.userModel.getAllFromOldDb();
      logger.info(`Số lượng records hợp lệ: ${oldRecords.length}`);
      
      if (oldRecords.length === 0) {
        logger.warn('Không có records hợp lệ để migrate');
        return { success: true, total: 0, inserted: 0, skipped: 0, errors: 0 };
      }

      const batches = chunkArray(oldRecords, this.batchSize);

      let totalInserted = 0;
      let totalSkipped = 0;
      let totalErrors = 0;
      const errorDetails = [];

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        logger.info(`Đang xử lý batch ${i + 1}/${batches.length} (${batch.length} records)...`);

        for (const oldRecord of batch) {
          try {
            // Kiểm tra oldRecord có tồn tại không
            if (!oldRecord || !oldRecord.ID) {
              totalErrors++;
              errorDetails.push({ id: 'unknown', error: 'Record không có ID' });
              continue;
            }

            // Kiểm tra đã migrate chưa qua id_user_bak
            const existingByBackup = await this.userModel.findByBackupId(oldRecord.ID);
            if (existingByBackup) {
              totalSkipped++;
              logger.debug(`SKIP: ID cũ ${oldRecord.ID} đã tồn tại`);
              continue;
            }

            // Kiểm tra trùng username (UNIQUE constraint)
            const usernameExists = await this.userModel.checkUsernameExists(oldRecord.AccountName);
            if (usernameExists) {
              totalSkipped++;
              logger.warn(`SKIP: Username ${oldRecord.AccountName} đã tồn tại`);
              continue;
            }

            // Map dữ liệu an toàn
            let newRecord;
            try {
              newRecord = this.safeMapRecord(oldRecord);
              
              // Debug: log record đầu tiên của mỗi batch
              if (totalInserted === 0 && i === 0) {
                logger.info('=== MẪU RECORD ĐẦU TIÊN SAU KHI MAP ===');
                logger.info(`ID: ${newRecord.id}`);
                logger.info(`Name: ${newRecord.name}`);
                logger.info(`Username: ${newRecord.username}`);
                logger.info(`Birthday: ${newRecord.birthday}`);
                logger.info(`IsTCT: ${newRecord.IsTCT}`);
                logger.info('====================================');
              }
              
            } catch (mapError) {
              totalErrors++;
              errorDetails.push({ id: oldRecord.ID, error: `Map error: ${mapError.message}` });
              logger.error(`Lỗi map record ${oldRecord.ID}: ${mapError.message}`);
              continue;
            }

            // Insert
            await this.userModel.insertToNewDb(newRecord);
            totalInserted++;

            // Log progress
            if (totalInserted % 100 === 0) {
              logger.info(`Đã insert ${totalInserted} records...`);
            }

          } catch (error) {
            totalErrors++;
            errorDetails.push({ 
              id: oldRecord?.ID || 'unknown', 
              error: error.message,
              details: error.stack 
            });
            logger.error(`Lỗi migrate record ${oldRecord?.ID || 'unknown'}: ${error.message}`);
          }
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('\n=== HOÀN THÀNH MIGRATION USER ===');
      logger.info(`Tổng thời gian: ${duration}s`);
      logger.info(`Tổng records: ${totalRecords}`);
      logger.info(`Insert thành công: ${totalInserted}`);
      logger.info(`Đã skip: ${totalSkipped}`);
      logger.info(`Lỗi: ${totalErrors}`);
      
      if (totalErrors > 0) {
        logger.warn(`Chi tiết ${Math.min(5, totalErrors)} lỗi đầu tiên:`);
        errorDetails.slice(0, 5).forEach((err, idx) => {
          logger.warn(`  ${idx + 1}. ID: ${err.id} - ${err.error}`);
        });
      }

      if (totalInserted > 0) {
        try {
          logger.info('Bắt đầu quá trình cập nhật phòng ban cho user...');
          await this.userModel.updateUserDepartments();
          logger.info('✓ Cập nhật phòng ban cho user hoàn tất.');
        } catch (deptError) {
          logger.error('Lỗi nghiêm trọng trong quá trình cập nhật phòng ban:', deptError);
        }

        try {
          logger.info('Bắt đầu quá trình cập nhật các trường bổ sung (password, name, email...)...');
          await this.userModel.updateUserFieldsAfterMigration();
          logger.info('✓ Cập nhật các trường bổ sung cho user hoàn tất.');
        } catch (updateFieldsError) {
          logger.error('Lỗi nghiêm trọng trong quá trình cập nhật các trường bổ sung:', updateFieldsError);
        }
      } else {
        logger.info('Không có user nào được insert, bỏ qua các bước cập nhật bổ sung.');
      }

      return {
        success: totalErrors === 0,
        total: totalRecords,
        inserted: totalInserted,
        skipped: totalSkipped,
        errors: totalErrors,
        duration,
        errorDetails: errorDetails.slice(0, 10) // Trả về 10 lỗi đầu tiên
      };

    } catch (error) {
      logger.error('Lỗi trong quá trình migration User:', error);
      logger.error('Stack trace:', error.stack);
      throw error;
    }
  }

  // Phương thức migration đơn giản (test với 10 records)
  async testMigration() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU TEST MIGRATION (10 RECORDS) ===');

    try {
      // Test kết nối
      const testResult = await this.userModel.testInsert();
      if (!testResult) {
        return { success: false, message: 'Test insert thất bại' };
      }

      // Lấy 10 records đầu tiên
      const oldRecords = await this.userModel.getAllFromOldDb();
      const testRecords = oldRecords.slice(0, 10);
      
      logger.info(`Testing với ${testRecords.length} records đầu tiên`);

      let successCount = 0;
      let errorCount = 0;

      for (const oldRecord of testRecords) {
        try {
          // Map dữ liệu
          const newRecord = this.safeMapRecord(oldRecord);
          
          // Insert
          await this.userModel.insertToNewDb(newRecord);
          successCount++;
          logger.info(`✓ Inserted ${oldRecord.ID}`);
          
        } catch (error) {
          errorCount++;
          logger.error(`✗ Error ${oldRecord.ID}: ${error.message}`);
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      logger.info('\n=== KẾT QUẢ TEST ===');
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
      logger.error('Lỗi trong test migration:', error);
      return {
        success: false,
        message: error.message,
        error: error.stack
      };
    }
  }

  async getStatistics() {
    try {
      const oldCount = await this.userModel.countOldDb();
      const newCount = await this.userModel.countNewDb();

      return {
        source: { 
          database: 'DataEOfficeSNP', 
          schema: 'dbo', 
          table: 'PersonalProfile', 
          count: oldCount 
        },
        destination: { 
          database: 'camunda', 
          schema: 'dbo',
          table: 'users', 
          count: newCount 
        },
        migrated: newCount,
        remaining: Math.max(0, oldCount - newCount),
        percentage: calculatePercentage(newCount, oldCount)
      };
    } catch (error) {
      logger.error('Lỗi lấy thống kê User:', error);
      throw error;
    }
  }

  async close() {
    await this.userModel.close();
  }
}

module.exports = MigrationUserService;