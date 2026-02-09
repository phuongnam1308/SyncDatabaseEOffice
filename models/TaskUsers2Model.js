// models/TaskUsers2Model.js
const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');
const mssql = require('mssql');

class TaskUsers2Model extends BaseModel {
  constructor() {
    super();
    this.oldTable = 'TaskVBDenPermission';
    this.oldJoinTable = 'UserField';
    this.oldSchema = 'dbo';
    this.newTable = 'task_users2';
    this.newSchema = 'dbo';
  }

  async getAllFromOldDb() {
    try {
      const query = `
        SELECT 
          p.TaskId,
          p.UserId,
          p.UserType,
          p.Modified,
          uf.ModuleId,
          uf.Description,
          uf.Name AS UserFieldName,
          uf.Split
        FROM ${this.oldSchema}.${this.oldTable} p
        INNER JOIN ${this.oldSchema}.${this.oldJoinTable} uf
          ON p.UserFieldId = uf.ID
        ORDER BY p.TaskId, p.UserId
      `;
      return await this.queryOldDb(query);
    } catch (error) {
      logger.error('Lỗi lấy dữ liệu TaskVBDenPermission + UserField:', error);
      throw error;
    }
  }

  async countOldDb() {
    // Đếm join để chính xác
    const query = `
      SELECT COUNT(*)
      FROM ${this.oldSchema}.TaskVBDenPermission p
      INNER JOIN ${this.oldSchema}.UserField uf ON p.UserFieldId = uf.ID
    `;
    const result = await this.queryOldDb(query);
    return result[0][''] || 0;
  }

  async findByBackupKeys(taskIdBak, userIdBak) {
    try {
      const query = `
        SELECT id
        FROM ${this.newSchema}.${this.newTable}
        WHERE id_task_bak = @taskIdBak
          AND userId_bak = @userIdBak
      `;
      const result = await this.queryNewDb(query, { taskIdBak, userIdBak });
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      logger.error('Lỗi tìm task_users2 theo id_task_bak + userId_bak:', error);
      throw error;
    }
  }

  async insertToNewDb(data) {
    try {
      const fields = Object.keys(data);
      const escapedFields = fields.map(f => 
        ['role', 'type', 'action', 'order'].includes(f.toLowerCase()) ? `[${f}]` : f
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

        if (value === undefined || value === null) {
          request.input(`param${i}`, mssql.NVarChar, null);
          return;
        }

        if (['update_at', 'created_at'].includes(field)) {
          // Đảm bảo là string ISO hoặc null
          const dateStr = typeof value === 'string' ? value : new Date(value).toISOString();
          request.input(`param${i}`, mssql.NVarChar(255), dateStr);
        } else {
          request.input(`param${i}`, mssql.NVarChar(500), String(value));
        }
      });

      await request.query(query);
      return true;
    } catch (error) {
      logger.error('Lỗi insert vào task_users2:', error);
      throw error;
    }
  }

  async countNewDb() {
    return await this.count(this.newTable, this.newSchema, false);
  }
}

module.exports = TaskUsers2Model;