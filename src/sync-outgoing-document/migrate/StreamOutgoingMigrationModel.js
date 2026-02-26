/**
 * StreamOutgoingMigrationModel.js
 *
 * ════════════════════════════════════════════════════════════════
 * LUỒNG ĐỒNG BỘ MỚI (document-centric):
 * ────────────────────────────────────────────────────────────────
 *
 *  Thay vì migrate từng bảng độc lập (audit → audit_sync, comment → comment_sync,
 *  document → document_sync, rồi apply từng bảng vào main), luồng mới là:
 *
 *  [OLD DB]
 *    ↓ fetchBatch(documents)
 *  Với mỗi document:
 *    1. Lấy oldDocumentId (IDVanBan / SoHieuGoiThau / ...)
 *    2. Query TẤT CẢ bảng audit cũ (LuanChuyenVanBan_*)
 *       → processSingleAudit(raw) → migrate vào audit_sync
 *       → applySingleAudit(syncRecord) → apply vào audit (main)
 *    3. Query TẤT CẢ bảng comment cũ (Comments_*)
 *       → processSingleComment(raw) → migrate vào document_comments_sync
 *       → applySingleComment(syncRecord) → apply vào document_comments (main)
 *    4. Migrate document → document_sync (insertBatchToNewDb)
 *    5. Apply document_sync → document main (insertBatchToMain via SyncOutgoingModel)
 *
 * ════════════════════════════════════════════════════════════════
 */

'use strict';

const BaseModel = require("../../../models/BaseModel");
const logger = require("../../../utils/logger");
const sql = require("mssql");
const MigrationHelper = require("../../helpers/MigrationHelper");

// Related sync models
const StreamOutgoingAuditSyncModel  = require("../../sync-audit/migrate/StreamAuditMigrationModel");
const StreamCommentMigrationModel   = require("../../sync-document-comment/migration/StreamCommentMigrationModel");
const SyncAuditModel                = require("../../sync-audit/apply/SyncAuditModel");
const SyncCommentModel              = require("../../sync-document-comment/apply/SyncCommentModel");

// Danh sách bảng audit và comment trong DB cũ
const AUDIT_MIGRATION_TABLES = [
  'LuanChuyenVanBan',
  'LuanChuyenVanBan_ATPC',
  'LuanChuyenVanBan_CLL',
  'LuanChuyenVanBan_CNTT',
  'LuanChuyenVanBan_CT',
  'LuanChuyenVanBan_CVTC',
  'LuanChuyenVanBan_DonVi',
  'LuanChuyenVanBan_DVHH',
  'LuanChuyenVanBan_DVKT',
  'LuanChuyenVanBan_GNVT',
  'LuanChuyenVanBan_HC',
  'LuanChuyenVanBan_HT',
  'LuanChuyenVanBan_ICDLB',
  'LuanChuyenVanBan_ICDST',
  'LuanChuyenVanBan_KHDT',
  'LuanChuyenVanBan_KHKD',
  'LuanChuyenVanBan_KTVT',
  'LuanChuyenVanBan_KVTC',
  'LuanChuyenVanBan_MKT',
  'LuanChuyenVanBan_NPL',
  'LuanChuyenVanBan_QLCT',
  'LuanChuyenVanBan_QSBV',
  'LuanChuyenVanBan_SNPL',
  'LuanChuyenVanBan_TC',
  'LuanChuyenVanBan_TC189',
  'LuanChuyenVanBan_TCCT',
  'LuanChuyenVanBan_TCHP',
  'LuanChuyenVanBan_TCIDI',
  'LuanChuyenVanBan_TCLD',
  'LuanChuyenVanBan_TCMT',
  'LuanChuyenVanBan_TCO',
  'LuanChuyenVanBan_TCOT',
  'LuanChuyenVanBan_TCPC',
  'LuanChuyenVanBan_TCPH',
  'LuanChuyenVanBan_TCTT',
  'LuanChuyenVanBan_TTDDC',
  'LuanChuyenVanBan_TTDTC',
  'LuanChuyenVanBan_VP',
  'LuanChuyenVanBan_VPMB',
  'LuanChuyenVanBan_VPTNB',
  'LuanChuyenVanBan_VTB',
  'LuanChuyenVanBan_VTT',
  'LuanChuyenVanBan_XDCT',
  'LuanChuyenVanBan_xdsm',
  'LuanChuyenVanBan_XNCG',
  'LuanChuyenVanBan_YTE',
];

