const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');
const mssql = require('mssql');

class FileRelationsModel extends BaseModel {
  constructor() {
    super();

    // ===== DB NGUỒN =====
    this.oldDatabase = 'DiOffice';
    this.oldSchema = 'dbo';
    this.oldTable = 'files2';

    // ===== DB ĐÍCH =====
    this.newDatabase = 'DiOffice';
    this.newSchema = 'dbo';
    this.newTable = 'file_relations2';
  }

  async getAllFromOldDb() {
    const query = `
      SELECT
        id,
        id_bak,
        created_at,
        table_bak,
        type_doc
      FROM ${this.oldSchema}.${this.oldTable}
      WHERE id_bak IS NOT NULL
      ORDER BY id
    `;
    return this.queryOldDb(query);
  }

  async countOldDb() {
    return this.count(this.oldTable, this.oldSchema, true);
  }

  async countNewDb() {
    return this.count(this.newTable, this.newSchema, false);
  }

  async findByBackupId(backupId) {
    const query = `
      SELECT id
      FROM ${this.newSchema}.${this.newTable}
      WHERE object_id = @backupId
    `;
    const rs = await this.queryNewDb(query, { backupId });
    return rs.length ? rs[0] : null;
  }

  async insertToNewDb(row) {
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
      INSERT INTO ${this.newSchema}.${this.newTable}
      (${fields.join(',')})
      VALUES (${params})
    `;

    const req = this.newPool.request();
    fields.forEach((f, i) => {
      req.input(`p${i}`, mssql.NVarChar, data[f] ?? null);
    });

    await req.query(sql);
  }
}

module.exports = FileRelationsModel;
