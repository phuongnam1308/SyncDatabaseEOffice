// models/TaskUsersMappingModel.js
const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');
const mssql = require('mssql');

class TaskUsersMappingModel extends BaseModel {
  constructor() {
    super();
    this.sourceTable = 'task2';
    this.targetTable = 'task_users2';
    this.schema = 'dbo';
  }

  async getMappingData() {
    try {
      const query = `
        SELECT 
          t.id AS new_task_id,
          t.id_taskBackups AS id_task_bak
        FROM ${this.schema}.${this.sourceTable} t
        WHERE t.id_taskBackups IS NOT NULL
        ORDER BY t.id_taskBackups
      `;
      return await this.queryNewDb(query); // vì cả 2 bảng đều ở DiOffice
    } catch (error) {
      logger.error('Lỗi lấy dữ liệu mapping từ task2:', error);
      throw error;
    }
  }

  async countTasksWithBackupId() {
    const query = `
      SELECT COUNT(*) 
      FROM ${this.schema}.${this.sourceTable}
      WHERE id_taskBackups IS NOT NULL
    `;
    const result = await this.queryNewDb(query);
    return result[0][''] || 0;
  }

  async countUsersWithoutTaskId() {
    const query = `
      SELECT COUNT(*) 
      FROM ${this.schema}.${this.targetTable}
      WHERE task_id IS NULL
    `;
    const result = await this.queryNewDb(query);
    return result[0][''] || 0;
  }

  async updateTaskIdInBatch(updates) {
    if (!updates.length) return 0;

    try {
      const request = this.newPool.request();

      // Chuẩn bị parameters cho từng dòng
      updates.forEach((item, index) => {
        request.input(`bak${index}`, mssql.NVarChar(255), item.id_task_bak);
        request.input(`newid${index}`, mssql.NVarChar(255), item.new_task_id);
      });

      // Tạo câu lệnh UPDATE với CASE
      let caseStatement = '';
      let params = [];

      updates.forEach((item, index) => {
        caseStatement += `WHEN id_task_bak = @bak${index} THEN @newid${index} `;
        params.push(`@bak${index}`);
      });

      const query = `
        UPDATE ${this.schema}.${this.targetTable}
        SET task_id = CASE id_task_bak
          ${caseStatement}
          ELSE task_id
        END
        WHERE id_task_bak IN (${params.join(', ')})
      `;

      const result = await request.query(query);
      return result.rowsAffected[0] || 0;
    } catch (error) {
      logger.error('Lỗi update batch task_id vào task_users2:', error);
      throw error;
    }
  }

  async getStatistics() {
    const totalTasksWithBak = await this.countTasksWithBackupId();
    const usersWithoutTaskId = await this.countUsersWithoutTaskId();

    return {
      tasksWithBackupId: totalTasksWithBak,
      taskUsersWithoutTaskId: usersWithoutTaskId,
      estimatedRemaining: usersWithoutTaskId
    };
  }
}

module.exports = TaskUsersMappingModel;