// // models/UserDeleteModel.js
// const BaseModel = require('./BaseModel');
// const logger = require('../utils/logger');

// class UserDeleteModel extends BaseModel {
//   constructor() {
//     super();
//     this.oldTable = 'PersonalProfileDelete';
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
//       return await this.queryOldDb(query);
//     } catch (error) {
//       logger.error('Lỗi lấy danh sách PersonalProfileDelete từ DB cũ:', error);
//       throw error;
//     }
//   }

//   async countOldDb() {
//     return await this.count(this.oldTable, this.oldSchema, true);
//   }

//   async findByBackupId(backupId) {
//     try {
//       const query = `
//         SELECT id, username, name, id_user_del_bak
//         FROM ${this.newSchema}.${this.newTable}
//         WHERE id_user_del_bak = @backupId
//       `;
//       const result = await this.queryNewDb(query, { backupId });
//       return result.length > 0 ? result[0] : null;
//     } catch (error) {
//       logger.error('Lỗi tìm record theo id_user_del_bak:', error);
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
//       const fields = Object.keys(data);
//       const values = fields.map((_, i) => `@param${i}`).join(', ');
//       const query = `
//         INSERT INTO ${this.newSchema}.${this.newTable} 
//         (${fields.join(', ')}) 
//         VALUES (${values})
//       `;

//       const request = this.newPool.request();
//       fields.forEach((field, i) => {
//         request.input(`param${i}`, data[field]);
//       });

//       await request.query(query);
//       return true;
//     } catch (error) {
//       logger.error('Lỗi insert UserDelete:', error);
//       throw error;
//     }
//   }

//   async countNewDb() {
//     return await this.count(this.newTable, this.newSchema, false);
//   }
// }

// module.exports = UserDeleteModel;

// models/UserDeleteModel.js
const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');
const sql = require('mssql');

