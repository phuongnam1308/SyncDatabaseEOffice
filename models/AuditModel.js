// models/AuditModel.js
const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');
const mssql = require('mssql');

class AuditModel extends BaseModel {
  constructor() {
    super();
    this.oldTable = 'LuanChuyenVanBan';
    this.oldSchema = 'dbo';
    this.newTable = 'audit2';
    this.newSchema = 'dbo';
  }

  async getAllFromOldDb() {
    try {
      const query = `
        SELECT 
          ID,
          IDVanBan,
          NguoiXuLy,
          NgayTao,
          HanhDong,
          Category,
          IDVanBanGoc,
          VBId,
          VBGocId
        FROM ${this.oldSchema}.${this.oldTable}
        ORDER BY ID
      `;
      return await this.queryOldDb(query);
    } catch (error) {
      logger.error('Lỗi lấy danh sách LuanChuyenVanBan từ DB cũ:', error);
      throw error;
    }
  }

  async countOldDb() {
    return await this.count(this.oldTable, this.oldSchema, true);
  }

  async findByBackupId(backupId) {
    try {
      const query = `
        SELECT id
        FROM ${this.newSchema}.${this.newTable}
        WHERE origin_id = @backupId
      `;
      const result = await this.queryNewDb(query, { backupId });
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      logger.error('Lỗi tìm audit theo origin_id:', error);
      throw error;
    }
  }

  async insertToNewDb(data) {
    try {
      logger.info('Dữ liệu sắp insert vào audit2:', JSON.stringify(data, (k, v) => v instanceof Date ? v.toISOString() : v, 2));

      const fields = Object.keys(data);
      const escapedFields = fields.map(field => 
        field.toLowerCase() === 'order' ? '[order]' : 
        field.toLowerCase() === 'role' ? '[role]' : 
        field.toLowerCase() === 'action' ? '[action]' : field
      ).join(', ');

      const values = fields.map((_, i) => `@param${i}`).join(', ');

      const query = `
        INSERT INTO ${this.newSchema}.${this.newTable} 
        (${escapedFields}) 
        VALUES (${values})
      `;

      const request = this.newPool.request();

      fields.forEach((field, i) => {
        let value = data[field];

        if (value === undefined) {
          value = null;
        }

        if (value === null) {
          request.input(`param${i}`, mssql.NVarChar, null);  // Default cho hầu hết
        } else if (['time', 'deadline', 'created_at', 'updated_at'].includes(field)) {
          const dateValue = new Date(value);
          request.input(`param${i}`, mssql.DateTime2, isNaN(dateValue.getTime()) ? null : dateValue);
        } else {
          request.input(`param${i}`, value);  // NVARCHAR cho các trường cũ
        }
      });

      await request.query(query);
      return true;
    } catch (error) {
      logger.error('Lỗi insert vào audit2:', error);
      throw error;
    }
  }

  async countNewDb() {
    return await this.count(this.newTable, this.newSchema, false);
  }
}

module.exports = AuditModel;