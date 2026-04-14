const logger = require('../../../utils/logger');
const sql = require('mssql');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
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

const SyncCommentModel = require('../../sync-document-comment/SyncCommentModel');
const SyncIncomingAuditModel = require('../../sync-audit/SyncIncomingAuditModel');
const SyncIncomingDocumentModel = require('./SyncIncomingDocumentModel');
const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');

const {
  CATEGORY_INCOMING_SUBMIT,
  CATEGORY_INCOMING_TCT,
  CATEGORY_INCOMING,
  CATEGORY_INCOMING_INTERNAL
} = require('../../sync-audit/SyncAuditModel');

const DEFAULT_SYNC_TIME = '1753-01-01T00:00:00.000Z';

// Lọc bản ghi cũ hơn ngưỡng này. Đặt trong .env với key SYNC_MIN_DATE.
// Ví dụ: SYNC_MIN_DATE=2026-01-01T00:00:00.000Z
// Để tắt filter (lấy toàn bộ lịch sử), để trống hoặc đặt bằng '1753-01-01T00:00:00.000Z'
const SYNC_MIN_DATE = process.env.SYNC_MIN_DATE || '2026-01-01T00:00:00.000Z';
const AUDIT_MIN_DATE = (process.env.AUDIT_MIN_DATE || '').trim();

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

class IncomingDocumentModel extends BaseIncrementalSyncInterface {
  /**
   * Configures source/staging tables and nested migration models for Incoming incremental sync.
   */
  constructor() {
    super({ modelName: 'STREAM_INCOMING_INCREMENTAL' });
    this.newDbName = process.env.NEW_DB_NAME;
    this.oldDbSchema = 'dbo';
    this.oldDbTable = 'VanBanDen';
    this.newDbSchema = 'dbo';
    this.newTableSync = 'incomming_documents_sync';

    this._syncAuditModel = [];
    this._syncAuditModelMap = new Map();
    this._syncCommentModel = [];
    this._IncomingMigrationModels = null;
    this._fileService = null;
  }

