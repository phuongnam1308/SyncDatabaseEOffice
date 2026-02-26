/**
 * OutGoingDocumentModel.js
 *
 * ════════════════════════════════════════════════════════════════
 * LUỒNG XỬ LÝ (3 bước chính):
 * ────────────────────────────────────────────────────────────────
 *
 *  BƯỚC 1 — fetchBatch()
 *    Kéo raw records từ DB cũ (VanBanDi) → trả về mảng để gọi bên ngoài
 *
 *  BƯỚC 2 — insertBatchToTemp(records)
 *    Ghi raw records vào bảng trung gian (VanBanDi_temp).
 *    Bảng temp có cùng cấu trúc cột với bảng cũ, chỉ khác tên.
 *    Dùng để tách biệt giai đoạn pull data và giai đoạn map/apply.
 *
 *  BƯỚC 3 — mapDocumentById(oldRecordId)
 *    Nhận ID của bản ghi trong bảng temp, thực hiện toàn bộ pipeline:
 *
 *    3a. Đọc raw record từ temp table theo ID
 *    3b. Map document → outgoing_documents_sync (upsert)
 *    3c. Apply document → outgoing_documents (main), cập nhật document_id trong sync
 *        ↑ Phải xong trước khi audit/comment chạy, vì chúng cần document_id
 *    3d. Với MỖI bảng LuanChuyenVanBan_*:
 *          - fetchByDocumentId(oldRecordId) → lấy raw audit records
 *          - Với mỗi raw: auditModel.processSingleRecord(raw)
 *              → map + upsert vào audit_sync (logic đã có trong model, KHÔNG được sửa)
 *          - Với mỗi syncedAudit: syncAuditModel.applySingleRecord(...)
 *              → apply vào bảng audit chính
 *    3e. Với MỖI bảng Comments_*:
 *          - fetchByDocumentId(oldRecordId) → lấy raw comment records
 *          - Với mỗi raw: commentModel.processSingleRecord(raw)
 *              → map + upsert vào document_comments_sync
 *          - Với mỗi syncedComment: syncCommentModel.applySingleRecord(...)
 *              → apply vào bảng document_comments chính
 *
 * ════════════════════════════════════════════════════════════════
 * RÀNG BUỘC QUAN TRỌNG:
 *   - processSingleRecord() của audit/comment: CHỈ ĐƯỢC GỌI, KHÔNG ĐƯỢC SỬA
 *   - _mapSingleRecord() bên trong các model: KHÔNG ĐƯỢC ĐỤNG VÀO
 *   - Tất cả hàm apply/insert vào bảng chính: dùng model sẵn có
 * ════════════════════════════════════════════════════════════════
 */

'use strict';

const BaseModel    = require('../../models/BaseModel');
const logger       = require('../../utils/logger');
const sql          = require('mssql');
const MigrationHelper = require('../helpers/MigrationHelper');

// ── Related sync models (CHỈ GỌI, KHÔNG SỬA) ─────────────────
const StreamOutgoingAuditSyncModel = require('../sync-audit/migrate/StreamAuditMigrationModel');
const StreamCommentMigrationModel  = require('../sync-document-comment/migration/StreamCommentMigrationModel');
const SyncAuditModel               = require('../sync-audit/apply/SyncAuditModel');
const SyncCommentModel             = require('../sync-document-comment/apply/SyncCommentModel');

