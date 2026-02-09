const BaseModel = require('./BaseModel');

class TaskAuditTestModel extends BaseModel {

  async getTaskIds() {
    const sql = `
      SELECT DISTINCT t.id
      FROM camunda.dbo.task t
      INNER JOIN camunda.dbo.task_users tu ON tu.task_id = t.id
      ORDER BY t.id
    `;
    return this.queryNewDb(sql);
  }

  async existsAudit(taskId) {
    const sql = `
      SELECT 1
      FROM camunda.dbo.audit
      WHERE document_id = @taskId
        AND table_backups = 'test_task'
    `;
    const rs = await this.queryNewDb(sql, { taskId });
    return rs.length > 0;
  }

  async insertAudit(data) {
    const sql = `
      INSERT INTO camunda.dbo.audit (
        document_id,[time],user_id,display_name,[role],
        action_code,from_node_id,to_node_id,details,
        origin_id,created_by,receiver,receiver_unit,
        group_,roleProcess,[action],deadline,
        stage_status,curStatusCode,
        created_at,updated_at,
        type_document,processed_by,
        table_backups,acting_as
      ) VALUES (
        @document_id,GETDATE(),@user_id,@display_name,@role,
        @action_code,@from_node_id,@to_node_id,@details,
        @origin_id,@created_by,@receiver,@receiver_unit,
        @group_,@roleProcess,@action,@deadline,
        @stage_status,@curStatusCode,
        GETDATE(),GETDATE(),
        @type_document,@processed_by,
        'test_task',@acting_as
      )
    `;

    return this.newPool.request()
      .input('document_id', data.document_id)
      .input('user_id', data.user_id)
      .input('display_name', data.display_name)
      .input('role', data.role)
      .input('action_code', data.action_code)
      .input('from_node_id', data.from_node_id)
      .input('to_node_id', data.to_node_id)
      .input('details', data.details)
      .input('origin_id', data.origin_id)
      .input('created_by', data.created_by)
      .input('receiver', data.receiver)
      .input('receiver_unit', data.receiver_unit)
      .input('group_', data.group_)
      .input('roleProcess', data.roleProcess)
      .input('action', data.action)
      .input('deadline', data.deadline)
      .input('stage_status', data.stage_status)
      .input('curStatusCode', data.curStatusCode)
      .input('type_document', data.type_document)
      .input('processed_by', data.processed_by)
      .input('acting_as', data.acting_as)
      .query(sql);
  }
}

module.exports = TaskAuditTestModel;
