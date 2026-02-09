const BaseModel = require('./BaseModel');

class IncommingAuditCreateModel extends BaseModel {
  constructor() {
    super();
    this.schema = 'dbo';
  }

  async getIncommingDocs() {
    const query = `
      SELECT document_id, sender_unit, receiver_unit
      FROM ${this.schema}.incomming_documents
      WHERE tb_bak = 'incomming_documents2'
    `;
    return this.queryNewDb(query);
  }

  async insertAudit(data) {
    const query = `
      INSERT INTO ${this.schema}.audit (
        document_id, [time], user_id, display_name, [role],
        action_code, to_node_id, origin_id,
        created_by, receiver, receiver_unit,
        group_, roleProcess, [action],
        stage_status, curStatusCode,
        created_at, updated_at,
        type_document, table_backups
      ) VALUES (
        @document_id, GETDATE(), @user_id, @display_name, @role,
        @action_code, @to_node_id, @origin_id,
        @created_by, @receiver, @receiver_unit,
        @group_, @roleProcess, @action,
        @stage_status, @curStatusCode,
        GETDATE(), GETDATE(),
        @type_document, @table_backups
      )
    `;
    return this.queryNewDb(query, data);
  }
}

module.exports = IncommingAuditCreateModel;
