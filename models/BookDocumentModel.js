// // models/BookDocumentModel.js
// const BaseModel = require('./BaseModel');
// const logger = require('../utils/logger');

// class BookDocumentModel extends BaseModel {
//   constructor() {
//     super();
//     this.oldTable = 'VanBanDen';
//     this.oldSchema = 'dbo';
//     this.newTable = 'book_documents';
//     this.newSchema = 'dbo';
//   }

//   async getAllFromOldDb() {
//     try {
//       const query = `
//         SELECT 
//           Title,
//           CoQuanGuiText,
//           DoKhan,
//           Created
//         FROM ${this.oldSchema}.${this.oldTable}
//         ORDER BY Title
//       `;
//       return await this.queryOldDb(query);
//     } catch (error) {
//       logger.error('Lỗi lấy danh sách VanBanDen từ DB cũ:', error);
//       throw error;
//     }
//   }

//   async countOldDb() {
//     return await this.count(this.oldTable, this.oldSchema, true);
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
//       logger.error('Lỗi insert book_documents:', error);
//       throw error;
//     }
//   }

//   async countNewDb() {
//     return await this.count(this.newTable, this.newSchema, false);
//   }

//   // Update count theo nhóm name sau khi insert
//   async updateCountByGroup() {
//     try {
//       const query = `
//         UPDATE bd
//         SET bd.count = g.doc_count
//         FROM DiOffice.dbo.book_documents bd
//         INNER JOIN (
//           SELECT name, COUNT(*) as doc_count
//           FROM DiOffice.dbo.book_documents
//           GROUP BY name
//         ) g ON bd.name = g.name
//       `;
//       await this.newPool.request().query(query);
//       logger.info('Đã update count theo nhóm name');
//     } catch (error) {
//       logger.error('Lỗi update count theo nhóm:', error);
//       throw error;
//     }
//   }
// }

// module.exports = BookDocumentModel;

// models/BookDocumentModel.js
const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');

class BookDocumentModel extends BaseModel {
  constructor() {
    super();
    this.oldTable = 'VanBanDen';
    this.oldSchema = 'dbo';
    this.newTable = 'book_documents';
    this.newSchema = 'dbo';
  }

  async getAllFromOldDb() {
    try {
      const query = `
        SELECT 
          Title,
          CoQuanGuiText,
          DoKhan,
          Created
        FROM ${this.oldSchema}.${this.oldTable}
        ORDER BY Title
      `;
      return await this.queryOldDb(query);
    } catch (error) {
      logger.error('Lỗi lấy danh sách VanBanDen từ DB cũ:', error);
      throw error;
    }
  }

  async countOldDb() {
    return await this.count(this.oldTable, this.oldSchema, true);
  }

  async insertToNewDb(data) {
    try {
      const fields = Object.keys(data);

      // Fix lỗi: nếu field là 'order' thì bọc bằng [order]
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

      // Log thành công để dễ theo dõi
      logger.info(`Insert thành công sổ: "${data.name || 'không tên'}" (count: ${data.count || 0})`);

      return true;
    } catch (error) {
      logger.error('Lỗi insert book_documents:', error);
      logger.error('Dữ liệu gây lỗi:', JSON.stringify(data, null, 2)); // log chi tiết record lỗi
      throw error;
    }
  }

  async countNewDb() {
    return await this.count(this.newTable, this.newSchema, false);
  }

  // Update count theo nhóm name sau khi insert
  async updateCountByGroup() {
    try {
      const query = `
        UPDATE bd
        SET bd.count = g.doc_count
        FROM DiOffice.dbo.book_documents bd
        INNER JOIN (
          SELECT name, COUNT(*) as doc_count
          FROM DiOffice.dbo.book_documents
          GROUP BY name
        ) g ON bd.name = g.name
      `;
      await this.newPool.request().query(query);
      logger.info('Đã update count theo nhóm name');
    } catch (error) {
      logger.error('Lỗi update count theo nhóm:', error);
      throw error;
    }
  }
}

module.exports = BookDocumentModel;