class UserDeleteModel extends BaseModel {
  constructor() {
    super();
    this.oldTable = 'PersonalProfileDelete';
    this.oldSchema = 'dbo';
    this.newTable = 'users';
    this.newSchema = 'dbo';
    this.sql = sql;
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
      
      if (results && results.length > 0) {
        logger.info(`✓ Lấy được ${results.length} records từ DB cũ`);
        
        const sampleRecord = results[0];
        logger.info('=== MẪU DỮ LIỆU ĐẦU TIÊN (DELETE) ===');
        logger.info(`ID: ${sampleRecord.ID}`);
        logger.info(`AccountName: ${sampleRecord.AccountName}`);
        logger.info(`FullName: ${sampleRecord.FullName}`);
        logger.info(`WorkStatus: ${sampleRecord.WorkStatus}`);
        logger.info('===========================');
        
        const stats = {
          total: results.length,
          missingID: results.filter(r => !r.ID).length,
          missingAccountName: results.filter(r => !r.AccountName).length
        };
        
        logger.info('=== THỐNG KÊ DỮ LIỆU (DELETE) ===');
        logger.info(`Tổng records: ${stats.total}`);
        logger.info(`Records thiếu ID: ${stats.missingID}`);
        logger.info(`Records thiếu AccountName: ${stats.missingAccountName}`);
        logger.info('===========================');
      }
      
      const validRecords = results.filter(record => 
        record && 
        typeof record === 'object' && 
        record.ID && 
        record.AccountName
      );
      
      logger.info(`Records hợp lệ: ${validRecords.length}/${results.length}`);
      
      return validRecords;
      
    } catch (error) {
      logger.error('❌ Lỗi lấy danh sách PersonalProfileDelete từ DB cũ:', error);
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
        SELECT id, username, name, id_user_del_bak
        FROM ${this.newSchema}.${this.newTable}
        WHERE id_user_del_bak = @backupId
      `;
      const result = await this.queryNewDb(query, { backupId });
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      logger.error('Lỗi tìm record theo id_user_del_bak:', error);
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
      
      fields.forEach((field, i) => {
        const value = processedData[field];
        const paramName = `param${i}`;
        
        if (value === null || value === undefined) {
          if (field === 'avatar') {
            request.input(paramName, this.sql.NVarChar, '[]');
          } else if (field === 'name') {
            request.input(paramName, this.sql.NVarChar, 'Unknown');
          } else if (field === 'username') {
            request.input(paramName, this.sql.NVarChar, `user_delete_${Date.now()}`);
          } else if (field === 'id') {
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
      logger.debug(`✓ Insert thành công delete record: ${data.id || 'unknown'}`);
      return true;
      
    } catch (error) {
      logger.error('❌ Lỗi insert User Delete:', error.message);
      logger.error('Chi tiết dữ liệu bị lỗi:');
      logger.error(JSON.stringify(data, null, 2));
      logger.error('Stack trace:', error.stack);
      throw error;
    }
  }

  prepareDataForInsert(data) {
    const processed = { ...data };
    
    if (!processed.id) {
      throw new Error('ID là bắt buộc');
    }
    
    if (!processed.name) {
      processed.name = 'Unknown';
    }
    
    if (!processed.username) {
      processed.username = `user_delete_${Date.now()}`;
    }
    
    if (!processed.avatar) {
      processed.avatar = '[]';
    }
    
    // User delete luôn có status = 3
    processed.status = 3;
    
    if (processed.orders === undefined || processed.orders === null) {
      processed.orders = 1000;
    }
    
    if (processed.IsTCT === 'NULL' || processed.IsTCT === null) {
      processed.IsTCT = 0;
    } else if (processed.IsTCT === '1' || processed.IsTCT === true) {
      processed.IsTCT = 1;
    } else if (processed.IsTCT === '0' || processed.IsTCT === false) {
      processed.IsTCT = 0;
    }
    
    if (!processed.created_at) {
      processed.created_at = new Date();
    }
    
    if (!processed.updated_at) {
      processed.updated_at = new Date();
    }
    
    if (processed.birthday === 'NULL' || processed.birthday === null) {
      processed.birthday = null;
    } else if (processed.birthday && !(processed.birthday instanceof Date)) {
      try {
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
    
    // Đảm bảo có table_backups = 'PersonalProfileDelete'
    processed.table_backups = 'PersonalProfileDelete';
    
    return processed;
  }

  async countNewDb() {
    try {
      const count = await this.count(this.newTable, this.newSchema, false);
      logger.info(`Số lượng delete records trong ${this.newSchema}.${this.newTable}: ${count}`);
      return count;
    } catch (error) {
      logger.error('Lỗi đếm số lượng records trong DB mới:', error);
      throw error;
    }
  }

  async getSampleRecords(limit = 5) {
    try {
      const query = `
        SELECT TOP ${limit} 
          ID, AccountID, AccountName, FullName, Department, 
          Manager, Gender, BirthDay, Email, WorkStatus,
          IsTCT, Orders, DepartmentId
        FROM ${this.oldSchema}.${this.oldTable}
        WHERE ID IS NOT NULL
        ORDER BY ID
      `;
      
      const results = await this.queryOldDb(query);
      
      if (results && results.length > 0) {
        logger.info(`\n=== SAMPLE DELETE RECORDS (${results.length} records) ===\n`);
        results.forEach((record, index) => {
          logger.info(`📋 Delete Record ${index + 1}:`);
          logger.info(`   ID: ${record.ID}`);
          logger.info(`   AccountName: ${record.AccountName}`);
          logger.info(`   FullName: ${record.FullName || 'NULL'}`);
          logger.info(`   WorkStatus: ${record.WorkStatus}`);
          logger.info('');
        });
        logger.info('==========================================\n');
      }
      
      return results;
    } catch (error) {
      logger.error('Lỗi lấy sample delete records:', error);
      return [];
    }
  }

  async testInsert() {
    try {
      const testData = {
        id: 'TEST-DELETE-' + Date.now(),
        name: 'Test Delete User',
        username: 'test_delete_' + Date.now(),
        avatar: '[]',
        password: '$10$mH.NYj.Bapxk4auiGaPKhOfCqUnA8jr1JO5fvP3miKbhIfwU3CVRa',
        status: 3, // Status luôn là 3 cho delete
        orders: 1000,
        created_at: new Date(),
        updated_at: new Date(),
        id_user_del_bak: 'TEST-DELETE-BACKUP-ID',
        IsTCT: 0,
        table_backups: 'PersonalProfileDelete'
      };
      
      logger.info('🔄 Testing insert delete với dữ liệu đơn giản...');
      await this.insertToNewDb(testData);
      logger.info('✅ Test insert delete thành công!');
      
      const deleteQuery = `
        DELETE FROM ${this.newSchema}.${this.newTable} 
        WHERE id = @id
      `;
      const request = this.newPool.request();
      request.input('id', testData.id);
      await request.query(deleteQuery);
      logger.info('🧹 Đã xóa test delete data');
      
      return true;
    } catch (error) {
      logger.error('❌ Test insert delete thất bại:', error);
      return false;
    }
  }
}

module.exports = UserDeleteModel;