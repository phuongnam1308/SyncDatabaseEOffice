const BaseModel = require('./BaseModel');

class IncommingBulkUpdateTestModel extends BaseModel {
  constructor() {
    super();
    this.schema = 'dbo';
    this.table = 'incomming_documents';
  }

  async bulkUpdate(fields) {
    const sets = [];
    const params = {};

    if (fields.status_code !== undefined) {
      sets.push('status_code = @status_code');
      params.status_code = fields.status_code;
    }

    if (fields.sender_unit !== undefined) {
      sets.push('sender_unit = @sender_unit');
      params.sender_unit = fields.sender_unit;
    }

    if (fields.receiver_unit !== undefined) {
      sets.push('receiver_unit = @receiver_unit');
      params.receiver_unit = fields.receiver_unit;
    }

    if (!sets.length) return 0;

    const query = `
      UPDATE ${this.schema}.${this.table}
      SET ${sets.join(', ')}
      WHERE tb_bak = 'incomming_documents2';

      SELECT @@ROWCOUNT AS affected;
    `;

    const result = await this.queryNewDb(query, params);
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

module.exports = IncommingBulkUpdateTestModel;