const COMMENT_MIGRATION_TABLES = [
  'Comments',
  'Comments_ATPC',
  'Comments_CLL',
  'Comments_CNTT',
  'Comments_CT',
  'Comments_CVTC',
  'Comments_DonVi',
  'Comments_DVHH',
  'Comments_DVKT',
  'Comments_GNVT',
  'Comments_HC',
  'Comments_HT',
  'Comments_ICDLB',
  'Comments_ICDST',
  'Comments_KHDT',
  'Comments_KHKD',
  'Comments_KTVT',
  'Comments_KVTC',
  'Comments_MKT',
  'Comments_NPL',
  'Comments_QLCT',
  'Comments_QSBV',
  'Comments_SNPL',
  'Comments_TC',
  'Comments_TC189',
  'Comments_TCCT',
  'Comments_TCHP',
  'Comments_TCIDI',
  'Comments_TCLD',
  'Comments_TCMT',
  'Comments_TCO',
  'Comments_TCOT',
  'Comments_TCPC',
  'Comments_TCPH',
  'Comments_TCTT',
  'Comments_TTDDC',
  'Comments_TTDTC',
  'Comments_VP',
  'Comments_VPMB',
  'Comments_VPTNB',
  'Comments_VTB',
  'Comments_VTT',
  'Comments_XDCT',
  'Comments_xdsm',
  'Comments_XNCG',
  'Comments_YTE',
];

class StreamOutgoingMigrationModel extends BaseModel {
  constructor() {
    super();
    this.oldDbSchema  = "dbo";
    this.oldDbTable   = "VanBanDi";         // bảng văn bản đi trong DB cũ
    this.newDbSchema  = "dbo";
    this.newDbTable   = "outgoing_documents_sync";
    this.helper       = new MigrationHelper(this.queryNewDbTx.bind(this));

    // Lazy-init: các model liên quan được khởi tạo trong initialize()
    this._auditMigrationModels  = [];   // StreamOutgoingAuditSyncModel[]
    this._commentMigrationModels = [];  // StreamCommentMigrationModel[]
    this._syncAuditModel        = null; // SyncAuditModel
    this._syncCommentModel      = null; // SyncCommentModel
  }

  /**
   * Khởi tạo model và tất cả các related model.
   * Phải được gọi trước khi sử dụng.
   */
  async initialize() {
    await super.initialize();

    // Khởi tạo apply models (sync → main)
    this._syncAuditModel = new SyncAuditModel();
    await this._syncAuditModel.initialize();

    this._syncCommentModel = new SyncCommentModel();
    await this._syncCommentModel.initialize();

    // Khởi tạo migrate models (old DB → sync)
    for (const table of AUDIT_MIGRATION_TABLES) {
      const model = new StreamOutgoingAuditSyncModel(table);
      await model.initialize();
      this._auditMigrationModels.push(model);
    }

    for (const table of COMMENT_MIGRATION_TABLES) {
      const model = new StreamCommentMigrationModel(table);
      await model.initialize();
      this._commentMigrationModels.push(model);
    }

    logger.info(`[StreamOutgoingMigrationModel] Initialized: ${this._auditMigrationModels.length} audit tables, ${this._commentMigrationModels.length} comment tables`);
  }

  // ── Fetch ─────────────────────────────────────────────────────

  /**
   * Lấy một batch văn bản đi từ DB cũ.
   * @param {object} opts
   * @param {number} opts.batch   - Số bản ghi mỗi batch
   * @param {*}      opts.lastId  - Con trỏ phân trang (ID cuối cùng đã xử lý)
   */
  async fetchBatch({ batch, lastId }) {
    const query = `
      SELECT TOP (@batch) *
      FROM ${this.oldDbSchema}.${this.oldDbTable}
      WHERE (@lastId IS NULL OR ID > @lastId)
      ORDER BY ID ASC
    `;
    return this.queryOldDb(query, { batch, lastId: lastId || null });
  }

  // ── Core: per-document sync ───────────────────────────────────

