const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');

class PositionModel extends BaseModel {
  constructor() {
    super();
    this.oldTable = 'Position';
    this.oldSchema = 'dbo';
    this.newTable = 'organization_units';
    this.newSchema = 'dbo';
  }

  // Lấy tất cả position từ DB cũ
  async getAllFromOldDb() {
    try {
      const query = `
        SELECT 
          ID,
          TitleVn,
          Code
        FROM ${this.oldSchema}.${this.oldTable}
        ORDER BY ID
      `;
      const result = await this.oldPool.request().query(query);
      return result.recordset;
    } catch (error) {
      logger.error('Lỗi lấy danh sách position từ DB cũ:', error);
      throw error;
    }
  }

  // Đếm số position trong DB cũ
  async countOldDb() {
    try {
      const query = `SELECT COUNT(*) as count FROM ${this.oldSchema}.${this.oldTable}`;
      const result = await this.oldPool.request().query(query);
      return result.recordset[0].count;
    } catch (error) {
      logger.error('Lỗi đếm position từ DB cũ:', error);
      throw error;
    }
  }

  // === KIỂM TRA ID CŨ ĐÃ TỒN TẠI TRONG Id_backups CHƯA ===
  async findByBackupId(backupId) {
    try {
      // CÁCH 1: Sử dụng tham số an toàn
      const query = `
        SELECT id, name, code, Id_backups
        FROM ${this.newSchema}.${this.newTable}
        WHERE Id_backups = @backupId
          AND table_backups = 'Position'
      `;
      
      const request = this.newPool.request();
      request.input('backupId', backupId);
      
      const result = await request.query(query);
      return result.recordset.length > 0 ? result.recordset[0] : null;
      
      /* CÁCH 2: Nếu vẫn lỗi, thử cách này (đơn giản hơn)
      const query = `
        SELECT TOP 1 id, name, code, Id_backups
        FROM ${this.newSchema}.${this.newTable}
        WHERE Id_backups = '${backupId}'
          AND table_backups = 'Position'
      `;
      
      const result = await this.newPool.request().query(query);
      return result.recordset.length > 0 ? result.recordset[0] : null;
      */
    } catch (error) {
      logger.error('Lỗi tìm record theo backup ID:', error);
      logger.error('Backup ID:', backupId);
      logger.error('Query:', error);
      throw error;
    }
  }

  // Insert position vào DB mới
  async insertToNewDb(data) {
    try {
      const fields = [];
      const values = [];
      
      // Xây dựng query động
      const request = this.newPool.request();
      let paramIndex = 0;
      
      for (const [key, value] of Object.entries(data)) {
        fields.push(key);
        const paramName = `param${paramIndex}`;
        values.push(`@${paramName}`);
        request.input(paramName, value);
        paramIndex++;
      }

      const query = `
        INSERT INTO ${this.newSchema}.${this.newTable} 
        (${fields.join(', ')}) 
        VALUES (${values.join(', ')})
      `;

      await request.query(query);
      return true;
    } catch (error) {
      logger.error('Lỗi insert position:', error);
      logger.error('Dữ liệu:', JSON.stringify(data, null, 2));
      throw error;
    }
  }

  // Lấy tất cả positions từ DB mới
  async getAllFromNewDb() {
    try {
      const query = `
        SELECT 
          id, name, code, description, display_order, 
          status, parentId, created_at, updated_at, 
          Id_backups, table_backups
        FROM ${this.newSchema}.${this.newTable}
        WHERE table_backups = 'Position'
        ORDER BY id
      `;
      
      const result = await this.newPool.request().query(query);
      return result.recordset;
    } catch (error) {
      logger.error('Lỗi lấy danh sách positions:', error);
      throw error;
    }
  }

  // Đếm số positions trong DB mới
  async countNewDb() {
    try {
      const query = `
        SELECT COUNT(*) as count
        FROM ${this.newSchema}.${this.newTable}
        WHERE table_backups = 'Position'
      `;
      
      const result = await this.newPool.request().query(query);
      return result.recordset[0].count;
    } catch (error) {
      logger.error('Lỗi đếm số positions:', error);
      throw error;
    }
  }

  // Xóa tất cả dữ liệu trong bảng mới (chỉ xóa positions)
  async truncateNewTable() {
    try {
      const query = `
        DELETE FROM ${this.newSchema}.${this.newTable}
        WHERE table_backups = 'Position'
      `;
      
      await this.newPool.request().query(query);
      logger.info('Đã xóa toàn bộ dữ liệu positions');
      return true;
    } catch (error) {
      logger.error('Lỗi xóa dữ liệu positions:', error);
      throw error;
    }
  }

  // Phương thức debug: Kiểm tra kết nối
  async testConnection() {
    try {
      // Test kết nối DB cũ
      const oldTest = await this.oldPool.request().query('SELECT 1 as test');
      logger.info('Kết nối DB cũ OK:', oldTest.recordset);
      
      // Test kết nối DB mới
      const newTest = await this.newPool.request().query('SELECT 1 as test');
      logger.info('Kết nối DB mới OK:', newTest.recordset);
      
      return true;
    } catch (error) {
      logger.error('Lỗi test kết nối:', error);
      return false;
    }
  }
}

module.exports = PositionModel;