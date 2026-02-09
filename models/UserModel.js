// // // models/UserModel.js
// // const BaseModel = require('./BaseModel');
// // const logger = require('../utils/logger');

// // class UserModel extends BaseModel {
// //   constructor() {
// //     super();
// //     this.oldTable = 'PersonalProfile';
// //     this.oldSchema = 'dbo';           // Đã sửa thành dbo
// //     this.newTable = 'users';
// //     this.newSchema = 'dbo';
// //   }

// //   async getAllFromOldDb() {
// //     try {
// //       const query = `
// //         SELECT 
// //           ID, AccountID, AccountName, FullName, Department, DepartmentManager,
// //           Manager, Gender, BirthDay, Address, Image, Mobile, Email, Position,
// //           PhongBan, Orders, DepartmentId, PhongBanID, WorkStatus, NgayTao,
// //           Modified, IsTCT, ImagePath, SignImage, SignImageSmall, CMND,
// //           SimKySo1, SimKySo2
// //         FROM ${this.oldSchema}.${this.oldTable}
// //         ORDER BY ID
// //       `;
// //       return await this.queryOldDb(query);
// //     } catch (error) {
// //       logger.error('Lỗi lấy danh sách PersonalProfile từ DB cũ:', error);
// //       throw error;
// //     }
// //   }

// //   async countOldDb() {
// //     return await this.count(this.oldTable, this.oldSchema, true);
// //   }

// //   async findByBackupId(backupId) {
// //     try {
// //       const query = `
// //         SELECT id, username, name, id_user_bak
// //         FROM ${this.newSchema}.${this.newTable}
// //         WHERE id_user_bak = @backupId
// //       `;
// //       const result = await this.queryNewDb(query, { backupId });
// //       return result.length > 0 ? result[0] : null;
// //     } catch (error) {
// //       logger.error('Lỗi tìm record theo id_user_bak:', error);
// //       throw error;
// //     }
// //   }

// //   async checkUsernameExists(username) {
// //     try {
// //       const query = `
// //         SELECT COUNT(*) as count 
// //         FROM ${this.newSchema}.${this.newTable} 
// //         WHERE username = @username
// //       `;
// //       const result = await this.queryNewDb(query, { username });
// //       return result[0].count > 0;
// //     } catch (error) {
// //       logger.error('Lỗi kiểm tra username tồn tại:', error);
// //       throw error;
// //     }
// //   }

// //   async insertToNewDb(data) {
// //     try {
// //       const fields = Object.keys(data);
// //       const values = fields.map((_, i) => `@param${i}`).join(', ');
// //       const query = `
// //         INSERT INTO ${this.newSchema}.${this.newTable} 
// //         (${fields.join(', ')}) 
// //         VALUES (${values})
// //       `;

// //       const request = this.newPool.request();
// //       fields.forEach((field, i) => {
// //         request.input(`param${i}`, data[field]);
// //       });

// //       await request.query(query);
// //       return true;
// //     } catch (error) {
// //       logger.error('Lỗi insert User:', error);
// //       throw error;
// //     }
// //   }

// //   async countNewDb() {
// //     return await this.count(this.newTable, this.newSchema, false);
// //   }
// // }

// // module.exports = UserModel;

// const BaseModel = require('./BaseModel');
// const logger = require('../utils/logger');

// class UserModel extends BaseModel {
//   constructor() {
//     super();
//     this.oldTable = 'PersonalProfile';
//     this.oldSchema = 'dbo';
//     this.newTable = 'users';
//     this.newSchema = 'dbo';
//   }

//   async getAllFromOldDb() {
//     try {
//       const query = `
//         SELECT 
//           ID, AccountID, AccountName, FullName, Department, DepartmentManager,
//           Manager, Gender, BirthDay, Address, Image, Mobile, Email, Position,
//           PhongBan, Orders, DepartmentId, PhongBanID, WorkStatus, NgayTao,
//           Modified, IsTCT, ImagePath, SignImage, SignImageSmall, CMND,
//           SimKySo1, SimKySo2
//         FROM ${this.oldSchema}.${this.oldTable}
//         ORDER BY ID
//       `;
//       const results = await this.queryOldDb(query);
      
