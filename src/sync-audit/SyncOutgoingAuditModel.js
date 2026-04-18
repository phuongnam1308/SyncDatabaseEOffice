// SyncOutgoingAuditModel.js
// Mô hình đồng bộ chuyên biệt cho VĂN BẢN ĐI.
// Kế thừa SyncAuditModel và mở rộng thêm logic sync vào 2 bảng mới:
//   - outgoing_assignment   : lưu phân công theo từng receiver / role
//   - outgoing_current_state: lưu trạng thái hiện tại (mới nhất) của văn bản
const SyncAuditModel = require('./SyncAuditModel');
const logger = require('../../utils/logger');

// ── Các stage_status quan trọng ──────────────────────────────────────────────
const STAGE = {
  // Văn bản hoàn tất phát hành
  BAN_HANH: 'BAN_HANH',
  DA_BAN_HANH: 'DA_BAN_HANH',
  // Văn bản đã được hoàn thành phê duyệt nội dung
  DA_XU_LY: 'DA_XU_LY',
  // Văn bản đang chờ hoàn thiện thể thức
  HT_VBTT: 'HT_VBTT',
  BAN_HANH_DU_THAO: 'BAN_HANH_DU_THAO',
  // Trả lại
  TRA_LAI: 'TRA_LAI',
};

// action_code tương ứng với sự kiện "tạo văn bản" → is_creator = 1
const CREATOR_ACTION_CODES = new Set(['CREATE', 'TONG_HOP', 'SOAN_THAO']);

