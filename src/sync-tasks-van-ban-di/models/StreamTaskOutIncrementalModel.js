const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const logger = require('../../../utils/logger');
const dbUtils = require('../../../utils/dbUtils');
const sql = require('mssql');

const { v4: uuidv4 } = require('uuid');
const FileService = require('../../sync-file-copy/Fileuploadservice');
const { downloadFile: spDownload } = require('../../sync-file-copy/SharePointAuthService');
const {
  claimNextStagingRow,
  ensureTrackingColumns,
  markRowFailed,
  markRowSuccess,
  releaseStaleClaims,
  startHeartbeatLoop,
  updateHeartbeat,
} = require('../../helpers/StagingQueueHelper');

const DEFAULT_SYNC_TIME = '2999-12-31T23:59:59.999Z';

// Lọc bản ghi cũ hơn ngưỡng này. Đặt trong .env với key SYNC_MIN_DATE.
// Ví dụ: SYNC_MIN_DATE=2026-01-01T00:00:00.000Z
// Để tắt filter (lấy toàn bộ lịch sử), để trống hoặc đặt thành 1753-01-01T00:00:00.000Z
const SYNC_MIN_DATE = process.env.SYNC_MIN_DATE || '2026-01-01T00:00:00.000Z';
const SYNC_START_DATE = process.env.SYNC_START_DATE || SYNC_MIN_DATE;
const SYNC_END_DATE = process.env.SYNC_END_DATE || '2100-01-01T00:00:00.000Z';

// ─── Deadlock retry config ────────────────────────────────────────────────────
const DEADLOCK_MAX_RETRIES = 3;
const DEADLOCK_BASE_DELAY_MS = 200; // exponential back-off: 200ms, 400ms, 800ms
const DEADLOCK_ERROR_NUMBER = 1205;
const STALE_PROCESSING_TIMEOUT_MINUTES = Number(process.env.STALE_PROCESSING_TIMEOUT_MINUTES || 30);

// ── Reuse detectFileType từ outgoing (copy nguyên, không import cross-module) ──
function detectFileType(buffer) {
  if (!buffer || buffer.length < 4) return { mime: 'application/octet-stream', ext: 'bin' };
  const b = buffer;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46)
    return { mime: 'application/pdf', ext: 'pdf' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return { mime: 'image/png', ext: 'png' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { mime: 'image/gif', ext: 'gif' };
  if (b[0] === 0x42 && b[1] === 0x4d) return { mime: 'image/bmp', ext: 'bmp' };
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    const s = buffer.slice(0, 200).toString('latin1');
    if (s.includes('word/'))
      return {
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ext: 'docx',
      };
    if (s.includes('xl/'))
      return {
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ext: 'xlsx',
      };
    if (s.includes('ppt/'))
      return {
        mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ext: 'pptx',
      };
    return { mime: 'application/zip', ext: 'zip' };
  }
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0)
    return { mime: 'application/msword', ext: 'doc' };
  if (b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21)
    return { mime: 'application/x-rar-compressed', ext: 'rar' };
  return { mime: 'application/octet-stream', ext: 'bin' };
}

// ── Comment tables (dùng chung với In model) ──
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

/**
 * Sleep for `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns true when the error originates from a SQL Server deadlock (error 1205).
 * @param {Error} err
 * @returns {boolean}
 */
function isDeadlockError(err) {
  return (
    err?.number === DEADLOCK_ERROR_NUMBER ||
    err?.originalError?.info?.number === DEADLOCK_ERROR_NUMBER ||
    String(err?.message || '').includes('deadlock')
  );
}

/**
 * Executes `fn` and retries automatically on deadlock up to `maxRetries` times.
 * Uses exponential back-off to reduce re-collision probability.
 *
 * @template T
 * @param {() => Promise<T>} fn          Async function to execute (should be idempotent).
 * @param {string} [label='']            Label used in log messages.
 * @param {number} [maxRetries]          Max retry attempts.
 * @returns {Promise<T>}
 */
async function withDeadlockRetry(fn, label = '', maxRetries = DEADLOCK_MAX_RETRIES) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (isDeadlockError(err) && attempt <= maxRetries) {
        const delay = DEADLOCK_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn(
          `[withDeadlockRetry]${label ? ' ' + label : ''} deadlock detected — retry ${attempt}/${maxRetries} after ${delay}ms`,
        );
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
}

/** Task sync orchestrator — VĂN BẢN ĐI (TaskVBDi → task_sync_out)
 *  (transaction-based: fetch → stage → process with atomic multi-table handling) */
class StreamTaskOutIncrementalModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_TASK_OUT_INCREMENTAL' });
    this.newDbName = process.env.NEW_DB_NAME;
    this.oldDbSchema = 'dbo';
    this.oldDbTable = 'TaskVBDi'; // ← VĂN BẢN ĐI
    this.newDbSchema = 'dbo';
    this.newTableSync = 'task_sync_out'; // ← staging riêng cho VBĐi

    // Internal data models
    this.taskModel = null;
    this.taskUsersModel = null;
    this.systemLogsModel = null;

    this._fileService = null;
    this._syncCommentModel = [];

    // Guard: prevent concurrent initialize() calls from racing on staging DDL
    this._initializingPromise = null;
    this.partitionColumn = 'Created'; // Cột nghiệp vụ để chia dải dữ liệu
    this.heartbeatIntervalMs = Number(process.env.HEARTBEAT_INTERVAL_MS || 30000);
  }

  // ═══════════════════════════════════════════════════════════════
  // INITIALIZE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Initialize all models and staging tables.
   * Concurrent callers share the same promise to avoid DDL races.
   */
  async initialize() {
    if (this._initializingPromise) {
      return this._initializingPromise;
    }

    this._initializingPromise = this._doInitialize();
    try {
      await this._initializingPromise;
    } finally {
      this._initializingPromise = null;
    }
  }

  /** Internal initialize logic, wrapped by the public guard above. */
  async _doInitialize() {
    await super.initialize();

    try {
      // Late require to break potential circular dependencies
      const StreamTaskMigrationModel = require('./StreamTaskMigrationModel');
      const StreamTaskUsersModel = require('./StreamTaskUsersModel');
      const StreamSystemLogTasksModel = require('./StreamSystemLogTasksModel');

      this.taskModel = new StreamTaskMigrationModel();
      await this.taskModel.initialize();

      this.taskUsersModel = new StreamTaskUsersModel();
      await this.taskUsersModel.initialize();

      this.systemLogsModel = new StreamSystemLogTasksModel();
      await this.systemLogsModel.initialize();

      // FIX: deadlock-safe staging table creation with retry
      await withDeadlockRetry(() => this.ensureStagingTableExists(), 'ensureStagingTableExists');

      // ADD: Ensure all necessary columns exist (e.g. ItemId)
      await withDeadlockRetry(() => this.ensureStagingTableColumns(), 'ensureStagingTableColumns');

      this._fileService = new FileService(this.newPool);

      // Late require SyncCommentModel
      const SyncCommentModel = require('../../sync-document-comment/SyncCommentModel');

      // init comment models — chỉ initialize() 1 lần, share pool cho 47 instances
      this._syncCommentModel = [];
      const baseCommentModel = new SyncCommentModel(COMMENT_TABLES[0]);
      await baseCommentModel.initialize();

      // Đảm bảo 2 cột backup tồn tại trong document_comments (dùng chung với In model)
      await baseCommentModel.queryNewDb(`
        IF NOT EXISTS (
          SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = 'document_comments' AND COLUMN_NAME = 'id_comments_bak'
        )
          ALTER TABLE ${process.env.NEW_DB_NAME}.dbo.document_comments
            ADD id_comments_bak NVARCHAR(255) NULL;

        IF NOT EXISTS (
          SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = 'document_comments' AND COLUMN_NAME = 'table_bak'
        )
          ALTER TABLE ${process.env.NEW_DB_NAME}.dbo.document_comments
            ADD table_bak NVARCHAR(255) NULL;
      `); // Kết thúc chuỗi SQL trước khi gọi logger
      logger.debug('[StreamTaskOutIncrementalModel] Comment backup columns ensured.');

      this._syncCommentModel = COMMENT_TABLES.map((table) => {
        const model = new SyncCommentModel(table);
        model.oldPool = baseCommentModel.oldPool;
        model.newPool = baseCommentModel.newPool;
        return model;
      });

      logger.info(
        '[StreamTaskOutIncrementalModel] Initialized with transaction-based aggregate processing',
      );
    } catch (error) {
      logger.error('[StreamTaskOutIncrementalModel.initialize]', error);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CURSOR HELPERS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Converts arbitrary datetime input to stable ISO cursor format.
   * @param {string|Date|null|undefined} value
   * @returns {string}
   */
  normalizeSyncTime(value) {
    if (!value || value === '1970-01-01T00:00:00.000Z') return DEFAULT_SYNC_TIME;
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
    const raw =
      row?.__sync_time || row?.Modified || row?.Created || row?.NgayTao || row?.updated_at || null;
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
   * DESC sync: thời gian nhỏ hơn (cũ hơn) là "đi trước" (tiến về quá khứ).
   * @param {string} aTime
   * @param {number} aId
   * @param {string} bTime
   * @param {number} bId
   * @returns {boolean}
   */
  isCursorAhead(aTime, aId, bTime, bId) {
    const ta = new Date(aTime || DEFAULT_SYNC_TIME).getTime();
    const tb = new Date(bTime || DEFAULT_SYNC_TIME).getTime();
    if (ta < tb) return true;
    if (ta > tb) return false;
    return Number(aId || 0) < Number(bId || 0);
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
   * Resolves fully-qualified staging table reference in NEW DB.
   * @returns {string}
   */
  getStagingTableRef() {
    if (this.newDbName) {
      return `${this.newDbName}.${this.newDbSchema}.${this.newTableSync}`;
    }
    return `${this.newDbSchema}.${this.newTableSync}`;
  }

  // ═══════════════════════════════════════════════════════════════
  // STAGING TABLE — task_sync_out schema
  // ═══════════════════════════════════════════════════════════════

  /**
   * Tạo bảng staging `task_sync_out` trong DB mới nếu chưa tồn tại.
   *
   * FIX (deadlock): Thay DROP + CREATE bằng CREATE IF NOT EXISTS để tránh
   * tranh chấp schema-lock với các transaction khác đang chạy song song.
   * Khi schema thật sự thay đổi (thêm/bớt cột), gọi rebuildStagingTable().
   */
  async ensureStagingTableExists() {
    const table = this.getStagingTableRef();
    const tableName = this.newTableSync; // 'task_sync_out'
    const schemaName = this.newDbSchema;
    const dbName = this.newDbName;

    // Create only if not exists — no DROP → no Sch-M lock race
    const createQuery = `
      IF NOT EXISTS (
        SELECT 1
        FROM ${dbName}.sys.tables  t
        JOIN ${dbName}.sys.schemas s ON t.schema_id = s.schema_id
        WHERE t.name = '${tableName}'
          AND s.name = '${schemaName}'
      )
      BEGIN
        CREATE TABLE ${table} (
          -- Source columns (raw from TaskVBDi / old DB)
          ID                     NVARCHAR(255)   NOT NULL,
          VBId                   NVARCHAR(MAX)   NULL,
          DepartmentId           NVARCHAR(MAX)   NULL,
          ParentId               NVARCHAR(MAX)   NULL,
          Title                  NVARCHAR(MAX)   NULL,
          DanhGia                NVARCHAR(MAX)   NULL,
          DeBaoCao               NVARCHAR(MAX)   NULL,
          DeBiet                 NVARCHAR(MAX)   NULL,
          DeThucHien             NVARCHAR(MAX)   NULL,
          DuocHuy                NVARCHAR(MAX)   NULL,
          DiemChatLuong          NVARCHAR(MAX)   NULL,
          DiemThoiGian           NVARCHAR(MAX)   NULL,
          DiemDanhGia            NVARCHAR(MAX)   NULL,
          StartDate              NVARCHAR(MAX)   NULL,
          DueDate                NVARCHAR(MAX)   NULL,
          CompletedDate          NVARCHAR(MAX)   NULL,
          HoanTatTuDong          NVARCHAR(MAX)   NULL,
          HoSoDuThaoId           NVARCHAR(MAX)   NULL,
          HoSoDuThaoUrl          NVARCHAR(MAX)   NULL,
          HoSoXuLyUrl            NVARCHAR(MAX)   NULL,
          [Percent]              NVARCHAR(MAX)   NULL,
          TrangThai              NVARCHAR(MAX)   NULL,
          Priority               NVARCHAR(MAX)   NULL,
          YKienCuaNguoiGiaiQuyet NVARCHAR(MAX)   NULL,
          YKienChiDao            NVARCHAR(MAX)   NULL,
          ModuleId               NVARCHAR(MAX)   NULL,
          SiteName               NVARCHAR(MAX)   NULL,
          ListName               NVARCHAR(MAX)   NULL,
          ItemId                 NVARCHAR(MAX)   NULL,
          Modified               NVARCHAR(MAX)   NULL,
          Created                NVARCHAR(MAX)   NULL,
          ModifiedBy             NVARCHAR(MAX)   NULL,
          CreatedBy              NVARCHAR(MAX)   NULL,
          MigrateFlg             NVARCHAR(MAX)   NULL,
          MigrateErrFlg          NVARCHAR(MAX)   NULL,
          MigrateErrMess         NVARCHAR(MAX)   NULL,
          ParentTaskID           NVARCHAR(MAX)   NULL,

          -- Bak tracking
          id_task_bak            NVARCHAR(MAX)   NULL,

          CONSTRAINT PK_task_sync_out PRIMARY KEY (ID)   -- ← tên constraint của VBĐi
        );
        PRINT 'task_sync_out table created';
      END
    `;

    await this.queryNewDb(createQuery);
    await ensureTrackingColumns(this, {
      tableRef: table,
      tableName,
      schemaName,
      dbName,
      label: this.modelName,
    });
    logger.info('[StreamTaskOutIncrementalModel] task_sync_out staging table ready');
  }

  /**
   * Đảm bảo tất cả các cột cần thiết tồn tại trong bảng staging (task_sync_out).
   * Nếu thiếu cột (ví dụ: ItemId), nó sẽ tự động ALTER TABLE ADD.
   */
  async ensureStagingTableColumns() {
    const table = this.getStagingTableRef();
    const tableName = this.newTableSync;
    const dbName = this.newDbName;

    // Danh sách các cột cần check (theo schema chuẩn ở ensureStagingTableExists)
    const requiredColumns = [
      { name: 'VBId', type: 'NVARCHAR(MAX)' },
      { name: 'DepartmentId', type: 'NVARCHAR(MAX)' },
      { name: 'ParentId', type: 'NVARCHAR(MAX)' },
      { name: 'Title', type: 'NVARCHAR(MAX)' },
      { name: 'DanhGia', type: 'NVARCHAR(MAX)' },
      { name: 'DeBaoCao', type: 'NVARCHAR(MAX)' },
      { name: 'DeBiet', type: 'NVARCHAR(MAX)' },
      { name: 'DeThucHien', type: 'NVARCHAR(MAX)' },
      { name: 'DuocHuy', type: 'NVARCHAR(MAX)' },
      { name: 'DiemChatLuong', type: 'NVARCHAR(MAX)' },
      { name: 'DiemThoiGian', type: 'NVARCHAR(MAX)' },
      { name: 'DiemDanhGia', type: 'NVARCHAR(MAX)' },
      { name: 'StartDate', type: 'NVARCHAR(MAX)' },
      { name: 'DueDate', type: 'NVARCHAR(MAX)' },
      { name: 'CompletedDate', type: 'NVARCHAR(MAX)' },
      { name: 'HoanTatTuDong', type: 'NVARCHAR(MAX)' },
      { name: 'HoSoDuThaoId', type: 'NVARCHAR(MAX)' },
      { name: 'HoSoDuThaoUrl', type: 'NVARCHAR(MAX)' },
      { name: 'HoSoXuLyUrl', type: 'NVARCHAR(MAX)' },
      { name: 'Percent', type: 'NVARCHAR(MAX)' },
      { name: 'TrangThai', type: 'NVARCHAR(MAX)' },
      { name: 'Priority', type: 'NVARCHAR(MAX)' },
      { name: 'YKienCuaNguoiGiaiQuyet', type: 'NVARCHAR(MAX)' },
      { name: 'YKienChiDao', type: 'NVARCHAR(MAX)' },
      { name: 'ModuleId', type: 'NVARCHAR(MAX)' },
      { name: 'SiteName', type: 'NVARCHAR(MAX)' },
      { name: 'ListName', type: 'NVARCHAR(MAX)' },
      { name: 'ItemId', type: 'NVARCHAR(MAX)' },
      { name: 'Modified', type: 'NVARCHAR(MAX)' },
      { name: 'Created', type: 'NVARCHAR(MAX)' },
      { name: 'ModifiedBy', type: 'NVARCHAR(MAX)' },
      { name: 'CreatedBy', type: 'NVARCHAR(MAX)' },
      { name: 'MigrateFlg', type: 'NVARCHAR(MAX)' },
      { name: 'MigrateErrFlg', type: 'NVARCHAR(MAX)' },
      { name: 'MigrateErrMess', type: 'NVARCHAR(MAX)' },
      { name: 'ParentTaskID', type: 'NVARCHAR(MAX)' },
      { name: 'id_task_bak', type: 'NVARCHAR(MAX)' },
    ];

    for (const col of requiredColumns) {
      const colName = col.name === 'Percent' ? '[Percent]' : col.name;
      const query = `
        IF NOT EXISTS (
          SELECT 1 FROM ${dbName}.INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = '${tableName}' AND COLUMN_NAME = '${col.name}'
        )
        BEGIN
          ALTER TABLE ${table} ADD ${colName} ${col.type} NULL;
          PRINT 'Added missing column ${col.name} to ${tableName}';
        END
      `;
      await this.queryNewDb(query);
    }

    await ensureTrackingColumns(this, {
      tableRef: table,
      tableName,
      schemaName: this.newDbSchema,
      dbName,
      label: this.modelName,
    });

    logger.info(`[StreamTaskOutIncrementalModel] Verified staging table columns for ${tableName}`);
  }

  /**
   * Force-rebuilds the staging table (DROP + CREATE).
   * Gọi thủ công khi cần migration schema — KHÔNG gọi lúc startup.
   */
  async rebuildStagingTable() {
    await withDeadlockRetry(async () => {
      const table = this.getStagingTableRef();

      const dropQuery = `
        IF OBJECT_ID('${table}', 'U') IS NOT NULL
          DROP TABLE ${table};
      `;
      await this.queryNewDb(dropQuery);
      logger.info('[StreamTaskOutIncrementalModel] task_sync_out dropped for rebuild');

      await this.ensureStagingTableExists();
    }, 'rebuildStagingTable');
  }

  /**
   * Reset rows stuck in processing state (MigrateFlg=2) beyond timeout.
   * This prevents permanent "kẹt" rows when a worker crashes mid-flight.
   */
  async resetStaleProcessingRows({ startDate = null, endDate = null } = {}) {
    const stagingTableRef = this.getStagingTableRef();
    return releaseStaleClaims(this, {
      tableRef: stagingTableRef,
      extraWhere: `
        (TRY_CONVERT(datetime2, ${this.partitionColumn}) >= @startDate OR @startDate IS NULL)
        AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) <= @endDate OR @endDate IS NULL)
      `,
      params: { startDate, endDate },
      staleMinutes: STALE_PROCESSING_TIMEOUT_MINUTES,
      label: this.modelName,
    });
  }

  async updateHeartbeat(rowId, transaction = null) {
    if (!rowId) return 0;
    const stagingTableRef = this.getStagingTableRef();
    return updateHeartbeat(this, {
      tableRef: stagingTableRef,
      keyWhere: 'ID = @ID',
      params: { ID: rowId },
      transaction,
      rowToken: `ID=${rowId}`,
      label: this.modelName,
    });
  }

  /**
   * Tải các file đính kèm của Task (Văn bản đi) từ SharePoint về bộ nhớ (NGOÀI giao dịch SQL).
   */
  async prepareTaskFilesFromSharePoint(stagingRow) {
    const baseUrl = (process.env.BASE_URL || "").replace(/\/$/, "");
    if (!baseUrl) return [];

    const fileFields = [
      { field: 'HoSoDuThaoId', objectType: 'taskdocuments' }, // Map thêm ID nếu cần
      { field: 'HoSoDuThaoUrl', objectType: 'taskdocuments' },
      { field: 'HoSoXuLyUrl', objectType: 'taskdocuments' }
    ];

    const preparedResults = [];
    for (const { field, objectType } of fileFields) {
      const rawUrl = stagingRow?.[field];
      if (!rawUrl || String(rawUrl).trim() === '') continue;
      // Tránh trùng lắp nếu metadata dùng chung link
      if (preparedResults.some(p => p.relativePath === String(rawUrl).trim())) continue;

      const relativePath = String(rawUrl).trim();
      const fullUrl = relativePath.startsWith('http') ? relativePath : `${baseUrl}${relativePath}`;
      const fileName = relativePath.substring(relativePath.lastIndexOf('/') + 1) || field;

      try {
        logger.info(`[StreamTaskOut][prepareFiles] Đang tải file cho Task ID ${stagingRow.ID}: ${fileName}`);
        const buffer = await spDownload(fullUrl, this.newPool); // Truyền Pool để lock đa tiến trình

        if (buffer && buffer.length > 0) {
          preparedResults.push({ buffer, fileName, relativePath, objectType });
        }
      } catch (err) {
        logger.error(`[StreamTaskOut][prepareFiles] Lỗi tải file ${fileName}: ${err.message}`);
      }
    }
    return preparedResults;
  }

  /**
   * Ghi dữ liệu file đính kèm của Task vào DB (TRONG Transaction SQL).
   */
  async applyPreparedTaskFiles(preparedFiles, newTaskId, stagingRow, transaction) {
    if (!Array.isArray(preparedFiles) || preparedFiles.length === 0) return true;

    for (const fileItem of preparedFiles) {
      const { buffer, fileName, relativePath, objectType } = fileItem;
      const fileType = detectFileType(buffer);
      const mimeType = fileType.mime;

      const fileIdBak = uuidv4();
      const fileRecord = {
        file_name: fileName,
        file_path: relativePath,
        mime_type: mimeType,
        created_by: stagingRow?.CreatedBy || null,
        version: 1,
        id_bak: fileIdBak,
        table_bak: 'TaskVBDi',
        type_doc: null,
        isBak: 1
      };

      const relationRecord = {
        object_type: objectType,
        object_id: String(newTaskId),
        object_id_bak: stagingRow?.ID,
        file_id_bak: fileIdBak,
        table_bak: 'TaskVBDi',
        type_doc: objectType,
      };

      await this._fileService.uploadAndInsert({
        fileBuffer: buffer,
        originalName: fileName,
        mimeType,
        fileRecord,
        relationRecord,
        folder: 'task',
        localFolder: 'task',
        transaction    // Dùng chung TX
      });
    }
    return true;
  }

  async ThemFileDinhKemTask(stagingRow, newTaskId) {
    // Để giữ tương thích, khuyến khích gọi prepare/apply riêng lẻ
    const prepared = await this.prepareTaskFilesFromSharePoint(stagingRow);
    return await this.applyPreparedTaskFiles(prepared, newTaskId, stagingRow, null);
  }

  // ═══════════════════════════════════════════════════════════════
  // COUNT
  // ═══════════════════════════════════════════════════════════════

  /**
   * Alias cho getCount để đồng nhất với SyncHandlerModel.
   */
  async getCount(lastSyncTime, lastSyncId = 0) {
    return this.countListFromOldDb(lastSyncTime, lastSyncId);
  }

  /**
   * Đếm tổng số bản ghi cần đồng bộ.
   */
  async countListFromOldDb(lastSyncTime, lastSyncId = 0) {
    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);

    const syncTimeExpr = this.getSyncTimeExpression();
    const query = `
      ;WITH source_rows AS (
        SELECT
          ${syncTimeExpr} AS __sync_time,
          TRY_CONVERT(
            BIGINT,
            NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), '')
          ) AS __sync_id_num
        FROM ${this.oldDbSchema}.${this.oldDbTable}
        WHERE 1=1
          AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) >= @startDate OR @startDate IS NULL)
          AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) <= @endDate OR @endDate IS NULL)
      )
      SELECT COUNT(1) AS total
      FROM source_rows
      WHERE (
        __sync_time < @lastSyncTime
        OR (
          __sync_time = @lastSyncTime
          AND ISNULL(__sync_id_num, 9223372036854775807) < @lastSyncId
        )
      )
      -- Chỉ lấy bản ghi từ năm 2026 trở đi (Nếu SYNC_MIN_DATE được bật)
      AND __sync_time >= '${SYNC_MIN_DATE}'
    `;

    const rows = await this.queryOldDb(query, {
      lastSyncTime: normalizedLastSyncTime,
      lastSyncId: normalizedLastSyncId,
      startDate: process.env.SYNC_START_DATE || null,
      endDate: process.env.SYNC_END_DATE || null
    });

    return Number(rows?.[0]?.total || 0);
  }

  // ═══════════════════════════════════════════════════════════════
  // FETCH FROM OLD DB — DESC cursor, OFFSET/TAKE
  // ═══════════════════════════════════════════════════════════════

  /**
   * @param {string} lastSyncTime
   * @param {number} [lastSyncId=0]
   * @returns {Promise<object[]>}
   */
  /**
   * Lấy danh sách bản ghi kèm phân trang.
   */
  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0, limit = null, offset = 0) {
    const syncTimeExpr = this.getSyncTimeExpression();
    const query = `
      ;WITH source_rows AS (
        SELECT
          *,
          ${syncTimeExpr} AS _sync_time_val,
          TRY_CONVERT(
            BIGINT,
            NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), '')
          ) AS _sync_id_val
        FROM ${this.oldDbSchema}.${this.oldDbTable}
        WHERE 1=1
          AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) >= @startDate OR @startDate IS NULL)
          AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) <= @endDate OR @endDate IS NULL)
      )
      SELECT * FROM (
        SELECT
          *,
          _sync_time_val AS __sync_time,
          ISNULL(_sync_id_val, 0) AS __sync_id,
          ROW_NUMBER() OVER (
            ORDER BY
              _sync_time_val DESC,
              ISNULL(_sync_id_val, 9223372036854775807) DESC,
              ID DESC
          ) AS __page_rn
        FROM source_rows
        WHERE (
          _sync_time_val < @lastSyncTime
          OR (
            _sync_time_val = @lastSyncTime
            AND ISNULL(_sync_id_val, 9223372036854775807) < @lastSyncId
          )
        )
        -- Chỉ lấy bản ghi từ năm 2026 trở đi
        AND _sync_time_val >= '${SYNC_MIN_DATE}'
      ) AS t
      WHERE __page_rn > @offset
      ${limit ? `AND __page_rn <= (@offset + @limit)` : ''}
      ORDER BY __page_rn
    `;

    return this.queryOldDb(query, {
      lastSyncTime,
      lastSyncId: Number(lastSyncId || 0),
      limit: limit ? Number(limit) : null,
      offset: Number(offset || 0),
      startDate: process.env.SYNC_START_DATE || null,
      endDate: process.env.SYNC_END_DATE || null
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // SYNC TO STAGING — dynamic column upsert
  // ═══════════════════════════════════════════════════════════════

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

    const internalColumns = new Set([
      '__sync_time',
      '__sync_id',
      '__sync_id_num',
      '_sync_time_val',
      '_sync_id_val',
      '__page_rn',
    ]);
    const columns = Object.keys(rows[0] || {}).filter(
      (column) => !String(column).startsWith('__') && !internalColumns.has(column),
    );
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
          ${nonIdColumns.length > 0
          ? `UPDATE ${stagingTableRef} SET ${updateClause} WHERE ID = @ID;`
          : `SELECT 1 AS noop;`
        }
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

  // ═══════════════════════════════════════════════════════════════
  // GET LIST — build staged batch + advance cursor
  // ═══════════════════════════════════════════════════════════════

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

    const STAGING_PARALLEL_BATCHES = Number(process.env.STAGING_PARALLEL_BATCHES || 3);
    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);

    const batchSize = Number(process.env.STAGING_FETCH_BATCH_SIZE || 2000);
    const stagingTableRef = this.getStagingTableRef();

    const envStartDate = process.env.SYNC_START_DATE ? new Date(process.env.SYNC_START_DATE).toISOString() : null;
    const envEndDate = process.env.SYNC_END_DATE ? new Date(process.env.SYNC_END_DATE).toISOString() : null;

    // Cleanup stale records
    try {
      const resetCount = await this.resetStaleProcessingRows({
        startDate: envStartDate,
        endDate: envEndDate
      });
      if (resetCount > 0) {
        logger.warn(
          `[StreamTaskOut] Reset stale processing rows: ${resetCount} (timeout=${STALE_PROCESSING_TIMEOUT_MINUTES}m)`,
        );
      }
    } catch (cleanupErr) {
      logger.warn(`[StreamTaskOut] Cleanup stale records failed: ${cleanupErr.message}`);
    }

    // 1. Đếm tổng và cập nhật Dashboard
    const totalCount = await this.countListFromOldDb(normalizedLastSyncTime, normalizedLastSyncId);
    logger.info(
      `[StreamTaskOut] Tổng số bản ghi cần sync: ${totalCount} (LastTime: ${normalizedLastSyncTime}, LastId: ${normalizedLastSyncId})`,
    );

    await this.queryNewDb(
      `
      UPDATE sync_jobs
      SET total_to_sync =
        CASE
          WHEN ISNULL(total_to_sync, 0) > @total THEN ISNULL(total_to_sync, 0)
          WHEN ISNULL(total_processed, 0) > @total THEN ISNULL(total_processed, 0)
          ELSE @total
        END
      WHERE job_id = @jobId
      `,
      {
        total: totalCount,
        jobId: syncJobId,
      }
    );

    const numIterations = Math.ceil(totalCount / batchSize);
    let totalStaged = 0;
    let nextSyncTime = normalizedLastSyncTime;
    let nextSyncId = normalizedLastSyncId;

    // Helper for parallel fetching
    const fetchAndStage = async (iteration) => {
      const begin = iteration * batchSize;
      const rows = await this.fetchListFromOldDb(
        normalizedLastSyncTime,
        normalizedLastSyncId,
        batchSize,
        begin
      );
      if (!rows || rows.length === 0) return { rowsCount: 0, stagedCount: 0 };

      const stageResult = await dbUtils.withTransactionRetry(this.newPool, async (transaction) => {
        return await this.syncOldToStaging(rows, { transaction });
      }, { maxRetries: 5 });

      return { rowsCount: rows.length, stagedCount: Number(stageResult?.stagedCount || 0), lastRow: rows[rows.length - 1] };
    };

    // 2. Chạy vòng lặp song song
    const executing = new Set();
    const results = [];

    for (let i = 0; i < numIterations; i++) {
      const task = fetchAndStage(i);
      results.push(task);
      executing.add(task);
      task.finally(() => executing.delete(task));

      if (executing.size >= STAGING_PARALLEL_BATCHES) {
        await Promise.race(executing);
      }
    }

    const batchResults = await Promise.all(results);
    for (const res of batchResults) {
      if (!res || res.rowsCount === 0) continue;
      totalStaged += res.stagedCount;

      const rowTime = this.extractRowSyncTime(res.lastRow);
      const rowId = this.extractRowSyncId(res.lastRow);
      if (rowTime && this.isCursorAhead(rowTime, rowId, nextSyncTime, nextSyncId)) {
        nextSyncTime = rowTime;
        nextSyncId = rowId;
      }
    }

    logger.info(
      `🔥 [StreamTaskOut] Hoàn tất hút dữ liệu về Staging. Staged=${totalStaged}/${totalCount}. LastSyncTime: ${nextSyncTime}, LastSyncId: ${nextSyncId}`,
    );

    // Fix Bug #3: Đếm số bản ghi THỰC TẾ trong staging chưa xử lý
    // FIX: Phải lọc theo dải ngày của instance này (SYNC_START_DATE/SYNC_END_DATE)
    // để tránh đếm nhầm records của các terminal khác đang chạy song song.
    let pendingCount = 0;
    let stagingDiag = null;
    try {
      // Diagnostic breakdown to explain "pending = 0" causes.
      // This helps identify whether rows are excluded by date range or by migrate flags.
      const diagRes = await this.queryNewDb(
        `
        SELECT
          COUNT(1) AS total_staging,
          SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 0 AND ISNULL(MigrateErrFlg, 0) = 0 THEN 1 ELSE 0 END) AS pending_all_range,
          SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 0 AND ISNULL(MigrateErrFlg, 0) = 0
                     AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) >= @startDate OR @startDate IS NULL)
                     AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) <= @endDate   OR @endDate IS NULL)
                   THEN 1 ELSE 0 END) AS pending_in_range,
          SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 1 THEN 1 ELSE 0 END) AS migrated_ok,
          SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 2 THEN 1 ELSE 0 END) AS processing_now,
          SUM(CASE WHEN ISNULL(MigrateErrFlg, 0) = 1 THEN 1 ELSE 0 END) AS error_rows
        FROM ${stagingTableRef}
        `,
        {
          startDate: process.env.SYNC_START_DATE || null,
          endDate: process.env.SYNC_END_DATE || null
        }
      );
      stagingDiag = diagRes?.[0] || null;

      const pendingRes = await this.queryNewDb(
        `SELECT COUNT(1) AS cnt FROM ${stagingTableRef}
         WHERE ISNULL(MigrateFlg, 0) = 0
           AND ISNULL(MigrateErrFlg, 0) = 0
           AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) >= @startDate OR @startDate IS NULL)
           AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) <= @endDate   OR @endDate IS NULL)`,
        {
          startDate: process.env.SYNC_START_DATE || null,
          endDate: process.env.SYNC_END_DATE || null
        }
      );
      pendingCount = Number(pendingRes?.[0]?.cnt || 0);
    } catch (e) {
      logger.warn(`[StreamTaskOut] Không đếm được pending staging: ${e.message}`);
      pendingCount = totalStaged;
    }
    logger.info(`[StreamTaskOut] Pending records trong Staging có thể xử lý: ${pendingCount} (range: ${process.env.SYNC_START_DATE || 'ALL'} → ${process.env.SYNC_END_DATE || 'ALL'})`);
    if (stagingDiag) {
      const totalStagingDiag = Number(stagingDiag.total_staging || 0);
      const pendingAllRange = Number(stagingDiag.pending_all_range || 0);
      const pendingInRange = Number(stagingDiag.pending_in_range || 0);
      const pendingOutOfRange = Math.max(0, pendingAllRange - pendingInRange);
      const migratedOk = Number(stagingDiag.migrated_ok || 0);
      const processingNow = Number(stagingDiag.processing_now || 0);
      const errorRows = Number(stagingDiag.error_rows || 0);
      logger.info(
        `[StreamTaskOut][DIAG] staging_breakdown: total=${totalStagingDiag}, pending_all_range=${pendingAllRange}, pending_in_range=${pendingInRange}, pending_out_of_range=${pendingOutOfRange}, migrated_ok=${migratedOk}, processing_now=${processingNow}, error_rows=${errorRows}, partition=${this.partitionColumn}`
      );
      if (pendingCount === 0) {
        logger.warn(
          `[StreamTaskOut][DIAG] pending=0 reason hints: out_of_range=${pendingOutOfRange}, migrated_ok=${migratedOk}, processing_now=${processingNow}, error_rows=${errorRows}`
        );
      }
    }


    // Cập nhật Dashboard lần cuối với tổng số thực tế (bao gồm cả các bản ghi tồn đọng cũ trong staging)
    await this.queryNewDb(
      `
      UPDATE sync_jobs
      SET total_to_sync =
        CASE
          WHEN ISNULL(total_to_sync, 0) > @total THEN ISNULL(total_to_sync, 0)
          WHEN ISNULL(total_processed, 0) > @total THEN ISNULL(total_processed, 0)
          ELSE @total
        END
      WHERE job_id = @jobId
      `,
      {
        total: pendingCount,
        jobId: syncJobId
      }
    );

    return {
      syncJobId,
      rows: [],
      totalCount: pendingCount,
      stagedCount: totalStaged,
      sourceLastSyncTime: normalizedLastSyncTime,
      sourceLastSyncId: normalizedLastSyncId,
      lastSyncTime: nextSyncTime,
      lastSyncId: nextSyncId,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // FETCH ONE FROM STAGING — ROW_NUMBER cursor
  // ═══════════════════════════════════════════════════════════════

  /**
   * Reads one deterministic row from staging based on source cursor and item index.
   * @param {{lastSyncTime:string,lastSyncId?:number,itemIndex:number,transaction?:object}} context
   * @returns {Promise<object|null>}
   */
  async fetchOneFromStaging(options = {}) {
    const queryKey = 'fetchOneFromStaging.claim-next-row';
    try {
      const itemIndex = Number(options?.itemIndex ?? -1);
      const workerId = String(options?.workerId || process.pid || 'worker');
      const stagingTableRef = this.getStagingTableRef();
      const picked = await claimNextStagingRow(this, {
        tableRef: stagingTableRef,
        extraWhere: `
          (TRY_CONVERT(datetime2, ${this.partitionColumn}) >= @startDate OR @startDate IS NULL)
          AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) <= @endDate OR @endDate IS NULL)
        `,
        params: {
          startDate: process.env.SYNC_START_DATE || null,
          endDate: process.env.SYNC_END_DATE || null,
        },
        owner: workerId,
        orderBy: `
          TRY_CONVERT(datetime2, Modified) DESC,
          TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), '')) DESC
        `,
        rowLabel: 'ID',
        label: this.modelName,
      });
      if (picked?.ID) {
        logger.info(
          `[${this.modelName}] [START] Processing started: itemIndex=${itemIndex}, rowId=${picked.ID}, created=${picked.Created || 'NULL'}, modified=${picked.Modified || 'NULL'}, owner=${workerId}`
        );
      }
      return picked;
    } catch (error) {
      logger.error(`[StreamTaskOut.fetchOneFromStaging] Failed at queryKey=${queryKey}: ${error.message}`);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SYNC JOB STATE
  // ═══════════════════════════════════════════════════════════════

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
      { syncJobId },
    );

    return rows?.[0] || null;
  }

  // ═══════════════════════════════════════════════════════════════
  // PROCESS ONE — with deadlock retry on full transaction
  // ═══════════════════════════════════════════════════════════════

  /**
   * Processes one staged item for a sync job inside a DB transaction.
   * Retries the entire transaction on deadlock (SQL error 1205).
   *
   * @param {string} syncJobId
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async processOne(syncJobId, options = {}) {
    if (!syncJobId) {
      throw new Error('syncJobId is required');
    }

    if (!this.newPool) {
      throw new Error('Database pool not initialized');
    }

    return withDeadlockRetry(
      () => this._processOneAttempt(syncJobId, options),
      `processOne syncJobId=${syncJobId}`,
    );
  }

  /**
   * Single attempt of processOne — extracted so withDeadlockRetry can re-run it cleanly.
   * @private
   */
  async _processOneAttempt(syncJobId, options = {}) {
    const itemIndex = Number(options?.itemIndex ?? -1);
    let step = 'getSyncJobState';
    let jobState;
    try {
      jobState = await this.getSyncJobState(syncJobId);
    } catch (error) {
      throw error;
    }

    let rowData = null;
    let transaction = null;
    let stopHeartbeat = null;

    try {
      const stagingTableRef = this.getStagingTableRef();
      try {
        await this.resetStaleProcessingRows({
          startDate: process.env.SYNC_START_DATE || null,
          endDate: process.env.SYNC_END_DATE || null,
        });
      } catch (_) { }

      step = 'fetchOneFromStaging';
      rowData = await this.fetchOneFromStaging({ itemIndex, workerId: syncJobId });

      if (!rowData) {
        try {
          const stagingTableRef = this.getStagingTableRef();
          const diagNoRow = await this.queryNewDb(
            `
            SELECT
              SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 0 AND ISNULL(MigrateErrFlg, 0) = 0 THEN 1 ELSE 0 END) AS pending_all_range,
              SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 0 AND ISNULL(MigrateErrFlg, 0) = 0
                         AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) >= @startDate OR @startDate IS NULL)
                         AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) <= @endDate   OR @endDate IS NULL)
                       THEN 1 ELSE 0 END) AS pending_in_range
            FROM ${stagingTableRef}
            `,
            {
              startDate: process.env.SYNC_START_DATE || null,
              endDate: process.env.SYNC_END_DATE || null
            }
          );
          const pendingAll = Number(diagNoRow?.[0]?.pending_all_range || 0);
          const pendingInRange = Number(diagNoRow?.[0]?.pending_in_range || 0);
          logger.info(
            `[StreamTaskOut][DIAG] fetchOneFromStaging returned null: itemIndex=${itemIndex}, pending_all_range=${pendingAll}, pending_in_range=${pendingInRange}, range=${process.env.SYNC_START_DATE || 'ALL'}→${process.env.SYNC_END_DATE || 'ALL'}`
          );

          // Show a small snapshot of candidates that SHOULD be pickable by this worker.
          const sampleRows = await this.queryNewDb(
            `
            SELECT TOP 5
              ID, Created, Modified, MigrateFlg, MigrateErrFlg
            FROM ${stagingTableRef}
            WHERE ISNULL(MigrateFlg, 0) = 0
              AND ISNULL(MigrateErrFlg, 0) = 0
              AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) >= @startDate OR @startDate IS NULL)
              AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) <= @endDate   OR @endDate IS NULL)
            ORDER BY TRY_CONVERT(datetime2, Modified) DESC,
                     TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), '')) DESC
            `,
            {
              startDate: process.env.SYNC_START_DATE || null,
              endDate: process.env.SYNC_END_DATE || null
            }
          );
          logger.info(
            `[StreamTaskOut][DIAG] null-pick sample itemIndex=${itemIndex}: ${JSON.stringify(sampleRows || [])}`
          );
        } catch (_) { }
        if (!this._finishedLogged) {
          logger.info(`[StreamTaskOut] No more data in staging for job ${syncJobId}`);
          this._finishedLogged = true;
        }
        await this.finalizeProcessingCursor(syncJobId);
        try {
          const doneDiag = await this.queryNewDb(
            `
            SELECT
              SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 0 AND ISNULL(MigrateErrFlg, 0) = 0 THEN 1 ELSE 0 END) AS pending_all_range,
              SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 1 THEN 1 ELSE 0 END) AS success_all_range,
              SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 2 THEN 1 ELSE 0 END) AS processing_all_range,
              SUM(CASE WHEN ISNULL(MigrateErrFlg, 0) = 1 THEN 1 ELSE 0 END) AS error_all_range
            FROM ${stagingTableRef}
            `
          );
          const d = doneDiag?.[0] || {};
          logger.warn(
            `[StreamTaskOut][DONE_DIAG] job=${syncJobId} completed-without-pick: pending=${Number(d.pending_all_range || 0)}, success=${Number(d.success_all_range || 0)}, processing=${Number(d.processing_all_range || 0)}, errors=${Number(d.error_all_range || 0)}`
          );
        } catch (_) { }
        return {
          syncJobId,
          processed: false,
          done: true
        };
      }

      const rowId = rowData.ID || null;
      const current = Number(jobState?.total_processed || 0) + 1;
      logger.info(
        `[StreamTaskOut][DIAG] start processing row: itemIndex=${itemIndex}, rowId=${rowId}, nextProcessedCounter=${current}`
      );
      logger.info(
        `[StreamTaskOut][FLOW] staging->task begin: rowId=${rowId}, created=${rowData?.Created || 'NULL'}, modified=${rowData?.Modified || 'NULL'}, vbId=${rowData?.VBId || 'NULL'}`
      );

      // --- BƯỚC MỚI: Tải file từ SharePoint (NGOÀI giao dịch SQL) ---
      step = 'prepareTaskFilesFromSharePoint';
      const preparedFiles = await this.prepareTaskFilesFromSharePoint(rowData);
      stopHeartbeat = startHeartbeatLoop(
        () => this.updateHeartbeat(rowId),
        this.heartbeatIntervalMs,
      );

      step = 'beginTransaction';
      transaction = new sql.Transaction(this.newPool);
      await transaction.begin();

      step = 'processRowData';
      const result = await this.processRowData(rowData, { transaction, preparedFiles });
      logger.info(
        `[StreamTaskOut][FLOW] staging->task result: rowId=${rowId}, action=${result?.action || 'N/A'}, affected=${result?.affected || 0}`
      );

      // Update counters in sync_jobs
      step = 'updateSyncJobsCounter';
      await this.queryNewDbTx(
        `UPDATE sync_jobs
         SET total_processed = ISNULL(total_processed, 0) + 1,
             total_success   = ISNULL(total_success, 0) + 1
         WHERE job_id = @syncJobId`,
        { syncJobId },
        transaction
      );

      // Mark staging row as processed successfully
      step = 'markStagingProcessed';
      await markRowSuccess(this, {
        tableRef: stagingTableRef,
        keyWhere: 'ID = @ID',
        params: { ID: rowId },
        transaction,
        rowToken: `ID=${rowId}`,
        label: this.modelName,
      });

      step = 'commitTransaction';
      await transaction.commit();
      if (stopHeartbeat) {
        stopHeartbeat();
        stopHeartbeat = null;
      }

      return {
        syncJobId,
        processed: true,
        done: false,
        rowId,
        result
      };
    } catch (error) {
      if (stopHeartbeat) {
        stopHeartbeat();
        stopHeartbeat = null;
      }
      if (transaction) {
        try {
          await transaction.rollback().catch(() => { });
        } catch (rollbackError) { }
      }

      if (rowData && rowData.ID) {
        try {
          step = 'markStagingError';
          const stagingTableRef = this.getStagingTableRef();
          await markRowFailed(this, {
            tableRef: stagingTableRef,
            keyWhere: 'ID = @ID',
            params: { ID: rowData.ID },
            rowToken: `ID=${rowData.ID}`,
            errorMessage: error.message,
            label: this.modelName,
          });
        } catch (updateErr) { }
      }

      logger.error(
        `[StreamTaskOut._processOneAttempt] Failed at step=${step}, row ID=${rowData?.ID || 'N/A'}, itemIndex=${itemIndex}: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Finalize cursor (deferred cursor pattern)
   */
  async finalizeProcessingCursor(syncJobId) {
    try {
      const stagingTableRef = this.getStagingTableRef();
      const res = await this.queryNewDb(`
        SELECT
          MAX(Modified) AS maxTime,
          MAX(TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), ''))) AS maxId
        FROM ${stagingTableRef}
        WHERE ISNULL(MigrateFlg, 0) = 1
          AND (${this.partitionColumn} >= @startDate OR @startDate IS NULL)
          AND (${this.partitionColumn} <= @endDate OR @endDate IS NULL)
      `, {
        startDate: process.env.SYNC_START_DATE || null,
        endDate: process.env.SYNC_END_DATE || null
      });
      if (res?.[0]?.maxTime) {
        const finalTime = new Date(res[0].maxTime).toISOString();
        const finalId = Number(res[0].maxId || 0);
        await this.queryNewDb(
          `UPDATE sync_jobs
           SET last_sync_time = @t,
               last_sync_id   = @id
           WHERE job_id = @jobId`,
          { t: finalTime, id: finalId, jobId: syncJobId }
        );
        logger.info(`[StreamTaskOut] Cursor finalized for partition: last_sync_time=${finalTime}, last_sync_id=${finalId}`);
      } else {
        logger.info(`[StreamTaskOut] finalizeProcessingCursor: không có bản ghi đã xử lý trong phân đoạn, cursor giữ nguyên.`);
      }
    } catch (err) {
      logger.warn(`[StreamTaskOut.finalizeProcessingCursor] Lỗi finalize cursor: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PROCESS ROW DATA
  // ═══════════════════════════════════════════════════════════════

  /**
   * Validates and applies one task row into destination aggregates.
   * @param {object} rowData
   * @param {{transaction?: object}} [context]
   * @returns {Promise<{action:string,idTaskBak:string,affected:number}>}
   */
  async processRowData(rowData, { transaction, preparedFiles = [] } = {}) {
    if (!rowData) {
      throw new Error('rowData is required');
    }

    const backupId = String(rowData.ID || '').trim();
    if (!backupId) {
      throw new Error('Invalid task ID from staging');
    }

    const res = await this.upsertTaskAggregateById(rowData, { transaction, preparedFiles });
    const affected = Number(res?.affected || 0);

    if (affected === 0) {
      throw new Error(`Task was not inserted or updated for ID=${backupId}`);
    }

    return {
      action: res?.action || 'upsert',
      idTaskBak: backupId,
      affected,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // UPSERT AGGREGATE — task-specific: task + task_users + system_logs
  // ═══════════════════════════════════════════════════════════════

  /**
   * Upserts one task and its related task_users + system_log entities.
   * @param {object} stagingRow
   * @param {{transaction?: object}} [context]
   * @returns {Promise<{action:string,idTaskBak:string,newTaskId:string,affected:number}>}
   */
  async upsertTaskAggregateById(stagingRow, { transaction, preparedFiles = [] } = {}) {
    if (!stagingRow) {
      return { action: 'none', affected: 0 };
    }

    const taskId = String(stagingRow.ID || '').trim();
    let totalAffected = 0;
    let stage = 'task.upsert';
    const counters = {
      task: 0,
      usersInsertedOrUpdated: 0,
      logsCreated: 0,
      filesApplied: 0,
      commentInsertedOrUpdated: 0,
      warnings: 0,
    };

    // ── 1. Upsert task chính ──────────────────────────────────────
    const taskResult = await this.taskModel.processSingleRecord(stagingRow, transaction);

    if (!taskResult || !taskResult.newTaskId) {
      logger.error(`[SYNC FAILED] Task not inserted for ID=${taskId}`);
      return { action: 'none', affected: 0, failed: true };
    }

    const newTaskId = taskResult.newTaskId;
    logger.info(`[SYNC OK] task ID=${taskId} → new_id=${newTaskId} action=${taskResult.action}`);
    totalAffected += 1;
    counters.task += 1;

    const createdAt = taskResult.createdAt || stagingRow.Created || new Date().toISOString();
    // ── 2. Task users (TaskVBDiPermission) ────────────────────────
    let firstUserId = null;
    try {
      stage = 'taskUsers.fetch';
      const taskUsersRows = await this.queryOldDb(
        `SELECT * FROM ${this.oldDbSchema}.TaskVBDiPermission WHERE TaskId = @taskId`,
        { taskId: String(stagingRow.ID) },
      );

      if (Array.isArray(taskUsersRows) && taskUsersRows.length > 0) {
        for (const userRow of taskUsersRows) {
          try {
            stage = 'taskUsers.upsert';
            const userResult = await this.taskUsersModel.processSingleRecord(
              { ...userRow, newTaskId, createdAt },
              transaction,
            );
            if (userResult && !firstUserId) {
              firstUserId = userRow.UserId;
            }
            if (userResult && userResult.action !== 'skipped') {
              totalAffected += 1;
              counters.usersInsertedOrUpdated += 1;
              logger.info(`[user] userId=${userRow.UserId} action=${userResult?.action}`);
            }
          } catch (userErr) {
            counters.warnings += 1;
            // SUB-TABLE ERROR: Log warning only, do NOT throw
            logger.warn(
              `[StreamTaskOutIncrementalModel] TaskUser sync failed at stage=${stage} (non-critical) userId=${userRow?.UserId || userRow?.ID || 'N/A'}: ${userErr.message}`,
              { errorStack: userErr.stack },
            );
          }
        }
      }
    } catch (userError) {
      counters.warnings += 1;
      // Fetch error: Log warning only, do NOT throw
      logger.warn(
        `[StreamTaskOutIncrementalModel] Failed at stage=${stage} for task_id=${taskId}: ${userError.message}`,
        { errorStack: userError.stack },
      );
    }
    const createdBy = firstUserId || taskResult?.createdBy || stagingRow.CreatedBy || null;
    // ── 3. System log ─────────────────────────────────────────────
    try {
      stage = 'systemLog.create';
      const logResult = await this.systemLogsModel.createLogForTask(
        { idTask: newTaskId, userInfo: createdBy, createdAt },
        transaction,
      );

      if (logResult.success) {
        logger.info(`[log] logId=${logResult.logId} created=true`);
        totalAffected += 1;
        counters.logsCreated += 1;
      } else {
        counters.warnings += 1;
        logger.warn(
          `[StreamTaskOutIncrementalModel] Log creation returned success=false for task_id=${newTaskId}`,
          {
            logResult,
          },
        );
      }
    } catch (logErr) {
      counters.warnings += 1;
      // SUB-TABLE ERROR: Log warning only, do NOT throw
      logger.warn(
        `[StreamTaskOutIncrementalModel] System log creation failed at stage=${stage} (non-critical) task_id=${newTaskId}: ${logErr.message}`,
        { errorStack: logErr.stack },
      );
    }

    // ── 4. File + Comment sync via linked outgoing document ───────
    const vbId = stagingRow?.VBId ? String(stagingRow.VBId).trim() : null;

    // ── 4a. Ghi dữ liệu file đính kèm vào Database ──────────────
    stage = 'files.applyPreparedTaskFiles';
    await this.applyPreparedTaskFiles(preparedFiles, newTaskId, stagingRow, transaction);
    counters.filesApplied += Array.isArray(preparedFiles) ? preparedFiles.length : 0;

    // ── 4b. Comment sync ───────────────────────────────────────
    if (vbId) {
      for (const commentModel of this._syncCommentModel) {
        try {
          stage = `comments.fetch.${commentModel?.oldDbTable}`;
          const rawComments = await commentModel.fetchByDocumentId(vbId);

          if (!Array.isArray(rawComments) || !rawComments.length) {
            continue;
          }

          for (const rawComment of rawComments) {
            try {
              stage = `comments.upsert.${commentModel?.oldDbTable}`;
              const result = await commentModel.processSingleRecord(
                rawComment,
                newTaskId,
                transaction,
              );
              if (!result) continue;
              logger.info(
                `[AggregateSync][Comment] table=${commentModel?.oldDbTable} taskId=${taskId} newTaskId=${newTaskId} inserted=${result?.inserted || 0} updated=${result?.updated || 0}`,
              );
              totalAffected += Number(result.inserted || 0);
              totalAffected += Number(result.updated || 0);
              counters.commentInsertedOrUpdated += Number(result.inserted || 0);
              counters.commentInsertedOrUpdated += Number(result.updated || 0);
            } catch (commentRowErr) {
              counters.warnings += 1;
              logger.warn(
                `[StreamTaskOutIncrementalModel] Comment row sync failed at stage=${stage} table=${commentModel?.oldDbTable} taskId=${taskId}: ${commentRowErr.message}`,
              );
            }
          }
        } catch (commentFetchErr) {
          counters.warnings += 1;
          logger.warn(
            `[StreamTaskOutIncrementalModel] Comment fetch failed at stage=${stage} table=${commentModel?.oldDbTable} taskId=${taskId}: ${commentFetchErr.message}`,
          );
        }
      }
    }

    logger.info(
      `[StreamTaskOut][AGG_SUMMARY] taskIdBak=${taskId}, newTaskId=${newTaskId}, action=${taskResult.action}, task=${counters.task}, users=${counters.usersInsertedOrUpdated}, logs=${counters.logsCreated}, files=${counters.filesApplied}, comments=${counters.commentInsertedOrUpdated}, warnings=${counters.warnings}, totalAffected=${Math.max(1, totalAffected)}`
    );

    return {
      action: taskResult.action,
      idTaskBak: taskId,
      newTaskId,
      affected: Math.max(1, totalAffected),
    };
  }
}

module.exports = StreamTaskOutIncrementalModel;
