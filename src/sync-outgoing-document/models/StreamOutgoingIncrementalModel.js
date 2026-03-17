const logger = require('../../../utils/logger');
const sql = require('mssql');
const { v4: uuidv4 } = require("uuid");
const SyncCommentModel = require('../../sync-document-comment/SyncCommentModel');
const SyncAuditModel = require('../../sync-audit/SyncAuditModel');
const StreamOutgoingMigrationModel = require('./StreamOutgoingMigrationModel');
const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const FileService = require('../../sync-file-copy/Fileuploadservice');
const { downloadFile: spDownload } = require('../../sync-file-copy/SharePointAuthService');

/**
 * Phát hiện MIME type từ magic bytes — thay thế package file-type (ESM-only)
 */
function detectFileType(buffer) {
  if (!buffer || buffer.length < 4) return { mime: 'application/octet-stream', ext: 'bin' };
  const b = buffer;
  if (b[0]===0x25&&b[1]===0x50&&b[2]===0x44&&b[3]===0x46) return { mime:'application/pdf', ext:'pdf' };
  if (b[0]===0x89&&b[1]===0x50&&b[2]===0x4E&&b[3]===0x47) return { mime:'image/png', ext:'png' };
  if (b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF)               return { mime:'image/jpeg', ext:'jpg' };
  if (b[0]===0x47&&b[1]===0x49&&b[2]===0x46)               return { mime:'image/gif', ext:'gif' };
  if (b[0]===0x42&&b[1]===0x4D)                             return { mime:'image/bmp', ext:'bmp' };
  if (b[0]===0x50&&b[1]===0x4B&&b[2]===0x03&&b[3]===0x04) {
    const s = buffer.slice(0,200).toString('latin1');
    if (s.includes('word/')) return { mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext:'docx' };
    if (s.includes('xl/'))   return { mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext:'xlsx' };
    if (s.includes('ppt/'))  return { mime:'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext:'pptx' };
    return { mime:'application/zip', ext:'zip' };
  }
  if (b[0]===0xD0&&b[1]===0xCF&&b[2]===0x11&&b[3]===0xE0) return { mime:'application/msword', ext:'doc' };
  if (b[0]===0x52&&b[1]===0x61&&b[2]===0x72&&b[3]===0x21) return { mime:'application/x-rar-compressed', ext:'rar' };
  return { mime:'application/octet-stream', ext:'bin' };
}
const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

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
  'LuanChuyenVanBan_YTE'
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
  'Comments_YTE'
];

class OutGoingDocumentModel extends BaseIncrementalSyncInterface {
  /**
   * Configures source/staging tables and nested migration models for outgoing incremental sync.
   */
  constructor() {
    super({ modelName: 'STREAM_OUTGOING_INCREMENTAL' });
    this.newDbName = process.env.NEW_DB_NAME;
    this.oldDbSchema = 'dbo';
    this.oldDbTable = 'VanBanBanHanh';
    this.newDbSchema = 'dbo';
    this.newTableSync = 'outgoing_documents_temp';

    this._syncAuditModel = [];
    this._syncCommentModel = [];
    this._outGoingMigrationModels = null;
    this._fileService = null;
  }

