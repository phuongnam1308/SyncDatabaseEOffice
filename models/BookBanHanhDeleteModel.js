// models/BookBanHanhDeleteModel.js
const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');

class BookBanHanhDeleteModel extends BaseModel {
  constructor() {
    super();
    this.oldTable = 'VanBanBanHanhDelete';
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
      logger.error('Lỗi lấy danh sách VanBanBanHanhDelete từ DB cũ:', error);
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
      const values = fields.map((_, i) => `@param${i}`).join(', ');
      const query = `
        INSERT INTO ${this.newSchema}.${this.newTable} 
        (${fields.join(', ')}) 
        VALUES (${values})
      `;

      const request = this.newPool.request();
      fields.forEach((field, i) => {
        request.input(`param${i}`, data[field]);
      });

      await request.query(query);
      return true;
    } catch (error) {
      logger.error('Lỗi insert book_documents từ VanBanBanHanhDelete:', error);
      throw error;
    }
  }

  async countNewDb() {
    return await this.count(this.newTable, this.newSchema, false);
  }
}

module.exports = BookBanHanhDeleteModel;