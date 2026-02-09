const BaseModel = require('./BaseModel');
const mssql = require('mssql');

class FileRelationsModel extends BaseModel {
  constructor() {
    super();
    this.schema = 'dbo';
    this.filesTable = 'files2';
    this.relationsTable = 'file_relations2';
  }

  async getAllFiles() {
    console.log('[MODEL] getAllFiles');
    console.log('[MODEL] TABLE =', `${this.schema}.${this.filesTable}`);

    const sql = `
      SELECT id, id_bak, created_at, table_bak, type_doc
      FROM ${this.schema}.${this.filesTable}
      WHERE id_bak IS NOT NULL
      ORDER BY id
    `;

    console.log('[MODEL] SQL =', sql);

    const rows = await this.queryNewDb(sql);
    console.log('[MODEL] rows =', rows.length);

    return rows;
  }

  async countFiles() {
    return this.count(this.filesTable, this.schema);
  }

  async countRelations() {
    return this.count(this.relationsTable, this.schema);
  }

  async findByBackupId(backupId) {
    const sql = `
      SELECT id
      FROM ${this.schema}.${this.relationsTable}
      WHERE object_id = @backupId
    `;
    const rs = await this.queryNewDb(sql, { backupId });
    return rs.length ? rs[0] : null;
  }

  async insertRelation(row) {
    console.log('[MODEL] insertRelation id_bak =', row.id_bak);

    const data = {
      object_type: null,
      object_id: row.id_bak,
      file_id: row.id,
      created_at: row.created_at,
      status: '1',
      object_id_bak: null,
      file_id_bak: row.id_bak,
      file_id_bak2: null,
      table_bak: row.table_bak,
      type_doc: row.type_doc
    };

    const fields = Object.keys(data);
    const params = fields.map((_, i) => `@p${i}`).join(',');

    const sql = `
      INSERT INTO ${this.schema}.${this.relationsTable}
      (${fields.join(',')})
      VALUES (${params})
    `;

    console.log('[MODEL] INSERT SQL =', sql);

    const req = this.newPool.request();
    fields.forEach((f, i) => {
      req.input(`p${i}`, mssql.NVarChar, data[f]);
    });

    await req.query(sql);
  }
}

module.exports = FileRelationsModel;
