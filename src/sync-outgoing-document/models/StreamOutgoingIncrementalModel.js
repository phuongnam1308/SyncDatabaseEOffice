const BaseModel    = require('../../../models/BaseModel');
const logger       = require('../../../utils/logger');
const MigrationHelper = require('../../helpers/MigrationHelper');

const SyncCommentModel             = require('../../sync-document-comment/SyncCommentModel');
const SyncAuditModel               = require('../../sync-audit/SyncAuditModel');
const SyncOutgoingModel            = require('./SyncOutgoingModel');
const StreamOutgoingMigrationModel = require('./StreamOutgoingMigrationModel');
const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');

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

class OutGoingDocumentModel extends BaseIncrementalSyncInterface {
  constructor() {
    super();

    // ── Nguồn DB cũ ──────────────────────────────────────────
    this.oldDbSchema = 'dbo';
    this.oldDbTable  = 'VanBanBanHanh';
    this.syncSchema = 'dbo';

    // ── Bảng trung gian──────────
    this.newDbSchema = 'dbo';
    this.tempTable   = 'outgoing_documents_temp';

    this.helper = new MigrationHelper(this.queryNewDbTx.bind(this));

    // Lazy-init: khởi tạo trong initialize()
    this._syncAuditModel   = [];
    this._syncCommentModel = [];
    this._syncOutgoingModel       = null;
    this._outGoingMigrationModels = null;
  }
  async initialize() {
    await super.initialize();

    this._syncOutgoingModel = new SyncOutgoingModel();
    await this._syncOutgoingModel.initialize();

    this._outGoingMigrationModels = new StreamOutgoingMigrationModel();
    await this._outGoingMigrationModels.initialize();

    // Migrate models (old DB → sync tables)
    for (const table of AUDIT_TABLES) {
      const model = new SyncAuditModel(table);
      await model.initialize();
      this._syncAuditModel.push(model);
    }

    for (const table of COMMENT_TABLES) {
      const model = new SyncCommentModel(table);
      await model.initialize();
      this._syncCommentModel.push(model);
    }

    logger.info(
      `[OutGoingDocumentModel] Initialized — ` +
      `auditTables=${this._syncOutgoingModel.length}, ` +
      `commentTables=${this._syncCommentModel.length}`
    );
  }

  getStagingTableRef() {
    if (this.newDbName) {
      return `${this.newDbName}.${this.newDbSchema}.${this.newTableSync}`;
    }
    return `${this.newDbSchema}.${this.newTableSync}`;
  }

  sanitizeColumnName(column) {
    if (!/^[A-Za-z0-9_]+$/.test(column)) {
      throw new Error(`Invalid column name from source: ${column}`);
    }
    return `[${column}]`;
  }

  async fetchListFromOldDb(lastSyncTime) {
    const query = `
      SELECT *
      FROM ${process.env.OLD_DB_NAME}.${this.oldDbSchema}.${this.oldDbTable}
      WHERE COALESCE(TRY_CONVERT(datetime2, Modified), TRY_CONVERT(datetime2, NgayTao)) > @lastSyncTime
      ORDER BY
        COALESCE(TRY_CONVERT(datetime2, Modified), TRY_CONVERT(datetime2, NgayTao)) ASC,
        ID ASC
    `;
    return this.queryOldDb(query, { lastSyncTime });
  }

  async syncOldToStaging(rows, { transaction } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { stagedCount: 0 };
    }

    const columns = Object.keys(rows[0] || {});
    if (!columns.length) {
      return { stagedCount: 0 };
    }

    if (!columns.includes('ID')) {
      throw new Error('Staging sync requires source column "ID"');
    }

    const safeColumns = columns.map((c) => this.sanitizeColumnName(c));
    const nonIdColumns = columns.filter((c) => c !== 'ID');
    const safeNonIdColumns = nonIdColumns.map((c) => this.sanitizeColumnName(c));
    const stagingTableRef = this.getStagingTableRef();

    for (const row of rows) {
      if (!row?.ID) {
        throw new Error('Row ID is required for staging');
      }

      const updateClause = safeNonIdColumns
        .map((col, idx) => `${col} = @${nonIdColumns[idx]}`)
        .join(', ');

      const query = `
        IF EXISTS (SELECT 1 FROM ${stagingTableRef} WHERE ID = @ID)
        BEGIN
          ${nonIdColumns.length > 0 ? `
          UPDATE ${stagingTableRef}
          SET ${updateClause}
          WHERE ID = @ID;` : `
          SELECT 1 AS noop;`}
        END
        ELSE
        BEGIN
          INSERT INTO ${stagingTableRef} (${safeColumns.join(', ')})
          VALUES (${columns.map((c) => `@${c}`).join(', ')});
        END
      `;

      await this.queryNewDbTx(query, row, transaction);
    }