//       // Debug: Log thông tin về dữ liệu
//       if (results && results.length > 0) {
//         logger.info(`Lấy được ${results.length} records từ DB cũ`);
        
//         // Kiểm tra cấu trúc của record đầu tiên
//         const sampleRecord = results[0];
//         logger.info(`Mẫu record đầu tiên - ID: ${sampleRecord.ID}, AccountName: ${sampleRecord.AccountName}`);
        
//         // Kiểm tra các trường quan trọng
//         const recordKeys = Object.keys(sampleRecord);
//         logger.info(`Các trường trong record: ${recordKeys.join(', ')}`);
        
//         // Tìm record có vấn đề (nếu có)
//         const problematicRecords = results.filter(record => 
//           !record || typeof record !== 'object' || !record.ID
//         );
        
//         if (problematicRecords.length > 0) {
//           logger.warn(`Tìm thấy ${problematicRecords.length} record có vấn đề`);
//         }
//       }
      
//       // Đảm bảo không có record undefined
//       return results.filter(record => record && typeof record === 'object');
//     } catch (error) {
//       logger.error('Lỗi lấy danh sách PersonalProfile từ DB cũ:', error);
//       throw error;
//     }
//   }

//   async countOldDb() {
//     try {
//       const count = await this.count(this.oldTable, this.oldSchema, true);
//       logger.info(`Số lượng records trong bảng cũ: ${count}`);
//       return count;
//     } catch (error) {
//       logger.error('Lỗi đếm số lượng records trong DB cũ:', error);
//       throw error;
//     }
//   }

//   async findByBackupId(backupId) {
//     try {
//       const query = `
//         SELECT id, username, name, id_user_bak
//         FROM ${this.newSchema}.${this.newTable}
//         WHERE id_user_bak = @backupId
//       `;
//       const result = await this.queryNewDb(query, { backupId });
//       return result.length > 0 ? result[0] : null;
//     } catch (error) {
//       logger.error('Lỗi tìm record theo id_user_bak:', error);
//       throw error;
//     }
//   }

//   async checkUsernameExists(username) {
//     try {
//       const query = `
//         SELECT COUNT(*) as count 
//         FROM ${this.newSchema}.${this.newTable} 
//         WHERE username = @username
//       `;
//       const result = await this.queryNewDb(query, { username });
//       return result[0].count > 0;
//     } catch (error) {
//       logger.error('Lỗi kiểm tra username tồn tại:', error);
//       throw error;
//     }
//   }

//   async insertToNewDb(data) {
//     try {
//       if (!data || Object.keys(data).length === 0) {
//         throw new Error('Dữ liệu insert là null hoặc empty');
//       }

//       const fields = Object.keys(data);
//       const values = fields.map((_, i) => `@param${i}`).join(', ');
      
//       const query = `
//         INSERT INTO ${this.newSchema}.${this.newTable} 
//         (${fields.join(', ')}) 
//         VALUES (${values})
//       `;

//       const request = this.newPool.request();
      
//       fields.forEach((field, i) => {
//         let value = data[field];
        
//         // Xử lý các giá trị đặc biệt
//         if (value === undefined) {
//           value = null;
//         }
        
//         // Chuyển đổi boolean thành bit cho SQL Server
//         if (typeof value === 'boolean') {
//           value = value ? 1 : 0;
//         }
        
//         request.input(`param${i}`, value);
//       });

//       await request.query(query);
//       logger.debug(`Insert thành công record với id: ${data.id || 'unknown'}`);
//       return true;
//     } catch (error) {
//       logger.error('Lỗi insert User:', error);
//       logger.error('Dữ liệu bị lỗi:', JSON.stringify(data));
//       throw error;
//     }
//   }

