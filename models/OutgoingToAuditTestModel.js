const BaseModel = require('./BaseModel');

class OutgoingToAuditTestModel extends BaseModel {
  constructor() {
    super();
    this.schema = 'dbo';
  }

  async getOutgoingTestData() {
    const query = `
      SELECT document_id, created_at
      FROM camunda.dbo.outgoing_documents
      WHERE table_backup = 'outgoing_documents2'
    `;
    return this.queryNewDb(query);
  }

  async insertAudit(data) {
    const query = `
      INSERT INTO camunda.dbo.audit (
        document_id, [time], user_id, display_name, [role],
        action_code, from_node_id, to_node_id, details,
        origin_id, created_by, receiver, receiver_unit,
        group_, roleProcess, [action], deadline,
        stage_status, curStatusCode,
        created_at, updated_at,
        type_document, processed_by, table_backups
      ) VALUES (
        @document_id, @time, @user_id, NULL, @role,
        @action_code, NULL, 'Gateway_0wb5flm', NULL,
        @origin_id, @created_by, @receiver, @receiver_unit,
        NULL, @roleProcess, @action, NULL,
        @stage_status, 1,
        GETDATE(), GETDATE(),
        'OutgoingDocument', NULL, 'test'
      )
    `;

    return this.queryNewDb(query, data);
  }
}

module.exports = OutgoingToAuditTestModel;