// ── Danh sách bảng audit trong DB cũ ─────────────────────────
const AUDIT_TABLES = [
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

// ── Danh sách bảng comment trong DB cũ ───────────────────────
const COMMENT_TABLES = [
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

// ─────────────────────────────────────────────────────────────
class OutGoingDocumentModel extends BaseModel {
  constructor() {
    super();

    // ── Nguồn DB cũ ──────────────────────────────────────────
    this.oldDbSchema = 'dbo';
    this.oldDbTable  = 'VanBanDi';

    // ── Bảng trung gian (temp) — cùng cột, tên khác ──────────
    this.newDbSchema = 'dbo';
    this.tempTable   = 'outgoing_documents_temp';          // bảng tạm trong NEW DB

    // ── Bảng sync cuối cùng của document ─────────────────────
    this.syncTable   = 'outgoing_documents_sync';
    this.syncSchema  = 'dbo';

    this.helper = new MigrationHelper(this.queryNewDbTx.bind(this));

    // Lazy-init: khởi tạo trong initialize()
    this._auditMigrationModels   = [];
    this._commentMigrationModels = [];
    this._syncAuditModel         = null;
    this._syncCommentModel       = null;
  }

  // ──────────────────────────────────────────────────────────
  // KHỞI TẠO — phải gọi trước khi dùng
  // ──────────────────────────────────────────────────────────
  async initialize() {
    await super.initialize();

    // Apply models (sync → main)
    this._syncAuditModel = new SyncAuditModel();
    await this._syncAuditModel.initialize();

    this._syncCommentModel = new SyncCommentModel();
    await this._syncCommentModel.initialize();

    // Migrate models (old DB → sync tables)
    for (const table of AUDIT_TABLES) {
      const model = new StreamOutgoingAuditSyncModel(table);
      await model.initialize();
      this._auditMigrationModels.push(model);
    }

    for (const table of COMMENT_TABLES) {
      const model = new StreamCommentMigrationModel(table);
      await model.initialize();
      this._commentMigrationModels.push(model);
    }

    logger.info(
      `[OutGoingDocumentModel] Initialized — ` +
      `auditTables=${this._auditMigrationModels.length}, ` +
      `commentTables=${this._commentMigrationModels.length}`
    );
  }

  // ══════════════════════════════════════════════════════════
  // BƯỚC 1 — Lấy dữ liệu từ DB cũ
  // ══════════════════════════════════════════════════════════

  /**
   * Kéo một batch văn bản đi từ DB cũ theo con trỏ ID tăng dần.
   *
   * @param {{ batch: number, lastId: number|null }} opts
   * @returns {Promise<object[]>} Mảng raw records từ VanBanDi
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

  // ══════════════════════════════════════════════════════════
  // BƯỚC 2 — Ghi raw records vào bảng temp
  // ══════════════════════════════════════════════════════════

  /**
   * Upsert một batch raw records vào bảng VanBanDi_temp trong NEW DB.
   * Bảng temp có cùng cấu trúc cột với VanBanDi, chỉ khác tên.
   * Nếu bản ghi đã tồn tại (theo ID) thì UPDATE, chưa có thì INSERT.
   *
   * @param {object[]} records — raw records từ fetchBatch()
   * @returns {Promise<{ inserted: number, updated: number, skipped: number }>}
   */
  async insertBatchToTemp(records) {
    if (!records?.length) return { inserted: 0, updated: 0, skipped: 0 };

    let inserted = 0;
    let updated  = 0;
    let skipped  = 0;

    const transaction = await this.beginTransaction();
    try {
      for (const raw of records) {
        if (!raw?.ID) { skipped++; continue; }

        try {
          const existing = await this.queryNewDbTx(
            `SELECT TOP 1 ID
             FROM ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.tempTable}
             WHERE ID = @id`,
            { id: raw.ID },
            transaction
          );

          if (existing?.length) {
            await this._updateTempRecord(raw, transaction);
            updated++;
          } else {
            await this._insertTempRecord(raw, transaction);
            inserted++;
          }
        } catch (rowErr) {
          skipped++;
          logger.warn(
            `[OutGoingDocumentModel.insertBatchToTemp] Skip ID=${raw.ID}: ${rowErr.message}`
          );
        }
      }

      await this.commitTransaction(transaction);
      logger.debug(
        `[insertBatchToTemp] inserted=${inserted} updated=${updated} skipped=${skipped}`
      );
      return { inserted, updated, skipped };
    } catch (error) {
      await this.rollbackTransaction(transaction);
      logger.error('[OutGoingDocumentModel.insertBatchToTemp] Error:', error);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════
  // BƯỚC 3 — Map document + audit + comment → insert vào main
  // ══════════════════════════════════════════════════════════

  /**
   * Pipeline đầy đủ cho một văn bản:
   *   3a. Đọc raw từ bảng temp theo oldRecordId
   *   3b. Map document → upsert vào outgoing_documents_sync
   *   3c. Apply document → outgoing_documents (main) + cập nhật document_id
   *   3d. Map + sync toàn bộ audit liên quan (LuanChuyenVanBan_*)
   *   3e. Map + sync toàn bộ comment liên quan (Comments_*)
   *
   * ⚠️ Thứ tự 3b → 3c PHẢI chạy trước 3d và 3e, vì audit/comment
   *    cần document_id đã được ghi vào outgoing_documents_sync.
   *
   * @param {number|string} oldRecordId — ID bản ghi trong bảng temp (= ID trong VanBanDi)
   * @returns {Promise<{
   *   document: { inserted: number, updated: number },
   *   audit:    { inserted: number, updated: number, skipped: number },
   *   comment:  { inserted: number, updated: number, skipped: number },
   * }>}
   */
  async mapDocumentById(oldRecordId) {
    const id = String(oldRecordId);
    const stats = {
      document: { inserted: 0, updated: 0 },
      audit:    { inserted: 0, updated: 0, skipped: 0 },
      comment:  { inserted: 0, updated: 0, skipped: 0 },
    };

    if (!id) return stats;

    // ── 3a. Đọc raw record từ bảng temp ────────────────────
    const rawDocument = await this._fetchTempRecordById(id);
    if (!rawDocument) {
      logger.warn(`[mapDocumentById] Không tìm thấy record trong temp, ID=${id}`);
      return stats;
    }

    // ── 3b. Map document → outgoing_documents_sync ─────────
    // Upsert vào bảng sync trung gian, document_id = NULL lúc này.
    try {
      await this._upsertDocumentToSync(rawDocument);
    } catch (err) {
      logger.error(`[mapDocumentById] Upsert to sync failed ID=${id}: ${err.message}`);
      // Nếu sync đã có record từ lần trước thì 3c vẫn resolve được → tiếp tục
    }

    // ── 3c. Apply document → outgoing_documents (main) ─────
    // INSERT/UPDATE vào bảng chính, đồng thời ghi ngược document_id
    // vào outgoing_documents_sync để audit/comment có thể lookup.
    let documentApplied = false;
    try {
      const applyResult = await this._applyDocumentToMain(id);
      stats.document.inserted = applyResult.inserted;
      stats.document.updated  = applyResult.updated;
      documentApplied         = applyResult.inserted > 0 || applyResult.updated > 0;
    } catch (err) {
      logger.error(`[mapDocumentById] Apply to main failed ID=${id}: ${err.message}`);
      // Không thể tiếp tục: document_id chưa tồn tại → audit/comment sẽ bị skip hết
      return stats;
    }

    if (!documentApplied) {
      logger.warn(`[mapDocumentById] documentApplied=false, bỏ qua audit/comment ID=${id}`);
      return stats;
    }

    // ── 3d. Sync toàn bộ audit liên quan ───────────────────
    //
    // Với mỗi bảng LuanChuyenVanBan_*:
    //   1. fetchByDocumentId(id) — lấy raw raws từ bảng audit cũ
    //   2. Với mỗi raw → auditModel.processSingleRecord(raw)
    //        → trong đó gọi _mapSingleRecord (KHÔNG được sửa) + upsert audit_sync
    //      Hàm này trả về mảng syncedAudits đã được ghi vào audit_sync
    //   3. Với mỗi syncedAudit → _syncAuditModel.applySingleRecord(...)
    //        → apply vào bảng audit chính
    //
    for (const auditModel of this._auditMigrationModels) {
      let rawAudits = [];
      try {
        rawAudits = await auditModel.fetchByDocumentId(id);
      } catch (fetchErr) {
        logger.warn(
          `[mapDocumentById] Fetch audit table=${auditModel.oldDbTable} docId=${id}: ${fetchErr.message}`
        );
        continue;
      }

      if (!rawAudits?.length) continue;

      for (const rawAudit of rawAudits) {
        try {
          // Gọi processSingleRecord của auditModel — KHÔNG SỬA HÀM NÀY
          // Bên trong nó tự gọi _mapSingleRecord + upsert audit_sync
          const syncedAudits = await auditModel.processSingleRecord(rawAudit);

          if (!syncedAudits?.length) {
            stats.audit.skipped++;
            continue;
          }

          // Apply từng audit_sync record vào bảng audit chính
          for (const syncedAudit of syncedAudits) {
            try {
              const applyResult = await this._syncAuditModel.applySingleRecord(
                this._toAuditMainRecord(syncedAudit)
              );
              stats.audit.inserted += applyResult.inserted;
              stats.audit.updated  += applyResult.updated;
            } catch (applyErr) {
              stats.audit.skipped++;
              logger.warn(
                `[mapDocumentById] Apply audit to main — ` +
                `table=${auditModel.oldDbTable} docId=${id}: ${applyErr.message}`
              );
            }
          }
        } catch (auditErr) {
          stats.audit.skipped++;
          logger.warn(
            `[mapDocumentById] processSingleRecord audit — ` +
            `table=${auditModel.oldDbTable} docId=${id}: ${auditErr.message}`
          );
        }
      }
    }

    // ── 3e. Sync toàn bộ comment liên quan ─────────────────
    //
    // Với mỗi bảng Comments_*:
    //   1. fetchByDocumentId(id) — lấy raw raws từ bảng comment cũ
    //   2. Với mỗi raw → commentModel.processSingleRecord(raw)
    //        → trong đó gọi _mapRecord (KHÔNG được sửa) + upsert document_comments_sync
    //   3. syncedComment → _syncCommentModel.applySingleRecord(...)
    //        → apply vào bảng document_comments chính
    //
    for (const commentModel of this._commentMigrationModels) {
      let rawComments = [];
      try {
        rawComments = await commentModel.fetchByDocumentId(id);
      } catch (fetchErr) {
        logger.warn(
          `[mapDocumentById] Fetch comment table=${commentModel.oldDbTable} docId=${id}: ${fetchErr.message}`
        );
        continue;
      }

      if (!rawComments?.length) continue;

      for (const rawComment of rawComments) {
        try {
          // Gọi processSingleRecord của commentModel — KHÔNG SỬA HÀM NÀY
          // Bên trong nó tự gọi _mapRecord + upsert document_comments_sync
          const syncedComment = await commentModel.processSingleRecord(rawComment);

          if (!syncedComment) {
            stats.comment.skipped++;
            continue;
          }

          // Apply comment_sync record vào bảng document_comments chính
          try {
            const applyResult = await this._syncCommentModel.applySingleRecord(
              this._toCommentMainRecord(syncedComment)
            );
            stats.comment.inserted += applyResult.inserted;
            stats.comment.updated  += applyResult.updated;
          } catch (applyErr) {
            stats.comment.skipped++;
            logger.warn(
              `[mapDocumentById] Apply comment to main — ` +
              `table=${commentModel.oldDbTable} docId=${id}: ${applyErr.message}`
            );
          }
        } catch (commentErr) {
          stats.comment.skipped++;
          logger.warn(
            `[mapDocumentById] processSingleRecord comment — ` +
            `table=${commentModel.oldDbTable} docId=${id}: ${commentErr.message}`
          );
        }
      }
    }

    return stats;
  }

  /**
   * Xử lý một batch — gọi mapDocumentById() cho từng ID trong danh sách.
   * Entry point chính khi chạy từ SyncHandlerModel / SyncManagerService.
   *
   * @param {Array<number|string>} oldRecordIds
   * @returns {Promise<{
   *   docInserted: number, docUpdated: number, docSkipped: number,
   *   auditInserted: number, auditUpdated: number, auditSkipped: number,
   *   commentInserted: number, commentUpdated: number, commentSkipped: number,
   * }>}
   */
  async mapBatch(oldRecordIds) {
    const totals = {
      docInserted:     0, docUpdated:     0, docSkipped:     0,
      auditInserted:   0, auditUpdated:   0, auditSkipped:   0,
      commentInserted: 0, commentUpdated: 0, commentSkipped: 0,
    };

    if (!oldRecordIds?.length) return totals;

    for (const id of oldRecordIds) {
      try {
        const result = await this.mapDocumentById(id);
        totals.docInserted     += result.document.inserted;
        totals.docUpdated      += result.document.updated;
        totals.auditInserted   += result.audit.inserted;
        totals.auditUpdated    += result.audit.updated;
        totals.auditSkipped    += result.audit.skipped;
        totals.commentInserted += result.comment.inserted;
        totals.commentUpdated  += result.comment.updated;
        totals.commentSkipped  += result.comment.skipped;
      } catch (err) {
        totals.docSkipped++;
        logger.warn(`[OutGoingDocumentModel.mapBatch] Skip ID=${id}: ${err.message}`);
      }
    }

    return totals;
  }

  // ══════════════════════════════════════════════════════════
  // PRIVATE — Temp table helpers (Bước 2)
  // ══════════════════════════════════════════════════════════

  /**
   * Đọc một raw record từ bảng temp theo ID.
   * @private
   */
  async _fetchTempRecordById(id) {
    const rows = await this.queryNewDbTx(
      `SELECT TOP 1 *
       FROM ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.tempTable}
       WHERE ID = @id`,
      { id }
    );
    return rows?.[0] || null;
  }

  /**
   * INSERT một raw record vào bảng VanBanDi_temp.
   * Cột của bảng temp giống hệt VanBanDi — map 1-1.
   *
   * ⚠️ Nếu cấu trúc VanBanDi thay đổi, chỉ cần cập nhật danh sách cột ở đây.
   * @private
   */
  async _insertTempRecord(raw, transaction) {
    // Lấy tất cả các key của raw record, bỏ qua các cột không hợp lệ
    const skipColumns = new Set(['__sync_time', '__sync_id']);
    const columns = Object.keys(raw).filter((k) => !skipColumns.has(k));

    if (!columns.length) return;

    const colList    = columns.map((c) => `[${c}]`).join(', ');
    const paramList  = columns.map((c) => `@${c}`).join(', ');
    const params     = {};
    columns.forEach((c) => { params[c] = raw[c] ?? null; });

    const query = `
      INSERT INTO ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.tempTable}
        (${colList})
      VALUES
        (${paramList})
    `;
    await this.queryNewDbTx(query, params, transaction);
  }

  /**
   * UPDATE raw record trong bảng VanBanDi_temp theo ID.
   * @private
   */
  async _updateTempRecord(raw, transaction) {
    const skipColumns = new Set(['ID', '__sync_time', '__sync_id']);
    const columns = Object.keys(raw).filter((k) => !skipColumns.has(k));

    if (!columns.length) return;

    const setClauses = columns.map((c) => `[${c}] = @${c}`).join(', ');
    const params     = { ID: raw.ID };
    columns.forEach((c) => { params[c] = raw[c] ?? null; });

    const query = `
      UPDATE ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.tempTable}
      SET ${setClauses}
      WHERE ID = @ID
    `;
    await this.queryNewDbTx(query, params, transaction);
  }

  // ══════════════════════════════════════════════════════════
  // PRIVATE — Document sync/apply helpers (Bước 3b & 3c)
  // ══════════════════════════════════════════════════════════

  /**
   * Map raw record từ bảng temp → format outgoing_documents_sync,
   * sau đó upsert vào bảng sync.
   *
   * @private
   */
  async _upsertDocumentToSync(raw) {
    if (!raw?.ID) return;

    const mapped = await this._mapDocumentRecord(raw);
    if (!mapped) return;

    const transaction = await this.beginTransaction();
    try {
      const existing = await this.queryNewDbTx(
        `SELECT TOP 1 id
         FROM ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.syncTable}
         WHERE id_outgoing_bak = @bakId`,
        { bakId: mapped.id_outgoing_bak },
        transaction
      );

      if (existing?.length) {
        await this._updateDocumentSync(mapped, transaction);
      } else {
        await this._insertDocumentSync(mapped, transaction);
      }

      await this.commitTransaction(transaction);
    } catch (error) {
      await this.rollbackTransaction(transaction);
      throw error;
    }
  }

  /**
   * Lấy bản ghi từ outgoing_documents_sync, sau đó INSERT hoặc UPDATE
   * vào bảng outgoing_documents (main).
   *
   * Quan trọng: sau khi INSERT vào main, cập nhật document_id ngược lại
   * vào outgoing_documents_sync để audit/comment lookup được.
   *
   * @param {string} oldId — ID bản ghi trong bảng temp (= id_outgoing_bak)
   * @returns {Promise<{ inserted: number, updated: number }>}
   * @private
   */
  async _applyDocumentToMain(oldId) {
    const transaction = await this.beginTransaction();
    try {
      // Lấy bản ghi từ sync table
      const syncRows = await this.queryNewDbTx(
        `SELECT TOP 1 *
         FROM ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.syncTable}
         WHERE id_outgoing_bak = @bakId`,
        { bakId: oldId },
        transaction
      );

      if (!syncRows?.length) {
        await this.commitTransaction(transaction);
        return { inserted: 0, updated: 0 };
      }

      const syncRecord = syncRows[0];

      // Kiểm tra đã có trong main chưa
      const existingMain = await this.queryNewDbTx(
        `SELECT TOP 1 id
         FROM ${process.env.NEW_DB_NAME}.${this.newDbSchema}.outgoing_documents
         WHERE id_outgoing_bak = @bakId`,
        { bakId: oldId },
        transaction
      );

      if (existingMain?.length) {
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
   * Map raw document record (từ bảng temp, cấu trúc giống VanBanDi)
   * → format phù hợp với outgoing_documents_sync.
   * @private
   */
  async _mapDocumentRecord(raw) {
    if (!raw?.ID) return null;

    const userId     = await this.helper.mapUserName(raw.NguoiSoan || raw.NguoiTao, null);
    const senderUnit = await this.helper.mapSenderUnitId(raw.DonViGui || raw.CoQuanBanHanh, null);

    return {
      id_outgoing_bak: String(raw.ID),
      document_id:     null,                                          // điền sau khi apply vào main
      document_number: raw.SoHieuVanBan  || null,
      document_date:   this.helper.parseDate(raw.NgayBanHanh),
      subject:         raw.TrichYeu      || null,
      sender_user_id:  userId            || null,
      sender_unit_id:  senderUnit        || null,
      created_at:      this.helper.parseDate(raw.NgayTao || raw.Created),
      updated_at:      null,
    };
  }

  // ── Document sync: INSERT / UPDATE ───────────────────────

  async _insertDocumentSync(data, transaction) {
    const query = `
      INSERT INTO ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.syncTable} (
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
      UPDATE ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.syncTable}
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

  // ── Document main: INSERT / UPDATE ───────────────────────

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

    // ⚠️ Cập nhật document_id ngược lại vào sync table.
    // Audit/comment model sẽ lookup document_id tại đây khi resolve.
    await this.queryNewDbTx(
      `UPDATE ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.syncTable}
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

  // ══════════════════════════════════════════════════════════
  // PRIVATE — Format converters (sync → main)
  // ══════════════════════════════════════════════════════════

  /**
   * Chuyển bản ghi từ audit_sync → format bảng audit chính.
   * Được gọi ngay trước applySingleRecord() của SyncAuditModel.
   * @private
   */
  _toAuditMainRecord(syncRecord) {
    return {
      document_id:   syncRecord.document_id?.document_id || syncRecord.document_id,
      time:          syncRecord.time,
      user_id:       syncRecord.user_id,
      display_name:  syncRecord.display_name,
      role:          syncRecord.role          || null,
      action_code:   syncRecord.action_code,
      from_node_id:  syncRecord.from_node_id  || null,
      to_node_id:    syncRecord.to_node_id    || null,
      details:       syncRecord.details       || null,
      origin_id:     syncRecord.origin_id     || null,
      created_by:    syncRecord.user_id,
      receiver: Array.isArray(syncRecord.receiver)
        ? syncRecord.receiver.join(',')
        : (syncRecord.receiver || null),
      receiver_unit: Array.isArray(syncRecord.receiver_unit)
        ? syncRecord.receiver_unit.join(',')
        : (syncRecord.receiver_unit || null),
      group_:        syncRecord.group_        || null,
      roleProcess:   syncRecord.roleProcess,
      action:        syncRecord.action        || null,
      deadline:      syncRecord.deadline      || null,
      stage_status:  syncRecord.stage_status,
      curStatusCode: syncRecord.curStatusCode || null,
      created_at:    syncRecord.created_at    || syncRecord.time,
      updated_at:    syncRecord.updated_at    || null,
      type_document: syncRecord.document_id?.type_document || syncRecord.type_document || null,
      processed_by:  syncRecord.processed_by  || null,
      table_backup:  syncRecord.table_backup  || syncRecord.table_backups,
      acting_as:     syncRecord.acting_as     || null,
    };
  }

  /**
   * Chuyển bản ghi từ document_comments_sync → format bảng document_comments chính.
   * Được gọi ngay trước applySingleRecord() của SyncCommentModel.
   * @private
   */
  _toCommentMainRecord(syncRecord) {
    return {
      document_id:     syncRecord.document_id,
      parent_id:       syncRecord.parent_id    || null,
      user_id:         syncRecord.user_id,
      user_name:       syncRecord.user_name,
      content:         syncRecord.content      || '',
      type:            syncRecord.type,
      created_at:      syncRecord.created_at,
      file_id:         syncRecord.file_id,
      likes:           syncRecord.likes,
      id_comments_bak: syncRecord.id_comments_bak,
      type_bak:        syncRecord.type_bak,
      table_backup:    syncRecord.table_backup,
      parent_id_bak:   syncRecord.parent_id_bak,
      user_id_bak:     syncRecord.user_id_bak,
    };
  }

  // ══════════════════════════════════════════════════════════
  // PRIVATE — Transaction helpers
  // ══════════════════════════════════════════════════════════

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
    } catch (_) { /* silent */ }
  }
}

module.exports = OutGoingDocumentModel;