  /**
   * Initializes DB pools, creates staging table if needed,
   * and initializes dependent audit/comment/document models.
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      await super.initialize();
      await this.ensureStagingTableExists();

      try {
        await this.queryNewDb(`
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'incomming_documents' AND COLUMN_NAME = 'table_backups')
                ALTER TABLE dbo.incomming_documents ADD table_backups NVARCHAR(MAX) NULL;
        `);
      } catch(e) {
        logger.warn(`[IncomingDocumentModel] Failed to auto alter table incomming_documents: ${e.message}`);
      }

      this._syncAuditModel = [];
      this._syncAuditModelMap = new Map();
      this._syncCommentModel = [];

      this._IncomingMigrationModels = new SyncIncomingDocumentModel();
      await this._IncomingMigrationModels.initialize();

      this._fileService = new FileService(this.newPool);

      for (const table of AUDIT_TABLES) {
        const model = new SyncIncomingAuditModel(table);
        await model.initialize();
        this._syncAuditModel.push(model);
        this._syncAuditModelMap.set(table, model);
      }

      // for (const table of COMMENT_TABLES) {
      //   const model = new SyncCommentModel(table);
      //   await model.initialize();
      //   this._syncCommentModel.push(model);
      // }

      logger.info(
        `[IncomingDocumentModel] Initialized with auditTables=${this._syncAuditModel.length}, commentTables=${this._syncCommentModel.length}`
      );
    } catch (error) {
      logger.error(`[IncomingDocumentModel.initialize] Failed to initialize: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Tự động tạo bảng trung gian `incomming_documents_sync` trong DB mới nếu chưa tồn tại.
   * Cấu trúc bảng được clone từ `VanBanDen` (DB cũ) qua IF NOT EXISTS + SELECT TOP 0 * INTO.
   */
    async ensureStagingTableExists() {
      try {
        const stagingTableRef = this.getStagingTableRef();

        const createQuery = `
        IF OBJECT_ID('${stagingTableRef}', 'U') IS NULL
        BEGIN
            CREATE TABLE ${stagingTableRef} (

            ID NVARCHAR(MAX) NULL,
            Title NVARCHAR(MAX) NULL,
            SoDen NVARCHAR(MAX) NULL,
            CoQuanGui2 NVARCHAR(MAX) NULL,
            CoQuanGuiText NVARCHAR(MAX) NULL,
            DonVi NVARCHAR(MAX) NULL,
            IsLibrary NVARCHAR(MAX) NULL,
            DoKhan NVARCHAR(MAX) NULL,
            DoMat NVARCHAR(MAX) NULL,
            Files NVARCHAR(MAX) NULL,
            ThoiHanGQ NVARCHAR(MAX) NULL,
            ItemVBDTCT NVARCHAR(MAX) NULL,
            ItemVBPH NVARCHAR(MAX) NULL,
            BanLanhDao NVARCHAR(MAX) NULL,
            LanhDaoTCT NVARCHAR(MAX) NULL,
            LanhDaoTCTDaXuLy NVARCHAR(MAX) NULL,
            LanhDaoTCTDeBiet NVARCHAR(MAX) NULL,
            LanhDaoVPDN NVARCHAR(MAX) NULL,
            LinhVuc NVARCHAR(MAX) NULL,
            LoaiVanBan NVARCHAR(MAX) NULL,
            NgayDen NVARCHAR(MAX) NULL,
            NgayTrenVB NVARCHAR(MAX) NULL,
            SoBan NVARCHAR(MAX) NULL,
            SoTrang NVARCHAR(MAX) NULL,
            SoVanBan NVARCHAR(MAX) NULL,
            TrangThai NVARCHAR(MAX) NULL,
            TrichYeu NVARCHAR(MAX) NULL,
            VanBanTraLoi NVARCHAR(MAX) NULL,
            ChenSo NVARCHAR(MAX) NULL,
            YKienLanhDao NVARCHAR(MAX) NULL,
            YKienLanhDaoTCT NVARCHAR(MAX) NULL,
            YKienLanhDaoVPDN NVARCHAR(MAX) NULL,
            YKienCuaLDVPChoVanThu NVARCHAR(MAX) NULL,
            ForwardType NVARCHAR(MAX) NULL,
            Modified NVARCHAR(MAX) NULL,
            Created NVARCHAR(MAX) NULL,
            ModifiedBy NVARCHAR(MAX) NULL,
            CreatedBy NVARCHAR(MAX) NULL,
            ModuleId NVARCHAR(MAX) NULL,
            SiteName NVARCHAR(MAX) NULL,
            ListName NVARCHAR(MAX) NULL,
            ItemId NVARCHAR(MAX) NULL,
            MigrateFlg NVARCHAR(MAX) NULL,
            YearMonth NVARCHAR(MAX) NULL,
            MigrateErrFlg NVARCHAR(MAX) NULL,
            MigrateErrMess NVARCHAR(MAX) NULL,
            ItemVBPHOld NVARCHAR(MAX) NULL,
            DGPId NVARCHAR(MAX) NULL
            )
        END
        `;

        await this.queryNewDb(createQuery);

        logger.info(`[IncomingDocumentModel] Staging table ready`);
      } catch (err) {
        logger.error(`[IncomingDocumentModel.ensureStagingTableExists] Failed to create or verify staging table: ${err.message}`, { stack: err.stack });
        throw err;
      }
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
    if (!value || value === '2100-01-01T00:00:00.000Z') return DEFAULT_SYNC_TIME;
    const dateValue = new Date(value);
    if (Number.isNaN(dateValue.getTime())) return DEFAULT_SYNC_TIME;
    // Chế độ ASC: Nếu cursor quá cũ, ép về 1753
    if (dateValue.getFullYear() <= 1753) return DEFAULT_SYNC_TIME;
    // Fix #4: Chặn cursor tương lai (> now(VN) + 1h buffer) để tránh skip toàn bộ data
    const maxAllowed = new Date(Date.now() + 8 * 60 * 60 * 1000); // UTC+7 + 1h safe buffer
    if (dateValue > maxAllowed) {
      logger.warn(`[IncomingDocumentModel.normalizeSyncTime] Cursor tương lai bị reset về DEFAULT: ${value}`);
      return DEFAULT_SYNC_TIME;
    }
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
    // Chế độ ASC: "Đi trước" nghĩa là mới hơn
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
        TRY_CONVERT(datetime2, Modified, 105),
        TRY_CONVERT(datetime2, Created, 105),

        TRY_CONVERT(datetime2, Modified, 120),
        TRY_CONVERT(datetime2, Created, 120),

        TRY_CONVERT(datetime2, Modified),
        TRY_CONVERT(datetime2, Created)
      )
    `;
  }

  /**
   * Lấy TẤT CẢ bản ghi từ CSDL cũ về bảng trung gian theo cursor.
   * COMPLETED_LIMIT chỉ được dùng ở bước trung gian → bảng chính (processOne).
   * @param {string} lastSyncTime - cursor từ (exclusive)
   * @param {number} [lastSyncId=0]
   * @param {string|null} [toTime=null] - giới hạn trên (inclusive).
   * @param {number} [offset=0]
   * @param {number} [limit=2000]
   * @returns {Promise<object[]>}
   */
  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0, toTime = null, offset = 0, limit = 2000) {
    try {
      const syncTimeExpr = this.getSyncTimeExpression();
      const toTimeFilter = toTime ? `AND (__sync_time IS NULL OR __sync_time <= @toTime)` : '';

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
        @lastSyncTime = '1753-01-01T00:00:00.000Z'
        OR __sync_time > @lastSyncTime
        OR (
          __sync_time = @lastSyncTime
          AND ISNULL(__sync_id_num, 0) > @lastSyncId
        )
      )
      -- Chỉ lấy bản ghi từ năm 2026 trở đi
      AND __sync_time >= '${SYNC_MIN_DATE}'
      ${toTimeFilter}
      ORDER BY
        __sync_time ASC,
        ISNULL(__sync_id_num, 0) ASC,
        ID ASC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `;

