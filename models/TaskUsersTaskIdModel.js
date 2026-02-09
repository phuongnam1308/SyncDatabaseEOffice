// models/TaskUsersTaskIdModel.js
const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');
const mssql = require('mssql');

class TaskUsersTaskIdModel extends BaseModel {
  constructor() {
    super();
    this.schema = 'dbo';
    this.taskTable = 'task2';
    this.usersTable = 'task_users2';
  }

  async countUsersWithoutTaskId() {
    try {
      const query = `
        SELECT COUNT(*) AS cnt
        FROM ${this.schema}.${this.usersTable}
        WHERE task_id IS NULL
          AND id_task_bak IS NOT NULL
      `;
      const result = await this.queryNewDb(query);
      return result[0].cnt || 0;
    } catch (err) {
      logger.error('Lỗi đếm task_users2 chưa có task_id:', err);
      throw err;
    }
  }

  async getPendingUpdates(limit = 1000) {
    try {
      const query = `
        SELECT TOP ${limit}
          u.id AS users_row_id,          -- để debug nếu cần
          u.id_task_bak,
          t.id AS new_task_id
        FROM ${this.schema}.${this.usersTable} u
        INNER JOIN ${this.schema}.${this.taskTable} t
          ON u.id_task_bak = t.id_taskBackups
        WHERE u.task_id IS NULL
          AND u.id_task_bak IS NOT NULL
          AND t.id_taskBackups IS NOT NULL
        ORDER BY u.id_task_bak
      `;
      return await this.queryNewDb(query);
    } catch (err) {
      logger.error('Lỗi lấy danh sách cần update task_id:', err);
      throw err;
    }
  }

  async updateTaskIdBatch(updates) {
    if (!updates || updates.length === 0) return 0;

    const request = this.newPool.request();

    let caseWhen = '';
    const params = [];

    updates.forEach((item, idx) => {
      const bakParam = `bak${idx}`;
      const idParam = `id${idx}`;
      request.input(bakParam, mssql.NVarChar(255), item.id_task_bak);
      request.input(idParam, mssql.NVarChar(255), item.new_task_id);

      caseWhen += `WHEN id_task_bak = @${bakParam} THEN @${idParam} `;
      params.push(`@${bakParam}`);
    });

    const query = `
      UPDATE ${this.schema}.${this.usersTable}
      SET task_id = CASE ${caseWhen} END,
          update_at = GETDATE()          -- tùy chọn: cập nhật thời gian
      WHERE id_task_bak IN (${params.join(', ')})
        AND task_id IS NULL
    `;

    try {
      const result = await request.query(query);
      return result.rowsAffected[0] || 0;
    } catch (err) {
      logger.error('Lỗi update batch task_id:', err);
      throw err;
    }
  }

  async getStatistics() {
    const pending = await this.countUsersWithoutTaskId();
    return {
      pendingUpdates: pending,
      message: pending > 0 
        ? `Còn ${pending.toLocaleString()} dòng task_users2 cần gán task_id`
        : 'Đã gán task_id cho tất cả dòng có id_task_bak hợp lệ'
    };
  }
}

module.exports = TaskUsersTaskIdModel;