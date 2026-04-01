// SyncIncomingAuditModel.js
// Mô hình đồng bộ chuyên biệt cho VĂN BẢN ĐẾN.
// Kế thừa SyncAuditModel và mở rộng thêm logic sync vào 2 bảng mới:
//   - incomming_assignment   : lưu phân công theo từng receiver / role
//   - incomming_current_state: lưu trạng thái hiện tại (mới nhất) của văn bản
const SyncAuditModel = require('./SyncAuditModel');
const logger = require('../../utils/logger');

// ── Các stage_status quan trọng ──────────────────────────────────────────────
// TODO: Cần kiểm tra lại các stage_status này cho phù hợp với Văn bản đến
const STAGE = {
  // Văn bản hoàn tất phát hành
  BAN_HANH:       'BAN_HANH',
  DA_BAN_HANH:    'DA_BAN_HANH',
  // Văn bản đã được hoàn thành phê duyệt nội dung
  DA_XU_LY:       'DA_XU_LY',
  // Văn bản đang chờ hoàn thiện thể thức
  HT_VBTT:        'HT_VBTT',
  BAN_HANH_DU_THAO: 'BAN_HANH_DU_THAO',
  HOAN_THANH_VAN_BAN: 'HOAN_THANH_VAN_BAN',
  // Trả lại
  TRA_LAI:        'TRA_LAI',
};

// action_code tương ứng với sự kiện "tạo văn bản" → is_creator = 1
// TODO: Cần kiểm tra mã action_code cho văn bản đến để xác định "is_creator" chính xác
const CREATOR_ACTION_CODES = new Set(['CREATE', 'TONG_HOP', 'SOAN_THAO']);

class SyncIncomingAuditModel extends SyncAuditModel {
  // ---------------------------------------------------------------------------
  // OVERRIDE: processSingleRecord
  // Sau khi parent đã upsert vào bảng audit, tiếp tục cập nhật 2 bảng phụ.
  // ---------------------------------------------------------------------------
  async processSingleRecord(rawRecord, documentId, transaction = null) {
    if (!rawRecord || !documentId) return null;

    // 1. Gọi parent thực hiện upsert vào bảng audit (trả về { inserted, updated, results })
    const result = await super.processSingleRecord(rawRecord, documentId, transaction);

    // 2. Nếu có kết quả audit, tiếp tục cập nhật các bảng phụ
    if (result && Array.isArray(result.results) && result.results.length > 0) {
      try {
        // Lưu vết các receiver đã xử lý trong record này để tránh duplicate assignment (nếu có)
        const processedReceivers = new Set();

        for (const res of result.results) {
          const { audit, id: auditId } = res;
          if (!audit || !auditId) continue;

          // 2a. Sync vào bảng assignment cho từng receiver đơn lẻ
          // audit ở đây đã được expand nên receiver/receiver_unit là giá trị đơn
          const recKey = `${audit.receiver}|${audit.receiver_unit}|${audit.roleProcess}`;
          if (!processedReceivers.has(recKey)) {
            await this._syncToAssignment(audit, auditId, transaction);
            processedReceivers.add(recKey);
          }

          // 2b. Sync vào current_state. Vì MERGE trong _syncToCurrentState có check @audit_time >= last_audit_time
          // nên row cuối cùng (hoặc row có time lớn nhất) sẽ được giữ lại làm trạng thái hiện tại.
          await this._syncToCurrentState(audit, auditId, transaction);
        }
      } catch (err) {
        // Lỗi bảng phụ không được làm hỏng toàn bộ luồng
        logger.warn(
          `[SyncIncomingAuditModel] sync phụ thất bại doc=${documentId} originId=${rawRecord?.ID}: ${err.message}`
        );
      }
    }

    return result;
  }