//   async countNewDb() {
//     try {
//       const count = await this.count(this.newTable, this.newSchema, false);
//       logger.info(`Số lượng records trong bảng mới: ${count}`);
//       return count;
//     } catch (error) {
//       logger.error('Lỗi đếm số lượng records trong DB mới:', error);
//       throw error;
//     }
//   }

//   // Thêm phương thức để debug dữ liệu cụ thể
//   async getSampleRecords(limit = 5) {
//     try {
//       const query = `
//         SELECT TOP ${limit} 
//           ID, AccountID, AccountName, FullName, Department, 
//           Manager, Gender, BirthDay, Email, WorkStatus
//         FROM ${this.oldSchema}.${this.oldTable}
//         WHERE ID IS NOT NULL
//         ORDER BY ID
//       `;
      
//       const results = await this.queryOldDb(query);
      
//       if (results && results.length > 0) {
//         logger.info(`=== SAMPLE RECORDS (${results.length} records) ===`);
//         results.forEach((record, index) => {
//           logger.info(`Record ${index + 1}:`);
//           logger.info(`  ID: ${record.ID}`);
//           logger.info(`  AccountName: ${record.AccountName}`);
//           logger.info(`  FullName: ${record.FullName || 'NULL'}`);
//           logger.info(`  Gender: ${record.Gender}`);
//           logger.info(`  WorkStatus: ${record.WorkStatus}`);
//         });
//         logger.info('==================================');
//       }
      
//       return results;
//     } catch (error) {
//       logger.error('Lỗi lấy sample records:', error);
//       return [];
//     }
//   }
// }

// module.exports = UserModel;

// models/UserModel.js
const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');
const sql = require('mssql'); // Thêm import này

class UserModel extends BaseModel {
  constructor() {
    super();
    this.oldTable = 'PersonalProfile';
    this.oldSchema = 'dbo';
    this.newTable = 'users';
    this.newSchema = 'dbo';
    this.sql = sql; // Lưu reference đến mssql
  }

  async getAllFromOldDb() {
    try {
      logger.info(`Đang lấy dữ liệu từ ${this.oldSchema}.${this.oldTable}...`);
      
      const query = `
        SELECT 
          ID, AccountID, AccountName, FullName, Department, DepartmentManager,
          Manager, Gender, BirthDay, Address, Image, Mobile, Email, Position,
          PhongBan, Orders, DepartmentId, PhongBanID, WorkStatus, NgayTao,
          Modified, IsTCT, ImagePath, SignImage, SignImageSmall, CMND,
          SimKySo1, SimKySo2
        FROM ${this.oldSchema}.${this.oldTable}
        ORDER BY ID
      `;
      
      const results = await this.queryOldDb(query);
      
      // Debug chi tiết
      if (results && results.length > 0) {
        logger.info(`✓ Lấy được ${results.length} records từ DB cũ`);
        
        // Log mẫu dữ liệu đầu tiên
        const sampleRecord = results[0];
        logger.info('=== MẪU DỮ LIỆU ĐẦU TIÊN ===');
        logger.info(`ID: ${sampleRecord.ID}`);
        logger.info(`AccountName: ${sampleRecord.AccountName}`);
        logger.info(`FullName: ${sampleRecord.FullName}`);
        logger.info(`Gender: ${sampleRecord.Gender} (type: ${typeof sampleRecord.Gender})`);
        logger.info(`BirthDay: ${sampleRecord.BirthDay} (type: ${typeof sampleRecord.BirthDay})`);
        logger.info(`Email: ${sampleRecord.Email}`);
        logger.info(`WorkStatus: ${sampleRecord.WorkStatus} (type: ${typeof sampleRecord.WorkStatus})`);
        logger.info(`IsTCT: ${sampleRecord.IsTCT} (type: ${typeof sampleRecord.IsTCT})`);
        logger.info('===========================');
        
        // Check for problematic data
        const stats = {
          total: results.length,
          missingID: results.filter(r => !r.ID).length,
          missingAccountName: results.filter(r => !r.AccountName).length,
          nullBirthDay: results.filter(r => r.BirthDay === 'NULL' || !r.BirthDay).length,
          nullIsTCT: results.filter(r => r.IsTCT === 'NULL' || !r.IsTCT).length,
          problematicDates: results.filter(r => {
            if (r.BirthDay && r.BirthDay !== 'NULL') {
              try {
                new Date(r.BirthDay);
                return false;
              } catch {
                return true;
              }
            }
            return false;
          }).length
        };
        
        logger.info('=== THỐNG KÊ DỮ LIỆU ===');
        logger.info(`Tổng records: ${stats.total}`);
        logger.info(`Records thiếu ID: ${stats.missingID}`);
        logger.info(`Records thiếu AccountName: ${stats.missingAccountName}`);
        logger.info(`Records có BirthDay là NULL: ${stats.nullBirthDay}`);
        logger.info(`Records có IsTCT là NULL: ${stats.nullIsTCT}`);
        logger.info(`Records có BirthDay không hợp lệ: ${stats.problematicDates}`);
        logger.info('===========================');
      }
      
      // Filter out invalid records
      const validRecords = results.filter(record => 
        record && 
        typeof record === 'object' && 
        record.ID && 
        record.AccountName
      );
      
      logger.info(`Records hợp lệ: ${validRecords.length}/${results.length}`);
      
      return validRecords;
      
    } catch (error) {
      logger.error('❌ Lỗi lấy danh sách PersonalProfile từ DB cũ:', error);
      throw error;
    }
  }

