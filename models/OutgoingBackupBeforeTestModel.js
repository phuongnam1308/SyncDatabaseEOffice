const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');

class OutgoingBackupBeforeTestModel extends BaseModel {
  constructor() {
    super();
    this.schema = 'dbo';
    this.table = 'outgoing_documents';
  }

  async backupFields(limit) {
    const query = `
      UPDATE TOP (${limit}) ${this.schema}.${this.table}
      SET
        status_code_bak_bef_test = status_code,
        send_id_bak_bef_test = sender_unit,
        drafter_bak_bef_test = drafter
      WHERE
        status_code_bak_bef_test IS NULL
        AND send_id_bak_bef_test IS NULL
        AND drafter_bak_bef_test IS NULL;

      SELECT @@ROWCOUNT AS affected;
    `;
    const result = await this.queryNewDb(query);
    return result[0]?.affected || 0;
  }
  
  async countNeedBackup() {
    const query = `
      SELECT COUNT(*) AS total
      FROM ${this.schema}.${this.table}
      WHERE
        status_code_bak_bef_test IS NULL
        OR send_id_bak_bef_test IS NULL
        OR drafter_bak_bef_test IS NULL
    `;
    const result = await this.queryNewDb(query);
    return result[0]?.total || 0;
  }
}

module.exports = OutgoingBackupBeforeTestModel;
