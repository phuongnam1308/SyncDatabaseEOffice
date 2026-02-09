const BaseModel = require('./BaseModel');

class IncommingBackupBeforeTestModel extends BaseModel {
  constructor() {
    super();
    this.schema = 'dbo';
    this.table = 'incomming_documents';
  }

  async backupFields() {
    const query = `
      UPDATE ${this.schema}.${this.table}
      SET
        status_code_bef_test = status_code,
        sender_unit_bef_test = sender_unit,
        receiver_unit_bef_test = receiver_unit
      WHERE tb_bak = 'incomming_documents2';

      SELECT @@ROWCOUNT AS affected;
    `;
    const result = await this.queryNewDb(query);
    return result[0]?.affected || 0;
  }

  async countData() {
    const query = `
      SELECT COUNT(*) AS total
      FROM ${this.schema}.${this.table}
      WHERE tb_bak = 'incomming_documents2'
    `;
    const result = await this.queryNewDb(query);
    return result[0]?.total || 0;
  }
}

module.exports = IncommingBackupBeforeTestModel;