  async countOldDb() {
    try {
      const count = await this.count(this.oldTable, this.oldSchema, true);
      logger.info(`Số lượng records trong ${this.oldSchema}.${this.oldTable}: ${count}`);
      return count;
    } catch (error) {
      logger.error('Lỗi đếm số lượng records trong DB cũ:', error);
      throw error;
    }
  }

  async findByBackupId(backupId) {
    try {
      const query = `
        SELECT id, username, name, id_user_bak
        FROM ${this.newSchema}.${this.newTable}
        WHERE id_user_bak = @backupId
      `;
      const result = await this.queryNewDb(query, { backupId });
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      logger.error('Lỗi tìm record theo id_user_bak:', error);
      throw error;
    }
  }

  async checkUsernameExists(username) {
    try {
      const query = `
        SELECT COUNT(*) as count 
        FROM ${this.newSchema}.${this.newTable} 
        WHERE username = @username
      `;
      const result = await this.queryNewDb(query, { username });
      return result[0].count > 0;
    } catch (error) {
      logger.error('Lỗi kiểm tra username tồn tại:', error);
      throw error;
    }
  }

  async insertToNewDb(data) {
    try {
      if (!data || Object.keys(data).length === 0) {
        throw new Error('Dữ liệu insert là null hoặc empty');
      }

      // Chuẩn bị dữ liệu trước khi insert
      const processedData = this.prepareDataForInsert(data);
      
      const fields = Object.keys(processedData);
      const values = fields.map((_, i) => `@param${i}`).join(', ');
      
      const query = `
        INSERT INTO ${this.newSchema}.${this.newTable} 
        (${fields.join(', ')}) 
        VALUES (${values})
      `;

      logger.debug(`SQL Query: ${query}`);
      
      const request = this.newPool.request();
      
      // Bind parameters với kiểu dữ liệu cụ thể
      fields.forEach((field, i) => {
        const value = processedData[field];
        const paramName = `param${i}`;
        
        // Xác định kiểu dữ liệu SQL
        if (value === null || value === undefined) {
          // Xử lý các trường NOT NULL
          if (field === 'avatar') {
            request.input(paramName, this.sql.NVarChar, '[]');
          } else if (field === 'name') {
            request.input(paramName, this.sql.NVarChar, 'Unknown');
          } else if (field === 'username') {
            request.input(paramName, this.sql.NVarChar, `user_${Date.now()}`);
          } else if (field === 'id') {
            // ID không được null
            logger.error('ID không được null!');
            throw new Error(`Field ${field} cannot be null`);
          } else {
            request.input(paramName, value);
          }
        } else if (field === 'birthday' && value instanceof Date) {
          request.input(paramName, this.sql.DateTime, value);
        } else if (field === 'created_at' || field === 'updated_at') {
          request.input(paramName, this.sql.DateTime, value);
        } else if (field === 'IsTCT') {
          // Xử lý bit field
          const bitValue = value === true || value === 1 || value === '1' ? 1 : 0;
          request.input(paramName, this.sql.Bit, bitValue);
        } else if (typeof value === 'number') {
          request.input(paramName, this.sql.Int, value);
        } else if (typeof value === 'boolean') {
          request.input(paramName, this.sql.Bit, value ? 1 : 0);
        } else {
          request.input(paramName, value);
        }
      });

      await request.query(query);
      logger.debug(`✓ Insert thành công record: ${data.id || 'unknown'}`);
      return true;
      
    } catch (error) {
      logger.error('❌ Lỗi insert User:', error.message);
      logger.error('Chi tiết dữ liệu bị lỗi:');
      logger.error(JSON.stringify(data, null, 2));
      logger.error('Stack trace:', error.stack);
      throw error;
    }
  }