  // ---------------------------------------------------------------------------
  // _syncToAssignment
  // Upsert vào incomming_assignment cho mỗi receiver và receiver_unit.
  // PK: (document_id, receiver, role_process)
  // ---------------------------------------------------------------------------
  async _syncToAssignment(audit, auditId, transaction) {
    const {
      document_id, created_at, receiver, receiver_unit,
      roleProcess, stage_status
    } = audit;

    if (!document_id) return;

    try {
      // 1. Xoá toàn bộ assignment của document
      await this.queryNewDbTx(
        `DELETE FROM ${process.env.NEW_DB_NAME}.dbo.incomming_assignment
        WHERE document_id = @document_id`,
        { document_id },
        transaction
      );

      // 2. Validate input chính
      if (!stage_status || !roleProcess) return;

      const allReceivers = [receiver, receiver_unit].filter(Boolean);
      if (allReceivers.length === 0) return;

      // 3. Loại duplicate receiver + role
      const uniqueKeys = new Set();

      for (const rec of allReceivers) {
        const key = `${rec}_${roleProcess}`;
        if (uniqueKeys.has(key)) continue;
        uniqueKeys.add(key);

        await this.queryNewDbTx(
          `INSERT INTO ${process.env.NEW_DB_NAME}.dbo.incomming_assignment
          (document_id, receiver, role_process, stage_status,
            created_at, last_audit_id, table_backups)
          VALUES (@document_id, @receiver, @role_process, @stage_status,
                  @created_at, @last_audit_id, @table_backups)`,
          {
            document_id,
            receiver:      String(rec).substring(0, 100),
            role_process:  String(roleProcess).substring(0, 50),
            stage_status:  String(stage_status).substring(0, 50),
            created_at:    created_at || new Date(),
            last_audit_id: auditId || null,
            table_backups: 'incomming_assignment',
          },
          transaction
        );
      }

    } catch (err) {
      logger.error(`[SyncIncomingAuditModel] Sync assignment failed: doc=${document_id}`, err);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // _syncToCurrentState
  // Upsert vào incomming_current_state (1 record / document).
  // Chỉ cập nhật nếu audit này là MỚI HƠN bản hiện tại (theo time).
  // ---------------------------------------------------------------------------
  async _syncToCurrentState(audit, auditId, transaction) {
    const {
      document_id, time, receiver, receiver_unit,
      roleProcess, stage_status, action_code
    } = audit;

    if (!document_id || !stage_status) return;

    const stageUp  = (stage_status || '').toUpperCase();
    // Văn bản đến được coi là hoàn tất khi ở trạng thái DA_XU_LY
    const isCompleted = (stageUp === STAGE.HOAN_THANH_VAN_BAN) ? 1 : 0;
    // Ưu tiên hiển thị cá nhân làm receiver chính trong current_state
    const currentReceiver = receiver || receiver_unit;

    // SCHEMA incomming_current_state: document_id, current_stage_status, current_action_code, current_receiver, current_role_process, current_deadline, last_audit_id, last_audit_time, is_transfer_to_room, has_open_workitem, is_completed_doc, updated_at
    await this.queryNewDbTx(
      `MERGE ${process.env.NEW_DB_NAME}.dbo.incomming_current_state AS tgt
       USING (SELECT @document_id AS document_id) AS src
       ON tgt.document_id = src.document_id
       WHEN MATCHED AND (@audit_time > tgt.last_audit_time OR (@audit_time = tgt.last_audit_time AND @last_audit_id >= tgt.last_audit_id) OR tgt.last_audit_time IS NULL) THEN
         UPDATE SET
           current_stage_status  = @stage_status,
           current_action_code   = @action_code,
           current_receiver      = @receiver,
           current_role_process  = @role_process,
           last_audit_id         = @last_audit_id,
           last_audit_time       = @audit_time,
           is_completed_doc      = CASE WHEN @is_completed  = 1 THEN 1 ELSE tgt.is_completed_doc END,
           updated_at            = SYSDATETIME()
       WHEN NOT MATCHED THEN
         INSERT (
           document_id, current_stage_status, current_action_code,
           current_receiver, current_role_process,
           last_audit_id, last_audit_time,
           is_completed_doc, has_open_workitem, is_transfer_to_room, updated_at, table_backups
         )
         VALUES (
           @document_id, @stage_status, @action_code,
           @receiver, @role_process,
           @last_audit_id, @audit_time,
           @is_completed, 0, 0, SYSDATETIME(), @table_backups
         );`,
      {
        document_id,
        stage_status:  String(stage_status).substring(0, 100),
        action_code:   action_code ? String(action_code).substring(0, 100) : null,
        receiver:      currentReceiver ? String(currentReceiver).substring(0, 100) : null,
        role_process:  roleProcess ? String(roleProcess).substring(0, 100) : null,
        last_audit_id: auditId || null,
        audit_time:    time,
        is_completed:  isCompleted,
        table_backups: 'incomming_current_state',
      },
      transaction
    );
    logger.info(`[SyncIncomingAuditModel] Sync current_state success: doc=${document_id} status=${stage_status}`);
  }

  // ---------------------------------------------------------------------------
  // Override fetchByDocumentId để chỉ lấy category văn bản đi
  // (giống fetchByIncomingDocumentId của parent)
  // ---------------------------------------------------------------------------
  async fetchByDocumentId(oldDocumentId) {
    return this.fetchByIncomingDocumentId(oldDocumentId);
  }
}

module.exports = SyncIncomingAuditModel;