class SyncOutgoingAuditModel extends SyncAuditModel {
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
          `[SyncOutgoingAuditModel] sync phụ thất bại doc=${documentId} originId=${rawRecord?.ID}: ${err.message}`
        );
      }
    }

    return result;
  }


  // ---------------------------------------------------------------------------
  // _syncToAssignment
  // Upsert vào outgoing_assignment cho mỗi receiver và receiver_unit.
  // PK: (document_id, receiver, role_process)
  // ---------------------------------------------------------------------------
  async _syncToAssignment(audit, auditId, transaction) {
    const {
      document_id, time, receiver, receiver_unit, created_by,
      roleProcess, stage_status, action_code
    } = audit;

    if (!document_id) return;

    try {
      // 1. Xoá toàn bộ assignment của document
      await this.queryNewDbTx(
        `DELETE FROM ${process.env.NEW_DB_NAME}.dbo.outgoing_assignment  WITH (ROWLOCK) 
        WHERE document_id = @document_id`,
        { document_id },
        transaction
      );

      // 2. Validate dữ liệu chính
      if (!stage_status || !roleProcess) return;

      const isCreator = CREATOR_ACTION_CODES?.has(action_code) ? 1 : 0;

      const allReceivers = [
        ...(receiver ? [{ rec: receiver || created_by, unit: receiver_unit || null }] : []),
        ...(receiver_unit && receiver_unit !== receiver
          ? [{ rec: receiver_unit, unit: receiver_unit }]
          : [])
      ];

      if (allReceivers.length === 0) return;

      // 3. Loại duplicate (receiver + role)
      const uniqueKeys = new Set();

      for (const { rec, unit } of allReceivers) {
        if (!rec) continue;

        const key = `${rec}_${roleProcess}`;
        if (uniqueKeys.has(key)) continue;
        uniqueKeys.add(key);

        await this.queryNewDbTx(
          `INSERT INTO ${process.env.NEW_DB_NAME}.dbo.outgoing_assignment  WITH (ROWLOCK) 
          (document_id, receiver, role_process, stage_status,
            created_at, last_audit_id, receiver_unit, is_creator, table_backups)
          VALUES (@document_id, @receiver, @role_process, @stage_status,
                  @created_at, @last_audit_id, @receiver_unit, @is_creator, @table_backups)`,
          {
            document_id,
            receiver: String(rec).substring(0, 100),
            role_process: String(roleProcess).substring(0, 50),
            stage_status: String(stage_status).substring(0, 50),
            created_at: time || new Date(),
            last_audit_id: auditId || null,
            receiver_unit: unit ? String(unit).substring(0, 100) : null,
            is_creator: isCreator,
            table_backups: 'outgoing_assignment',
          },
          transaction
        );
      }

    } catch (err) {
      logger.error(`[SyncOutgoingAuditModel] Sync assignment failed: doc=${document_id}`, err);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // _syncToCurrentState
  // Upsert vào outgoing_current_state (1 record / document).
  // Chỉ cập nhật nếu audit này là MỚI HƠN bản hiện tại (theo time).
  // Flags tích luỹ: has_ban_hanh, has_da_xu_ly, has_ht_vbtt không bao giờ reset về 0.
  // ---------------------------------------------------------------------------
  async _syncToCurrentState(audit, auditId, transaction) {
    const {
      document_id, time, receiver, receiver_unit, created_by,
      roleProcess, stage_status, action_code
    } = audit;

    if (!document_id || !stage_status) return;

    const stageUp = (stage_status || '').toUpperCase();
    const isBanHanh = (stageUp === STAGE.BAN_HANH || stageUp === STAGE.DA_BAN_HANH) ? 1 : 0;
    const isDaXuLy = stageUp === STAGE.DA_XU_LY ? 1 : 0;
    const isHtVbtt = (stageUp === STAGE.HT_VBTT || stageUp === STAGE.BAN_HANH_DU_THAO) ? 1 : 0;
    const isCompleted = isBanHanh;

    const currentReceiver = receiver || receiver_unit || created_by;

    await this.queryNewDbTx(
      `MERGE ${process.env.NEW_DB_NAME}.dbo.outgoing_current_state  WITH (ROWLOCK)  AS tgt
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
           -- flags tích luỹ: chỉ set lên 1, không reset về 0
           has_ban_hanh          = CASE WHEN @has_ban_hanh  = 1 THEN 1 ELSE tgt.has_ban_hanh  END,
           has_da_xu_ly          = CASE WHEN @has_da_xu_ly  = 1 THEN 1 ELSE tgt.has_da_xu_ly  END,
           has_ht_vbtt           = CASE WHEN @has_ht_vbtt   = 1 THEN 1 ELSE tgt.has_ht_vbtt   END,
           is_completed_doc      = CASE WHEN @is_completed  = 1 THEN 1 ELSE tgt.is_completed_doc END,
           last_da_xu_ly_audit_id= CASE WHEN @has_da_xu_ly  = 1 THEN @last_audit_id ELSE tgt.last_da_xu_ly_audit_id END,
           has_tra_lai_after_da_xu_ly = CASE
             WHEN @action_code = 'TRA_LAI' AND tgt.has_da_xu_ly = 1 THEN 1
             ELSE tgt.has_tra_lai_after_da_xu_ly
           END,
           updated_at            = SYSDATETIME()
       WHEN NOT MATCHED THEN
         INSERT (
           document_id, current_stage_status, current_action_code,
           current_receiver, current_role_process,
           last_audit_id, last_audit_time,
           has_ban_hanh, has_da_xu_ly, has_ht_vbtt,
           is_completed_doc, last_da_xu_ly_audit_id, has_tra_lai_after_da_xu_ly,
           has_open_workitem, is_transfer_to_room, updated_at, table_backups
         )
         VALUES (
           @document_id, @stage_status, @action_code,
           @receiver, @role_process,
           @last_audit_id, @audit_time,
           @has_ban_hanh, @has_da_xu_ly, @has_ht_vbtt,
           @is_completed, CASE WHEN @has_da_xu_ly = 1 THEN @last_audit_id ELSE NULL END, 0,
           0, 0, SYSDATETIME(), @table_backups
         );`,
      {
        document_id,
        stage_status: String(stage_status).substring(0, 100),
        action_code: action_code ? String(action_code).substring(0, 100) : null,
        receiver: currentReceiver ? String(currentReceiver).substring(0, 100) : null,
        role_process: roleProcess ? String(roleProcess).substring(0, 100) : null,
        last_audit_id: auditId || null,
        audit_time: time,
        has_ban_hanh: isBanHanh,
        has_da_xu_ly: isDaXuLy,
        has_ht_vbtt: isHtVbtt,
        is_completed: isCompleted,
        table_backups: 'outgoing_current_state',
      },
      transaction
    );
    logger.info(`[SyncOutgoingAuditModel] Sync current_state success: doc=${document_id} status=${stage_status}`);
  }

  // ---------------------------------------------------------------------------
  // Override fetchByDocumentId để chỉ lấy category văn bản đi
  // (giống fetchByOutgoingDocumentId của parent)
  // ---------------------------------------------------------------------------
  async fetchByDocumentId(oldDocumentId) {
    return this.fetchByOutgoingDocumentId(oldDocumentId);
  }
}

module.exports = SyncOutgoingAuditModel;
