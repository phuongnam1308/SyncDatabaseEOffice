const BaseModel = require('./BaseModel');

class IncommingBpmnVersionTestModel extends BaseModel {
  constructor() {
    super();
    this.schema = 'dbo';
    this.table = 'incomming_documents';
  }

  async updateBpmnVersion(bpmnVersion) {
    const query = `
      UPDATE ${this.schema}.${this.table}
      SET bpmn_version = @bpmnVersion
      WHERE tb_bak = 'incomming_documents2';

      SELECT @@ROWCOUNT AS affected;
    `;

    const result = await this.queryNewDb(query, { bpmnVersion });
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

module.exports = IncommingBpmnVersionTestModel;