  /**
   * Đồng bộ một văn bản cùng toàn bộ audit và comment liên quan.
   *
   * LUỒNG ĐÚNG — thứ tự quan trọng:
   * ─────────────────────────────────────────────────────────────
   *  Bước 1: Migrate document → outgoing_documents_sync  (trung gian, document_id = NULL)
   *  Bước 2: Apply document   → outgoing_documents       (main, tạo newId)
   *          + cập nhật document_id vào outgoing_documents_sync
   *          ↑ SAU bước này mới có document_id hợp lệ trong sync table
   *
   *  Bước 3: Sync audit liên quan
   *          auditModel._getNewDocumentId() truy vấn outgoing_documents_sync
   *          → lúc này document_id đã được điền → resolve thành công ✅
   *
   *  Bước 4: Sync comment liên quan  (tương tự)
   *
   * KHÔNG thể đảo ngược: nếu audit/comment chạy trước bước 2,
   * _getNewDocumentId() trả về NULL → toàn bộ audit/comment bị skip.
   * ─────────────────────────────────────────────────────────────
   *
   * @param {object} rawDocument - Bản ghi văn bản thô từ DB cũ
   * @returns {Promise<{
   *   document: { inserted: number, updated: number },
   *   audit:    { inserted: number, updated: number, skipped: number },
   *   comment:  { inserted: number, updated: number, skipped: number },
   * }>}
   */
  async processSingleDocument(rawDocument) {
    if (!rawDocument?.ID) {
      return {
        document: { inserted: 0, updated: 0 },
        audit:    { inserted: 0, updated: 0, skipped: 0 },
        comment:  { inserted: 0, updated: 0, skipped: 0 },
      };
    }

    const oldDocumentId = String(rawDocument.ID);
    const stats = {
      document: { inserted: 0, updated: 0 },
      audit:    { inserted: 0, updated: 0, skipped: 0 },
      comment:  { inserted: 0, updated: 0, skipped: 0 },
    };

    // ── Bước 1: Migrate document → outgoing_documents_sync ─────
    // Ghi vào bảng trung gian. document_id vẫn là NULL ở bước này.
    try {
      await this._migrateDocumentToSync(rawDocument);
    } catch (err) {
      logger.error(`[processSingleDocument] Migrate to sync ID=${oldDocumentId} failed: ${err.message}`);
      // Vẫn tiếp tục: nếu đã có record từ lần trước thì bước 2 vẫn resolve được
    }

    // ── Bước 2: Apply document → outgoing_documents (main) ─────
    // INSERT / UPDATE vào bảng chính, đồng thời cập nhật document_id
    // vào outgoing_documents_sync → bước này mới "kích hoạt" document_id.
    // Audit/comment phải đợi sau bước này mới có document_id để resolve.
    let documentApplied = false;
    try {
      const applyResult = await this._applyDocumentToMain(rawDocument);
      stats.document.inserted = applyResult.inserted;
      stats.document.updated  = applyResult.updated;
      documentApplied = true;
    } catch (err) {
      logger.error(`[processSingleDocument] Apply document to main ID=${oldDocumentId} failed: ${err.message}`);
      // Không tiếp tục sync audit/comment nếu document chưa tồn tại trong main
      // vì document_id sẽ không resolve được
      return stats;
    }

    if (!documentApplied) return stats;

    // ── Bước 3: Sync audit liên quan ───────────────────────────
    // Chỉ chạy SAU khi document đã có document_id trong outgoing_documents_sync.
    // auditModel._getNewDocumentId() sẽ truy vấn outgoing_documents_sync
    // và tìm thấy document_id hợp lệ.
    for (const auditModel of this._auditMigrationModels) {
      try {
        const auditRecords = await auditModel.fetchByDocumentId(oldDocumentId);
        if (!auditRecords?.length) continue;

        for (const raw of auditRecords) {
          try {
            // migrate raw → audit_sync
            const syncedAudits = await auditModel.processSingleRecord(raw);
            if (!syncedAudits?.length) { stats.audit.skipped++; continue; }

            // apply audit_sync → audit (main)
            for (const syncRecord of syncedAudits) {
              const applyResult = await this._syncAuditModel.applySingleRecord(
                this._toAuditMainRecord(syncRecord)
              );
              stats.audit.inserted += applyResult.inserted;
              stats.audit.updated  += applyResult.updated;
            }
          } catch (auditErr) {
            stats.audit.skipped++;
            logger.warn(
              `[processSingleDocument] Skip audit table=${auditModel.oldDbTable} docId=${oldDocumentId}: ${auditErr.message}`
            );
          }
        }
      } catch (tableErr) {
        logger.warn(`[processSingleDocument] Audit table=${auditModel.oldDbTable} error: ${tableErr.message}`);
      }
    }

    // ── Bước 4: Sync comment liên quan ──────────────────────────
    // Tương tự: chạy SAU khi document đã có document_id.
    for (const commentModel of this._commentMigrationModels) {
      try {
        const commentRecords = await commentModel.fetchByDocumentId(oldDocumentId);
        if (!commentRecords?.length) continue;

        for (const raw of commentRecords) {
          try {
            // migrate raw → document_comments_sync
            const syncRecord = await commentModel.processSingleRecord(raw);
            if (!syncRecord) { stats.comment.skipped++; continue; }

            // apply document_comments_sync → document_comments (main)
            const applyResult = await this._syncCommentModel.applySingleRecord(
              this._toCommentMainRecord(syncRecord)
            );
            stats.comment.inserted += applyResult.inserted;
            stats.comment.updated  += applyResult.updated;
          } catch (commentErr) {
            stats.comment.skipped++;
            logger.warn(
              `[processSingleDocument] Skip comment table=${commentModel.oldDbTable} docId=${oldDocumentId}: ${commentErr.message}`
            );
          }
        }
      } catch (tableErr) {
        logger.warn(`[processSingleDocument] Comment table=${commentModel.oldDbTable} error: ${tableErr.message}`);
      }
    }

    return stats;
  }

