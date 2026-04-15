const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const logger = require('../../../utils/logger');
const sql = require('mssql');

const { v4: uuidv4 } = require('uuid');
const FileService = require('../../sync-file-copy/Fileuploadservice');
const { downloadFile: spDownload } = require('../../sync-file-copy/SharePointAuthService');
const MigrationHelper = require('../../helpers/MigrationHelper');

const DEFAULT_SYNC_TIME = '9999-12-31T23:59:59.999Z';

// Lọc bản ghi cũ hơn ngưỡng này. Đặt trong .env với key SYNC_MIN_DATE.
// Ví dụ: SYNC_MIN_DATE=2026-01-01T00:00:00.000Z
// Để tắt filter (lấy toàn bộ lịch sử), để trống hoặc đặt thành 1753-01-01T00:00:00.000Z
const SYNC_MIN_DATE = process.env.SYNC_MIN_DATE || '2026-01-01T00:00:00.000Z';

// ─── Deadlock retry config ────────────────────────────────────────────────────
const DEADLOCK_MAX_RETRIES = 3;
const DEADLOCK_BASE_DELAY_MS = 200; // exponential back-off: 200ms, 400ms, 800ms
const DEADLOCK_ERROR_NUMBER = 1205;

// ── Reuse detectFileType từ outgoing (copy nguyên, không import cross-module) ──
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

// ── Comment tables (giống outgoing — dùng chung cấu trúc) ──
const COMMENT_TABLES = [
  'Comments',
  'Comments_ATPC', 'Comments_CLL',  'Comments_CNTT', 'Comments_CT',
  'Comments_CVTC', 'Comments_DonVi', 'Comments_DVHH', 'Comments_DVKT',
  'Comments_GNVT', 'Comments_HC',   'Comments_HT',   'Comments_ICDLB',
  'Comments_ICDST','Comments_KHDT', 'Comments_KHKD', 'Comments_KTVT',
  'Comments_KVTC', 'Comments_MKT',  'Comments_NPL',  'Comments_QLCT',
  'Comments_QSBV', 'Comments_SNPL', 'Comments_TC',   'Comments_TC189',
  'Comments_TCCT', 'Comments_TCHP', 'Comments_TCIDI','Comments_TCLD',
  'Comments_TCMT', 'Comments_TCO',  'Comments_TCOT', 'Comments_TCPC',
  'Comments_TCPH', 'Comments_TCTT', 'Comments_TTDDC','Comments_TTDTC',
  'Comments_VP',   'Comments_VPMB', 'Comments_VPTNB','Comments_VTB',
  'Comments_VTT',  'Comments_XDCT', 'Comments_xdsm', 'Comments_XNCG',
  'Comments_YTE'
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
          `[withDeadlockRetry]${label ? ' ' + label : ''} deadlock detected — retry ${attempt}/${maxRetries} after ${delay}ms`
        );
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
}

