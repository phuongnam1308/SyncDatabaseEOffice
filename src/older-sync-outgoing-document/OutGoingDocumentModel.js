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
    this.oldDbTable  = 'VanBanBanHanh';
    this.syncSchema = 'dbo';

    // ── Bảng trung gian (temp) — cùng cột, tên khác ──────────
    this.newDbSchema = 'dbo';
    this.tempTable   = 'outgoing_documents_temp';          // bảng tạm trong NEW DB

    // ── Bảng sync cuối cùng của document ─────────────────────
    this.syncTable   = 'outgoing_documents_sync';

    this.helper = new MigrationHelper(this.queryNewDbTx.bind(this), this.queryOldDb.bind(this));

    // Lazy-init: khởi tạo trong initialize()
    this._auditMigrationModels    = [];
    this._commentMigrationModels  = [];
    this._syncAuditModel          = null;
    this._syncCommentModel        = null;
    this._syncOutgoingModel       = null;
    this._outGoingMigrationModels = null;
  }

  // ──────────────────────────────────────────────────────────
  // KHỞI TẠO — phải gọi trước khi dùng
  // ──────────────────────────────────────────────────────────
  async initialize() {
    await super.initialize();

    this._syncOutgoingModel = new SyncOutgoingModel();
    await this._syncOutgoingModel.initialize();

    this._outGoingMigrationModels = new StreamOutgoingAuditSyncModel();
    await this._outGoingMigrationModels.initialize();

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
   * @returns {Promise<object[]>} Mảng raw records từ VanBanBanHanh
   */
  async fetchBatch({ batch, lastId }) {
    const query = `
      SELECT TOP (@batch) *
      FROM ${process.env.OLD_DB_NAME}.${this.oldDbSchema}.${this.oldDbTable}
      WHERE (@lastId IS NULL OR ID > @lastId)
      ORDER BY ID ASC
    `;
    return this.queryOldDb(query, { batch, lastId: lastId || null });
  }

  // ══════════════════════════════════════════════════════════
  // BƯỚC 2 — Ghi raw records vào bảng temp
  // ══════════════════════════════════════════════════════════

  /**
   * Upsert một batch raw records vào bảng VanBanBanHanh_temp trong NEW DB.
   * Bảng temp có cùng cấu trúc cột với VanBanBanHanh, chỉ khác tên.
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
   * @param {number|string} oldRecordId — ID bản ghi trong bảng temp (= ID trong VanBanBanHanh)
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

    // ─────────────────────────────────────────────
    // 1️⃣  Apply Document (sync → main)
    // ─────────────────────────────────────────────
    try {
        // StreamOutgoingAuditSyncModel đã có processSingleRecord
        const syncedDocs = await this._outGoingMigrationModels.processSingleRecord({ ID: id });

        if (syncedDocs?.length) {
        for (const syncedDoc of syncedDocs) {
            const applyResult = await this._syncOutgoingModel.applySingleRecord(syncedDoc);
            stats.document.inserted += applyResult.inserted;
            stats.document.updated  += applyResult.updated;
        }
        }
    } catch (err) {
        logger.warn(`[mapDocumentById] Document sync failed ID=${id}: ${err.message}`);
        return stats; // document fail thì dừng luôn
    }

    // ─────────────────────────────────────────────
    // 2️⃣  Sync AUDIT
    // ─────────────────────────────────────────────
    for (const auditModel of this._auditMigrationModels) {
        try {
        const rawAudits = await auditModel.fetchByDocumentId(id);
        if (!rawAudits?.length) continue;

        for (const rawAudit of rawAudits) {
            try {
            const syncedAudits = await auditModel.processSingleRecord(rawAudit);
            if (!syncedAudits?.length) {
                stats.audit.skipped++;
                continue;
            }

            for (const syncedAudit of syncedAudits) {
                try {
                const applyResult = await this._syncAuditModel.applySingleRecord(syncedAudit);
                stats.audit.inserted += applyResult.inserted;
                stats.audit.updated  += applyResult.updated;
                } catch (applyErr) {
                stats.audit.skipped++;
                logger.warn(
                    `[mapDocumentById] Apply audit failed table=${auditModel.oldDbTable} ID=${id}: ${applyErr.message}`
                );
                }
            }
            } catch (err) {
            stats.audit.skipped++;
            }
        }
        } catch (err) {
        logger.warn(
            `[mapDocumentById] Fetch audit failed table=${auditModel.oldDbTable} ID=${id}: ${err.message}`
        );
        }
    }

    // ─────────────────────────────────────────────
    // 3️⃣  Sync COMMENT
    // ─────────────────────────────────────────────
    for (const commentModel of this._commentMigrationModels) {
        try {
        const rawComments = await commentModel.fetchByDocumentId(id);
        if (!rawComments?.length) continue;

        for (const rawComment of rawComments) {
            try {
            const syncedComment = await commentModel.processSingleRecord(rawComment);
            if (!syncedComment) {
                stats.comment.skipped++;
                continue;
            }

            try {
                const applyResult = await this._syncCommentModel.applySingleRecord(syncedComment);
                stats.comment.inserted += applyResult.inserted;
                stats.comment.updated  += applyResult.updated;
            } catch (applyErr) {
                stats.comment.skipped++;
                logger.warn(
                `[mapDocumentById] Apply comment failed table=${commentModel.oldDbTable} ID=${id}: ${applyErr.message}`
                );
            }
            } catch (_) {
            stats.comment.skipped++;
            }
        }
        } catch (err) {
        logger.warn(
            `[mapDocumentById] Fetch comment failed table=${commentModel.oldDbTable} ID=${id}: ${err.message}`
        );
        }
    }

    return stats;
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
   * INSERT một raw record vào bảng VanBanBanHanh_temp.
   * Cột của bảng temp giống hệt VanBanBanHanh — map 1-1.
   *
   * ⚠️ Nếu cấu trúc VanBanBanHanh thay đổi, chỉ cần cập nhật danh sách cột ở đây.
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
   * UPDATE raw record trong bảng VanBanBanHanh_temp theo ID.
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