// models/FileRelations2Model.js
const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');
const mssql = require('mssql');

class FileRelations2Model extends BaseModel {
  constructor() {
    super();
    this.oldTable = 'files2';
    this.oldSchema = 'dbo';
    this.newTable = 'file_relations2';
    this.newSchema = 'dbo';
  }

  // THÊM: Hàm lấy data theo page (paging để tránh load all với data lớn)
  async getFromOldDbPaged(page = 0, pageSize = 1000) {
    try {
      const query = `
        SELECT 
          id,
          file_name,
          file_path,
          mime_type,
          file_size,
          description,
          is_directory,
          parent_id,
          created_by,
          created_at,
          updated_at,
          status,
          version,
          is_signed_file,
          number_of_signed_file,
          storage_path,
          storage_type,
          isNumbered,
          typeSize,
          id_bak,
          table_bak,
          type_doc,
          isBak,
          nguoikyvanban
        FROM ${this.oldSchema}.${this.oldTable}
        ORDER BY id
        OFFSET @offset ROWS
        FETCH NEXT @pageSize ROWS ONLY
      `;
      const offset = page * pageSize;
      logger.info(`Chạy query getFromOldDbPaged trên DiOffice: page=${page}, offset=${offset}, pageSize=${pageSize}`);
      return await this.queryNewDb(query, { offset, pageSize });
    } catch (error) {
      logger.error('Lỗi lấy danh sách files2 paged từ DB cũ:', error);
      throw error;
    }
  }

  // SỬA: Giữ hàm cũ nhưng khuyên không dùng cho data lớn (hoặc comment out nếu không cần)
  async getAllFromOldDb() {
    logger.warn('Cảnh báo: getAllFromOldDb không nên dùng cho data lớn (>100k records). Sử dụng getFromOldDbPaged thay thế.');
    try {
      const query = `
        SELECT 
          id,
          file_name,
          file_path,
          mime_type,
          file_size,
          description,
          is_directory,
          parent_id,
          created_by,
          created_at,
          updated_at,
          status,
          version,
          is_signed_file,
          number_of_signed_file,
          storage_path,
          storage_type,
          isNumbered,
          typeSize,
          id_bak,
          table_bak,
          type_doc,
          isBak,
          nguoikyvanban
        FROM ${this.oldSchema}.${this.oldTable}
        ORDER BY id
      `;
      return await this.queryNewDb(query);  // Giữ dùng newDb
    } catch (error) {
      logger.error('Lỗi lấy danh sách files2 từ DB cũ:', error);
      throw error;
    }
  }

  async countOldDb() {
    try {
      logger.info(`Đếm bản ghi bảng old: ${this.oldSchema}.${this.oldTable} trong DiOffice`);
      const query = `SELECT COUNT(*) AS Total FROM ${this.oldSchema}.${this.oldTable}`;
      const result = await this.queryNewDb(query);
      return result[0].Total;
    } catch (error) {
      logger.error('Lỗi đếm bản ghi old:', error);
      throw error;
    }
  }

  async findByBackupId(backupId) {
    try {
      const query = `
        SELECT id
        FROM ${this.newSchema}.${this.newTable}
        WHERE object_id_bak = @backupId
      `;
      const result = await this.queryNewDb(query, { backupId });
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      logger.error('Lỗi tìm file_relations2 theo object_id_bak:', error);
      throw error;
    }
  }

  async insertToNewDb(data) {
    try {
      logger.info('Dữ liệu sắp insert vào file_relations2:', JSON.stringify(data, (k, v) => v instanceof Date ? v.toISOString() : v, 2));

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
          request.input(`param${i}`, mssql.NVarChar, null);
        } else if (['created_at', 'updated_at'].includes(field)) {
          const dateValue = new Date(value);
          request.input(`param${i}`, mssql.DateTime2, isNaN(dateValue.getTime()) ? null : dateValue);
        } else {
          request.input(`param${i}`, value);
        }
      });

      await request.query(query);
      return true;
    } catch (error) {
      logger.error('Lỗi insert vào file_relations2:', error);
      throw error;
    }
  }

  async countNewDb() {
    return await this.count(this.newTable, this.newSchema, false);
  }
}

module.exports = FileRelations2Model;