// models/Files2Model.js
const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');
const mssql = require('mssql');
const path = require('path');

class Files2Model extends BaseModel {
  constructor() {
    super();
    this.table = 'files2';
    this.schema = 'dbo';
    this.database = 'DiOffice'; // Giả sử bảng ở DB mới DiOffice
  }

  async getAllRecords() {
    try {
      const query = `
        SELECT id, file_path, file_name
        FROM ${this.schema}.${this.table}
        ORDER BY id
      `;
      logger.info('Lấy tất cả records từ files2');
      return await this.queryNewDb(query); // Giả sử dùng queryNewDb vì bảng ở DB mới
    } catch (error) {
      logger.error('Lỗi lấy danh sách records từ files2:', error);
      throw error;
    }
  }

  async countRecords() {
    logger.info('Đếm tổng số records trong files2');
    return await this.count(this.table, this.schema, false); // false vì DB mới
  }

  async countNeedUpdate() {
    try {
      const query = `
        SELECT COUNT(*) AS count
        FROM ${this.schema}.${this.table}
        WHERE file_name LIKE '%-[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]-[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]-[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]-[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]-[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]%'
      `;
      const result = await this.queryNewDb(query);
      logger.info(`Số records cần update: ${result[0].count}`);
      return result[0].count;
    } catch (error) {
      logger.error('Lỗi đếm records cần update:', error);
      throw error;
    }
  }

  async updateFileName(id, newFileName) {
    try {
      const query = `
        UPDATE ${this.schema}.${this.table}
        SET file_name = @newFileName
        WHERE id = @id
      `;
      await this.queryNewDb(query, { id, newFileName });
      logger.info(`Đã cập nhật file_name cho ID ${id} thành ${newFileName}`);
      return true;
    } catch (error) {
      logger.error(`Lỗi update file_name cho ID ${id}:`, error);
      throw error;
    }
  }
}

module.exports = Files2Model;