    return { stagedCount: rows.length };
  }

  async fetchOneFromStaging({ lastSyncTime, itemIndex, transaction } = {}) {
    const rowNumber = Number(itemIndex || 0) + 1;
    const stagingTableRef = this.getStagingTableRef();
    const query = `
      ;WITH staged AS (
        SELECT
          *,
          ROW_NUMBER() OVER (
            ORDER BY
              COALESCE(TRY_CONVERT(datetime2, Modified), TRY_CONVERT(datetime2, NgayTao)) ASC,
              ID ASC
          ) AS rn
        FROM ${stagingTableRef}
        WHERE COALESCE(TRY_CONVERT(datetime2, Modified), TRY_CONVERT(datetime2, NgayTao)) > @lastSyncTime
      )
      SELECT TOP 1 *
      FROM staged
      WHERE rn = @rowNumber
    `;

    const rows = await this.queryNewDbTx(
      query,
      {
        lastSyncTime,
        rowNumber
      },
      transaction
    );

    if (!rows?.length) {
      return null;
    }

    const row = { ...rows[0] };
    delete row.rn;
    return row;
  }

  async processRowData(rowData, { transaction } = {}) {
    if (!rowData) {
      throw new Error('rowData is required');
    }

    const backupId = String(rowData.ID || '').trim();
    if (!backupId) {
      throw new Error('Invalid document ID from staging');
    }

    let res;
    try {
      res = await this.upsertDocumentAggregateById(rowData, { transaction });
    } catch (err) {
      logger.error(
        `[OutGoingDocumentModel.processRowData] upsertDocumentAggregateById failed ID=${backupId}: ${err.message}`
      );
      throw err; // rollback tầng trên
    }

    const affected = Number(res?.affected || 0);

    if (affected === 0) {
      throw new Error(`Document was not inserted or updated for ID=${backupId}`);
    }

    return {
      action: res?.action || 'upsert',
      backupId,
      affected
    };
  }

  async upsertDocumentAggregateById(oldRecord, { transaction } = {}) {
    if (!oldRecord) {
      return { action: 'none', affected: 0 };
    }
    const id = String(oldRecord.ID || '').trim();

    if (!this._outGoingMigrationModels || !this._syncOutgoingModel) {
      logger.error(
        `[upsertDocumentAggregateById] Model not initialized ID=${id}`
      );
      return { action: 'none', affected: 0 };
    }
    let totalAffected = 0;

    // ─────────────────────────────
    // 1️⃣ UPSERT DOCUMENT
    // ─────────────────────────────
    let documentResult;
    try {
      documentResult =
        await this._outGoingMigrationModels.processSingleRecord(
          oldRecord,
          transaction
        );
    } catch (err) {
      logger.error(
        `[upsertDocumentAggregateById] Document upsert failed ID=${id}: ${err.message}`
      );
    }
    if (!documentResult || documentResult.affected === 0) {
      return { action: 'none', affected: 0 };
    }
    totalAffected += documentResult.affected;
    const documentId = documentResult.documentId;

    // ─────────────────────────────
    // 2️⃣ UPSERT AUDIT
    // ─────────────────────────────
    for (const auditModel of this._syncAuditModel || []) {
      try {
        const rawAudits =
          await auditModel.fetchByDocumentId(id);

        if (!Array.isArray(rawAudits) || !rawAudits.length) {
          continue;
        }

        for (const rawAudit of rawAudits) {
          try {
            const result =
              await auditModel.processSingleRecord(
                rawAudit,
                documentId,
                transaction
              );

            if (!result) continue;

            totalAffected += Number(result.inserted || 0);
            totalAffected += Number(result.updated || 0);

          } catch (auditErr) {
            logger.warn(
              `[upsertDocumentAggregateById] Audit migrate failed table=${auditModel?.oldDbTable} ID=${id}: ${auditErr.message}`
            );
          }
        }
      } catch (err) {
        logger.warn(
          `[upsertDocumentAggregateById] Fetch audit failed table=${auditModel?.oldDbTable} ID=${id}: ${err.message}`
        );
      }
    }

    // ─────────────────────────────
    // 3️⃣ UPSERT COMMENT
    // ─────────────────────────────
    for (const commentModel of this._syncCommentModel || []) {
      try {
        const rawComments =
          await commentModel.fetchByDocumentId(id);

        if (!Array.isArray(rawComments) || !rawComments.length)
          continue;

        for (const rawComment of rawComments) {
          try {
            const result =
              await commentModel.processSingleRecord(
                rawComment,
                documentId,
                transaction
              );

            if (!result) continue;

            totalAffected += Number(result.inserted || 0);
            totalAffected += Number(result.updated || 0);

          } catch (err) {
            logger.warn(
              `[upsertDocumentAggregateById] Comment migrate failed table=${commentModel?.oldDbTable} ID=${id}: ${err.message}`
            );
          }
        }
      } catch (err) {
        logger.warn(
          `[upsertDocumentAggregateById] Fetch comment failed table=${commentModel?.oldDbTable} ID=${id}: ${err.message}`
        );
      }
    }

    return {
      action: 'upsert',
      affected: Number(totalAffected || 0)
    };
  }
}

module.exports = OutGoingDocumentModel;