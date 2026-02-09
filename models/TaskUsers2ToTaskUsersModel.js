// models/TaskUsers2ToTaskUsersModel.js
const BaseModel = require('./BaseModel');

class TaskUsers2ToTaskUsersModel extends BaseModel {
  constructor() {
    super();
    this.schema = 'dbo';
    this.sourceTable = 'task_users2';
    this.targetTable = 'task_users';
  }

  async countSource() {
    const sql = `
      SELECT COUNT(1) AS total
      FROM ${this.schema}.${this.sourceTable}
    `;
    const rs = await this.queryNewDb(sql);
    return rs[0]?.total || 0;
  }

  async countTarget() {
    const sql = `
      SELECT COUNT(1) AS total
      FROM ${this.schema}.${this.targetTable}
      WHERE table_bak = 'task_users2'
    `;
    const rs = await this.queryNewDb(sql);
    return rs[0]?.total || 0;
  }

  async getAllSource() {
    const sql = `
      SELECT *
      FROM ${this.schema}.${this.sourceTable}
      ORDER BY id
    `;
    return await this.queryNewDb(sql);
  }

  async existsByBackup(taskIdBak, userIdBak) {
    const sql = `
      SELECT id
      FROM ${this.schema}.${this.targetTable}
      WHERE id_task_bak = @taskIdBak
        AND userId_bak = @userIdBak
        AND table_bak = 'task_users2'
    `;
    const rs = await this.queryNewDb(sql, { taskIdBak, userIdBak });
    return rs.length > 0;
  }

  // 🔥 MAP ID CŨ → ID MỚI (FIX FK)
  async findNewTaskIdByBackupId(taskIdBak) {
    const sql = `
      SELECT id
      FROM dbo.task
      WHERE id_taskBackups = @taskIdBak
    `;
    const rs = await this.queryNewDb(sql, { taskIdBak });
    return rs.length ? rs[0].id : null;
  }

  async insertTarget(data) {
    const fields = Object.keys(data);
    const columns = fields.map(f => `[${f}]`).join(', ');
    const params = fields.map((_, i) => `@p${i}`).join(', ');

    const sql = `
      INSERT INTO ${this.schema}.${this.targetTable}
      (${columns})
      VALUES (${params})
    `;

    const req = this.newPool.request();
    fields.forEach((f, i) => {
      req.input(`p${i}`, data[f] ?? null);
    });

    await req.query(sql);
  }
}

module.exports = TaskUsers2ToTaskUsersModel;
