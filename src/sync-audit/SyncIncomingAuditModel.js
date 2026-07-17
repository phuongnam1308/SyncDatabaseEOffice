// SyncIncomingAuditModel.js
// Mô hình đồng bộ chuyên biệt cho VĂN BẢN ĐI.
// Kế thừa SyncAuditModel và mở rộng thêm logic sync vào 2 bảng mới:
//   - incomming_assignment   : lưu phân công theo từng receiver / role
//   - incomming_current_state: lưu trạng thái hiện tại (mới nhất) của văn bản
const SyncAuditModel = require('./SyncAuditModel');
const logger = require('../../utils/logger');

// ── Các stage_status quan trọng ──────────────────────────────────────────────
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

const CREATOR_ACTION_CODES = new Set(['CREATE', 'TONG_HOP', 'SOAN_THAO']);

const { isRetryableSqlError } = require('../../utils/dbUtils');

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
      }
    } catch (err) {
      if (isRetryableSqlError(err)) {
        throw err;
      }
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
    const rawAction      = this._normalizeTextField(rawRecord.HanhDong);
    const currentTrangThai = this._normalizeTextField(rawRecord.TrangThai);
    const parsed         = await this.receiverParser.determineReceivers(rawRecord, transaction);
    const receiverIds    = parsed.receiverIds || [];
    const receiverUnitIds = parsed.receiverUnitIds || [];
    const roleProcess    = parsed.roleProcess || 'VANTHU';

    const userProfile  = await this.helper.findUserByBakId(user_id, transaction);
    const userPosition = userProfile?.position || '';
    const workflowMap  = this._determineUserRoleAndScreen(userPosition, currentTrangThai, rawAction);
    const actionParsed = this.helper.parseActionString(user_id, rawRecord.HanhDong) || {};

    return {
      document_id:   documentId,
      time,
      receiver:      receiverIds,
      receiver_unit: receiverUnitIds,
      roleProcess:   workflowMap.role || roleProcess || actionParsed.roleProcess || null,
      stage_status:  workflowMap.stage_status || actionParsed.stage_status || null,
      action_code:   workflowMap.action_code  || actionParsed.action_code  || null,
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
      document_id,
      time,
      receiver,
      receiver_unit,
      roleProcess,
      stage_status,
      deadline,
      action_code,
    } = mapped;

    if (!document_id || !stage_status || !roleProcess) return;

    const isCreator = CREATOR_ACTION_CODES.has(action_code) ? 1 : 0;

    // receiver cá nhân
    const individualReceivers = Array.isArray(receiver)
      ? receiver
      : [];

    // receiver đơn vị
    const unitReceivers = Array.isArray(receiver_unit)
      ? receiver_unit
      : [];

    // gom tất cả assignment cần sync
    const assignments = [
      ...individualReceivers.map(r => ({
        rec: r,
        unit: unitReceivers[0] || null,
      })),
      ...unitReceivers.map(u => ({
        rec: u,
        unit: u,
      })),
    ];

    // deduplicate theo receiver + role
    const seen = new Set();

    for (const { rec, unit } of assignments) {
      if (!rec) continue;

      const key = `${rec}|${roleProcess}`;
      if (seen.has(key)) continue;
      seen.add(key);

      await this.queryNewDbTx(
        `MERGE ${process.env.NEW_DB_NAME}.dbo.incomming_assignment AS tgt
        USING (
          SELECT
            @document_id AS document_id,
            @receiver AS receiver,
            @role_process AS role_process
        ) AS src
        ON tgt.document_id = src.document_id
        AND tgt.receiver = src.receiver
        AND tgt.role_process = src.role_process

        WHEN MATCHED THEN
          UPDATE SET
            stage_status = @stage_status,
            deadline = @deadline,
            last_audit_id = @last_audit_id,
            updated_at = SYSDATETIME()

        WHEN NOT MATCHED THEN
          INSERT (
            document_id,
            receiver,
            role_process,
            stage_status,
            deadline,
            created_at,
            last_audit_id
          )
          VALUES (
            @document_id,
            @receiver,
            @role_process,
            @stage_status,
            @deadline,
            @created_at,
            @last_audit_id
          );`,
        {
          document_id,
          receiver: String(rec).substring(0, 100),
          role_process: String(roleProcess).substring(0, 50),
          stage_status: String(stage_status).substring(0, 50),
          deadline: deadline || null,
          created_at: time,
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
      document_id,
      time,
      receiver,
      receiver_unit,
      roleProcess,
      stage_status,
      action_code,
      deadline,
    } = mapped;

    if (!document_id || !stage_status) return;

    // Ưu tiên receiver cá nhân, fallback sang đơn vị
    const receiverStr =
      (Array.isArray(receiver)
        ? receiver[0]
        : receiver)
      ||
      (Array.isArray(receiver_unit)
        ? receiver_unit[0]
        : receiver_unit)
      ||
      null;

    const stageUp = String(stage_status || '').toUpperCase();

    const isCompleted =
      stageUp === STAGE.BAN_HANH ||
      stageUp === STAGE.DA_BAN_HANH
        ? 1
        : 0;

    const params = {
      document_id: String(document_id).substring(0, 100),

      stage_status: String(stage_status).substring(0, 100),

      action_code: action_code
        ? String(action_code).substring(0, 100)
        : null,

      receiver: receiverStr
        ? String(receiverStr).substring(0, 100)
        : null,

      role_process: roleProcess
        ? String(roleProcess).substring(0, 100)
        : null,

      deadline: deadline || null,

      last_audit_id: auditId || null,

      audit_time: time || new Date(),

      is_completed: isCompleted,
    };

    await this.queryNewDbTx(
      `
      -- 1. Update nếu đã tồn tại
      UPDATE tgt WITH (UPDLOCK, ROWLOCK)
      SET
        current_stage_status = @stage_status,
        current_action_code = @action_code,
        current_receiver = @receiver,
        current_role_process = @role_process,
        current_deadline = @deadline,
        last_audit_id = @last_audit_id,
        last_audit_time = @audit_time,

        -- completed chỉ bật lên 1, không reset
        is_completed_doc =
          CASE
            WHEN @is_completed = 1
            THEN 1
            ELSE tgt.is_completed_doc
          END,

        updated_at = SYSDATETIME()

      FROM ${process.env.NEW_DB_NAME}.dbo.incomming_current_state tgt
      WHERE tgt.document_id = @document_id
        AND (
          tgt.last_audit_time IS NULL
          OR @audit_time >= tgt.last_audit_time
        );

      -- 2. Nếu chưa tồn tại thì insert
      IF @@ROWCOUNT = 0
      BEGIN
        BEGIN TRY
          INSERT INTO ${process.env.NEW_DB_NAME}.dbo.incomming_current_state (
            document_id,
            current_stage_status,
            current_action_code,
            current_receiver,
            current_role_process,
            current_deadline,
            last_audit_id,
            last_audit_time,
            has_open_workitem,
            is_transfer_to_room,
            is_completed_doc,
            updated_at
          )
          VALUES (
            @document_id,
            @stage_status,
            @action_code,
            @receiver,
            @role_process,
            @deadline,
            @last_audit_id,
            @audit_time,
            0,
            0,
            @is_completed,
            SYSDATETIME()
          );
        END TRY
        BEGIN CATCH
          -- duplicate PK do race condition Promise.all
          IF ERROR_NUMBER() NOT IN (2601, 2627)
            THROW;
        END CATCH
      END
      `,
      params,
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
