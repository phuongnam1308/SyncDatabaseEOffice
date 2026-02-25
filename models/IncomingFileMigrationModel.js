// models/IncomingFileMigrationModel.js
const BaseModel = require('./BaseModel');

class IncomingFileMigrationModel extends BaseModel {
  constructor() {
    super();
    this.oldTable = 'VanBanDen';
    this.oldSchema = 'dbo';
    this.newTable = 'files2';
    this.newSchema = 'dbo';
  }

  async getOldFiles() {
    const sql = `
      SELECT
        ID,
        Files,
        TrichYeu,
        Created,
        Modified,
        CreatedBy,
        ChenSo,
        SoTrang,
        LoaiVanBan
      FROM DataEOfficeSNP.dbo.VanBanDen
      WHERE Files IS NOT NULL
    `;
    return this.queryOldDb(sql);
  }

  async insertFile(data) {
    const fields = Object.keys(data);
    const values = fields.map((_, i) => `@p${i}`).join(',');

    const sql = `
      INSERT INTO camunda.dbo.files2 (${fields.join(',')})
      VALUES (${values})
    `;

    const req = this.newPool.request();
    fields.forEach((f, i) => req.input(`p${i}`, data[f]));
    await req.query(sql);
  }
}

module.exports = IncomingFileMigrationModel;
