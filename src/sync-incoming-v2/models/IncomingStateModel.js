// IncomingStateModel.js
// Mô hình đồng bộ chuyên biệt cho VĂN BẢN ĐẾN (trạng thái và phân công).
const BaseModel = require('../../../models/BaseModel');
const logger = require('../../../utils/logger');

class IncomingStateModel extends BaseModel {
  constructor() {
    super();
  }

  // ---------------------------------------------------------------------------
  // Đồng bộ audit sang incomming_assignment bằng Batch Queries
  // ---------------------------------------------------------------------------
  async syncAssignment(documentId, transaction = null) {
    if (!documentId) return null;

    try {
      // Xóa toàn bộ assignment cũ của văn bản để insert mới (tránh lock contention khi UPDATE/MERGE)
      // Sử dụng ROW_NUMBER để lấy bản ghi mới nhất cho mỗi (receiver, role_process), 
      // tránh lỗi trùng Primary Key khi 1 người có nhiều audit.
      const assignmentQuery = `
        DELETE FROM ${process.env.NEW_DB_NAME}.dbo.incomming_assignment 
        WHERE document_id = @document_id;

        WITH LatestAssignments AS (
          SELECT 
            document_id, 
            COALESCE(receiver, receiver_unit, created_by) AS receiver, 
            roleProcess AS role_process, 
            stage_status, 
            created_at, 
            id AS last_audit_id,
            SYSDATETIME() AS updated_at,
            'incomming_assignment' AS table_backups,
            ROW_NUMBER() OVER (
              PARTITION BY COALESCE(receiver, receiver_unit, created_by), roleProcess 
              ORDER BY [time] DESC, id DESC
            ) as rn
          FROM ${process.env.NEW_DB_NAME}.dbo.audit WITH (NOLOCK)
          WHERE document_id = @document_id 
            AND COALESCE(receiver, receiver_unit, created_by) IS NOT NULL 
            AND roleProcess IS NOT NULL 
            AND stage_status IS NOT NULL
        )
        INSERT INTO ${process.env.NEW_DB_NAME}.dbo.incomming_assignment (
          document_id, receiver, role_process, stage_status, created_at, last_audit_id, updated_at, table_backups
        )
        SELECT 
          document_id, receiver, role_process, stage_status, created_at, last_audit_id, updated_at, table_backups
        FROM LatestAssignments
        WHERE rn = 1;
      `;
      
      await this.queryNewDbTx(assignmentQuery, { document_id: documentId }, transaction);
    } catch (err) {
      logger.error(`[IncomingStateModel] syncAssignment failed: doc=${documentId}`, err);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Đồng bộ audit sang incomming_current_state bằng Batch Queries
  // ---------------------------------------------------------------------------
  async syncCurrentState(documentId, transaction = null) {
    if (!documentId) return null;

    try {
      // Xóa state cũ và insert state mới (lấy audit có id lớn nhất)
      const currentStateQuery = `
        DELETE FROM ${process.env.NEW_DB_NAME}.dbo.incomming_current_state 
        WHERE document_id = @document_id;

        INSERT INTO ${process.env.NEW_DB_NAME}.dbo.incomming_current_state (
          document_id, current_stage_status, current_action_code, current_receiver, current_role_process,
          last_audit_id, last_audit_time, is_completed_doc, has_open_workitem, is_transfer_to_room, updated_at, table_backups
        )
        SELECT TOP 1
          document_id,
          stage_status AS current_stage_status,
          action_code AS current_action_code,
          COALESCE(receiver, receiver_unit, created_by) AS current_receiver,
          roleProcess AS current_role_process,
          id AS last_audit_id,
          [time] AS last_audit_time,
          CASE WHEN UPPER(stage_status) = 'HOAN_THANH_VAN_BAN' THEN 1 ELSE 0 END AS is_completed_doc,
          0 AS has_open_workitem,
          0 AS is_transfer_to_room,
          SYSDATETIME() AS updated_at,
          'incomming_current_state' AS table_backups
        FROM ${process.env.NEW_DB_NAME}.dbo.audit WITH (NOLOCK)
        WHERE document_id = @document_id AND stage_status IS NOT NULL
        ORDER BY id DESC;
      `;
      
      await this.queryNewDbTx(currentStateQuery, { document_id: documentId }, transaction);
    } catch (err) {
      logger.error(`[IncomingStateModel] syncCurrentState failed: doc=${documentId}`, err);
      throw err;
    }
  }
}

module.exports = IncomingStateModel;
