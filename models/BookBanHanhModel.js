// // models/BookBanHanhModel.js
// const BaseModel = require('./BaseModel');
// const logger = require('../utils/logger');

// class BookBanHanhModel extends BaseModel {
//   constructor() {
//     super();
//     this.oldTable = 'VanBanBanHanh';
//     this.oldSchema = 'dbo';
//     this.newTable = 'book_documents';
//     this.newSchema = 'dbo';
//   }

//   async getAllFromOldDb() {
//     try {
//       const query = `
//         SELECT 
//           SoVanBan,
//           NoiLuuTru,
//           DoKhan,
//           Created
//         FROM ${this.oldSchema}.${this.oldTable}
//         ORDER BY SoVanBan
//       `;
//       return await this.queryOldDb(query);
//     } catch (error) {
//       logger.error('Lỗi lấy danh sách VanBanBanHanh từ DB cũ:', error);
//       throw error;
//     }
//   }

//   async countOldDb() {
//     return await this.count(this.oldTable, this.oldSchema, true);
//   }

//   async checkIfToBookCodeExists(toBookCode) {
//     try {
//       const query = `
//         SELECT COUNT(*) as count 
//         FROM ${this.newSchema}.${this.newTable} 
//         WHERE to_book_code = @toBookCode
//       `;
//       const result = await this.newPool.request()
//         .input('toBookCode', toBookCode)
//         .query(query);
//       return result.recordset[0].count > 0;
//     } catch (error) {
//       logger.error('Lỗi check to_book_code tồn tại:', error);
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
//       logger.error('Lỗi insert book_documents từ VanBanBanHanh:', error);
//       throw error;
//     }
//   }

//   async countNewDb() {
//     return await this.count(this.newTable, this.newSchema, false);
//   }
// }

// module.exports = BookBanHanhModel;

// models/BookBanHanhModel.js
const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');

class BookBanHanhModel extends BaseModel {
  constructor() {
    super();
    this.oldTable = 'VanBanBanHanh';
    this.oldSchema = 'dbo';
    this.newTable = 'book_documents';
    this.newSchema = 'dbo';
  }

  async getAllFromOldDb() {
    try {
      const query = `
        SELECT 
          SoVanBan,
          NoiLuuTru,
          DoKhan,
          Created
        FROM ${this.oldSchema}.${this.oldTable}
        ORDER BY SoVanBan
      `;
      return await this.queryOldDb(query);
    } catch (error) {
      logger.error('Lỗi lấy danh sách VanBanBanHanh từ DB cũ:', error);
      throw error;
    }
  }

  async countOldDb() {
    return await this.count(this.oldTable, this.oldSchema, true);
  }

  async checkIfToBookCodeExists(toBookCode) {
    try {
      const query = `
        SELECT COUNT(*) as count 
        FROM ${this.newSchema}.${this.newTable} 
        WHERE to_book_code = @toBookCode
      `;
      const result = await this.newPool.request()
        .input('toBookCode', toBookCode)
        .query(query);
      return result.recordset[0].count > 0;
    } catch (error) {
      logger.error('Lỗi check to_book_code tồn tại:', error);
      throw error;
    }
  }

  async insertToNewDb(data) {
    try {
      const fields = Object.keys(data);

      // Fix lỗi: bọc [order] nếu field là 'order'
      const escapedFields = fields.map(field => {
        if (field.toLowerCase() === 'order') {
          return '[order]';
        }
        return field;
      }).join(', ');

      const values = fields.map((_, i) => `@param${i}`).join(', ');

      const query = `
        INSERT INTO ${this.newSchema}.${this.newTable} 
        (${escapedFields}) 
        VALUES (${values})
      `;

      const request = this.newPool.request();
      fields.forEach((field, i) => {
        request.input(`param${i}`, data[field]);
      });

      await request.query(query);

      // Log để debug
      logger.info(`Insert sổ ban hành thành công: "${data.name || data.to_book_code || 'không tên'}"`);

      return true;
    } catch (error) {
      logger.error('Lỗi insert book_documents từ VanBanBanHanh:', error);
      logger.error('Dữ liệu gây lỗi:', JSON.stringify(data, null, 2));
      throw error;
    }
  }

  async countNewDb() {
    return await this.count(this.newTable, this.newSchema, false);
  }
}

module.exports = BookBanHanhModel;