  /**
   * Initializes DB pools and dependent audit/comment/document models.
   * @returns {Promise<void>}
   */
  async initialize() {
    await super.initialize();
    await this.ensureStagingTableExists();

    this._syncAuditModel = [];
    this._syncCommentModel = [];

    this._outGoingMigrationModels = new StreamOutgoingMigrationModel();
    await this._outGoingMigrationModels.initialize();

    // Khởi tạo FileService một lần với pool đã sẵn sàng
    this._fileService = new FileService(this.newPool);

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
      `[OutGoingDocumentModel] Initialized with auditTables=${this._syncAuditModel.length}, commentTables=${this._syncCommentModel.length}`
    );
  }

  /**
   * Tự động tạo bảng staging `outgoing_documents_temp` trong DB mới nếu chưa tồn tại.
   * Clone cấu trúc từ `VanBanBanHanh` (DB cũ) qua SELECT TOP 0 * INTO.
   */
    async ensureStagingTableExists() {
      const table = this.getStagingTableRef();

      const query = `
      IF OBJECT_ID('${table}', 'U') IS NOT NULL
          DROP TABLE ${table};

      CREATE TABLE ${table} (
        -- Source columns (raw from VanBanBanHanh / old DB)
        ID                          NVARCHAR(255)   NOT NULL,
        Title                       NVARCHAR(MAX),
        BanLanhDao                  NVARCHAR(MAX),
        ChenSo                      NVARCHAR(MAX),
        TrangThai                   NVARCHAR(MAX),
        IsLibrary                   NVARCHAR(MAX),
        DoKhan                      NVARCHAR(MAX),
        DoMat                       NVARCHAR(MAX),
        DonVi                       NVARCHAR(MAX),
        Files                       NVARCHAR(MAX),
        ChucVu                      NVARCHAR(MAX),
        DocNum                      NVARCHAR(MAX),
        NguoiSoanThaoText           NVARCHAR(MAX),
        FolderLocation              NVARCHAR(MAX),
        HoSoXuLyLink                NVARCHAR(MAX),
        InfoVBDi                    NVARCHAR(MAX),
        ItemVBPH                    NVARCHAR(MAX),
        LoaiBanHanh                 NVARCHAR(MAX),
        LoaiVanBan                  NVARCHAR(MAX),
        NoiLuuTru                   NVARCHAR(MAX),
        NoiNhan                     NVARCHAR(MAX),
        NgayBanHanh                 NVARCHAR(MAX),
        NgayHieuLuc                 NVARCHAR(MAX),
        NgayHoanTat                 NVARCHAR(MAX),
        NguoiKyVanBan               NVARCHAR(MAX),
        NguoiKyVanBanText           NVARCHAR(MAX),
        PhanCong                    NVARCHAR(MAX),
        TraLoiVBDen                 NVARCHAR(MAX),
        SoBan                       NVARCHAR(MAX),
        SoTrang                     NVARCHAR(MAX),
        SoVanBan                    NVARCHAR(MAX),
        SoVanBanText                NVARCHAR(MAX),
        TrichYeu                    NVARCHAR(MAX),
        BanLanhDaoTCT               NVARCHAR(MAX),
        YKien                       NVARCHAR(MAX),
        YKienChiHuy                 NVARCHAR(MAX),
        ModuleId                    NVARCHAR(MAX),
        SiteName                    NVARCHAR(MAX),
        ListName                    NVARCHAR(MAX),
        ItemId                      NVARCHAR(MAX),
        YearMonth                   NVARCHAR(MAX),
        Modified                    NVARCHAR(MAX),
        Created                     NVARCHAR(MAX),
        ModifiedBy                  NVARCHAR(MAX),
        CreatedBy                   NVARCHAR(MAX),
        MigrateFlg                  NVARCHAR(MAX),
        MigrateErrFlg               NVARCHAR(MAX),
        MigrateErrMess              NVARCHAR(MAX),
        LoaiMoc                     NVARCHAR(MAX),
        KySoFiles                   NVARCHAR(MAX),
        DGPId                       NVARCHAR(MAX),
        Workflow                    NVARCHAR(MAX),
        IsKyQuyChe                  NVARCHAR(MAX),
        DocSignType                 NVARCHAR(MAX),
        IsConverting                NVARCHAR(MAX),
        CodeItemId                  NVARCHAR(MAX),

        -- Mapped/output columns (từ StreamOutgoingMigrationModel)
        document_id                 NVARCHAR(MAX),
        status_code                 NVARCHAR(MAX),
        sender_unit                 NVARCHAR(MAX),
        drafter                     NVARCHAR(MAX),
        document_type               NVARCHAR(MAX),
        urgency_level               NVARCHAR(MAX),
        private_level               NVARCHAR(MAX),
        document_field              NVARCHAR(MAX),
        report_signer               NVARCHAR(MAX),
        report_document_symbol      NVARCHAR(MAX),
        to_book_text_symbols        NVARCHAR(MAX),
        viewers                     NVARCHAR(MAX),
        deadline_reply              NVARCHAR(MAX),
        abstract_note               NVARCHAR(MAX),
        recipient_ids               NVARCHAR(MAX),
        internal_receiving_unit     NVARCHAR(MAX),
        reply_incomming_doc         NVARCHAR(MAX),
        created_at                  NVARCHAR(MAX),
        updated_at                  NVARCHAR(MAX),
        draft_signer                NVARCHAR(MAX),
        book_document_id            NVARCHAR(MAX),
        status                      NVARCHAR(MAX),
        code_commanders             NVARCHAR(MAX),
        commanders                  NVARCHAR(MAX),
        current_note                NVARCHAR(MAX),
        to_book                     NVARCHAR(MAX),
        release_no                  NVARCHAR(MAX),
        release_date                NVARCHAR(MAX),
        text_symbols                NVARCHAR(MAX),
        doc_work_files              NVARCHAR(MAX),
        doc_proposal                NVARCHAR(MAX),
        doc_draft                   NVARCHAR(MAX),
        doc_attachments             NVARCHAR(MAX),
        doc_recall                  NVARCHAR(MAX),
        doc_replacement             NVARCHAR(MAX),
        doc_answer                  NVARCHAR(MAX),
        external_receiving_unit     NVARCHAR(MAX),
        internal_receiving_dept     NVARCHAR(MAX),
        processor                   NVARCHAR(MAX),
        type_doc                    NVARCHAR(MAX),
        bpmn_version                NVARCHAR(MAX),
        vieweds                     NVARCHAR(MAX),
        know_receivers              NVARCHAR(MAX),
        type_of_process             NVARCHAR(MAX),
        replaced_documents          NVARCHAR(MAX),
        id_outgoing_bak             NVARCHAR(MAX),
        internal_receiving_dept_old NVARCHAR(MAX),
        sign_type                   NVARCHAR(MAX),
        from_create_draf            NVARCHAR(MAX),
        replaced                    NVARCHAR(MAX),
        tb_bak                      NVARCHAR(MAX),
        table_backup                NVARCHAR(MAX),
        send_id_bak_bef_test        NVARCHAR(MAX),
        status_code_bak_bef_test    NVARCHAR(MAX),
        drafter_bak_bef_test        NVARCHAR(MAX),

        CONSTRAINT PK_outgoing_documents_temp PRIMARY KEY (ID)
      );
      `;

      await this.queryNewDb(query);
    }

  /**
   * Resolves fully-qualified staging table reference in NEW DB.
   * @returns {string}
   */
  getStagingTableRef() {
    if (this.newDbName) {
      return `${this.newDbName}.${this.newDbSchema}.${this.newTableSync}`;
    }
    return `${this.newDbSchema}.${this.newTableSync}`;
  }

  /**
   * Validates and escapes one dynamic source column name.
   * @param {string} column
   * @returns {string}
   */
  sanitizeColumnName(column) {
    if (!/^[A-Za-z0-9_]+$/.test(column)) {
      throw new Error(`Invalid column name from source: ${column}`);
    }
    return `[${column}]`;
  }

  /**
   * Converts arbitrary datetime input to stable ISO cursor format.
   * @param {string|Date|null|undefined} value
   * @returns {string}
   */
  normalizeSyncTime(value) {
    if (!value) return DEFAULT_SYNC_TIME;
    const dateValue = new Date(value);
    if (Number.isNaN(dateValue.getTime())) return DEFAULT_SYNC_TIME;
    return dateValue.toISOString();
  }

  /**
   * Extracts row-level sync timestamp used for cursor advancement.
   * @param {object} row
   * @returns {string|null}
   */
  extractRowSyncTime(row) {
    const raw = row?.__sync_time || row?.Modified || row?.Created || row?.NgayTao || row?.updated_at || null;
    if (!raw) return null;
    const dateValue = new Date(raw);
    if (Number.isNaN(dateValue.getTime())) return null;
    return dateValue.toISOString();
  }

  /**
   * Extracts row-level sync id used as tie-breaker for same timestamp.
   * @param {object} row
   * @returns {number}
   */
  extractRowSyncId(row) {
    return Number(row?.__sync_id || row?.ID || 0);
  }

  /**
   * Compares two cursors and returns true when (aTime,aId) is ahead of (bTime,bId).
   * @param {string} aTime
   * @param {number} aId
   * @param {string} bTime
   * @param {number} bId
   * @returns {boolean}
   */
  isCursorAhead(aTime, aId, bTime, bId) {
    const ta = new Date(aTime || DEFAULT_SYNC_TIME).getTime();
    const tb = new Date(bTime || DEFAULT_SYNC_TIME).getTime();
    if (ta > tb) return true;
    if (ta < tb) return false;
    return Number(aId || 0) > Number(bId || 0);
  }

  /**
   * Returns SQL expression that normalizes source sync time across supported columns.
   * @returns {string}
   */
  getSyncTimeExpression() {
    return `
      COALESCE(
        TRY_CONVERT(datetime2, Modified),
        TRY_CONVERT(datetime2, Created)
      )
    `;
  }

    /**
   * Tìm một bản ghi đầy đủ trong bảng staging theo ID.
   * @param {string|number} id - ID của bản ghi cần tìm
   * @param {object} [transaction] - SQL Transaction (nếu có)
   * @returns {Promise<object|null>} Bản ghi đầy đủ hoặc null nếu không tìm thấy
   */
  async getByIdFromStaging(id, transaction = null) {
    if (!id) {
      throw new Error('[getByIdFromStaging] id là bắt buộc.');
    }

    const stagingTableRef = this.getStagingTableRef();

    const query = `
      SELECT TOP 1 *
      FROM ${stagingTableRef}
      WHERE ID = @id
    `;

    const rows = await this.queryNewDbTx(
      query,
      { id: String(id).trim() },
      transaction
    );

    return rows?.[0] || null;
  }

  /**
   * Tìm một bản ghi đầy đủ trong bảng VanBanBanHanh (old DB) theo ID.
   * @param {string|number} id - ID của bản ghi cần tìm
   * @returns {Promise<object|null>} Bản ghi đầy đủ hoặc null nếu không tìm thấy
   */
  async getByIdFromOldDb(id) {
    if (!id) {
      throw new Error('[getByIdFromOldDb] id là bắt buộc.');
    }

    const query = `
      SELECT TOP 1 *
      FROM ${this.oldDbSchema}.${this.oldDbTable}
      WHERE ID = @id
    `;

    const rows = await this.queryOldDb(
      query,
      { id: String(id).trim() }
    );

    return rows?.[0] || null;
  }

  /**
   * Loads incremental source records from OLD DB after current cursor.
   * @param {string} lastSyncTime
   * @param {number} [lastSyncId=0]
   * @returns {Promise<object[]>}
   */
  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0) {
    const syncTimeExpr = this.getSyncTimeExpression();
    const query = `
      ;WITH source_rows AS (
        SELECT
          *,
          ${syncTimeExpr} AS __sync_time,
          TRY_CONVERT(
            BIGINT,
            NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), '')
          ) AS __sync_id_num
        FROM ${this.oldDbSchema}.${this.oldDbTable}
      )
      SELECT
        *,
        ISNULL(__sync_id_num, 0) AS __sync_id
      FROM source_rows
      WHERE (
        __sync_time > @lastSyncTime
        OR (
          __sync_time = @lastSyncTime
          AND ISNULL(__sync_id_num, -9223372036854775808) > @lastSyncId
        )
      )
      ORDER BY
        __sync_time ASC,
        ISNULL(__sync_id_num, -9223372036854775808) ASC,
        ID ASC
    `;

    return this.queryOldDb(query, {
      lastSyncTime,
      lastSyncId: Number(lastSyncId || 0)
    });
  }

  /**
   * Upserts source rows into staging table so process phase can read deterministic snapshots.
   * @param {object[]} rows
   * @param {{transaction?: object}} [context]
   * @returns {Promise<{stagedCount:number}>}
   */
  async syncOldToStaging(rows, { transaction } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { stagedCount: 0 };
    }

    const internalColumns = new Set(['__sync_time', '__sync_id', '__sync_id_num']);
    const columns = Object.keys(rows[0] || {}).filter((column) => !internalColumns.has(column));
    if (!columns.length) {
      return { stagedCount: 0 };
    }

    if (!columns.includes('ID')) {
      throw new Error('Staging sync requires source column "ID"');
    }

    const safeColumns = columns.map((column) => this.sanitizeColumnName(column));
    const nonIdColumns = columns.filter((column) => column !== 'ID');
    const safeNonIdColumns = nonIdColumns.map((column) => this.sanitizeColumnName(column));
    const stagingTableRef = this.getStagingTableRef();

    for (const row of rows) {
      const rawId = row?.ID;
      if (rawId == null || String(rawId).trim() === '') {
        throw new Error('Row ID is required for staging');
      }

      const params = {};
      for (const column of columns) {
        params[column] = row[column];
      }

      const updateClause = safeNonIdColumns
        .map((columnName, idx) => `${columnName} = @${nonIdColumns[idx]}`)
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
          VALUES (${columns.map((column) => `@${column}`).join(', ')});
        END
      `;

      await this.queryNewDbTx(query, params, transaction);
    }

    return { stagedCount: rows.length };
  }

  /**
   * Builds one staged incremental list for a sync job and returns cursor progression info.
   * @param {string} lastSyncTime
   * @param {string} syncJobId
   * @param {number} [lastSyncId=0]
   * @returns {Promise<object>}
   */
  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    if (!syncJobId) {
      throw new Error('syncJobId is required');
    }

    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);
    const rows = await this.fetchListFromOldDb(normalizedLastSyncTime, normalizedLastSyncId);
    const stageResult = await this.syncOldToStaging(rows);

    let nextSyncTime = normalizedLastSyncTime;
    let nextSyncId = normalizedLastSyncId;

    for (const row of rows) {
      const rowTime = this.extractRowSyncTime(row);
      const rowId = this.extractRowSyncId(row);
      if (!rowTime) continue;
      if (this.isCursorAhead(rowTime, rowId, nextSyncTime, nextSyncId)) {
        nextSyncTime = rowTime;
        nextSyncId = rowId;
      }
    }

    return {
      syncJobId,
      rows,
      totalCount: rows.length,
      stagedCount: Number(stageResult?.stagedCount || 0),
      sourceLastSyncTime: normalizedLastSyncTime,
      sourceLastSyncId: normalizedLastSyncId,
      lastSyncTime: nextSyncTime,
      lastSyncId: nextSyncId
    };
  }

  /**
   * Reads persisted sync job state from sync_jobs table.
   * @param {string} syncJobId
   * @returns {Promise<object|null>}
   */
  async getSyncJobState(syncJobId) {
    if (!syncJobId) {
      throw new Error('syncJobId is required');
    }

    const rows = await this.queryNewDb(
      `
      SELECT TOP 1
        job_id,
        total_to_sync,
        total_processed,
        total_success,
        total_errors,
        last_sync_time,
        last_sync_id
      FROM sync_jobs
      WHERE job_id = @syncJobId
      `,
      { syncJobId }
    );

    return rows?.[0] || null;
  }

  /**
   * Processes one staged item for a sync job inside a DB transaction.
   * @param {string} syncJobId
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async processOne(syncJobId, options = {}) {
    if (!syncJobId) {
      throw new Error('syncJobId is required');
    }

    const jobState = await this.getSyncJobState(syncJobId);
    const itemIndex = Number(
      options.itemIndex != null
        ? options.itemIndex
        : (jobState?.total_processed || 0)
    );

    const sourceLastSyncTime = this.normalizeSyncTime(
      options.sourceLastSyncTime || options.lastSyncTime || jobState?.last_sync_time || DEFAULT_SYNC_TIME
    );
    const sourceLastSyncId = Number(
      options.sourceLastSyncId != null
        ? options.sourceLastSyncId
        : (jobState?.last_sync_id || 0)
    );

    const transaction = new sql.Transaction(this.newPool);
    await transaction.begin();

    try {
      const rowData = await this.fetchOneFromStaging({
        lastSyncTime: sourceLastSyncTime,
        lastSyncId: sourceLastSyncId,
        itemIndex,
        transaction
      });

      if (!rowData) {
        await transaction.commit();
        return {
          syncJobId,
          itemIndex,
          processed: false,
          done: true
        };
      }

      const result = await this.processRowData(rowData, { transaction });
      await transaction.commit();

      return {
        syncJobId,
        itemIndex,
        processed: true,
        done: false,
        rowId: rowData.ID || null,
        result
      };
    } catch (error) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        logger.error('[OutGoingDocumentModel.processOne] rollback failed:', rollbackError);
      }
      throw error;
    }
  }

  /**
   * Reads one deterministic row from staging based on source cursor and item index.
   * @param {{lastSyncTime:string,lastSyncId?:number,itemIndex:number,transaction?:object}} context
   * @returns {Promise<object|null>}
   */
  async fetchOneFromStaging({ lastSyncTime, lastSyncId = 0, itemIndex, transaction } = {}) {
    const rowNumber = Number(itemIndex || 0) + 1;
    const stagingTableRef = this.getStagingTableRef();
    const syncTimeExpr = this.getSyncTimeExpression();
    const query = `
      ;WITH source_rows AS (
        SELECT
          *,
          ${syncTimeExpr} AS __sync_time,
          TRY_CONVERT(
            BIGINT,
            NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), '')
          ) AS __sync_id_num
        FROM ${stagingTableRef}
      ),
      staged AS (
        SELECT
          *,
          ROW_NUMBER() OVER (
            ORDER BY
              __sync_time ASC,
              ISNULL(__sync_id_num, -9223372036854775808) ASC,
              ID ASC
          ) AS rn
        FROM source_rows
        WHERE (
          __sync_time > @lastSyncTime
          OR (
            __sync_time = @lastSyncTime
            AND ISNULL(__sync_id_num, -9223372036854775808) > @lastSyncId
          )
        )
      )
      SELECT TOP 1 *
      FROM staged
      WHERE rn = @rowNumber
    `;

    const rows = await this.queryNewDbTx(
      query,
      {
        lastSyncTime,
        lastSyncId: Number(lastSyncId || 0),
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

  /**
   * Validates and applies one outgoing row into destination aggregates.
   * @param {object} rowData
   * @param {{transaction?: object}} [context]
   * @returns {Promise<{action:string,backupId:string,affected:number}>}
   */
  async processRowData(rowData, { transaction } = {}) {
    if (!rowData) {
      throw new Error('rowData is required');
    }

    const backupId = String(rowData.ID || '').trim();
    if (!backupId) {
      throw new Error('Invalid document ID from staging');
    }

    const res = await this.upsertDocumentAggregateById(rowData, { transaction });
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
  // hàm nhận vào bản ghi cũ và mới để thêm file
  async ThemFileDinhKem(oldRecord, newDocumentRecord) {

    const files = oldRecord?.Files || '';

    if (!files) {
      return false;
    }

    try {
      const fileSvc = this._fileService;
      const baseUrl = (process.env.BASE_URL || "").replace(/\/$/, "");
      if (!baseUrl) {
        logger.error('[ThemFileDinhKem][Outgoing] BASE_URL is not configured in .env');
        return false;
      }

      const parts = files.split('|').filter(Boolean);
      if (parts.length === 0) return true;

      let filesToProcess = [];

      // Heuristic to decide parsing strategy based on the format of the first part.
      const firstPartIsLikelyFile = /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|bmp|txt|zip|rar)$/i.test(parts[0]);

      if (firstPartIsLikelyFile) {
        // FORMAT 1: "path/to/file.ext|other_data..."
        filesToProcess.push(parts[0]);
      } else {
        // FORMAT 2: "path/to/dir/|file1.pdf|file2.docx"
        const directory = parts[0];
        const names = parts.slice(1);
        for (const name of names) {
          if (!name) continue;
          const relativePath = directory.endsWith('/') ? `${directory}${name}` : `${directory}/${name}`;
          filesToProcess.push(relativePath);
        }
      }

      for (const relativePath of filesToProcess) {
        if (!relativePath || !relativePath.includes('/')) {
          logger.warn(`[ThemFileDinhKem][Outgoing] Skipping invalid path part: "${relativePath}" for record ${oldRecord?.ID}`);
          continue;
        }

        const fullUrl = `${baseUrl}${relativePath}`;
        const fileName = relativePath.substring(relativePath.lastIndexOf('/') + 1);

        let buffer;
        try {
          buffer = await spDownload(fullUrl);
        } catch (downloadErr) {
          logger.error(`[ThemFileDinhKem][Outgoing] Failed to download file from ${fullUrl}: ${downloadErr.message}`);
          continue;
        }

        const fileType = detectFileType(buffer);
        const mimeType = fileType.mime;

        const fileIdBak = uuidv4();
        const fileRecord = {
          file_name: fileName,
          file_path: relativePath,
          mime_type: mimeType,
          created_by: newDocumentRecord?.drafter,
          version: 1,
          id_bak: fileIdBak,
          table_bak: 'VanBanBanHanh',
          type_doc: newDocumentRecord?.type_doc,
          isBak: 1
        };

        const relationRecord = {
          object_type: 'docDraft',
          object_id: String(newDocumentRecord?.id),  // ID văn bản trong DB mới — NOT NULL
          object_id_bak: oldRecord?.ID,
          file_id_bak: fileIdBak,
          table_bak: 'VanBanBanHanh',
          type_doc: 'docDraft',
        };

        await fileSvc.uploadAndInsert({
          fileBuffer: buffer,
          originalName: fileName,
          mimeType,
          fileRecord,
          relationRecord,
          folder: 'outgoing',
          localFolder: 'outgoing'
        });
      }

      return true;
    } catch (error) {
      logger.error(`[ThemFileDinhKem][Outgoing] Unexpected error while migrating files for record ID ${oldRecord?.ID}: ${error.message}`, { stack: error.stack });
      return false;
    }

}

  /**
   * Upserts one outgoing document and its related audit/comment entities.
   * @param {object} oldRecord
   * @param {{transaction?: object}} [context]
   * @returns {Promise<{action:string,affected:number}>}
   */
  async upsertDocumentAggregateById(oldRecord, { transaction } = {}) {
    if (!oldRecord) {
      return { action: 'none', affected: 0 };
    }
    const id = String(oldRecord.ID || '').trim();
    const oldDbRecord = id
      ? await this.getByIdFromOldDb(id).catch(err => {
          logger.warn(`[upsertDocumentAggregateById] Không lấy được old record ID=${id}: ${err.message}`);
          return null;
        })
      : null;    
    if (!this._outGoingMigrationModels) {
      throw new Error(`[upsertDocumentAggregateById] Model not initialized for ID=${id}`);
    }

    let totalAffected = 0;

    const documentResult = await this._outGoingMigrationModels.processSingleRecord(
      oldRecord,
      transaction
    );

    if (!documentResult || documentResult.affected === 0) {
      return { action: 'none', affected: 0 };
    }
    logger.info(
      `[AggregateSync][Document] documentId=${documentResult.documentId} action=${documentResult?.action} affected=${documentResult?.affected}`
    );

    totalAffected += Number(documentResult.affected || 0);
    const documentId = documentResult.documentId;
    const stagingRecord = documentId
      ? await this.getByIdFromStaging(id, transaction).catch(err => {
          logger.warn(`[upsertDocumentAggregateById] Không lấy được staging record ID=${id}: ${err.message}`);
          return null;
        })
      : null;
    if (!documentId) {
      return {
        action: documentResult.action || 'upsert',
        affected: Number(totalAffected || 0)
      };
    }

    /* ====== thêm file====== */
    try {
      if (oldRecord?.Files) {
        const ok = await this.ThemFileDinhKem(
          oldRecord,
          {
            id: documentId,
            type_doc: stagingRecord?.type_doc
          }
        );

        logger.info(
          `[AggregateSync][Files] documentId=${documentId} migrated=${ok}`
        );
      }
    } catch (fileErr) {
      logger.warn(
        `[upsertDocumentAggregateById] File migrate failed ID=${id}: ${fileErr.message}`
      );
    }


    for (const auditModel of this._syncAuditModel || []) {
      try {
        const rawAudits =
          await auditModel.fetchByOutgoingDocumentId(
            id
          );

        if (!Array.isArray(rawAudits) || !rawAudits.length) {
          continue;
        }

        for (const rawAudit of rawAudits) {
          try {
            const result = await auditModel.processSingleRecord(rawAudit, documentId, transaction);
            if (!result) continue;
            logger.info(
              `[AggregateSync][Audit] table=${auditModel?.oldDbTable} documentId=${documentResult.documentId} inserted=${result?.inserted || 0} updated=${result?.updated || 0}`
            );
            totalAffected += Number(result.inserted || 0);
            totalAffected += Number(result.updated || 0);
          } catch (auditErr) {
            logger.warn(
              `[upsertDocumentAggregateById] Audit migrate failed table=${auditModel?.oldDbTable} ID=${id}: ${auditErr.message}`
            );
          }
        }
      } catch (error) {
        logger.warn(
          `[upsertDocumentAggregateById] Fetch audit failed table=${auditModel?.oldDbTable} ID=${id}: ${error.message}`
        );
      }
    }

    for (const commentModel of this._syncCommentModel || []) {
      try {
        const rawComments = await commentModel.fetchByDocumentId(id);
        
        if (!Array.isArray(rawComments) || !rawComments.length) {
          continue;
        }

        for (const rawComment of rawComments) {
          try {
            const result = await commentModel.processSingleRecord(rawComment, documentId, transaction);
            if (!result) continue;
            logger.info(
              `[AggregateSync][Comment] table=${commentModel?.oldDbTable} documentId=${documentResult.documentId} inserted=${result?.inserted || 0} updated=${result?.updated || 0}`
            );
            totalAffected += Number(result.inserted || 0);
            totalAffected += Number(result.updated || 0);
          } catch (error) {
            logger.warn(
              `[upsertDocumentAggregateById] Comment migrate failed table=${commentModel?.oldDbTable} ID=${id}: ${error.message}`
            );
          }
        }
      } catch (error) {
        logger.warn(
          `[upsertDocumentAggregateById] Fetch comment failed table=${commentModel?.oldDbTable} ID=${id}: ${error.message}`
        );
      }
    }
    // logic xu
  
    return {
      action: documentResult.action || 'upsert',
      affected: Number(totalAffected || 0)
    };
  }
}

module.exports = OutGoingDocumentModel;