  /**
   * Đồng bộ một batch văn bản.
   * Gọi processSingleDocument() cho từng văn bản trong batch.
   *
   * @param {object[]} records - Mảng các bản ghi văn bản thô từ DB cũ
   * @returns {Promise<{
   *   inserted: number, updated: number, skipped: number,
   *   auditInserted: number, auditUpdated: number, auditSkipped: number,
   *   commentInserted: number, commentUpdated: number, commentSkipped: number,
   * }>}
   */
  async insertBatchToNewDb(records) {
    if (!records?.length) {
      return {
        inserted: 0, updated: 0, skipped: 0,
        auditInserted: 0, auditUpdated: 0, auditSkipped: 0,
        commentInserted: 0, commentUpdated: 0, commentSkipped: 0,
      };
    }

    const totals = {
      inserted: 0, updated: 0, skipped: 0,
      auditInserted: 0, auditUpdated: 0, auditSkipped: 0,
      commentInserted: 0, commentUpdated: 0, commentSkipped: 0,
    };

    for (const raw of records) {
      try {
        const result = await this.processSingleDocument(raw);

        totals.inserted        += result.document.inserted;
        totals.updated         += result.document.updated;
        totals.auditInserted   += result.audit.inserted;
        totals.auditUpdated    += result.audit.updated;
        totals.auditSkipped    += result.audit.skipped;
        totals.commentInserted += result.comment.inserted;
        totals.commentUpdated  += result.comment.updated;
        totals.commentSkipped  += result.comment.skipped;
      } catch (err) {
        totals.skipped++;
        logger.warn(`[StreamOutgoingMigrationModel] Skip document ID=${raw?.ID}: ${err.message}`);
      }
    }

    return totals;
  }

  // ── Private helpers ───────────────────────────────────────────

  /**
   * Migrate bản ghi văn bản vào outgoing_documents_sync.
   * Thực hiện upsert: nếu đã tồn tại (theo id_outgoing_bak) thì UPDATE, ngược lại INSERT.
   *
   * @private
   */
  async _migrateDocumentToSync(raw) {
    if (!raw?.ID) return { inserted: 0, updated: 0 };

    const mapped = await this._mapDocumentRecord(raw);
    if (!mapped) return { inserted: 0, updated: 0 };

    const transaction = await this.beginTransaction();
    try {
      const existing = await this.queryNewDbTx(
        `SELECT TOP 1 id FROM ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable}
         WHERE id_outgoing_bak = @bakId`,
        { bakId: mapped.id_outgoing_bak },
        transaction
      );

      if (existing?.length) {
        await this._updateDocumentSync(mapped, transaction);
        await this.commitTransaction(transaction);
        return { inserted: 0, updated: 1 };
      } else {
        await this._insertDocumentSync(mapped, transaction);
        await this.commitTransaction(transaction);
        return { inserted: 1, updated: 0 };
      }
    } catch (error) {
      await this.rollbackTransaction(transaction);
      throw error;
    }
  }