/** Task sync orchestrator (transaction-based: fetch → stage → process with atomic multi-table handling) */
class StreamTaskInIncrementalModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_TASK_INCOMING_INCREMENTAL' });
    this.newDbName = process.env.NEW_DB_NAME;
    this.oldDbSchema = 'dbo';
    this.oldDbTable = 'TaskVBDen';
    this.newDbSchema = 'dbo';
    this.newTableSync = 'task_sync';

    // Internal data models
    this.taskModel = null;
    this.taskUsersModel = null;
    this.systemLogsModel = null;

    this._fileService = null;
    this._syncCommentModel = [];

    // Guard: prevent concurrent initialize() calls from racing on staging DDL
    this._initializingPromise = null;
    this.partitionColumn = 'Created'; // Cột nghiệp vụ để chia dải dữ liệu
  }

  // ═══════════════════════════════════════════════════════════════
  // INITIALIZE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Initialize all models and staging tables.
   * Concurrent callers share the same promise to avoid DDL races.
   */
  async initialize() {
    // If already initializing (e.g. duplicate registration race), share the same promise
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

  /** Internal initialize logic, wrapped by the public guard above */
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

      // Helper for self-healing
      const helper = new MigrationHelper(this.queryNewDbTx.bind(this), this.queryOldDb.bind(this));

      // FIX (Self-healing): Ensure technical columns exist in staging table
      await helper.ensureColumnsExist(
        this.newDbName,
        this.newTableSync,
        {
          'MigrateFlg': 'NVARCHAR(MAX) NULL',
          'MigrateErrFlg': 'NVARCHAR(MAX) NULL',
          'MigrateErrMess': 'NVARCHAR(MAX) NULL'
        }
      );

      // FIX: use deadlock-safe staging table creation with retry
      await withDeadlockRetry(
        () => this.ensureStagingTableExists(),
        'ensureStagingTableExists'
      );

      // ADD: Ensure all necessary columns exist (e.g. ItemId)
      await withDeadlockRetry(
        () => this.ensureStagingTableColumns(),
        'ensureStagingTableColumns'
      );

      this._fileService = new FileService(this.newPool);

      // Late require SyncCommentModel
      const SyncCommentModel = require('../../sync-document-comment/SyncCommentModel');

      this._syncCommentModel = [];
      const baseCommentModel = new SyncCommentModel(COMMENT_TABLES[0]);
      await baseCommentModel.initialize();

      // Đảm bảo 2 cột backup tồn tại trong document_comments
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
      `);

      this._syncCommentModel = COMMENT_TABLES.map((table) => {
        const model = new SyncCommentModel(table);
        model.oldPool = baseCommentModel.oldPool;
        model.newPool = baseCommentModel.newPool;
        return model;
      });

      logger.info('[StreamTaskInIncrementalModel] Initialized with transaction-based aggregate processing');
    } catch (error) {
      logger.error('[StreamTaskInIncrementalModel.initialize]', error);
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
  // STAGING TABLE — task-specific schema
  // ═══════════════════════════════════════════════════════════════

  /**
   * Tạo bảng staging `task_sync` trong DB mới nếu chưa tồn tại.
   *
   * FIX (deadlock): Thay DROP + CREATE bằng CREATE IF NOT EXISTS để tránh
   * tranh chấp schema-lock với các transaction khác đang chạy song song.
   * Khi schema thật sự thay đổi (thêm/bớt cột), gọi rebuildStagingTable().
   */
  async ensureStagingTableExists() {
    const table = this.getStagingTableRef();
    const tableName = this.newTableSync;
    const schemaName = this.newDbSchema;
    const dbName = this.newDbName;

    // ── 1. Create table only if it doesn't exist (no DROP → no schema lock race) ──
    const createQuery = `
      IF NOT EXISTS (
        SELECT 1
        FROM ${dbName}.sys.tables  t
        JOIN ${dbName}.sys.schemas s ON t.schema_id = s.schema_id
        WHERE t.name   = '${tableName}'
          AND s.name   = '${schemaName}'
      )
      BEGIN
        CREATE TABLE ${table} (
          -- Source columns (raw from TaskVBDen / old DB)
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

          CONSTRAINT PK_task_sync PRIMARY KEY (ID)
        );
        PRINT 'task_sync table created';
      END
    `;

    await this.queryNewDb(createQuery);
    logger.info('[StreamTaskInIncrementalModel] task_sync staging table ready');
  }

  /**
   * Đảm bảo tất cả các cột cần thiết tồn tại trong bảng staging.
   * Nếu thiếu cột (ví dụ: ItemId mới bổ sung), nó sẽ tự động ALTER TABLE ADD.
   */
  async ensureStagingTableColumns() {
    const table = this.getStagingTableRef();
    const tableName = this.newTableSync;
    const dbName = this.newDbName;

    // Danh sách các cột cần check (theo schema chuẩn ở ensureStagingTableExists)
    const requiredColumns = [
      { name: 'VBId',                   type: 'NVARCHAR(MAX)' },
      { name: 'DepartmentId',           type: 'NVARCHAR(MAX)' },
      { name: 'ParentId',               type: 'NVARCHAR(MAX)' },
      { name: 'Title',                  type: 'NVARCHAR(MAX)' },
      { name: 'DanhGia',                type: 'NVARCHAR(MAX)' },
      { name: 'DeBaoCao',               type: 'NVARCHAR(MAX)' },
      { name: 'DeBiet',                 type: 'NVARCHAR(MAX)' },
      { name: 'DeThucHien',             type: 'NVARCHAR(MAX)' },
      { name: 'DuocHuy',                type: 'NVARCHAR(MAX)' },
      { name: 'DiemChatLuong',          type: 'NVARCHAR(MAX)' },
      { name: 'DiemThoiGian',           type: 'NVARCHAR(MAX)' },
      { name: 'DiemDanhGia',            type: 'NVARCHAR(MAX)' },
      { name: 'StartDate',              type: 'NVARCHAR(MAX)' },
      { name: 'DueDate',                type: 'NVARCHAR(MAX)' },
      { name: 'CompletedDate',          type: 'NVARCHAR(MAX)' },
      { name: 'HoanTatTuDong',          type: 'NVARCHAR(MAX)' },
      { name: 'HoSoDuThaoId',           type: 'NVARCHAR(MAX)' },
      { name: 'HoSoDuThaoUrl',          type: 'NVARCHAR(MAX)' },
      { name: 'HoSoXuLyUrl',            type: 'NVARCHAR(MAX)' },
      { name: 'Percent',                type: 'NVARCHAR(MAX)' },
      { name: 'TrangThai',              type: 'NVARCHAR(MAX)' },
      { name: 'Priority',               type: 'NVARCHAR(MAX)' },
      { name: 'YKienCuaNguoiGiaiQuyet', type: 'NVARCHAR(MAX)' },
      { name: 'YKienChiDao',            type: 'NVARCHAR(MAX)' },
      { name: 'ModuleId',               type: 'NVARCHAR(MAX)' },
      { name: 'SiteName',               type: 'NVARCHAR(MAX)' },
      { name: 'ListName',               type: 'NVARCHAR(MAX)' },
      { name: 'ItemId',                 type: 'NVARCHAR(MAX)' },
      { name: 'Modified',               type: 'NVARCHAR(MAX)' },
      { name: 'Created',                type: 'NVARCHAR(MAX)' },
      { name: 'ModifiedBy',             type: 'NVARCHAR(MAX)' },
      { name: 'CreatedBy',              type: 'NVARCHAR(MAX)' },
      { name: 'MigrateFlg',             type: 'NVARCHAR(MAX)' },
      { name: 'MigrateErrFlg',          type: 'NVARCHAR(MAX)' },
      { name: 'MigrateErrMess',         type: 'NVARCHAR(MAX)' },
      { name: 'ParentTaskID',           type: 'NVARCHAR(MAX)' },
      { name: 'id_task_bak',            type: 'NVARCHAR(MAX)' }
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

    logger.info(`[StreamTaskInIncrementalModel] Verified staging table columns for ${tableName}`);
  }

  /**
   * Force-rebuilds the staging table (DROP + CREATE).
   * Call this ONLY during maintenance / schema migration — NOT on every startup.
   * Wrapped with deadlock retry automatically.
   */
  async rebuildStagingTable() {
    await withDeadlockRetry(async () => {
      const table = this.getStagingTableRef();

      const dropQuery = `
        IF OBJECT_ID('${table}', 'U') IS NOT NULL
          DROP TABLE ${table};
      `;
      await this.queryNewDb(dropQuery);
      logger.info('[StreamTaskInIncrementalModel] task_sync dropped for rebuild');

      // Re-use ensureStagingTableExists to create fresh
      await this.ensureStagingTableExists();
    }, 'rebuildStagingTable');
  }

  async ThemFileDinhKemTask(stagingRow, newTaskId) {
    if (!this._fileService) {
      logger.warn('[ThemFileDinhKemTask] FileService chưa được khởi tạo');
      return false;
    }

    const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
    if (!baseUrl) {
      logger.error('[ThemFileDinhKemTask] BASE_URL chưa được cấu hình trong .env');
      return false;
    }

    // Task có thể có nhiều URL file — mở rộng dễ dàng nếu cần thêm field
    const fileUrlFields = [
      { field: 'HoSoDuThaoUrl', objectType: 'taskdocuments'   },
      { field: 'HoSoXuLyUrl',   objectType: 'taskdocuments'  },
    ];

    let anySuccess = false;

    for (const { field, objectType } of fileUrlFields) {
      const rawUrl = stagingRow?.[field];
      if (!rawUrl || String(rawUrl).trim() === '') continue;

      const relativePath = String(rawUrl).trim();
      const fullUrl = relativePath.startsWith('http')
        ? relativePath
        : `${baseUrl}${relativePath}`;

      const fileName = relativePath.substring(relativePath.lastIndexOf('/') + 1) || field;

      let buffer;
      try {
        buffer = await spDownload(fullUrl);
      } catch (downloadErr) {
        logger.error(
          `[ThemFileDinhKemTask] Download failed field=${field} url=${fullUrl} taskId=${stagingRow?.ID}: ${downloadErr.message}`
        );
        continue;
      }

      try {
        const { mime: mimeType } = detectFileType(buffer);
        const fileIdBak = uuidv4();

        const fileRecord = {
          file_name:   fileName,
          file_path:   relativePath,
          mime_type:   mimeType,
          created_by:  stagingRow?.CreatedBy || null,
          version:     1,
          id_bak:      fileIdBak,
          table_bak:   'TaskVBDen',
          type_doc:    null,
          isBak:       1
        };

        const relationRecord = {
          object_type:    objectType,
          object_id:      String(newTaskId),
          object_id_bak:  stagingRow?.ID,
          file_id_bak:    fileIdBak,
          table_bak:      'TaskVBDen',
          type_doc:       objectType,
        };

        await this._fileService.uploadAndInsert({
          fileBuffer:    buffer,
          originalName:  fileName,
          mimeType,
          fileRecord,
          relationRecord,
          folder:        'task',
          localFolder:   'task'
        });

        logger.info(
          `[ThemFileDinhKemTask] field=${field} taskId=${stagingRow?.ID} newTaskId=${newTaskId} ok`
        );
        anySuccess = true;
      } catch (insertErr) {
        logger.error(
          `[ThemFileDinhKemTask] Insert failed field=${field} taskId=${stagingRow?.ID}: ${insertErr.message}`
        );
      }
    }

    return anySuccess;
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
          AND (${this.partitionColumn} >= @startDate OR @startDate IS NULL)
          AND (${this.partitionColumn} <= @endDate OR @endDate IS NULL)
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
          AND (${this.partitionColumn} >= @startDate OR @startDate IS NULL)
          AND (${this.partitionColumn} <= @endDate OR @endDate IS NULL)
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
          __sync_time < @lastSyncTime
          OR (
            __sync_time = @lastSyncTime
            AND ISNULL(__sync_id, 9223372036854775807) < @lastSyncId
          )
        )
        -- Chỉ lấy bản ghi từ năm 2026 trở đi
        AND __sync_time >= '${SYNC_MIN_DATE}'
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

    const internalColumns = new Set(['__sync_time', '__sync_id', '__sync_id_num', '_sync_time_val', '_sync_id_val']);
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
          ${nonIdColumns.length > 0
          ? `UPDATE ${stagingTableRef} SET ${updateClause} WHERE ID = @ID;`
          : `SELECT 1 AS noop;`}
        END
        ELSE
        BEGIN
          INSERT INTO ${stagingTableRef} (${safeColumns.join(', ')})
          VALUES (${columns.map((column) => `@${column}`).join(', ')});
        END
      `;

      // FIX: wrap each row upsert with deadlock retry
      await withDeadlockRetry(
        () => this.queryNewDbTx(query, params, transaction),
        `syncOldToStaging ID=${rawId}`
      );
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

    // Cleanup stale records
    try {
      await this.queryNewDb(`
        UPDATE ${stagingTableRef}
        SET MigrateFlg = 0, MigrateErrMess = 'Reset from stale processing'
        WHERE MigrateFlg = 2
      `);
    } catch (cleanupErr) {
      logger.warn(`[StreamTaskIn] Cleanup stale records failed: ${cleanupErr.message}`);
    }

    // 1. Đếm tổng và cập nhật Dashboard
    const totalCount = await this.countListFromOldDb(normalizedLastSyncTime, normalizedLastSyncId);
    logger.info(`[StreamTaskIn] Tổng số bản ghi cần sync: ${totalCount} (LastTime: ${normalizedLastSyncTime}, LastId: ${normalizedLastSyncId})`);

    await this.queryNewDb(`UPDATE sync_jobs SET total_to_sync = @total WHERE job_id = @jobId`, {
      total: totalCount,
      jobId: syncJobId
    });

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

      const stageResult = await this.syncOldToStaging(rows);
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

    logger.info(`🔥 [StreamTaskIn] Hoàn tất hút dữ liệu về Staging. Staged=${totalStaged}/${totalCount}. LastSyncTime: ${nextSyncTime}, LastSyncId: ${nextSyncId}`);

    // Fix Bug #3: Đếm số bản ghi THỰC TẾ trong staging chưa xử lý
    let pendingCount = 0;
    try {
      const pendingRes = await this.queryNewDb(`
        SELECT COUNT(1) AS cnt FROM ${stagingTableRef}
        WHERE ISNULL(MigrateFlg, 0) = 0
          AND ISNULL(MigrateErrFlg, 0) = 0
      `);
      pendingCount = Number(pendingRes?.[0]?.cnt || 0);
    } catch (e) {
      logger.warn(`[StreamTaskIn] Không đếm được pending staging: ${e.message}`);
      pendingCount = totalStaged;
    }
    logger.info(`[StreamTaskIn] Pending records trong Staging có thể xử lý: ${pendingCount}`);

    // Cập nhật Dashboard lần cuối với tổng số thực tế (bao gồm cả các bản ghi tồn đọng cũ trong staging)
    await this.queryNewDb(`UPDATE sync_jobs SET total_to_sync = @total WHERE job_id = @jobId`, {
      total: pendingCount,
      jobId: syncJobId
    });

    return {
      syncJobId,
      rows: [],
      totalCount: pendingCount,
      stagedCount: totalStaged,
      sourceLastSyncTime: normalizedLastSyncTime,
      sourceLastSyncId: normalizedLastSyncId,
      lastSyncTime: nextSyncTime,
      lastSyncId: nextSyncId
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
  async fetchOneFromStaging() {
    try {
      const stagingTableRef = this.getStagingTableRef();
      const query = `
      WITH CTE AS (
        SELECT TOP (1) *
        FROM ${stagingTableRef}
        WHERE ISNULL(MigrateFlg, 0) = 0
          AND ISNULL(MigrateErrFlg, 0) = 0
          -- Lọc theo cột nghiệp vụ để chia tải giữa các Worker
          AND (${this.partitionColumn} >= @startDate OR @startDate IS NULL)
          AND (${this.partitionColumn} <= @endDate OR @endDate IS NULL)
        ORDER BY TRY_CONVERT(datetime2, Modified) DESC,
                 TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(ID)), '')) DESC
      )
      UPDATE CTE
      SET MigrateFlg = 2,
          MigrateErrMess = 'Processing...'
      OUTPUT inserted.*
      `;

      const rows = await this.queryNewDb(query, {
        startDate: process.env.SYNC_START_DATE || null,
        endDate: process.env.SYNC_END_DATE || null
      });
      return rows?.length ? rows[0] : null;
    } catch (error) {
      logger.error(`[StreamTaskIn.fetchOneFromStaging] Failed: ${error.message}`);
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
      { syncJobId }
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

    // Safety check: ensure pool is initialized
    if (!this.newPool) {
      throw new Error('Database pool not initialized');
    }

    return withDeadlockRetry(
      () => this._processOneAttempt(syncJobId, options),
      `processOne syncJobId=${syncJobId}`
    );
  }

  /**
   * Single attempt of processOne — extracted so withDeadlockRetry can re-run it cleanly.
   * @private
   */
  async _processOneAttempt(syncJobId, options = {}) {
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
        logger.info(`[StreamTaskIn] No more data in staging for job ${syncJobId}.`);
        await this.finalizeProcessingCursor(syncJobId);
        return {
          syncJobId,
          processed: false,
          done: true
        };
      }

      const rowId = rowData.ID || null;
      const current = Number(jobState?.total_processed || 0) + 1;
      logger.info(`[StreamTaskIn] Process ${current}: record ID=${rowId}`);

      transaction = new sql.Transaction(this.newPool);
      await transaction.begin();

      const result = await this.processRowData(rowData, { transaction });

      // Update counters in sync_jobs
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
          await transaction.rollback().catch(() => {});
        } catch (rollbackError) {}
      }

      if (rowData && rowData.ID) {
        try {
           const stagingTableRef = this.getStagingTableRef();
           await this.queryNewDb(`UPDATE ${stagingTableRef} SET MigrateErrFlg = 1, MigrateErrMess = @Err WHERE ID = @ID`, { ID: rowData.ID, Err: String(error.message).slice(0, 1000) });
        } catch (updateErr) {}
      }

      logger.error(`[StreamTaskIn._processOneAttempt] Failed row ID=${rowData?.ID}: ${error.message}`);
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
        logger.info(`[StreamTaskIn] Cursor finalized: last_sync_time=${finalTime}, last_sync_id=${finalId}`);
      }
    } catch (err) {
      logger.warn(`[StreamTaskIn.finalizeProcessingCursor] Lỗi finalize cursor: ${err.message}`);
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
  async processRowData(rowData, { transaction } = {}) {
    if (!rowData) {
      throw new Error('rowData is required');
    }

    const backupId = String(rowData.ID || '').trim();
    if (!backupId) {
      throw new Error('Invalid task ID from staging');
    }

    const res = await this.upsertTaskAggregateById(rowData, { transaction });
    const affected = Number(res?.affected || 0);

    if (affected === 0) {
      throw new Error(`Task was not inserted or updated for ID=${backupId}`);
    }

    return {
      action: res?.action || 'upsert',
      idTaskBak: backupId,
      affected
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
  async upsertTaskAggregateById(stagingRow, { transaction } = {}) {
    if (!stagingRow) {
      return { action: 'none', affected: 0 };
    }

    const taskId = String(stagingRow.ID || '').trim();
    let totalAffected = 0;

    // ── 1. Upsert task chính ──────────────────────────────────────
    const taskResult = await this.taskModel.processSingleRecord(stagingRow, transaction);

    if (!taskResult || !taskResult.newTaskId) {
      logger.error(`[SYNC FAILED] Task not inserted for ID=${taskId}`);
      return { action: 'none', affected: 0, failed: true };
    }

    const newTaskId = taskResult.newTaskId;
    logger.info(`[SYNC OK] task ID=${taskId} → new_id=${newTaskId} action=${taskResult.action}`);
    totalAffected += 1;

    const createdAt = taskResult.createdAt || stagingRow.Created || new Date().toISOString();
    // ── 2. Task users (TaskVBDenPermission) ───────────────────────
    let firstUserId = null;
    try {
      const taskUsersRows = await this.queryOldDb(
        `SELECT * FROM ${this.oldDbSchema}.TaskVBDenPermission WHERE TaskId = @taskId`,
        { taskId: String(stagingRow.ID) }
      );
      if (Array.isArray(taskUsersRows) && taskUsersRows.length > 0) {
        for (const userRow of taskUsersRows) {
          try {
            const userResult = await this.taskUsersModel.processSingleRecord(
              { ...userRow, newTaskId, createdAt },
              transaction
            );
            if(userResult && !firstUserId) {
              firstUserId = userRow.UserId;
            }
            if (userResult && userResult.action !== 'skipped') {
              totalAffected += 1;
              logger.info(`[user] userId=${userRow.UserId} action=${userResult?.action}`);
            }
          } catch (userErr) {
            // SUB-TABLE ERROR: Log warning only, do NOT throw
            logger.warn(
              `[StreamTaskInIncrementalModel] TaskUser sync failed (non-critical) userId=${userRow.ID}: ${userErr.message}`,
              { errorStack: userErr.stack }
            );
          }
        }
      }
    } catch (userError) {
      // Fetch error: Log warning only, do NOT throw
      logger.warn(
        `[StreamTaskInIncrementalModel] Failed to fetch task users for task_id=${taskId}: ${userError.message}`,
        { errorStack: userError.stack }
      );
    }

    const createdBy =
      firstUserId ||
      taskResult?.createdBy ||
      stagingRow.CreatedBy ||
      null;
    // ── 3. System log ─────────────────────────────────────────────
    try {
      const logResult = await this.systemLogsModel.createLogForTask(
        { idTask: newTaskId, userInfo: createdBy, createdAt },
        transaction
      );

      if (logResult.success) {
        logger.info(`[log] logId=${logResult.logId} created=true`);
        totalAffected += 1;
      } else {
        logger.warn(`[StreamTaskInIncrementalModel] Log creation returned success=false for task_id=${newTaskId}`, {
          logResult
        });
      }
    } catch (logErr) {
      // SUB-TABLE ERROR: Log warning only, do NOT throw
      logger.warn(
        `[StreamTaskInIncrementalModel] System log creation failed (non-critical) task_id=${newTaskId}: ${logErr.message}`,
        { errorStack: logErr.stack }
      );
    }

    // ── 4. File + Comment sync via linked incoming document ───────
    const vbId = stagingRow?.VBId ? String(stagingRow.VBId).trim() : null;

    if (vbId) {
      // ── 4a. File sync ──────────────────────────────────────────
      try {
        const hasFiles = stagingRow?.HoSoDuThaoUrl || stagingRow?.HoSoXuLyUrl;
        if (hasFiles) {
          await this.ThemFileDinhKemTask(stagingRow, newTaskId);
        }
      } catch (fileErr) {
        logger.warn(
          `[StreamTaskInIncrementalModel] File sync failed (non-critical) taskId=${taskId} newTaskId=${newTaskId}: ${fileErr.message}`
        );
      }
      // ── 4b. Comment sync (cấu trúc giữ nguyên từ outgoing) ────
      for (const commentModel of this._syncCommentModel) {
        try {
          const rawComments = await commentModel.fetchByDocumentId(vbId);

          if (!Array.isArray(rawComments) || !rawComments.length) {
            continue;
          }

          for (const rawComment of rawComments) {
            try {
              const result = await commentModel.processSingleRecord(
                rawComment,
                newTaskId,
                transaction
              );
              if (!result) continue;
              logger.info(
                `[AggregateSync][Comment] table=${commentModel?.oldDbTable} taskId=${taskId} newTaskId=${newTaskId} inserted=${result?.inserted || 0} updated=${result?.updated || 0}`
              );
              totalAffected += Number(result.inserted || 0);
              totalAffected += Number(result.updated || 0);
            } catch (commentRowErr) {
              logger.warn(
                `[StreamTaskInIncrementalModel] Comment row sync failed table=${commentModel?.oldDbTable} taskId=${taskId}: ${commentRowErr.message}`
              );
            }
          }
        } catch (commentFetchErr) {
          logger.warn(
            `[StreamTaskInIncrementalModel] Comment fetch failed table=${commentModel?.oldDbTable} taskId=${taskId}: ${commentFetchErr.message}`
          );
        }
      }
    }

    return {
      action: taskResult.action,
      idTaskBak: taskId,
      newTaskId,
      affected: Math.max(1, totalAffected)
    };
  }
}

module.exports = StreamTaskInIncrementalModel;
