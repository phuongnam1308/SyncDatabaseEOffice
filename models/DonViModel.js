const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');

class DonViModel extends BaseModel {
  constructor() {
    super();
    this.oldTable = 'DonVi';
    this.oldSchema = 'dbo';
    this.newTable = 'organization_units';
    this.newSchema = 'dbo';
  }

  async getAllFromOldDb() {
    try {
      const query = `
        SELECT 
          DonViID,
          MaDonVi,
          TenDonVi,
          URLDonVi,
          Manager
        FROM ${this.oldSchema}.${this.oldTable}
        ORDER BY DonViID
      `;
      return await this.queryOldDb(query);
    } catch (error) {
      logger.error('Lỗi lấy danh sách đơn vị từ DB cũ:', error);
      throw error;
    }
  }

  async countOldDb() {
    return await this.count(this.oldTable, this.oldSchema, true);
  }

  async findByBackupId(backupId) {
    try {
      const query = `
        SELECT id, name, code, Id_backups, table_backups
        FROM ${this.newSchema}.${this.newTable}
        WHERE Id_backups = @backupId AND table_backups = 'DonVi'
      `;
      const result = await this.queryNewDb(query, { backupId });
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      logger.error('Lỗi tìm record theo backup ID:', error);
      throw error;
    }
  }

  async insertToNewDb(data) {
    try {
      const fields = [];
      const values = [];
      const params = {};

      let paramIndex = 0;
      for (const [key, value] of Object.entries(data)) {
        fields.push(key);
        values.push(`@param${paramIndex}`);
        params[`param${paramIndex}`] = value;
        paramIndex++;
      }

      const query = `
        INSERT INTO ${this.newSchema}.${this.newTable} 
        (${fields.join(', ')}) 
        VALUES (${values.join(', ')})
      `;

      const request = this.newPool.request();
      Object.keys(params).forEach(key => {
        request.input(key, params[key]);
      });

      await request.query(query);
      return true;
    } catch (error) {
      logger.error('Lỗi insert đơn vị:', error);
      throw error;
    }
  }

  async getAllFromNewDb() {
    try {
      const query = `
        SELECT 
          id, name, code, type, phone_number, email, 
          leader, position, address, description, 
          display_order, status, mpath, parentId, 
          created_at, updated_at, Id_backups, table_backups
        FROM ${this.newSchema}.${this.newTable}
        WHERE table_backups = 'DonVi'
        ORDER BY id
      `;
      return await this.queryNewDb(query);
    } catch (error) {
      logger.error('Lỗi lấy danh sách đơn vị:', error);
      throw error;
    }
  }

  // ============================================================
  // ⭐⭐⭐ NẾU BẠN MUỐN ĐẾM TẤT CẢ (KHÔNG LỌC) ⭐⭐⭐
  // ============================================================
  async countNewDb() {
    try {
      // CÁCH 1: ĐẾM TẤT CẢ (không lọc table_backups)
      const query = `
        SELECT COUNT(*) as total 
        FROM ${this.newSchema}.${this.newTable}
      `;
      
      const result = await this.newPool.request().query(query);
      const count = result.recordset[0].total;
      
      logger.info(`Tổng số records trong organization_units: ${count}`);
      return count;
      
    } catch (error) {
      logger.error('Lỗi đếm đơn vị:', error);
      throw error;
    }
  }
  // ============================================================
  
  // HOẶC NẾU BẠN MUỐN ĐẾM CHỈ DONVI, DÙNG HÀM NÀY:
  async countNewDbDonViOnly() {
    try {
      const query = `
        SELECT COUNT(*) as total 
        FROM ${this.newSchema}.${this.newTable} 
        WHERE table_backups = 'DonVi'
      `;
      
      const result = await this.newPool.request().query(query);
      const count = result.recordset[0].total;
      
      logger.info(`Số records DonVi trong organization_units: ${count}`);
      return count;
      
    } catch (error) {
      logger.error('Lỗi đếm đơn vị:', error);
      throw error;
    }
  }

  async truncateNewTable() {
    try {
      const query = `
        DELETE FROM ${this.newSchema}.${this.newTable} 
        WHERE table_backups = 'DonVi'
      `;
      await this.executeNewDb(query);
      logger.info('Đã xóa toàn bộ dữ liệu đơn vị trong organization_units');
      return true;
    } catch (error) {
      logger.error('Lỗi xóa đơn vị:', error);
      throw error;
    }
  }
}

module.exports = DonViModel;