      const params = {
        lastSyncTime,
        lastSyncId: Number(lastSyncId || 0),
        offset: Number(offset || 0),
        limit: Number(limit || 2000)
      };
      if (toTime) params.toTime = toTime;
      return await this.queryOldDb(query, params);
    } catch (error) {
      logger.error(`[IncomingDocumentModel.fetchListFromOldDb] Failed to fetch list: ${error.message}`);
      throw error;
    }
  }

  /**
   * Alias for countListFromOldDb to support SyncHandlerModel.
   */
  async getCount(lastSyncTime, lastSyncId = 0) {
    return this.countListFromOldDb(lastSyncTime, lastSyncId);
  }

  /**
   * Đếm tổng số bản ghi cần hút từ CSDL cũ.
   */
  async countListFromOldDb(lastSyncTime, lastSyncId = 0, toTime = null) {
    try {
      const syncTimeExpr = this.getSyncTimeExpression();
      const toTimeFilter = toTime ? `AND (__sync_time IS NULL OR __sync_time <= @toTime)` : '';

      const query = `
      ;WITH source_rows AS (
        SELECT
          ${syncTimeExpr} AS __sync_time,
          TRY_CONVERT(
            BIGINT,
            NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), '')
          ) AS __sync_id_num
        FROM ${this.oldDbSchema}.${this.oldDbTable}
      )
      SELECT COUNT(1) AS total
      FROM source_rows
      WHERE (
        @lastSyncTime = '1753-01-01T00:00:00.000Z'
        OR __sync_time > @lastSyncTime
        OR (
          __sync_time = @lastSyncTime
          AND ISNULL(__sync_id_num, 0) > @lastSyncId
        )
      )
      -- Chỉ lấy bản ghi từ năm 2026 trở đi
      AND __sync_time >= '${SYNC_MIN_DATE}'
      ${toTimeFilter}
    `;

      const params = { lastSyncTime, lastSyncId: Number(lastSyncId || 0) };
      if (toTime) params.toTime = toTime;
      const res = await this.queryOldDb(query, params);
      return Number(res?.[0]?.total || 0);
    } catch (error) {
      logger.error(`[IncomingDocumentModel.countListFromOldDb] Failed to count: ${error.message}`);
      throw error;
    }
  }

  /**
   * Upserts source rows into staging table dùng BATCH MERGE để tăng tốc.
   * Thay vì row-by-row, gom tất cả rows vào một TVP (Table-Valued-like) qua VALUES list.
   * Mỗi batch tối đa STAGING_BATCH_SIZE rows (default 100) để tránh tham số quá lớn.
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
    // SQL Server giới hạn tối đa 2100 params. Tự động tính batch size an toàn:
    // maxParams = 2000 (để dư một khoảng an toàn), numCols = số cột thực tế
    const numCols = columns.length || 1;
    const safeBatchByParams = Math.max(1, Math.floor(2000 / numCols));
    const configuredBatch  = Number(process.env.STAGING_BATCH_SIZE || 50);
    const BATCH_SIZE = Math.min(configuredBatch, safeBatchByParams);

    // Chia rows thành các mini-batch
    const batches = [];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      batches.push(rows.slice(i, i + BATCH_SIZE));
    }

    let totalStaged = 0;

    try {
      for (const batch of batches) {
        // Validate IDs
        for (const row of batch) {
          if (row?.ID == null || String(row.ID).trim() === '') {
            throw new Error('Row ID is required for staging');
          }
        }

        // Xây dựng MERGE với VALUES list
        // Mỗi row dùng param prefix r{i}_col
        const valueParts = [];
        const params = {};

        for (let i = 0; i < batch.length; i++) {
          const row = batch[i];
          const rowParamNames = columns.map((col) => `@r${i}_${col}`);
          valueParts.push(`(${rowParamNames.join(', ')})`);
          for (const col of columns) {
            let val = row[col];
            // Chuyển Date object thành ISO string
            if (val instanceof Date) val = val.toISOString();
            else if (val !== null && val !== undefined) val = String(val);
            params[`r${i}_${col}`] = val != null ? val : null;
          }
        }

        const updateSetClause = nonIdColumns.length > 0
          ? nonIdColumns.map((col) => `tgt.${this.sanitizeColumnName(col)} = src.${this.sanitizeColumnName(col)}`).join(',\n             ')
          : 'tgt.[ID] = tgt.[ID]'; // noop if no non-id cols

        const mergeQuery = `
        MERGE ${stagingTableRef} AS tgt
        USING (
          SELECT ${columns.map((col) => `${this.sanitizeColumnName(col)}`).join(', ')}
          FROM (VALUES ${valueParts.join(',\n          ')}) AS v(${safeColumns.join(', ')})
        ) AS src ON tgt.[ID] = src.[ID]
        WHEN MATCHED AND (
          tgt.[Modified] IS NULL
          OR TRY_CONVERT(datetime2, src.[Modified]) > TRY_CONVERT(datetime2, tgt.[Modified])
        ) THEN UPDATE SET
             ${updateSetClause}
        WHEN NOT MATCHED BY TARGET THEN
          INSERT (${safeColumns.join(', ')})
          VALUES (${safeColumns.map((c) => `src.${c}`).join(', ')});
        `;

        await this.queryNewDbTx(mergeQuery, params, transaction);
        totalStaged += batch.length;
      }
    } catch (error) {
      logger.error(`[IncomingDocumentModel.syncOldToStaging] Failed to batch merge staging: ${error.message}`, { stack: error.stack });
      throw error;
    }

    return { stagedCount: totalStaged };
  }

  /**
   * Builds one staged incremental list for a sync job and returns cursor progression info.
   * @param {string} lastSyncTime
   * @param {string} syncJobId
   * @param {number} [lastSyncId=0]
   * @returns {Promise<object>}
   */
  async getList(lastSyncTime, syncJobId, lastSyncId = 0, options = {}) {
    try {
      if (!syncJobId) {
        throw new Error('syncJobId is required');
      }

      const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
      const normalizedLastSyncId = Number(lastSyncId || 0);

      let currentSyncTime = normalizedLastSyncTime;
      let currentSyncId = normalizedLastSyncId;

      // ---------------------------------------------------------------
      // Tính toán window thời gian:
      //   fromTime = MAX(Modified) ở bảng trung gian - LOOKBACK_HOURS (default 1h)
      //   toTime   = thời gian hiện tại UTC + 7h (giờ VN hiện tại)
      // ---------------------------------------------------------------
      const stagingTableRef = this.getStagingTableRef();
      const lookbackHours = Number(process.env.STAGING_LOOKBACK_HOURS || 1);
      const nowUtc = new Date();
      // Ưu tiên dùng toTime từ options (Job range)
      const toTime = options.toTime || new Date(nowUtc.getTime() + 7 * 60 * 60 * 1000).toISOString();

      if (currentSyncTime === DEFAULT_SYNC_TIME) {
        // Lấy mốc lớn nhất từ bảng trung gian bằng TRY_CONVERT để xử lý đúng
        const maxRes = await this.queryNewDb(
          `SELECT MAX(TRY_CONVERT(datetime2, Modified)) AS maxTime FROM ${stagingTableRef}`
        );
        if (maxRes?.[0]?.maxTime) {
          const rawMax = new Date(maxRes[0].maxTime);
          // Trừ lookback để re-sync các bản ghi gần nhất tránh bỏ sót
          const fromDate = new Date(rawMax.getTime() - lookbackHours * 60 * 60 * 1000);
          currentSyncTime = fromDate.toISOString();
          logger.info(`[IncomingDocumentModel] Mốc cursor tự động: MAX(staging)=${rawMax.toISOString()} - ${lookbackHours}h => fromTime=${currentSyncTime}`);
        }
      }

      logger.info(`[IncomingDocumentModel] Window đồng bộ: [${currentSyncTime}] → [${toTime}]`);

      let totalStagedCount = 0;
      let allRowsCount = 0;

      const totalCountToFetch = await this.countListFromOldDb(currentSyncTime, currentSyncId, toTime);
      logger.info(`[IncomingDocumentModel] Tổng số bản ghi cần hút về Staging: ${totalCountToFetch}`);

      // Cập nhật Dashboard ngay lập tức để người dùng thấy tổng số bản ghi
      await this.queryNewDb(`UPDATE sync_jobs SET total_to_sync = @total WHERE job_id = @jobId`, {
        total: totalCountToFetch,
        jobId: syncJobId
      });

      const fetchBatchSize = Number(process.env.STAGING_FETCH_BATCH_SIZE || 2000);

      const numIterations = Math.ceil(totalCountToFetch / fetchBatchSize);

      // 2 vòng for: Outer loop theo batch size, Inner loop xử lý batch đó
      for (let i = 0; i < numIterations; i++) {
        const offset = i * fetchBatchSize;
        // Fetch một batch dùng mốc thời gian cố định và offset tăng dần
        const rows = await this.fetchListFromOldDb(currentSyncTime, currentSyncId, toTime, offset, fetchBatchSize);
        if (!rows || rows.length === 0) break;

        // Inner loop (xử lý batch) - Ở đây syncOldToStaging đã xử lý batch MERGE
        let transaction = null;
        let stageResult = null;
        try {
          transaction = new sql.Transaction(this.newPool);
          await transaction.begin();
          stageResult = await this.syncOldToStaging(rows, { transaction });
          await transaction.commit();
        } catch (err) {
          if (transaction) await transaction.rollback().catch(() => {});
          logger.error(`[IncomingDocumentModel] Failed to sync batch to staging at offset ${offset}: ${err.message}`);
          throw err;
        }

        totalStagedCount += Number(stageResult?.stagedCount || 0);
        allRowsCount += rows.length;

        // Tiến cursor (dùng cho log hoặc nếu cần fallback)
        for (const row of rows) {
          const rowTime = this.extractRowSyncTime(row);
          const rowId = this.extractRowSyncId(row);
          if (!rowTime) continue;

          const isAhead = this.isCursorAhead(rowTime, rowId, currentSyncTime, currentSyncId);
          logger.info(`  └─ [Compare] rowID: ${row.ID} | T: ${rowTime} ID: ${rowId} vs Cursor(T: ${currentSyncTime} ID: ${currentSyncId}) -> Ahead: ${isAhead}`);

          if (isAhead) {
            currentSyncTime = rowTime;
            currentSyncId = rowId;
          }
        }

        logger.info(`[IncomingDocumentModel] >> Tiến độ: ${allRowsCount}/${totalCountToFetch} bản ghi (Staged=${totalStagedCount})`);
      }

      logger.info(`[IncomingDocumentModel] Hoàn tất hút ${allRowsCount} bản ghi về Staging. Staged=${totalStagedCount}`);

      // Fix #3: Đếm số bản ghi THỰC TẾ trong staging chưa xử lý (pending)
      // Không dùng allRowsCount (số vừa staged lần này) vì khi Resume nó = 0
      // → SyncHandlerModel sẽ tính remaining = 0 → COMPLETED sai
      const pendingCountRes = await this.queryNewDb(`
        SELECT COUNT(1) AS cnt
        FROM ${stagingTableRef}
        WHERE ISNULL(MigrateFlg, 0) = 0
          AND ISNULL(MigrateErrFlg, 0) = 0
      `);
      const pendingCount = Number(pendingCountRes?.[0]?.cnt || 0);
      logger.info(`[IncomingDocumentModel] Pending records trong Staging chưa xử lý: ${pendingCount}`);

      return {
        syncJobId,
        rows: [],
        totalCount: pendingCount,
        stagedCount: totalStagedCount,
        sourceLastSyncTime: normalizedLastSyncTime,
        sourceLastSyncId: normalizedLastSyncId,
        lastSyncTime: currentSyncTime,
        lastSyncId: currentSyncId
      };
    } catch (error) {
      logger.error(`[IncomingDocumentModel.getList] Failed to get list for syncJobId=${syncJobId}: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Reads persisted sync job state from sync_jobs table.
   * @param {string} syncJobId
   * @returns {Promise<object|null>}
   */
  async getSyncJobState(syncJobId) {
    try {
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
    } catch (error) {
      logger.error(`[IncomingDocumentModel.getSyncJobState] Failed to get sync job state for syncJobId=${syncJobId}: ${error.message}`, { stack: error.stack });
      throw error;
    }
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

    let jobState;
    try {
      jobState = await this.getSyncJobState(syncJobId);
    } catch (error) {
      throw error;
    }

    let rowData = null;
    let transaction = null;

    try {
      const stagingTableRef = this.getStagingTableRef();

      rowData = await this.fetchOneFromStaging();

      if (!rowData) {
        logger.info(`[IncomingDocumentModel] Không còn dữ liệu trong staging (cần xử lý) cho job ${syncJobId}.`);
        // Deferred cursor: cập nhật cursor lên MAX(Modified) sau khi toàn bộ staging xong
        await this.finalizeProcessingCursor(syncJobId);
        return {
          syncJobId,
          processed: false,
          done: true
        };
      }

      const rowId = rowData.ID || null;
      const current = Number(jobState?.total_processed || 0) + 1;
      logger.info(`[IncomingDocumentModel] Process ${current}: record ID=${rowId}`);

      transaction = new sql.Transaction(this.newPool);
      await transaction.begin();

      const result = await this.processRowData(rowData, { transaction });

      // Deferred Cursor strategy: KHÔNG update last_sync_time theo từng record.
      // Với ORDER BY DESC (newest-first), record đầu tiên = mới nhất.
      // Nếu update cursor ngay, nó sẽ nhảy lên tương lai sau 1 bước.
      // Thay vào đó: chỉ tăng counter, cursor được finalize ở cuối (finalizeProcessingCursor).
      await this.queryNewDbTx(
        `UPDATE sync_jobs
         SET total_processed = ISNULL(total_processed, 0) + 1,
             total_success   = ISNULL(total_success, 0) + 1
         WHERE job_id = @syncJobId`,
        { syncJobId },
        transaction
      );

      // Mark staging row as processed successfully
      await this.queryNewDbTx(
        `UPDATE ${stagingTableRef} SET MigrateFlg = 1, MigrateErrFlg = 0, MigrateErrMess = NULL WHERE ID = @ID`,
        { ID: rowId },
        transaction
      );

      await transaction.commit();

      return {
        syncJobId,
        processed: true,
        done: false,
        rowId,
        result
      };
    } catch (error) {
      if (transaction) {
        try {
          await transaction.rollback();
        } catch (rollbackError) {}
      }

      // If failed, mark as error in staging so we skip it next time!
      if (rowData && rowData.ID) {
        try {
           const stagingTableRef = this.getStagingTableRef();
           await this.queryNewDb(`UPDATE ${stagingTableRef} SET MigrateErrFlg = 1, MigrateErrMess = @Err WHERE ID = @ID`, { ID: rowData.ID, Err: String(error.message).slice(0, 1000) });
        } catch (updateErr) {}
      }

      logger.error(`[IncomingDocumentModel.processOne] Failed row ID=${rowData?.ID}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Cập nhật cursor (last_sync_time, last_sync_id) lên MAX(Modified) của tất cả bản ghi
   * đã xử lý thành công trong staging (MigrateFlg=1).
   * Gọi một lần duy nhất ở cuối job (khi fetchOneFromStaging trả null).
   * Đây là phần cốt lõi của "Deferred Cursor" pattern.
   * @param {string} syncJobId
   * @returns {Promise<void>}
   */
  async finalizeProcessingCursor(syncJobId) {
    try {
      const stagingTableRef = this.getStagingTableRef();
      const res = await this.queryNewDb(`
        SELECT
          MAX(TRY_CONVERT(datetime2, Modified)) AS maxTime,
          MAX(TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(ID)), ''))) AS maxId
        FROM ${stagingTableRef}
        WHERE ISNULL(MigrateFlg, 0) = 1
      `);
      if (res?.[0]?.maxTime) {
        const finalTime = new Date(res[0].maxTime).toISOString();
        const finalId   = Number(res[0].maxId || 0);
        await this.queryNewDb(
          `UPDATE sync_jobs
           SET last_sync_time = @t,
               last_sync_id   = @id
           WHERE job_id = @jobId`,
          { t: finalTime, id: finalId, jobId: syncJobId }
        );
        logger.info(`[IncomingDocumentModel] Cursor finalized: last_sync_time=${finalTime}, last_sync_id=${finalId}`);
      } else {
        logger.info(`[IncomingDocumentModel] finalizeProcessingCursor: không có bản ghi đã xử lý, cursor giữ nguyên.`);
      }
    } catch (err) {
      logger.warn(`[IncomingDocumentModel.finalizeProcessingCursor] Lỗi khi finalize cursor: ${err.message}`);
    }
  }

  /**
   * Reads one deterministic row from staging based on source cursor and item index.
   * @param {{lastSyncTime:string,lastSyncId?:number,itemIndex:number,transaction?:object}} context
   * @returns {Promise<object|null>}
   */
  async fetchOneFromStaging() {
    try {
      const stagingTableRef = this.getStagingTableRef();
      // Newest-first (DESC): xử lý bản ghi MỚI NHẤT trước.
      // An toàn vì dùng "Deferred Cursor" pattern:
      //   → Cursor KHÔNG update theo từng record (tránh nhảy lên tương lai)
      //   → Cursor chỉ được finalize 1 lần sau khi staging rống (finalizeProcessingCursor)
      const query = `
      SELECT TOP 1 *
      FROM ${stagingTableRef}
      WHERE ISNULL(MigrateFlg, 0) = 0
        AND ISNULL(MigrateErrFlg, 0) = 0
      ORDER BY TRY_CONVERT(datetime2, Modified) DESC,
               TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(ID)), '')) DESC
      `;

      const rows = await this.queryNewDb(query);
      return rows?.length ? rows[0] : null;
    } catch (error) {
      logger.error(`[IncomingDocumentModel.fetchOneFromStaging] Failed to fetch: ${error.message}`);
      throw error;
    }
  }

  /**
   * Validates and applies one Incoming row into destination aggregates.
   * @param {object} rowData
   * @param {{transaction?: object}} [context]
   * @returns {Promise<{action:string,backupId:string,affected:number}>}
   */
  async processRowData(rowData, { transaction } = {}) {
    try {
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
    } catch (error) {
      const backupId = rowData?.ID || 'unknown';
      logger.error(`[IncomingDocumentModel.processRowData] Failed to process row with ID=${backupId}: ${error.message}`, { stack: error.stack, rowData });
      throw error;
    }
  }

  async ThemFileDinhKem(oldRecord, newDocumentRecord, documentId) {
    const files = oldRecord?.Files || '';
    logger.info(`[DEBUG][ThemFileDinhKem] Dang kiem tra file cho ban ghi ID: ${oldRecord?.ID}. Gia tri cot Files: "${files}"`);

    if (!files) {
      logger.info(`[DEBUG][ThemFileDinhKem] Ban ghi ID ${oldRecord?.ID} KHONG co file đính kèm (cot Files trong DB cũ trống).`);
      return false;
    }

    try {
      const fileSvc = this._fileService;
      const baseUrl = (process.env.BASE_URL || "").replace(/\/$/, "");
      if (!baseUrl) {
        logger.error('[ThemFileDinhKem] BASE_URL is not configured in .env');
        return false;
      }

      const parts = files.split('|').filter(Boolean);
      if (parts.length === 0) return true;

      let filesToProcess = [];

      // Heuristic to decide parsing strategy based on the format of the first part.
      const firstPartIsLikelyFile = /\.(pdf|docx?|xlsx?|jpe?g|png|gif|bmp)$/i.test(parts[0]);

      if (firstPartIsLikelyFile) {
        logger.info(`[DEBUG][ThemFileDinhKem] Phat hien FORMAT 1 (relativePath truc tiep): ${parts[0]}`);
        const relativePath = parts[0];
        filesToProcess.push(relativePath);
      } else {
        const directory = parts[0];
        const names = parts.slice(1);
        logger.info(`[DEBUG][ThemFileDinhKem] Phat hien FORMAT 2 (directory + multiple files). Directory: "${directory}", Files count: ${names.length}`);
        for (const name of names) {
          if (!name) continue;
          const relativePath = directory.endsWith('/') ? `${directory}${name}` : `${directory}/${name}`;
          filesToProcess.push(relativePath);
        }
      }

      logger.info(`[DEBUG][ThemFileDinhKem] Record ${oldRecord.ID}: Found ${filesToProcess.length} files to process: ${filesToProcess.join(', ')}`);

      const uploadPromises = filesToProcess.map(async (relativePath) => {
        if (!relativePath.includes('/')) {
            logger.warn(`[ThemFileDinhKem] Skipping invalid path part: "${relativePath}" for record ${oldRecord.ID}`);
            return;
        }

        const fullUrl = `${baseUrl}${relativePath}`;
        const fileName = relativePath.substring(relativePath.lastIndexOf('/') + 1);

        let buffer;
        try {
          logger.info(`[DEBUG][ThemFileDinhKem] Dang tai file tu SharePoint: ${fullUrl}`);
          // spDownload uses authentication cookies managed by SharePointAuthService
          buffer = await spDownload(fullUrl);
          if (!buffer || buffer.length === 0) {
            throw new Error(`Buffer tải về trống cho file ${fileName}`);
          }
          logger.info(`[DEBUG][ThemFileDinhKem] Tai file thanh cong: ${fileName} | Dung luong: ${buffer.length} bytes`);
        } catch (downloadErr) {
          logger.error(`[ThemFileDinhKem] Failed to download file from ${fullUrl}: ${downloadErr.message}`);
          return; // Skip this file and return
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
          table_bak: 'VanBanDen',
          type_doc: 'IncomingDocument',
          isBak: 1
        };

        const relationRecord = {
          object_type: 'IncomingDocument',
          object_id: String(documentId),
          object_id_bak: oldRecord?.ID,
          file_id_bak: fileIdBak,
          table_bak: 'VanBanDen',
          type_doc: 'IncomingDocument',
        };

        logger.info(`[DEBUG][ThemFileDinhKem] [BUOC 4] Chuan bi metadata de upload. fileName=${fileName}, relativePath=${relativePath}, mimeType=${mimeType}`);
        const result = await fileSvc.uploadAndInsert({
          fileBuffer: buffer,
          originalName: fileName,
          mimeType,
          fileRecord,
          relationRecord,
          folder: 'incoming',
          localFolder: 'incoming'
        });

        logger.info(`[DEBUG][ThemFileDinhKem] [KET QUA] Da hoan tat upload cho file ${fileName}. result: ${JSON.stringify(result)}`);
      });

      await Promise.all(uploadPromises);

      return true;
    } catch (error) {
      logger.error(`[ThemFileDinhKem] Unexpected error while migrating files for record ID ${oldRecord?.ID}: ${error.message}`, { stack: error.stack });
      return false;
    }
  }

/**
   * Tìm một bản ghi đầy đủ trong bảng staging theo ID.
   * @param {string|number} id
   * @param {object} [transaction]
   * @returns {Promise<object|null>}
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
   * Tìm một bản ghi đầy đủ trong bảng VanBanDen (old DB) theo ID.
   * @param {string|number} id
   * @returns {Promise<object|null>}
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
   * Upserts one Incoming document and its related audit/comment entities.
   * @param {object} oldRecord
   * @param {{transaction?: object}} [context]
   * @returns {Promise<{action:string,affected:number}>}
   */
    async upsertDocumentAggregateById(oldRecord, { transaction } = {}) {
        const id = String(oldRecord?.ID || '').trim();
        try {
            if (!oldRecord) {
                return { action: 'none', affected: 0 };
            }

            logger.info(`[AggregateSync][START] Bắt đầu xử lý bản ghi ID=${id} từ Staging.`);

            if (!this._IncomingMigrationModels) {
                throw new Error(`[upsertDocumentAggregateById] Model not initialized for ID=${id}`);
            }

            let totalAffected = 0;

            logger.info(`[AggregateSync][STEP 1] Xử lý mapping và chèn vào bảng chính incomming_documents cho ID=${id}...`);
            const _timeStep1 = Date.now();
            const documentResult = await this._IncomingMigrationModels.processSingleRecord(
                oldRecord,
                transaction
            );
            logger.info(`[PERF] STEP 1 (Document) took ${Date.now() - _timeStep1}ms for ID=${id}`);

            if (!documentResult || documentResult.affected === 0) {
                logger.warn(`[AggregateSync][STEP 1] Bản ghi ID=${id} KHÔNG được chèn/cập nhật vào bảng chính.`);
                return { action: 'none', affected: 0 };
            }
            logger.info(
                `[AggregateSync][STEP 1] Thành công cho ID=${id} -> documentId=${documentResult.documentId} action=${documentResult?.action} affected=${documentResult?.affected}`
            );

      totalAffected += Number(documentResult.affected || 0);
      const documentId = documentResult.documentId;
      const drafter = documentResult.drafter ?? null;

      if (!documentId) {
        return {
          action: documentResult.action || 'upsert',
          affected: Number(totalAffected || 0)
        };
      }

      const newRrecord = await this.getByIdFromStaging(id, transaction);
      logger.info(`[DEBUG][upsertDocumentAggregateById] Bat dau goi ThemFileDinhKem cho documentId: ${documentId}`);
      const _timeStep2 = Date.now();
      await this.ThemFileDinhKem(oldRecord, newRrecord, documentId);
      logger.info(`[PERF] STEP 2 (Files) took ${Date.now() - _timeStep2}ms for ID=${id}`);

      /* ====== Phân tách bình luận từ HTML (Ý kiến lãnh đạo SP cũ) ====== */
      const _timeStep3 = Date.now();
      try {
        let totalParsedComments = 0;
        if (oldRecord?.YKienLanhDao) {
           totalParsedComments += await this._IncomingMigrationModels.helper.parseAndInsertHtmlComments(
              oldRecord.YKienLanhDao, documentId, id, 'VanBanDen', 'YKienLanhDao', transaction
           );
        }
        if (oldRecord?.YKienLanhDaoTCT) {
           totalParsedComments += await this._IncomingMigrationModels.helper.parseAndInsertHtmlComments(
              oldRecord.YKienLanhDaoTCT, documentId, id, 'VanBanDen', 'YKienLanhDaoTCT', transaction
           );
        }
        if (oldRecord?.YKienLanhDaoVPDN) {
           totalParsedComments += await this._IncomingMigrationModels.helper.parseAndInsertHtmlComments(
              oldRecord.YKienLanhDaoVPDN, documentId, id, 'VanBanDen', 'YKienLanhDaoVPDN', transaction
           );
        }
                if (oldRecord?.YKienCuaLDVPChoVanThu) {
                    totalParsedComments += await this._IncomingMigrationModels.helper.parseAndInsertHtmlComments(
                        oldRecord.YKienCuaLDVPChoVanThu, documentId, id, 'VanBanDen', 'YKienCuaLDVPChoVanThu', transaction
                    );
                }
                if (totalParsedComments > 0) {
                    logger.info(`[AggregateSync][STEP 3] ID=${id} -> parse thành công = ${totalParsedComments} comments từ phân vùng Ý kiến Lãnh đạo.`);
                } else {
                    logger.info(`[AggregateSync][STEP 3] ID=${id} -> KHÔNG có ý kiến lãnh đạo HTML nào cần bóc.`);
                }
            } catch (htmlCommentErr) {
                logger.warn(`[upsertDocumentAggregateById] Lỗi parse HTML YKien ID=${id}: ${htmlCommentErr.message}`);
            }
            logger.info(`[PERF] STEP 3 (HTML Comments) took ${Date.now() - _timeStep3}ms for ID=${id}`);

            // ══════════════════════════════════════════════════════════════
            // AGGREGATED AUDIT SYNC: Gộp tất cả audit từ các bảng và xử lý theo thứ tự thời gian
            // ══════════════════════════════════════════════════════════════
            logger.info(`[AggregateSync][STEP 4] Bắt đầu tổng hợp Audit Trails từ ${AUDIT_TABLES.length} bảng liên quan cho ID=${id}...`);
            const _timeStep4 = Date.now();
            const auditModels = this._syncAuditModel || [];
            if (auditModels.length > 0) {
              try {
                const auditTableNames = auditModels.map(m => m.oldDbTable);
                const firstModel = auditModels[0];
                const auditFetchOptions = AUDIT_MIN_DATE ? { minDate: AUDIT_MIN_DATE } : {};

                // fetchAllAuditsAcrossTables ưu tiên chạy UNION ALL (1 query),
                // fallback về cơ chế cũ nếu schema không tương thích.
                const allRawAudits = await firstModel.fetchAllAuditsAcrossTables(
                  id,
                  auditTableNames,
                  [
                    CATEGORY_INCOMING_TCT,
                    CATEGORY_INCOMING,
                    CATEGORY_INCOMING_INTERNAL,
                    CATEGORY_INCOMING_SUBMIT
                  ],
                  auditFetchOptions
                );

                if (allRawAudits.length > 0) {
                  let auditInserted = 0;
                  let auditUpdated = 0;
                  let auditProcessed = 0;

                  for (const rawAudit of allRawAudits) {
                    const tableName = rawAudit.__source_table;
                    const model = this._syncAuditModelMap.get(tableName) || firstModel;

                    try {
                      const result = await model.processSingleRecord(rawAudit, documentId, transaction, drafter);
                      if (!result) continue;

                      auditProcessed += 1;
                      auditInserted += Number(result.inserted || 0);
                      auditUpdated += Number(result.updated || 0);
                    } catch (auditErr) {
                      logger.warn(
                        `[upsertDocumentAggregateById] Audit migrate failed for table=${tableName}, source ID=${id}, target documentId=${documentId}: ${auditErr.message}`, { stack: auditErr.stack }
                      );
                    }
                  }

                  totalAffected += auditInserted;
                  totalAffected += auditUpdated;

                  logger.info(
                    `[AggregateSync][STEP 4] ID=${id} processed=${auditProcessed}/${allRawAudits.length} inserted=${auditInserted} updated=${auditUpdated}`
                  );
                }
              } catch (error) {
                logger.warn(
                  `[upsertDocumentAggregateById] Aggregated fetch audit failed for ID=${id}: ${error.message}`, { stack: error.stack }
                );
              }
            }
      logger.info(`[PERF] STEP 4 (Audits) took ${Date.now() - _timeStep4}ms for ID=${id}`);

      // ══════════════════════════════════════════════════════════════
      // AUTO-CREATE AUDIT: Nếu document_id chưa có audit nào → tạo 1 bản ghi CREATE
      // ══════════════════════════════════════════════════════════════
      try {
        const existingAudit = await this.queryNewDbTx(
          `SELECT TOP 1 id FROM ${process.env.NEW_DB_NAME}.dbo.audit WHERE document_id = @docId`,
          { docId: documentId },
          transaction
        );

        if (!existingAudit || existingAudit.length === 0) {
          const creatorName = oldRecord.CreatedBy || oldRecord.NguoiSoanThaoText || '';
          const parsedDate = this.helper
            ? this.helper.parseDate(oldRecord.Created)
            : null;
          const createdDate = parsedDate || new Date();

          // Ưu tiên dùng drafter (người đã tạo văn bản), nếu không có mới dùng Máy Văn Thư làm dự phòng
          let creatorId = drafter || process.env.VANTHU_USER_ID;
          let displayName = creatorName;

          if (this.helper && creatorName && !creatorId) {
            try {
              const cleanName = this.helper.extractDisplayName
                ? this.helper.extractDisplayName(creatorName)
                : creatorName;
              displayName = cleanName || creatorName;
              const resolvedId = await this.helper.mapUserName(cleanName, transaction);
              if (resolvedId) creatorId = resolvedId;
            } catch (mapErr) {
              logger.warn(`[AutoCreateAudit][Incoming] mapUserName failed for "${creatorName}": ${mapErr.message}`);
            }
          }

          const insertQuery = `
            INSERT INTO ${process.env.NEW_DB_NAME}.dbo.audit (
              document_id, [time], user_id, display_name,
              action_code, details, origin_id, created_by,
              receiver, receiver_unit, group_, roleProcess,
              [action], stage_status, created_at, updated_at,
              type_document, table_backups
            ) VALUES (
              @document_id, @time, @user_id, @display_name,
              @action_code, @details, @origin_id, @created_by,
              @receiver, @receiver_unit, @group_, @roleProcess,
              @action, @stage_status, @created_at, GETDATE(),
              @type_document, @table_backups
            )
          `;

          await this.queryNewDbTx(insertQuery, {
            document_id: documentId,
            time: createdDate || new Date(),
            user_id: creatorId,
            display_name: displayName || null,
            action_code: 'CREATE',
            details: JSON.stringify({ note: 'Tạo văn bản (tự động tạo từ migration)', isTransferOption: false }),
            origin_id: `auto_create_${String(id).substring(0, 80)}`,
            created_by: creatorId,
            receiver: creatorId,
            receiver_unit: null,
            group_: null,
            roleProcess: 'VANTHU',
            action: 'Tạo văn bản',
            stage_status: 'DA_XU_LY',
            created_at: createdDate || new Date(),
            type_document: 'IncomingDocument',
            table_backups: 'auto_create'
          }, transaction);

          logger.info(`[AutoCreateAudit][Incoming] Created initial CREATE audit for documentId=${documentId} creator=${displayName}`);
          totalAffected++;
        }
      } catch (autoAuditErr) {
        logger.warn(`[AutoCreateAudit][Incoming] Failed for documentId=${documentId}: ${autoAuditErr.message}`);
      }

      // for (const commentModel of this._syncCommentModel || []) {
      //   try {
      //     const rawComments = await commentModel.fetchByDocumentId(id);
      //
      //     if (!Array.isArray(rawComments) || !rawComments.length) {
      //       continue;
      //     }
      //
      //     for (const rawComment of rawComments) {
      //       try {
      //         const result = await commentModel.processSingleRecord(rawComment, documentId, transaction);
      //         if (!result) continue;
      //         logger.info(
      //           `[AggregateSync][Comment] table=${commentModel?.oldDbTable} documentId=${documentResult.documentId} inserted=${result?.inserted || 0} updated=${result?.updated || 0}`
      //         );
      //         totalAffected += Number(result.inserted || 0);
      //         totalAffected += Number(result.updated || 0);
      //       } catch (error) {
      //         logger.warn(
      //           `[upsertDocumentAggregateById] Comment migrate failed for table=${commentModel?.oldDbTable}, source ID=${id}, target documentId=${documentId}: ${error.message}`, { stack: error.stack }
      //         );
      //       }
      //     }
      //   } catch (error) {
      //     logger.warn(
      //       `[upsertDocumentAggregateById] Fetch comment failed for table=${commentModel?.oldDbTable}, source ID=${id}: ${error.message}`, { stack: error.stack }
      //     );
      //   }
      // }

      logger.info(
        `[AggregateSync][DONE] Tổng kết ID=${id}: Tác động ${totalAffected} bản ghi liên hệ (Bao gồm File, Ý kiến, Audit).`
      );

      return {
        action: documentResult.action || 'upsert',
        affected: Number(totalAffected || 0)
      };
    } catch (error) {
      logger.error(`[AggregateSync][ERROR] Thất bại xử lý tích hợp cũ-mới cho bản ghi ID=${id} - Lỗi: ${error.message}`);
      throw error;
    }
  }
}

module.exports = IncomingDocumentModel;