  /**
   * Apply bản ghi document từ sync sang main (outgoing_documents).
   *
   * @private
   */
  async _applyDocumentToMain(raw) {
    if (!raw?.ID) return { inserted: 0, updated: 0 };

    const oldId = String(raw.ID);
    const transaction = await this.beginTransaction();
    try {
      // Lấy bản ghi từ sync table theo id_outgoing_bak
      const syncRecords = await this.queryNewDbTx(
        `SELECT TOP 1 * FROM ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable}
         WHERE id_outgoing_bak = @bakId`,
        { bakId: oldId },
        transaction
      );

      if (!syncRecords?.length) {
        await this.commitTransaction(transaction);
        return { inserted: 0, updated: 0 };
      }

      const syncRecord = syncRecords[0];

      const existing = await this.queryNewDbTx(
        `SELECT TOP 1 id FROM ${process.env.NEW_DB_NAME}.${this.newDbSchema}.outgoing_documents
         WHERE id_outgoing_bak = @bakId`,
        { bakId: oldId },
        transaction
      );

      if (existing?.length) {
        await this._updateDocumentMain(syncRecord, transaction);
        await this.commitTransaction(transaction);
        return { inserted: 0, updated: 1 };
      } else {
        await this._insertDocumentMain(syncRecord, transaction);
        await this.commitTransaction(transaction);
        return { inserted: 1, updated: 0 };
      }
    } catch (error) {
      await this.rollbackTransaction(transaction);
      throw error;
    }
  }

  /**
   * Chuyển đổi bản ghi từ audit_sync về format phù hợp với bảng audit chính.
   * Map các field từ audit_sync sang audit main table format.
   *
   * @private
   */
  _toAuditMainRecord(syncRecord) {
    return {
      document_id:   syncRecord.document_id?.document_id || syncRecord.document_id,
      time:          syncRecord.time,
      user_id:       syncRecord.user_id,
      display_name:  syncRecord.display_name,
      role:          syncRecord.role           || null,
      action_code:   syncRecord.action_code,
      from_node_id:  syncRecord.from_node_id   || null,
      to_node_id:    syncRecord.to_node_id     || null,
      details:       syncRecord.details        || null,
      origin_id:     syncRecord.origin_id      || null,
      created_by:    syncRecord.user_id,
      receiver:      Array.isArray(syncRecord.receiver)
                       ? syncRecord.receiver.join(',')
                       : (syncRecord.receiver || null),
      receiver_unit: Array.isArray(syncRecord.receiver_unit)
                       ? syncRecord.receiver_unit.join(',')
                       : (syncRecord.receiver_unit || null),
      group_:        syncRecord.group_         || null,
      roleProcess:   syncRecord.roleProcess,
      action:        syncRecord.action         || null,
      deadline:      syncRecord.deadline       || null,
      stage_status:  syncRecord.stage_status,
      curStatusCode: syncRecord.curStatusCode  || null,
      created_at:    syncRecord.created_at     || syncRecord.time,
      updated_at:    syncRecord.updated_at     || null,
      type_document: syncRecord.document_id?.type_document || syncRecord.type_document || null,
      processed_by:  syncRecord.processed_by   || null,
      table_backup:  syncRecord.table_backup   || syncRecord.table_backups,
      acting_as:     syncRecord.acting_as      || null,
    };
  }

  /**
   * Chuyển đổi bản ghi từ document_comments_sync về format phù hợp với bảng comment chính.
   *
   * @private
   */
  _toCommentMainRecord(syncRecord) {
    return {
      document_id:    syncRecord.document_id,
      parent_id:      syncRecord.parent_id    || null,
      user_id:        syncRecord.user_id,
      user_name:      syncRecord.user_name,
      content:        syncRecord.content      || "",
      type:           syncRecord.type,
      created_at:     syncRecord.created_at,
      file_id:        syncRecord.file_id,
      likes:          syncRecord.likes,
      id_comments_bak: syncRecord.id_comments_bak,
      type_bak:       syncRecord.type_bak,
      table_backup:   syncRecord.table_backup,
      parent_id_bak:  syncRecord.parent_id_bak,
      user_id_bak:    syncRecord.user_id_bak,
    };
  }

  /**
   * Map bản ghi văn bản thô từ DB cũ → format cho outgoing_documents_sync.
   * Ghi đè phương thức này để tùy chỉnh mapping theo cấu trúc DB cũ thực tế.
   *
   * @private
   */
  async _mapDocumentRecord(raw) {
    if (!raw?.ID) return null;

    const userId     = await this.helper.mapUserName(raw.NguoiSoan || raw.NguoiTao, null);
    const senderUnit = await this.helper.mapSenderUnitId(raw.DonViGui || raw.CoQuanBanHanh, null);

    return {
      id_outgoing_bak:   String(raw.ID),
      document_id:       null,                             // sẽ được tạo khi apply vào main
      document_number:   raw.SoHieuVanBan   || null,
      document_date:     this.helper.parseDate(raw.NgayBanHanh),
      subject:           raw.TrichYeu       || null,
      sender_user_id:    userId             || null,
      sender_unit_id:    senderUnit         || null,
      created_at:        this.helper.parseDate(raw.NgayTao || raw.Created),
      updated_at:        null,
    };
  }

