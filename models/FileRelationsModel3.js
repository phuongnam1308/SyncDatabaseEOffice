// models/FileRelationsModel.js
const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');
const mssql = require('mssql');
const { tableMappings } = require('../config/tablesFileRelations2');

class FileRelationsModel extends BaseModel {
  constructor() {
    super();
    this.oldTable = tableMappings.fileRelations.oldTable;
    this.oldSchema = tableMappings.fileRelations.oldSchema;
    this.newTable = tableMappings.fileRelations.newTable;
    this.newSchema = tableMappings.fileRelations.newSchema;
  }

  // Lấy dữ liệu theo trang (Pagination) - Giải quyết Timeout
  async getPaginatedFromOldDb(offset, limit) {
    try {
      const query = `
        SELECT 
          id,
          nguoikyvanban,
          id_bak,
          table_bak,
          type_doc,
          created_at  -- Thêm created_at để lấy từ files2
        FROM ${this.oldSchema}.${this.oldTable}
        ORDER BY id
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `;
      logger.info(`[Pagination] Lấy batch files2 → offset: ${offset}, limit: ${limit}`);
      
      return await this.queryNewDb(query, { 
        offset: parseInt(offset), 
        limit: parseInt(limit) 
      });
    } catch (error) {
      logger.error('Lỗi lấy batch paginated từ files2:', error);
      throw error;
    }
  }

  // Giữ nguyên các method cũ
  async getAllFromOldDb() {
    // Không nên dùng nữa (dễ timeout) → chỉ để fallback
    const query = `SELECT id, nguoikyvanban, id_bak, table_bak, type_doc, created_at FROM ${this.oldSchema}.${this.oldTable} ORDER BY id`;
    logger.info('Lấy toàn bộ từ files2 (không khuyến khích)');
    return await this.queryNewDb(query);
  }

  async countOldDb() {
    logger.info('Đếm tổng số bản ghi trong files2');
    return await this.count(this.oldTable, this.oldSchema, false);
  }

  async countNewDb() {
    logger.info('Đếm tổng số bản ghi trong file_relations2');
    return await this.count(this.newTable, this.newSchema, false);
  }

  async findByBackupId(backupId) {
    try {
      const query = `
        SELECT id FROM ${this.newSchema}.${this.newTable}
        WHERE file_id = @backupId
      `;
      const result = await this.queryNewDb(query, { backupId });
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      logger.error('Lỗi findByBackupId:', error);
      throw error;
    }
  }

  async insertToNewDb(data) {
    try {
      const fields = Object.keys(data);
      const escapedFields = fields.map(field => 
        field.toLowerCase() === 'group' ? '[group]' : field
      ).join(', ');

      const values = fields.map((_, i) => `@param${i}`).join(', ');

      const query = `
        INSERT INTO ${this.newSchema}.${this.newTable} (${escapedFields}) 
        VALUES (${values})
      `;

      const request = this.newPool.request();

      fields.forEach((field, i) => {
        let value = data[field];

        if (value === undefined || value === null) {
          request.input(`param${i}`, mssql.NVarChar, null);
          return;
        }

        if (field === 'created_at') {
          const dateVal = new Date(value);
          request.input(`param${i}`, mssql.DateTime2, isNaN(dateVal.getTime()) ? null : dateVal);
        } else if (field === 'status') {
          request.input(`param${i}`, mssql.Int, value);
        } else {
          request.input(`param${i}`, mssql.NVarChar, value);
        }
      });

      await request.query(query);
      return true;
    } catch (error) {
      logger.error('Lỗi insert vào file_relations2:', error);
      throw error;
    }
  }
}

module.exports = FileRelationsModel;