  // Chuẩn bị dữ liệu trước khi insert
  prepareDataForInsert(data) {
    const processed = { ...data };
    
    // Đảm bảo các trường NOT NULL có giá trị
    if (!processed.id) {
      throw new Error('ID là bắt buộc');
    }
    
    if (!processed.name) {
      processed.name = 'Unknown';
    }
    
    if (!processed.username) {
      processed.username = `user_${Date.now()}`;
    }
    
    if (!processed.avatar) {
      processed.avatar = '[]';
    }
    
    // Xử lý status
    if (processed.status === undefined || processed.status === null) {
      processed.status = 1;
    }
    
    // Xử lý orders
    if (processed.orders === undefined || processed.orders === null) {
      processed.orders = 1000;
    }
    
    // Xử lý IsTCT (bit field)
    if (processed.IsTCT === 'NULL' || processed.IsTCT === null) {
      processed.IsTCT = 0;
    } else if (processed.IsTCT === '1' || processed.IsTCT === true) {
      processed.IsTCT = 1;
    } else if (processed.IsTCT === '0' || processed.IsTCT === false) {
      processed.IsTCT = 0;
    }
    
    // Xử lý created_at và updated_at
    if (!processed.created_at) {
      processed.created_at = new Date();
    }
    
    if (!processed.updated_at) {
      processed.updated_at = new Date();
    }
    
    // Xử lý birthday date
    if (processed.birthday === 'NULL' || processed.birthday === null) {
      processed.birthday = null;
    } else if (processed.birthday && !(processed.birthday instanceof Date)) {
      try {
        // Thử parse date
        const date = new Date(processed.birthday);
        if (isNaN(date.getTime())) {
          processed.birthday = null;
        } else {
          processed.birthday = date;
        }
      } catch {
        processed.birthday = null;
      }
    }
    
    return processed;
  }

  async countNewDb() {
    try {
      const count = await this.count(this.newTable, this.newSchema, false);
      logger.info(`Số lượng records trong ${this.newSchema}.${this.newTable}: ${count}`);
      return count;
    } catch (error) {
      logger.error('Lỗi đếm số lượng records trong DB mới:', error);
      throw error;
    }
  }

