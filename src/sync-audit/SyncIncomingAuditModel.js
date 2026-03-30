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

    // 1. Gọi parent thực hiện upsert vào bảng audit (không thay đổi)
    const result = await super.processSingleRecord(rawRecord, documentId, transaction);

    // 2. Lấy audit row vừa được insert/update để lấy id thực tế từ DB
    //    (parent trả về { inserted, updated } chứ không return id,
    //     nên ta tự query lại dựa trên origin_id)
    try {
      const auditId = await this._getAuditIdByOrigin(String(rawRecord.ID), transaction);
      const mapped  = await this._buildMappedForIncoming(rawRecord, documentId, transaction);

      if (mapped) {
        await this._syncToAssignment(mapped, auditId, transaction);
        await this._syncToCurrentState(mapped, auditId, transaction);
        
        // Cập nhật status_code cho bảng chính nếu có mapping từ config
        if (mapped.status_code) {
          await this._updateDocumentStatusCode(documentId, 'IncommingDocument', mapped.status_code, transaction);
        }
      }
    } catch (err) {
      // Lỗi bảng phụ không được làm hỏng toàn bộ luồng
      logger.warn(
        `[SyncIncomingAuditModel] sync phụ thất bại doc=${documentId} originId=${rawRecord?.ID}: ${err.message}`
      );
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Tìm audit.id bằng origin_id (ID gốc từ CSDL cũ)
  // ---------------------------------------------------------------------------
  async _getAuditIdByOrigin(originId, transaction) {
    if (!originId) return null;
    const rows = await this.queryNewDbTx(
      `SELECT TOP 1 id FROM ${process.env.NEW_DB_NAME}.${this.newDbSchema}.audit
       WHERE origin_id = @origin_id AND table_backups = @table_backups`,
      { origin_id: originId, table_backups: this.oldDbTable },
      transaction
    );
    return rows?.[0]?.id ?? null;
  }

  // ---------------------------------------------------------------------------
  // Build mapped object chứa những trường cần thiết cho 2 bảng phụ.
  // Tái dụng logic từ parent._mapSingleRecord nhưng không insert lại audit.
  // ---------------------------------------------------------------------------
  async _buildMappedForIncoming(rawRecord, documentId, transaction) {
    if (!rawRecord?.ID || !documentId) return null;

    const parsedTime     = this.helper.parseDate(rawRecord.NgayTao);
    const time           = parsedTime || new Date();
    const user_id        = (await this.helper.mapUserName(rawRecord.NguoiXuLy, transaction))
                           || process.env.VANTHU_USER_ID;
    const userProfile  = await this.helper.findUserByBakId(user_id, transaction);
    const userPosition = userProfile?.position || '';
    const currentTrangThai = this._normalizeTextField(rawRecord.TrangThai);
    const rawAction      = this._normalizeTextField(rawRecord.HanhDong);
    const parsed         = await this.receiverParser.determineReceivers(rawRecord, transaction);
    const receiverIds    = parsed.receiverIds || [];
    const receiverUnitIds = parsed.receiverUnitIds || [];
    const roleProcess    = parsed.roleProcess || 'VANTHU';

    // determineUserRoleAndScreen tự động dùng parsedRole và parsedActionCode (nếu có)
    const actionParsed = this.helper.parseActionString(user_id, rawRecord.HanhDong) || {};
    const parsedActionCode = actionParsed.action_code || null;

    const workflowMap = this._determineUserRoleAndScreen(
      userPosition, 
      currentTrangThai, 
      rawAction, 
      'IncommingDocument', // Phải dùng double 'm' theo table schema
      parsed.parsedRole,
      parsedActionCode
    );

    return {
      document_id:   documentId,
      time,
      receiver:      receiverIds,
      receiver_unit: receiverUnitIds,
      roleProcess:   workflowMap.role || roleProcess || actionParsed.roleProcess || null,
      stage_status:  workflowMap.stage_status || actionParsed.stage_status || null,
      action_code:   workflowMap.action_code  || actionParsed.action_code  || null,
      status_code:   workflowMap.status_code  || null, // Lấy status_code từ config
      deadline:      rawRecord.HanXuLy ? this.helper.parseDate(rawRecord.HanXuLy) : null,
      user_id,
    };
  }

  // ---------------------------------------------------------------------------
  // _syncToAssignment
  // Upsert vào incomming_assignment cho mỗi receiver và receiver_unit.
  // PK: (document_id, receiver, role_process)
  // ---------------------------------------------------------------------------
  async _syncToAssignment(mapped, auditId, transaction) {
    const {
      document_id, time, receiver, receiver_unit,
      roleProcess, stage_status, deadline
    } = mapped;

    if (!document_id || !stage_status || !roleProcess) return;

    // SCHEMA incomming_assignment: (document_id, receiver, role_process)
    // Gộp tất cả đối tượng nhận (cá nhân và đơn vị) vào danh sách chung
    const allReceivers = [
      ...(Array.isArray(receiver) ? receiver : []),
      ...(Array.isArray(receiver_unit) ? receiver_unit : [])
    ];

    // Lọc trùng và loại bỏ rỗng
    const uniqueReceivers = [...new Set(allReceivers.filter(Boolean))];

    for (const rec of uniqueReceivers) {
      // PK: (document_id, receiver, role_process)
      await this.queryNewDbTx(
        `MERGE ${process.env.NEW_DB_NAME}.dbo.incomming_assignment AS tgt
         USING (SELECT
           @document_id      AS document_id,
           @receiver         AS receiver,
           @role_process     AS role_process
         ) AS src
         ON  tgt.document_id  = src.document_id
         AND tgt.receiver     = src.receiver
         AND tgt.role_process = src.role_process
         WHEN MATCHED THEN
           UPDATE SET
             stage_status   = @stage_status,
             deadline       = @deadline,
             last_audit_id  = @last_audit_id,
             updated_at     = SYSDATETIME()
         WHEN NOT MATCHED THEN
           INSERT (document_id, receiver, role_process, stage_status,
                   deadline, created_at, last_audit_id)
           VALUES (@document_id, @receiver, @role_process, @stage_status,
                   @deadline, @created_at, @last_audit_id);`,
        {
          document_id,
          receiver:      String(rec).substring(0, 100),
          role_process:  String(roleProcess).substring(0, 50),
          stage_status:  String(stage_status).substring(0, 50),
          deadline:      deadline || null,
          created_at:    time,
          last_audit_id: auditId || null,
        },
        transaction
      );
    }
  }

  // ---------------------------------------------------------------------------
  // _syncToCurrentState
  // Upsert vào incomming_current_state (1 record / document).
  // Chỉ cập nhật nếu audit này là MỚI HƠN bản hiện tại (theo time).
  // ---------------------------------------------------------------------------
  async _syncToCurrentState(mapped, auditId, transaction) {
    const {
      document_id, time, receiver, receiver_unit,
      roleProcess, stage_status, action_code, deadline
    } = mapped;

    if (!document_id || !stage_status) return;

    const stageUp  = (stage_status || '').toUpperCase();
    // Văn bản đến được coi là hoàn tất khi ở trạng thái DA_XU_LY
    const isCompleted = (stageUp === STAGE.DA_XU_LY) ? 1 : 0;

    const firstReceiver = Array.isArray(receiver) ? (receiver[0] || null) : (receiver || null);
    const firstUnit = Array.isArray(receiver_unit) ? (receiver_unit[0] || null) : (receiver_unit || null);
    // Ưu tiên hiển thị cá nhân làm receiver chính trong current_state
    const currentReceiver = firstReceiver || firstUnit;

    // SCHEMA incomming_current_state: document_id, current_stage_status, current_action_code, current_receiver, current_role_process, current_deadline, last_audit_id, last_audit_time, is_transfer_to_room, has_open_workitem, is_completed_doc, updated_at
    await this.queryNewDbTx(
      `MERGE ${process.env.NEW_DB_NAME}.dbo.incomming_current_state AS tgt
       USING (SELECT @document_id AS document_id) AS src
       ON tgt.document_id = src.document_id
       WHEN MATCHED AND (@audit_time >= tgt.last_audit_time OR tgt.last_audit_time IS NULL) THEN
         UPDATE SET
           current_stage_status  = @stage_status,
           current_action_code   = @action_code,
           current_receiver      = @receiver,
           current_role_process  = @role_process,
           current_deadline      = @deadline,
           last_audit_id         = @last_audit_id,
           last_audit_time       = @audit_time,
           is_completed_doc      = CASE WHEN @is_completed  = 1 THEN 1 ELSE tgt.is_completed_doc END,
           updated_at            = SYSDATETIME()
       WHEN NOT MATCHED THEN
         INSERT (
           document_id, current_stage_status, current_action_code,
           current_receiver, current_role_process, current_deadline,
           last_audit_id, last_audit_time,
           is_completed_doc, has_open_workitem, is_transfer_to_room, updated_at
         )
         VALUES (
           @document_id, @stage_status, @action_code,
           @receiver, @role_process, @deadline,
           @last_audit_id, @audit_time,
           @is_completed, 0, 0, SYSDATETIME()
         );`,
      {
        document_id,
        stage_status:  String(stage_status).substring(0, 100),
        action_code:   action_code ? String(action_code).substring(0, 100) : null,
        receiver:      currentReceiver ? String(currentReceiver).substring(0, 100) : null,
        role_process:  roleProcess ? String(roleProcess).substring(0, 100) : null,
        deadline:      deadline || null,
        last_audit_id: auditId || null,
        audit_time:    time,
        is_completed:  isCompleted,
      },
      transaction
    );
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