  async _insertDocumentSync(data, transaction) {
    const query = `
      INSERT INTO ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable} (
        id_outgoing_bak, document_number, document_date, subject,
        sender_user_id, sender_unit_id, created_at, updated_at
      ) VALUES (
        @idOutgoingBak, @documentNumber, @documentDate, @subject,
        @senderUserId, @senderUnitId, @createdAt, GETDATE()
      )
    `;
    await this.queryNewDbTx(query, {
      idOutgoingBak:  data.id_outgoing_bak,
      documentNumber: data.document_number,
      documentDate:   data.document_date,
      subject:        data.subject,
      senderUserId:   data.sender_user_id,
      senderUnitId:   data.sender_unit_id,
      createdAt:      data.created_at,
    }, transaction);
  }

  async _updateDocumentSync(data, transaction) {
    const query = `
      UPDATE ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable}
      SET
        document_number = @documentNumber,
        document_date   = @documentDate,
        subject         = @subject,
        sender_user_id  = @senderUserId,
        sender_unit_id  = @senderUnitId,
        updated_at      = GETDATE()
      WHERE id_outgoing_bak = @idOutgoingBak
    `;
    await this.queryNewDbTx(query, {
      idOutgoingBak:  data.id_outgoing_bak,
      documentNumber: data.document_number,
      documentDate:   data.document_date,
      subject:        data.subject,
      senderUserId:   data.sender_user_id,
      senderUnitId:   data.sender_unit_id,
    }, transaction);
  }

  async _insertDocumentMain(syncRecord, transaction) {
    const newId = `${Date.now()}${Math.random().toString(36).substring(2, 10)}`;
    const query = `
      INSERT INTO ${process.env.NEW_DB_NAME}.${this.newDbSchema}.outgoing_documents (
        id, document_number, document_date, subject,
        sender_user_id, sender_unit_id,
        id_outgoing_bak, created_at, updated_at
      ) VALUES (
        @id, @documentNumber, @documentDate, @subject,
        @senderUserId, @senderUnitId,
        @idOutgoingBak, @createdAt, GETDATE()
      )
    `;
    await this.queryNewDbTx(query, {
      id:             newId,
      documentNumber: syncRecord.document_number,
      documentDate:   syncRecord.document_date,
      subject:        syncRecord.subject,
      senderUserId:   syncRecord.sender_user_id,
      senderUnitId:   syncRecord.sender_unit_id,
      idOutgoingBak:  syncRecord.id_outgoing_bak,
      createdAt:      syncRecord.created_at,
    }, transaction);

    // Cập nhật document_id trong sync table để audit/comment lookup có thể resolve
    await this.queryNewDbTx(
      `UPDATE ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable}
       SET document_id = @newId
       WHERE id_outgoing_bak = @bakId`,
      { newId, bakId: syncRecord.id_outgoing_bak },
      transaction
    );
  }

  async _updateDocumentMain(syncRecord, transaction) {
    const query = `
      UPDATE ${process.env.NEW_DB_NAME}.${this.newDbSchema}.outgoing_documents
      SET
        document_number = @documentNumber,
        document_date   = @documentDate,
        subject         = @subject,
        sender_user_id  = @senderUserId,
        sender_unit_id  = @senderUnitId,
        updated_at      = GETDATE()
      WHERE id_outgoing_bak = @idOutgoingBak
    `;
    await this.queryNewDbTx(query, {
      documentNumber: syncRecord.document_number,
      documentDate:   syncRecord.document_date,
      subject:        syncRecord.subject,
      senderUserId:   syncRecord.sender_user_id,
      senderUnitId:   syncRecord.sender_unit_id,
      idOutgoingBak:  syncRecord.id_outgoing_bak,
    }, transaction);
  }

  // ── Transaction helpers ───────────────────────────────────────

  async beginTransaction() {
    const transaction = new sql.Transaction(this.newPool);
    await transaction.begin();
    return transaction;
  }

  async commitTransaction(transaction) {
    if (!transaction) return;
    await transaction.commit();
  }

  async rollbackTransaction(transaction) {
    try {
      if (!transaction) return;
      await transaction.rollback();
    } catch {}
  }
}

module.exports = StreamOutgoingMigrationModel;