  // Lấy mẫu dữ liệu để debug
  async getSampleRecords(limit = 10) {
    try {
      const query = `
        SELECT TOP ${limit} 
          ID, AccountID, AccountName, FullName, Department, 
          Manager, Gender, BirthDay, Email, WorkStatus,
          IsTCT, Image, Mobile, Position, Orders, DepartmentId
        FROM ${this.oldSchema}.${this.oldTable}
        WHERE ID IS NOT NULL
        ORDER BY ID
      `;
      
      const results = await this.queryOldDb(query);
      
      if (results && results.length > 0) {
        logger.info(`\n=== SAMPLE RECORDS (${results.length} records) ===\n`);
        results.forEach((record, index) => {
          logger.info(`📋 Record ${index + 1}:`);
          logger.info(`   ID: ${record.ID}`);
          logger.info(`   AccountName: ${record.AccountName}`);
          logger.info(`   FullName: ${record.FullName || 'NULL'}`);
          logger.info(`   Gender: ${record.Gender} (${this.parseGender(record.Gender)})`);
          logger.info(`   BirthDay: ${record.BirthDay} (${this.isValidDate(record.BirthDay) ? 'Valid' : 'Invalid'})`);
          logger.info(`   Email: ${record.Email || 'NULL'}`);
          logger.info(`   WorkStatus: ${record.WorkStatus} -> Status: ${this.parseStatus(record.WorkStatus)}`);
          logger.info(`   IsTCT: ${record.IsTCT} -> Bit: ${this.parseBit(record.IsTCT)}`);
          logger.info(`   Image: ${record.Image ? 'Has value' : 'NULL'}`);
          logger.info(`   Orders: ${record.Orders}`);
          logger.info('');
        });
        logger.info('==========================================\n');
      }
      
      return results;
    } catch (error) {
      logger.error('Lỗi lấy sample records:', error);
      return [];
    }
  }

  // Helper methods
  parseGender(value) {
    const genderStr = String(value || '');
    if (genderStr === '1') return 'nam';
    if (genderStr === '0') return 'nu';
    return 'unknown';
  }

  parseStatus(value) {
    const statusStr = String(value || '');
    if (statusStr === '-1') return 3;
    return 1;
  }

  parseBit(value) {
    if (value === '1' || value === 1 || value === true) return 1;
    if (value === '0' || value === 0 || value === false) return 0;
    return 0; // default
  }

  isValidDate(dateStr) {
    if (!dateStr || dateStr === 'NULL') return false;
    try {
      const date = new Date(dateStr);
      return !isNaN(date.getTime());
    } catch {
      return false;
    }
  }

  // Test insert method với dữ liệu đơn giản
  async testInsert() {
    try {
      const testData = {
        id: 'TEST-' + Date.now(),
        name: 'Test User',
        username: 'test_user_' + Date.now(),
        avatar: '[]',
        password: '$10$mH.NYj.Bapxk4auiGaPKhOfCqUnA8jr1JO5fvP3miKbhIfwU3CVRa',
        status: 1,
        orders: 1000,
        created_at: new Date(),
        updated_at: new Date(),
        id_user_bak: 'TEST-BACKUP-ID',
        IsTCT: 0
      };
      
      logger.info('🔄 Testing insert với dữ liệu đơn giản...');
      await this.insertToNewDb(testData);
      logger.info('✅ Test insert thành công!');
      
      // Clean up test data
      const deleteQuery = `
        DELETE FROM ${this.newSchema}.${this.newTable} 
        WHERE id = @id
      `;
      const request = this.newPool.request();
      request.input('id', testData.id);
      await request.query(deleteQuery);
      logger.info('🧹 Đã xóa test data');
      
      return true;
    } catch (error) {
      logger.error('❌ Test insert thất bại:', error);
      return false;
    }
  }

  // Phương thức batch insert cho performance
  async batchInsert(records) {
    if (!records || records.length === 0) {
      return { success: true, inserted: 0, errors: 0 };
    }

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const record of records) {
      try {
        await this.insertToNewDb(record);
        successCount++;
      } catch (error) {
        errorCount++;
        errors.push({
          id: record.id || record.ID || 'unknown',
          error: error.message
        });
        
        // Log lỗi nhưng tiếp tục với các record khác
        logger.warn(`Lỗi insert record ${record.id || record.ID}: ${error.message}`);
      }
    }

    return {
      success: errorCount === 0,
      inserted: successCount,
      errors: errorCount,
      errorDetails: errors
    };
  }
}

module.exports = UserModel;