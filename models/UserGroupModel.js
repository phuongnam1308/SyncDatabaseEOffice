// const BaseModel = require('./BaseModel');
// const logger = require('../utils/logger');

// class UserGroupModel extends BaseModel {
//   constructor() {
//     super();
//     this.oldTable = 'UserGroup';
//     this.oldSchema = 'SNP';
//     this.newTable = 'group_users';
//     this.newSchema = 'dbo';
//   }

//   async getAllFromOldDb() {
//     try {
//       const query = `
//         SELECT TOP 1000
//           ID,
//           Name,
//           Type,
//           AccountName,
//           Position,
//           WorkStatus
//         FROM ${this.oldSchema}.${this.oldTable}
//         ORDER BY ID
//       `;
//       return await this.queryOldDb(query);
//     } catch (error) {
//       logger.error('Lỗi lấy danh sách UserGroup từ DB cũ:', error);
//       throw error;
//     }
//   }

//   async countOldDb() {
//     return await this.count(this.oldTable, this.oldSchema, true);
//   }

//   async findByBackupId(backupId) {
//     try {
//       const query = `
//         SELECT id, name, code, id_group_bk
//         FROM ${this.newSchema}.${this.newTable}
//         WHERE id_group_bk = @backupId
//       `;
//       const result = await this.queryNewDb(query, { backupId });
//       return result.length > 0 ? result[0] : null;
//     } catch (error) {
//       logger.error('Lỗi tìm record theo id_group_bk:', error);
//       throw error;
//     }
//   }

//   async checkCodeExists(code) {
//     try {
//       const query = `
//         SELECT COUNT(*) as count 
//         FROM ${this.newSchema}.${this.newTable} 
//         WHERE code = @code
//       `;
//       const result = await this.queryNewDb(query, { code });
//       return result[0].count > 0;
//     } catch (error) {
//       logger.error('Lỗi kiểm tra code tồn tại:', error);
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
//       logger.error('Lỗi insert UserGroup:', error);
//       throw error;
//     }
//   }

//   async countNewDb() {
//     return await this.count(this.newTable, this.newSchema, false);
//   }
// }

// module.exports = UserGroupModel;

const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class UserGroupModel extends BaseModel {
  constructor() {
    super();
    this.oldTable = 'UserGroup';
    this.oldSchema = 'SNP';
    this.newTable = 'group_users';
    this.newSchema = 'dbo';
  }

  async getAllFromOldDb() {
    try {
      // Lấy tất cả records, không giới hạn TOP 1000
      const query = `
        SELECT
          ID,
          Name,
          Type,
          AccountName,
          Position,
          WorkStatus
        FROM ${this.oldSchema}.${this.oldTable}
        ORDER BY ID
      `;
      return await this.queryOldDb(query);
    } catch (error) {
      logger.error('Lỗi lấy danh sách UserGroup từ DB cũ:', error);
      throw error;
    }
  }

  async countOldDb() {
    return await this.count(this.oldTable, this.oldSchema, true);
  }

  async findByBackupId(backupId) {
    try {
      const query = `
        SELECT id, name, code, id_group_bk
        FROM ${this.newSchema}.${this.newTable}
        WHERE id_group_bk = @backupId
      `;
      const result = await this.queryNewDb(query, { backupId });
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      logger.error('Lỗi tìm record theo id_group_bk:', error);
      throw error;
    }
  }

  async checkCodeExists(code) {
    try {
      if (!code || code.trim() === '') {
        return true; // Coi code rỗng là đã tồn tại để skip
      }
      
      const query = `
        SELECT COUNT(*) as count 
        FROM ${this.newSchema}.${this.newTable} 
        WHERE code = @code
      `;
      const result = await this.queryNewDb(query, { code });
      return result[0].count > 0;
    } catch (error) {
      logger.error('Lỗi kiểm tra code tồn tại:', error);
      throw error;
    }
  }

  async insertToNewDb(data) {
    try {
      // === FIX: VALIDATE DỮ LIỆU TRƯỚC KHI INSERT ===
      if (!data.code || data.code.trim() === '') {
        logger.error('Không thể insert: code bắt buộc không được rỗng');
        logger.error('Data:', JSON.stringify(data, null, 2));
        throw new Error('Code field is required and cannot be empty');
      }

      // Log thông tin record đang insert
      logger.debug(`Inserting UserGroup: code=${data.code}, name=${data.name}, id_group_bk=${data.id_group_bk}`);

      const fields = Object.keys(data);
      const values = fields.map((_, i) => `@param${i}`).join(', ');
      
      const query = `
        INSERT INTO ${this.newSchema}.${this.newTable} 
        (${fields.join(', ')}) 
        VALUES (${values})
      `;

      const request = this.newPool.request();
      
      // Xử lý từng field
      fields.forEach((field, i) => {
        let value = data[field];
        
        // Xử lý các trường đặc biệt
        if (value === null || value === undefined) {
          if (field === 'code') {
            // Tạo code tự động nếu null
            value = `AUTO_${uuidv4().substring(0, 8).toUpperCase()}`;
            logger.warn(`Field 'code' null, đã tạo giá trị tự động: ${value}`);
          } else if (field === 'name') {
            value = data.code || 'Unknown Group';
            logger.warn(`Field 'name' null, đã gán từ code: ${value}`);
          }
        }
        
        // Xử lý chuỗi rỗng
        if (typeof value === 'string' && value.trim() === '' && field === 'code') {
          value = `EMPTY_${uuidv4().substring(0, 8).toUpperCase()}`;
          logger.warn(`Field 'code' rỗng, đã tạo giá trị: ${value}`);
        }
        
        request.input(`param${i}`, value);
      });

      await request.query(query);
      logger.debug(`Insert thành công: code=${data.code}`);
      return true;
      
    } catch (error) {
      logger.error('Lỗi insert UserGroup:', error);
      logger.error('Data gây lỗi:', JSON.stringify(data, null, 2));
      
      // Phân tích lỗi chi tiết
      if (error.message.includes('Cannot insert the value NULL into column')) {
        const columnMatch = error.message.match(/column '([^']+)'/);
        if (columnMatch) {
          logger.error(`Lỗi NULL column: ${columnMatch[1]} trong record với code=${data.code}`);
        }
      }
      
      throw error;
    }
  }

  async countNewDb() {
    return await this.count(this.newTable, this.newSchema, false);
  }

  // === THÊM HÀM MỚI ĐỂ DEBUG ===
  async getRecordsWithNullCode() {
    try {
      const query = `
        SELECT COUNT(*) as count
        FROM ${this.oldSchema}.${this.oldTable}
        WHERE AccountName IS NULL OR LTRIM(RTRIM(AccountName)) = ''
      `;
      const result = await this.queryOldDb(query);
      return result[0].count;
    } catch (error) {
      logger.error('Lỗi lấy số records có code null:', error);
      return 0;
    }
  }
}

module.exports = UserGroupModel;