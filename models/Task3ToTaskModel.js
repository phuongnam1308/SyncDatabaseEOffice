const BaseModel = require('./BaseModel');

class Task3ToTaskModel extends BaseModel {
  constructor() {
    super();
    this.schema = 'dbo';
    this.sourceTable = 'task3'; // tb_bak
    this.targetTable = 'task';
  }

  async countSource() {
    const sql = `
      SELECT COUNT(1) AS total
      FROM ${this.schema}.${this.sourceTable}
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

  async findByBackupId(backupId) {
    const sql = `
      SELECT id
      FROM ${this.schema}.${this.targetTable}
      WHERE id_taskBackups = @backupId
    `;
    const rs = await this.queryNewDb(sql, { backupId });
    return rs.length ? rs[0] : null;
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
    fields.forEach((f, i) => req.input(`p${i}`, data[f] ?? null));
    await req.query(sql);
  }
}

module.exports = Task3ToTaskModel;
