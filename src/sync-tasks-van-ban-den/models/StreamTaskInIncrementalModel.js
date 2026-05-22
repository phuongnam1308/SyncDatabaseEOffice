const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const logger = require('../../../utils/logger');
const dbUtils = require('../../../utils/dbUtils');
const sql = require('mssql');

const { v4: uuidv4 } = require('uuid');
const FileService = require('../../sync-file-copy/Fileuploadservice');
const { downloadFile: spDownload } = require('../../sync-file-copy/SharePointAuthService');
const MigrationHelper = require('../../helpers/MigrationHelper');
const {
  claimNextStagingRow,
  ensureTrackingColumns,
  markRowFailed,
  markRowSuccess,
  releaseStaleClaims,
  startHeartbeatLoop,
  updateHeartbeat,
} = require('../../helpers/StagingQueueHelper');

const DEFAULT_SYNC_TIME = '9999-12-31T23:59:59.999Z';

// Lá»c báº£n ghi cÅ© hÆ¡n ngÆ°á»¡ng nÃ y. Äáº·t trong .env vá»›i key SYNC_MIN_DATE.
// VÃ­ dá»¥: SYNC_MIN_DATE=2026-01-01T00:00:00.000Z
// Äá»ƒ táº¯t filter (láº¥y toÃ n bá»™ lá»‹ch sá»­), Ä‘á»ƒ trá»‘ng hoáº·c Ä‘áº·t thÃ nh 1753-01-01T00:00:00.000Z
const SYNC_MIN_DATE = process.env.SYNC_MIN_DATE || '2026-01-01T00:00:00.000Z';

// â”€â”€â”€ Deadlock retry config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DEADLOCK_MAX_RETRIES = 3;
const DEADLOCK_BASE_DELAY_MS = 200; // exponential back-off: 200ms, 400ms, 800ms
const DEADLOCK_ERROR_NUMBER = 1205;
const LOCK_TIMEOUT_ERROR_NUMBER = 1222;
const OLD_DB_CONNECT_MAX_RETRIES = Number(process.env.OLD_DB_CONNECT_MAX_RETRIES || 4);
const OLD_DB_CONNECT_BASE_DELAY_MS = Number(process.env.OLD_DB_CONNECT_BASE_DELAY_MS || 1000);
const TASK_IN_PIPELINE_MODE = String(process.env.TASK_IN_PIPELINE_MODE || 'old_to_staging')
  .trim()
  .toLowerCase();

// â”€â”€ Reuse detectFileType tá»« outgoing (copy nguyÃªn, khÃ´ng import cross-module) â”€â”€
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

// â”€â”€ Comment tables (giá»‘ng outgoing â€” dÃ¹ng chung cáº¥u trÃºc) â”€â”€
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
 * Convert values to stable staging params (staging columns are NVARCHAR-based).
 * This prevents mssql from inferring DateTime and failing on edge dates like 9999-12-31.
 * @param {any} value
 * @returns {any}
 */
function normalizeStagingParamValue(value) {
  if (value === undefined) return null;
  if (value === null) return null;

  // Keep primitive numbers/booleans as-is for lightweight binding.
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString();
  }

  return value;
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
 * Returns true when the error is a lock-contention transient issue
 * (deadlock / lock timeout) and should be retried.
 * @param {Error} err
 * @returns {boolean}
 */
function isRetryableLockError(err) {
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || err?.originalError?.code || '').toUpperCase();
  return (
    isDeadlockError(err) ||
    err?.number === LOCK_TIMEOUT_ERROR_NUMBER ||
    err?.originalError?.info?.number === LOCK_TIMEOUT_ERROR_NUMBER ||
    code === 'ETIMEOUT' ||
    msg.includes('lock request time out') ||
    msg.includes('request failed to complete in') ||
    msg.includes('timeout')
  );
}

/**
 * Returns true for transient OLD DB connectivity failures.
 * @param {Error} err
 * @returns {boolean}
 */
function isTransientOldDbConnectionError(err) {
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || err?.originalError?.code || '').toUpperCase();
  return (
    code === 'ESOCKET' ||
    code === 'ETIMEOUT' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    msg.includes('could not connect') ||
    msg.includes('failed to connect') ||
    msg.includes('connectionerror') ||
    msg.includes('socket hang up') ||
    msg.includes('connection is closed') ||
    msg.includes('connection lost')
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
      if (isRetryableLockError(err) && attempt <= maxRetries) {
        const delay = DEADLOCK_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn(
          `[withDeadlockRetry]${label ? ' ' + label : ''} lock conflict detected â€” retry ${attempt}/${maxRetries} after ${delay}ms`,
        );
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
}

/** Task sync orchestrator (transaction-based: fetch â†’ stage â†’ process with atomic multi-table handling) */
class StreamTaskInIncrementalModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_TASK_INCOMING_INCREMENTAL' });
    this.newDbName = process.env.NEW_DB_NAME;
    this.oldDbSchema = 'dbo';
    this.oldDbTable = 'TaskVBDen';
    this.newDbSchema = 'dbo';
    this.newTableSync = 'task_sync';
    this.isBatchSync = true; // Mark as batch sync module for high performance

    // Internal data models
    this.taskModel = null;
    this.taskUsersModel = null;
    this.systemLogsModel = null;

    this._fileService = null;
    this._syncCommentModel = [];

    // Guard: prevent concurrent initialize() calls from racing on staging DDL
    this._initializingPromise = null;
    this.partitionColumn = 'Created'; // Cá»™t nghiá»‡p vá»¥ Ä‘á»ƒ chia dáº£i dá»¯ liá»‡u
    this.heartbeatIntervalMs = Number(process.env.HEARTBEAT_INTERVAL_MS || 30000);
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // INITIALIZE
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
      // FIX: Ensure staging table exists FIRST before any column checks or model inits
      await withDeadlockRetry(() => this.ensureStagingTableExists(), 'ensureStagingTableExists');

      // ADD: Ensure all necessary columns exist (e.g. ItemId)
      await withDeadlockRetry(() => this.ensureStagingTableColumns(), 'ensureStagingTableColumns');

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
      await helper.ensureColumnsExist(this.newDbName, this.newTableSync, {
        MigrateFlg: 'NVARCHAR(MAX) NULL',
        MigrateErrFlg: 'NVARCHAR(MAX) NULL',
        MigrateErrMess: 'NVARCHAR(MAX) NULL',
      });

      this._fileService = new FileService(this.newPool);

      // Late require SyncCommentModel
      const SyncCommentModel = require('../../sync-document-comment/SyncCommentModel');

      this._syncCommentModel = [];
      const baseCommentModel = new SyncCommentModel(COMMENT_TABLES[0]);
      await baseCommentModel.initialize();

      // Äáº£m báº£o 2 cá»™t backup tá»“n táº¡i trong document_comments
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

      logger.info(
        '[StreamTaskInIncrementalModel] Initialized with transaction-based aggregate processing',
      );
    } catch (error) {
      logger.error('[StreamTaskInIncrementalModel.initialize]', error);
      throw error;
    }
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // CURSOR HELPERS
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
   * DESC sync: thá»i gian nhá» hÆ¡n (cÅ© hÆ¡n) lÃ  "Ä‘i trÆ°á»›c" (tiáº¿n vá» quÃ¡ khá»©).
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

  _normalizeQueryForLog(query) {
    return String(query || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1200);
  }

  _safeParamsForLog(params) {
    try {
      return JSON.stringify(params || {});
    } catch (_err) {
      return '[unserializable params]';
    }
  }

  _resolveQueryCaller() {
    const stack = String(new Error().stack || '')
      .split('\n')
      .map((line) => line.trim());
    const caller = stack.find(
      (line) =>
        line.startsWith('at ') &&
        !line.includes('._resolveQueryCaller') &&
        !line.includes('._logDetailedQueryError') &&
        !line.includes('.queryOldDb') &&
        !line.includes('.queryNewDb') &&
        !line.includes('.queryNewDbTx'),
    );
    return caller || 'at <unknown>';
  }

  _logDetailedQueryError(dbLabel, query, params, error, extra = {}) {
    const caller = this._resolveQueryCaller();
    const compactQuery = this._normalizeQueryForLog(query);
    const compactParams = this._safeParamsForLog(params);
    logger.error(
      `[StreamTaskInIncrementalModel][${dbLabel}] Query failed at ${caller}. ` +
      `Error=${error?.message || 'unknown error'}. Query=${compactQuery}. Params=${compactParams}`,
      extra,
    );
  }

  async queryOldDb(query, params = {}) {
    let attempt = 0;
    while (true) {
      try {
        return await super.queryOldDb(query, params);
      } catch (error) {
        attempt += 1;
        const canRetry =
          isTransientOldDbConnectionError(error) && attempt <= OLD_DB_CONNECT_MAX_RETRIES;
        this._logDetailedQueryError('OLD_DB', query, params, error, {
          retry: {
            attempt,
            maxRetries: OLD_DB_CONNECT_MAX_RETRIES,
            canRetry,
          },
        });
        if (!canRetry) {
          throw error;
        }
        const delay = OLD_DB_CONNECT_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn(
          `[StreamTaskInIncrementalModel][OLD_DB] transient connection error, retry ${attempt}/${OLD_DB_CONNECT_MAX_RETRIES} after ${delay}ms`,
        );
        await sleep(delay);
      }
    }
  }

  async queryNewDb(query, params = {}) {
    try {
      return await super.queryNewDb(query, params);
    } catch (error) {
      this._logDetailedQueryError('NEW_DB', query, params, error);
      throw error;
    }
  }

  async queryNewDbTx(query, params = {}, transaction = null) {
    try {
      return await super.queryNewDbTx(query, params, transaction);
    } catch (error) {
      this._logDetailedQueryError('NEW_DB_TX', query, params, error, {
        txState: {
          hasTx: Boolean(transaction),
          aborted: Boolean(transaction?._aborted),
          acquiredConnection: Boolean(transaction?._acquiredConnection),
        },
      });
      throw error;
    }
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // STAGING TABLE â€” task-specific schema
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  /**
   * Táº¡o báº£ng staging `task_sync` trong DB má»›i náº¿u chÆ°a tá»“n táº¡i.
   *
   * FIX (deadlock): Thay DROP + CREATE báº±ng CREATE IF NOT EXISTS Ä‘á»ƒ trÃ¡nh
   * tranh cháº¥p schema-lock vá»›i cÃ¡c transaction khÃ¡c Ä‘ang cháº¡y song song.
   * Khi schema tháº­t sá»± thay Ä‘á»•i (thÃªm/bá»›t cá»™t), gá»i rebuildStagingTable().
   */
  async ensureStagingTableExists() {
    const table = this.getStagingTableRef();
    const tableName = this.newTableSync;
    const schemaName = this.newDbSchema;
    const dbName = this.newDbName;

    // â”€â”€ 1. Create table only if it doesn't exist (no DROP â†’ no schema lock race) â”€â”€
    const createQuery = `
      IF OBJECT_ID('${table}', 'U') IS NULL
      BEGIN
        CREATE TABLE ${table} (
          -- Source columns (raw from TaskVBDen / old DB)
          ID                     NVARCHAR(255)   NOT NULL,
          source_db              NVARCHAR(255)   NULL,
          stg_job_id             NVARCHAR(255)   NULL,
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
    await ensureTrackingColumns(this, {
      tableRef: table,
      tableName,
      schemaName,
      dbName,
      label: this.modelName,
    });
    logger.info('[StreamTaskInIncrementalModel] task_sync staging table ready');
  }

  /**
   * Äáº£m báº£o táº¥t cáº£ cÃ¡c cá»™t cáº§n thiáº¿t tá»“n táº¡i trong báº£ng staging.
   * Náº¿u thiáº¿u cá»™t (vÃ­ dá»¥: ItemId má»›i bá»• sung), nÃ³ sáº½ tá»± Ä‘á»™ng ALTER TABLE ADD.
   */
  async ensureStagingTableColumns() {
    if (process.env.DISABLE_ENSURE_SCHEMA === 'true') {
      return;
    }
    const table = this.getStagingTableRef();
    const tableName = this.newTableSync;
    const dbName = this.newDbName;

    // Danh sÃ¡ch cÃ¡c cá»™t cáº§n check (theo schema chuáº©n á»Ÿ ensureStagingTableExists)
    const requiredColumns = [
      { name: 'source_db', type: 'NVARCHAR(255)' },
      { name: 'stg_job_id', type: 'NVARCHAR(255)' },
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

    logger.info(`[StreamTaskInIncrementalModel] Verified staging table columns for ${tableName}`);
  }

  /**
   * Force-rebuilds the staging table (DROP + CREATE).
   * Call this ONLY during maintenance / schema migration â€” NOT on every startup.
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

  /**
   * Táº£i cÃ¡c file Ä‘Ã­nh kÃ¨m cá»§a Task tá»« SharePoint vá» bá»™ nhá»› (NGOÃ€I Transaction SQL).
   */
  async prepareTaskFilesFromSharePoint(stagingRow) {
    const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
    if (!baseUrl) return [];

    const fileFields = [
      { field: 'HoSoDuThaoUrl', objectType: 'taskdocuments' },
      { field: 'HoSoXuLyUrl', objectType: 'taskdocuments' },
    ];

    const preparedResults = [];
    for (const { field, objectType } of fileFields) {
      const rawUrl = stagingRow?.[field];
      if (!rawUrl || String(rawUrl).trim() === '') continue;
      if (String(rawUrl).toLowerCase().includes('.aspx')) {
        logger.debug(`[StreamTaskIn][prepareFiles] Skipping ASPX page link (not a file): ${rawUrl}`);
        continue;
      }

      const relativePath = String(rawUrl).trim();
      const fullUrl = relativePath.startsWith('http') ? relativePath : `${baseUrl}${relativePath}`;
      const fileName = relativePath.substring(relativePath.lastIndexOf('/') + 1) || field;

      try {
        logger.info(
          `[StreamTaskIn][prepareFiles] Äang táº£i file cho Task ${stagingRow.ID}: ${fileName}`,
        );
        const buffer = await spDownload(fullUrl, this.newPool); // Truyá»n Pool Ä‘á»ƒ lock Ä‘a tiáº¿n trÃ¬nh

        if (buffer && buffer.length > 0) {
          preparedResults.push({ buffer, fileName, relativePath, objectType });
        }
      } catch (err) {
        logger.error(`[StreamTaskIn][prepareFiles] Lá»—i táº£i file ${fileName}: ${err.message}`);
      }
    }
    return preparedResults;
  }

  /**
   * Ghi dá»¯ liá»‡u file cá»§a Task vÃ o database (TRONG Transaction SQL).
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
        table_bak: 'TaskVBDen',
        type_doc: null,
        isBak: 1,
      };

      const relationRecord = {
        object_type: objectType,
        object_id: String(newTaskId),
        object_id_bak: stagingRow?.ID,
        file_id_bak: fileIdBak,
        table_bak: 'TaskVBDen',
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
        transaction, // DÃ¹ng chung TX cá»§a Task
      });
    }
    return true;
  }

  async ThemFileDinhKemTask(stagingRow, newTaskId) {
    // Äá»ƒ giá»¯ tÆ°Æ¡ng thÃ­ch, nhÆ°ng khuyáº¿n khÃ­ch gá»i prepare/apply riÃªng láº»
    const prepared = await this.prepareTaskFilesFromSharePoint(stagingRow);
    return await this.applyPreparedTaskFiles(prepared, newTaskId, stagingRow, null);
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // COUNT
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  /**
   * Alias cho getCount Ä‘á»ƒ Ä‘á»“ng nháº¥t vá»›i SyncHandlerModel.
   */
  async getCount(lastSyncTime, lastSyncId = 0) {
    const tableRef = this.getStagingTableRef();
    const query = `
      SELECT COUNT(1) AS total
      FROM ${tableRef}
      WHERE ISNULL(MigrateFlg, 0) = 0
        AND ISNULL(MigrateErrFlg, 0) = 0
    `;

    try {
      const rows = await this.queryNewDb(query);
      const count = Number(rows?.[0]?.total || 0);
      logger.debug(`[StreamTaskInIncrementalModel] getCount from staging: ${count}`);
      return count;
    } catch (error) {
      logger.error(`[StreamTaskInIncrementalModel] getCount staging error: ${error.message}`);
      return 0;
    }
  }

  /**
   * Äáº¿m tá»•ng sá»‘ báº£n ghi cáº§n Ä‘á»“ng bá»™.
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
      -- Chá»‰ láº¥y báº£n ghi tá»« nÄƒm 2026 trá»Ÿ Ä‘i (Náº¿u SYNC_MIN_DATE Ä‘Æ°á»£c báº­t)
      AND __sync_time >= '${SYNC_MIN_DATE}'
    `;

    const rows = await this.queryOldDb(query, {
      lastSyncTime: normalizedLastSyncTime,
      lastSyncId: normalizedLastSyncId,
      startDate: process.env.SYNC_START_DATE || null,
      endDate: process.env.SYNC_END_DATE || null,
    });

    return Number(rows?.[0]?.total || 0);
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // FETCH FROM OLD DB â€” DESC cursor, OFFSET/TAKE
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  /**
   * @param {string} lastSyncTime
   * @param {number} [lastSyncId=0]
   * @returns {Promise<object[]>}
   */
  /**
   * Láº¥y danh sÃ¡ch báº£n ghi kÃ¨m phÃ¢n trang.
   */
  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0, limit = null, offset = 0) {
    const t0 = Date.now();
    logger.info(
      `[StreamTaskIn][fetchList] start offset=${Number(offset || 0)} limit=${limit ? Number(limit) : 'ALL'} lastSyncTime=${lastSyncTime} lastSyncId=${Number(lastSyncId || 0)}`,
    );
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
          _sync_time_val < @lastSyncTime
          OR (
            _sync_time_val = @lastSyncTime
            AND ISNULL(_sync_id_val, 9223372036854775807) < @lastSyncId
          )
        )
        -- Chá»‰ láº¥y báº£n ghi tá»« nÄƒm 2026 trá»Ÿ Ä‘i
        AND _sync_time_val >= '${SYNC_MIN_DATE}'
      ) AS t
      WHERE __page_rn > @offset
      ${limit ? `AND __page_rn <= (@offset + @limit)` : ''}
      ORDER BY __page_rn
    `;

    const rows = await this.queryOldDb(query, {
      lastSyncTime,
      lastSyncId: Number(lastSyncId || 0),
      limit: limit ? Number(limit) : null,
      offset: Number(offset || 0),
      startDate: process.env.SYNC_START_DATE || null,
      endDate: process.env.SYNC_END_DATE || null,
    });
    logger.info(
      `[StreamTaskIn][fetchList] done offset=${Number(offset || 0)} rows=${Array.isArray(rows) ? rows.length : 0} took=${Date.now() - t0}ms`,
    );
    return rows;
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // SYNC TO STAGING â€” dynamic column upsert
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
    const t0 = Date.now();
    const progressStep = Number(process.env.STAGING_LOG_PROGRESS_EVERY || 100);
    logger.info(
      `[StreamTaskIn][syncOldToStaging] start rows=${rows.length} cols=${columns.length} firstId=${rows[0]?.ID ?? 'NA'} lastId=${rows[rows.length - 1]?.ID ?? 'NA'}`,
    );

    const lockTimeoutMs = Number(process.env.STAGING_LOCK_TIMEOUT_MS || 8000);
    const updateClause = safeNonIdColumns
      .map((columnName, idx) => `${columnName} = @${nonIdColumns[idx]}`)
      .join(', ');

    const hasSourceDb = columns.includes('source_db');
    const whereClause = hasSourceDb
      ? "ID = @ID AND ISNULL(source_db, '') = ISNULL(@source_db, '')"
      : 'ID = @ID';

    let idx = 0;
    let skippedCount = 0;
    for (const row of rows) {
      idx += 1;
      const rawId = row?.ID;
      if (rawId == null || String(rawId).trim() === '') {
        throw new Error('Row ID is required for staging');
      }

      const params = {};
      for (const column of columns) {
        params[column] = normalizeStagingParamValue(row[column]);
      }

      const query = `
        SET LOCK_TIMEOUT ${Number.isFinite(lockTimeoutMs) && lockTimeoutMs > 0 ? lockTimeoutMs : 8000};
        IF EXISTS (SELECT 1 FROM ${stagingTableRef} WHERE ${whereClause})
        BEGIN
          ${nonIdColumns.length > 0
          ? `UPDATE ${stagingTableRef} WITH (ROWLOCK)
               SET ${updateClause}
               WHERE ${whereClause};`
          : `SELECT 1 AS noop;`
        }
        END
        ELSE
        BEGIN
          INSERT INTO ${stagingTableRef} (${safeColumns.join(', ')})
          VALUES (${columns.map((column) => `@${column}`).join(', ')});
        END
      `;

      try {
        await withDeadlockRetry(
          () => this.queryNewDbTx(query, params, transaction),
          `syncOldToStaging id=${rawId}`,
        );
      } catch (error) {
        // Lock contention after max retries: skip current row, continue batch.
        // Row is not staged now and will be retried in next sync cycle.
        if (isRetryableLockError(error)) {
          skippedCount += 1;
          logger.warn(
            `[StreamTaskIn][syncOldToStaging] skip row due to lock conflict after retries index=${idx}/${rows.length} id=${rawId} err=${error.message}`,
          );
          continue;
        }
        logger.error(
          `[StreamTaskIn][syncOldToStaging] failed at index=${idx}/${rows.length} id=${rawId} err=${error.message}`,
        );
        throw error;
      }

      if (idx === 1 || idx === rows.length || (progressStep > 0 && idx % progressStep === 0)) {
        logger.info(
          `[StreamTaskIn][syncOldToStaging] progress ${idx}/${rows.length} lastId=${rawId} elapsed=${Date.now() - t0}ms`,
        );
      }
    }

    const stagedCount = Math.max(0, rows.length - skippedCount);
    logger.info(
      `[StreamTaskIn][syncOldToStaging] done rows=${rows.length} staged=${stagedCount} skipped=${skippedCount} took=${Date.now() - t0}ms`,
    );
    return { stagedCount, skippedCount };
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // GET LIST â€” build staged batch + advance cursor
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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

    const STAGING_PARALLEL_BATCHES = Number(process.env.STAGING_PARALLEL_BATCHES || 1);
    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);

    const batchSize = Number(process.env.STAGING_FETCH_BATCH_SIZE || 100);
    const stagingTableRef = this.getStagingTableRef();
    const pipelineMode =
      TASK_IN_PIPELINE_MODE === 'staging_only' ? 'staging_only' : 'old_to_staging';
    if (pipelineMode !== TASK_IN_PIPELINE_MODE) {
      logger.warn(
        `[StreamTaskIn] Invalid TASK_IN_PIPELINE_MODE="${TASK_IN_PIPELINE_MODE}", fallback to "old_to_staging"`,
      );
    }

    const envStartDate = process.env.SYNC_START_DATE
      ? new Date(process.env.SYNC_START_DATE).toISOString()
      : null;
    const envEndDate = process.env.SYNC_END_DATE
      ? new Date(process.env.SYNC_END_DATE).toISOString()
      : null;

    logger.info(
      `[StreamTaskIn][count-input] lastSyncTime=${normalizedLastSyncTime}, lastSyncId=${normalizedLastSyncId}, startDate=${envStartDate || 'NULL'}, endDate=${envEndDate || 'NULL'}, syncMinDate=${SYNC_MIN_DATE}`,
    );

    // Cleanup stale records
    try {
      await withDeadlockRetry(async () => {
        await releaseStaleClaims(this, {
          tableRef: stagingTableRef,
          extraWhere: `
            (${this.partitionColumn} >= @startDate OR @startDate IS NULL)
            AND (${this.partitionColumn} <= @endDate OR @endDate IS NULL)
          `,
          params: {
            startDate: envStartDate,
            endDate: envEndDate,
          },
          label: this.modelName,
        });
      }, 'cleanup stale task_sync');
    } catch (cleanupErr) {
      logger.warn(`[StreamTaskIn] Cleanup stale records failed: ${cleanupErr.message}`);
    }

    if (pipelineMode === 'staging_only') {
      logger.info(
        `[StreamTaskIn] Pipeline mode=staging_only: skip fetch OLD DB, process directly from staging ${stagingTableRef}`,
      );

      const pendingRes = await this.queryNewDb(
        `
        SELECT COUNT(1) AS cnt
        FROM ${stagingTableRef}
        WHERE ISNULL(MigrateFlg, 0) = 0
          AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) >= @startDate OR @startDate IS NULL)
          AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) <= @endDate OR @endDate IS NULL)
      `,
        {
          startDate: envStartDate,
          endDate: envEndDate,
        },
      );
      const pendingCount = Number(pendingRes?.[0]?.cnt || 0);

      await this.queryNewDb(`UPDATE sync_jobs SET total_to_sync = @total WHERE job_id = @jobId`, {
        total: pendingCount,
        jobId: syncJobId,
      });

      logger.info(
        `[StreamTaskIn] staging_only pending=${pendingCount} (range: ${envStartDate || 'ALL'} -> ${envEndDate || 'ALL'})`,
      );
      return {
        syncJobId,
        rows: [],
        totalCount: pendingCount,
        stagedCount: 0,
        sourceLastSyncTime: normalizedLastSyncTime,
        sourceLastSyncId: normalizedLastSyncId,
        lastSyncTime: normalizedLastSyncTime,
        lastSyncId: normalizedLastSyncId,
      };
    }

    // 1. Äáº¿m tá»•ng vÃ  cáº­p nháº­t Dashboard
    const totalCount = await this.countListFromOldDb(normalizedLastSyncTime, normalizedLastSyncId);
    logger.info(
      `[StreamTaskIn] Tá»•ng sá»‘ báº£n ghi cáº§n sync: ${totalCount} (LastTime: ${normalizedLastSyncTime}, LastId: ${normalizedLastSyncId})`,
    );
    logger.info(`[StreamTaskIn][count-source] TaskVBDen total_by_cursor=${totalCount}`);

    try {
      const stagingDiag = await this.queryNewDb(
        `
        SELECT
          COUNT(1) AS total_rows,
          SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 0 THEN 1 ELSE 0 END) AS pending_0,
          SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 1 THEN 1 ELSE 0 END) AS done_1,
          SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 2 THEN 1 ELSE 0 END) AS processing_2,
          SUM(CASE WHEN ISNULL(MigrateErrFlg, 0) = 1 THEN 1 ELSE 0 END) AS error_rows
        FROM ${stagingTableRef}
        WHERE (TRY_CONVERT(datetime2, ${this.partitionColumn}) >= @startDate OR @startDate IS NULL)
          AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) <= @endDate OR @endDate IS NULL)
      `,
        {
          startDate: envStartDate,
          endDate: envEndDate,
        },
      );
      const d = stagingDiag?.[0] || {};
      logger.info(
        `[StreamTaskIn][count-staging] total_rows=${Number(d.total_rows || 0)}, pending_0=${Number(d.pending_0 || 0)}, done_1=${Number(d.done_1 || 0)}, processing_2=${Number(d.processing_2 || 0)}, error_rows=${Number(d.error_rows || 0)}`,
      );
    } catch (diagErr) {
      logger.warn(`[StreamTaskIn][count-staging] failed: ${diagErr.message}`);
    }

    await this.queryNewDb(`UPDATE sync_jobs SET total_to_sync = @total WHERE job_id = @jobId`, {
      total: totalCount,
      jobId: syncJobId,
    });

    const numIterations = Math.ceil(totalCount / batchSize);
    let totalStaged = 0;
    let nextSyncTime = normalizedLastSyncTime;
    let nextSyncId = normalizedLastSyncId;

    // Helper for one batch fetch+stage. Return only lightweight metadata to reduce RAM pressure.
    const fetchAndStage = async (iteration) => {
      const begin = iteration * batchSize;
      const tBatch = Date.now();
      logger.info(
        `[StreamTaskIn][stage-batch] start iter=${iteration + 1}/${numIterations} offset=${begin} batchSize=${batchSize}`,
      );
      const rows = await this.fetchListFromOldDb(
        normalizedLastSyncTime,
        normalizedLastSyncId,
        batchSize,
        begin,
      );
      if (!rows || rows.length === 0) {
        logger.info(
          `[StreamTaskIn][stage-batch] empty iter=${iteration + 1}/${numIterations} offset=${begin} took=${Date.now() - tBatch}ms`,
        );
        return { rowsCount: 0, stagedCount: 0 };
      }

      // Keep each staging statement short (autocommit) to reduce lock contention.
      const stageResult = await this.syncOldToStaging(rows);
      logger.info(
        `[StreamTaskIn][stage-batch] done iter=${iteration + 1}/${numIterations} rows=${rows.length} staged=${Number(stageResult?.stagedCount || 0)} took=${Date.now() - tBatch}ms`,
      );

      const lastRow = rows[rows.length - 1];
      const rowTime = this.extractRowSyncTime(lastRow);
      const rowId = this.extractRowSyncId(lastRow);
      // release large array reference early
      return {
        rowsCount: rows.length,
        stagedCount: Number(stageResult?.stagedCount || 0),
        rowTime,
        rowId,
      };
    };

    // 2. Run bounded worker pool to avoid accumulating all promises/results in memory.
    const workerCount = Math.max(1, Number(STAGING_PARALLEL_BATCHES || 1));
    let nextIteration = 0;
    const runWorker = async () => {
      while (true) {
        const iteration = nextIteration;
        nextIteration += 1;
        if (iteration >= numIterations) return;
        const res = await fetchAndStage(iteration);
        if (!res || res.rowsCount === 0) continue;
        totalStaged += res.stagedCount;
        if (res.rowTime && this.isCursorAhead(res.rowTime, res.rowId, nextSyncTime, nextSyncId)) {
          nextSyncTime = res.rowTime;
          nextSyncId = res.rowId;
        }
      }
    };
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    logger.info(
      `ðŸ”¥ [StreamTaskIn] HoÃ n táº¥t hÃºt dá»¯ liá»‡u vá» Staging. Staged=${totalStaged}/${totalCount}. LastSyncTime: ${nextSyncTime}, LastSyncId: ${nextSyncId}`,
    );

    // Fix Bug #3: Äáº¿m sá»‘ báº£n ghi THá»°C Táº¾ trong staging chÆ°a xá»­ lÃ½
    // FIX: Pháº£i lá»c theo dáº£i ngÃ y cá»§a instance nÃ y (SYNC_START_DATE/SYNC_END_DATE)
    // Ä‘á»ƒ trÃ¡nh Ä‘áº¿m nháº§m records cá»§a cÃ¡c terminal khÃ¡c Ä‘ang cháº¡y song song.
    let pendingCount = 0;
    try {
      const pendingRes = await this.queryNewDb(
        `
        SELECT COUNT(1) AS cnt FROM ${stagingTableRef}
        WHERE ISNULL(MigrateFlg, 0) = 0
          AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) >= @startDate OR @startDate IS NULL)
          AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) <= @endDate   OR @endDate IS NULL)
      `,
        {
          startDate: process.env.SYNC_START_DATE || null,
          endDate: process.env.SYNC_END_DATE || null,
        },
      );
      pendingCount = Number(pendingRes?.[0]?.cnt || 0);
    } catch (e) {
      logger.warn(`[StreamTaskIn] KhÃ´ng Ä‘áº¿m Ä‘Æ°á»£c pending staging: ${e.message}`);
      pendingCount = totalStaged;
    }
    logger.info(
      `[StreamTaskIn] Pending records trong Staging cÃ³ thá»ƒ xá»­ lÃ½: ${pendingCount} (range: ${process.env.SYNC_START_DATE || 'ALL'} â†’ ${process.env.SYNC_END_DATE || 'ALL'})`,
    );
    if (totalStaged > 0 && pendingCount === 0) {
      try {
        const diag = await this.queryNewDb(
          `
          SELECT
            COUNT(1) AS total_rows,
            SUM(CASE WHEN ISNULL(MigrateFlg,0)=0 THEN 1 ELSE 0 END) AS flg_0,
            SUM(CASE WHEN ISNULL(MigrateFlg,0)=1 THEN 1 ELSE 0 END) AS flg_1,
            SUM(CASE WHEN ISNULL(MigrateFlg,0)=2 THEN 1 ELSE 0 END) AS flg_2,
            SUM(CASE WHEN ISNULL(MigrateErrFlg,0)=1 THEN 1 ELSE 0 END) AS err_1,
            SUM(CASE WHEN TRY_CONVERT(datetime2, ${this.partitionColumn}) IS NULL THEN 1 ELSE 0 END) AS invalid_partition_date
          FROM ${stagingTableRef}
          WHERE (TRY_CONVERT(datetime2, ${this.partitionColumn}) >= @startDate OR @startDate IS NULL)
            AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) <= @endDate OR @endDate IS NULL)
        `,
          {
            startDate: process.env.SYNC_START_DATE || null,
            endDate: process.env.SYNC_END_DATE || null,
          },
        );
        const d = diag?.[0] || {};
        logger.warn(
          `[StreamTaskIn][diag-after-stage] staged=${totalStaged}, pending=${pendingCount}, total_rows=${Number(d.total_rows || 0)}, flg0=${Number(d.flg_0 || 0)}, flg1=${Number(d.flg_1 || 0)}, flg2=${Number(d.flg_2 || 0)}, err1=${Number(d.err_1 || 0)}, invalid_partition_date=${Number(d.invalid_partition_date || 0)}`,
        );
      } catch (diagErr) {
        logger.warn(`[StreamTaskIn][diag-after-stage] failed: ${diagErr.message}`);
      }
    }

    // Cáº­p nháº­t Dashboard láº§n cuá»‘i vá»›i tá»•ng sá»‘ thá»±c táº¿ (bao gá»“m cáº£ cÃ¡c báº£n ghi tá»“n Ä‘á»ng cÅ© trong staging)
    await this.queryNewDb(`UPDATE sync_jobs SET total_to_sync = @total WHERE job_id = @jobId`, {
      total: pendingCount,
      jobId: syncJobId,
    });

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

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // FETCH ONE FROM STAGING â€” ROW_NUMBER cursor
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  /**
   * Reads one deterministic row from staging based on source cursor and item index.
   * @param {{lastSyncTime:string,lastSyncId?:number,itemIndex:number,transaction?:object}} context
   * @returns {Promise<object|null>}
   */
  async fetchOneFromStaging() {
    const queryKey = 'fetchOneFromStaging.claim-next-row';
    try {
      const stagingTableRef = this.getStagingTableRef();
      const row = await claimNextStagingRow(this, {
        tableRef: stagingTableRef,
        extraWhere: `
          (TRY_CONVERT(datetime2, ${this.partitionColumn}) >= @startDate OR @startDate IS NULL)
          AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) <= @endDate OR @endDate IS NULL)
        `,
        params: {
          startDate: process.env.SYNC_START_DATE || null,
          endDate: process.env.SYNC_END_DATE || null,
        },
        owner: `pid_${process.pid}`,
        orderBy: `
          TRY_CONVERT(datetime2, Modified) DESC,
          TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(ID)), '')) DESC
        `,
        label: this.modelName,
      });
      if (!row) {
        logger.info(
          `[StreamTaskIn.fetchOneFromStaging] No row claimed (MigrateFlg=0 not found/unavailable). range=${process.env.SYNC_START_DATE || 'ALL'}â†’${process.env.SYNC_END_DATE || 'ALL'}`,
        );
        return null;
      }
      logger.info(`[${this.modelName}] [START] Processing started: ID=${row.ID}`);
      return row;
    } catch (error) {
      logger.error(
        `[StreamTaskIn.fetchOneFromStaging] Failed at queryKey=${queryKey}: ${error.message}`,
      );
      throw error;
    }
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

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // SYNC JOB STATE
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // PROCESS ONE â€” with deadlock retry on full transaction
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  /**
   * Processes one staged item for a sync job inside a DB transaction.
   * Retries the entire transaction on deadlock (SQL error 1205).
   *
   * @param {string} syncJobId
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  /**
   * Fetches a batch of unclaimed records from staging table using thread-safe row locks.
   */
  async fetchBatchFromStaging(workerId, batchSize = 50) {
    const stagingTable = this.getStagingTableRef();
    try {
      const query = `
        UPDATE TOP (@batchSize) ${stagingTable} WITH (UPDLOCK, READPAST, ROWLOCK)
        SET MigrateFlg = 2,
            MigrateErrMess = 'Processing Batch...',
            processing_owner = @owner,
            processing_started_at = SYSUTCDATETIME(),
            processing_heartbeat_at = SYSUTCDATETIME()
        OUTPUT inserted.*
        WHERE ISNULL(MigrateFlg, 0) = 0
          AND ISNULL(MigrateErrFlg, 0) = 0
          AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) >= @startDate OR @startDate IS NULL)
          AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) <= @endDate OR @endDate IS NULL);
      `;

      const result = await this.newPool.request()
        .input('batchSize', batchSize)
        .input('owner', workerId)
        .input('startDate', process.env.SYNC_START_DATE || null)
        .input('endDate', process.env.SYNC_END_DATE || null)
        .query(query);

      return result.recordset || [];
    } catch (error) {
      logger.error(`[StreamTaskIn] fetchBatchFromStaging failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Marks a list of row IDs as successfully migrated.
   */
  async markBatchSuccess(rowIds) {
    if (!rowIds || rowIds.length === 0) return;
    const stagingTable = this.getStagingTableRef();
    const idList = rowIds.map(id => `'${id}'`).join(',');
    const query = `
      UPDATE ${stagingTable} WITH (ROWLOCK)
      SET MigrateFlg = 1,
          MigrateErrFlg = 0,
          MigrateErrMess = NULL,
          processing_owner = NULL,
          processing_started_at = NULL,
          processing_heartbeat_at = NULL
      WHERE ID IN (${idList})
    `;
    await this.queryNewDb(query);
  }

  /**
   * Marks a list of records as failed with their individual errors.
   */
  async markBatchFailed(failedRecords) {
    if (!failedRecords || failedRecords.length === 0) return;
    const stagingTable = this.getStagingTableRef();
    const request = this.newPool.request();
    let queryParts = [];

    failedRecords.forEach((item, index) => {
      queryParts.push(`
        UPDATE ${stagingTable} WITH (ROWLOCK)
        SET MigrateFlg = 3,
            MigrateErrFlg = 1,
            MigrateErrMess = @err${index},
            processing_owner = NULL,
            processing_started_at = NULL,
            processing_heartbeat_at = NULL
        WHERE ID = @id${index};
      `);
      request.input(`id${index}`, item.id);
      request.input(`err${index}`, String(item.error || 'Unknown error').substring(0, 4000));
    });

    await request.query(queryParts.join('\n'));
  }

  /**
   * processOne - entry point delegated by SyncManagerService.
   * Processes a batch of records inside withDeadlockRetry to maintain system stability.
   */
  async processOne(syncJobId, options = {}) {
    if (!syncJobId) {
      throw new Error('syncJobId is required');
    }

    if (!this.newPool) {
      throw new Error('Database pool not initialized');
    }

    return withDeadlockRetry(
      () => this._processBatchAttempt(syncJobId, options),
      `processBatch syncJobId=${syncJobId}`,
    );
  }

  /**
   * Batch processing logic with parallel file download and sequential recovery fallback.
   */
  async _processBatchAttempt(syncJobId, options = {}) {
    const itemIndex = Number(options?.itemIndex ?? -1);
    const batchSize = Number(process.env.BATCH_SIZE || 50);

    // 1. Fetch batch
    const rows = await this.fetchBatchFromStaging(syncJobId, batchSize);

    if (!rows || rows.length === 0) {
      await this.finalizeProcessingCursor(syncJobId);
      return {
        syncJobId,
        processed: false,
        done: true
      };
    }

    logger.info(`[StreamTaskIn] [START] Processing batch of ${rows.length} records. ItemIndex=${itemIndex}`);

    // 2. Parallel file preparing (OUTSIDE SQL transaction to reduce lock duration)
    const concurrency = 5;
    const preparedFilesMap = new Map();
    for (let i = 0; i < rows.length; i += concurrency) {
      const chunk = rows.slice(i, i + concurrency);
      await Promise.all(
        chunk.map(async (row) => {
          try {
            const files = await this.prepareTaskFilesFromSharePoint(row);
            preparedFilesMap.set(row.ID, files);
          } catch (err) {
            logger.warn(`[StreamTaskIn] prepareFiles failed for ID=${row.ID}: ${err.message}`);
            preparedFilesMap.set(row.ID, []);
          }
        })
      );
    }

    const successIds = [];
    const failedRecords = [];
    const successfulDocs = [];

    // 3. Try whole-batch processing inside a single SQL transaction for top speed
    let batchSuccess = true;
    let transaction = null;
    try {
      transaction = new sql.Transaction(this.newPool);
      await transaction.begin();

      for (const row of rows) {
        const result = await this.processRowData(row, { transaction, preparedFiles: [], syncJobId });
        successfulDocs.push({ row, result });
      }

      await transaction.commit();

      for (const { row, result } of successfulDocs) {
        successIds.push(row.ID);
        const preparedFiles = preparedFilesMap.get(row.ID) || [];
        preparedFilesMap.delete(row.ID); // GC optimization
        try {
          await this.applyPreparedTaskFiles(preparedFiles, result.newTaskId, row, null);
        } catch (fileErr) {
          logger.warn(`[StreamTaskIn] File upload failed for task ${result.newTaskId}: ${fileErr.message}`);
        }
      }
    } catch (batchError) {
      batchSuccess = false;
      logger.error(`[StreamTaskIn] Batch transaction failed, falling back to sequential: ${batchError.message}`);
      if (transaction) {
        try {
          await transaction.rollback().catch(() => { });
        } catch (_) { }
      }
    }

    // 4. Sequential fallback to isolate and identify failed records independently
    if (!batchSuccess) {
      for (const row of rows) {
        try {
          let docResult = null;

          await dbUtils.withTransactionRetry(this.newPool, async (tx) => {
            docResult = await this.processRowData(row, { transaction: tx, preparedFiles: [], syncJobId });
          }, { maxRetries: 3 });

          if (docResult) {
            successIds.push(row.ID);
            const preparedFiles = preparedFilesMap.get(row.ID) || [];
            preparedFilesMap.delete(row.ID); // GC optimization
            try {
              await this.applyPreparedTaskFiles(preparedFiles, docResult.newTaskId, row, null);
            } catch (fileErr) {
              logger.warn(`[StreamTaskIn] File upload failed for task ${docResult.newTaskId}: ${fileErr.message}`);
            }
          }
        } catch (singleError) {
          logger.error(`[StreamTaskIn] Sequential fallback failed for ID=${row.ID}: ${singleError.message}`);
          failedRecords.push({ id: row.ID, error: singleError.message });
        }
      }
    }

    // 4.5. Bulk backfill parent relationships for the whole batch
    if (successIds.length > 0) {
      try {
        await this.taskModel.resolveParentRelation();
      } catch (parentErr) {
        logger.warn(`[StreamTaskIn] Parent relation bulk mapping warning: ${parentErr.message}`);
      }
    }

    // 5. Update Staging state & Sync Job state
    if (successIds.length > 0) {
      await this.markBatchSuccess(successIds);
      await this.queryNewDb(
        `UPDATE sync_jobs
         SET total_processed = ISNULL(total_processed, 0) + @count,
             total_success   = ISNULL(total_success, 0) + @count
         WHERE job_id = @syncJobId`,
        { count: successIds.length, syncJobId }
      );
    }

    if (failedRecords.length > 0) {
      await this.markBatchFailed(failedRecords);
      await this.queryNewDb(
        `UPDATE sync_jobs
         SET total_processed = ISNULL(total_processed, 0) + @count,
             total_errors    = ISNULL(total_errors, 0) + @count
         WHERE job_id = @syncJobId`,
        { count: failedRecords.length, syncJobId }
      );
    }

    logger.info(
      `[StreamTaskIn] Batch finished: total=${rows.length}, success=${successIds.length}, failed=${failedRecords.length}`
    );

    return {
      syncJobId,
      processed: true,
      done: false,
      affected: successIds.length
    };
  }

  /**
   * Finalize cursor (deferred cursor pattern)
   */
  async finalizeProcessingCursor(syncJobId) {
    try {
      const stagingTableRef = this.getStagingTableRef();
      const res = await this.queryNewDb(
        `
        SELECT
          MAX(
            COALESCE(
              TRY_CONVERT(datetime2, Modified),
              TRY_CONVERT(datetime2, Created)
            )
          ) AS maxTime,
          MAX(TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), ''))) AS maxId
        FROM ${stagingTableRef}
        WHERE ISNULL(MigrateFlg, 0) = 1
          AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) >= @startDate OR @startDate IS NULL)
          AND (TRY_CONVERT(datetime2, ${this.partitionColumn}) <= @endDate OR @endDate IS NULL)
      `,
        {
          startDate: process.env.SYNC_START_DATE || null,
          endDate: process.env.SYNC_END_DATE || null,
        },
      );
      if (res?.[0]?.maxTime) {
        const parsed = new Date(res[0].maxTime);
        if (Number.isNaN(parsed.getTime())) {
          logger.warn(`[StreamTaskIn.finalizeProcessingCursor] maxTime invalid: ${res[0].maxTime}`);
          return;
        }
        const finalTime = parsed.toISOString();
        const finalId = Number(res[0].maxId || 0);
        await this.queryNewDb(
          `UPDATE sync_jobs
           SET last_sync_time = @t,
               last_sync_id   = @id
           WHERE job_id = @jobId`,
          { t: finalTime, id: finalId, jobId: syncJobId },
        );
        logger.info(
          `[StreamTaskIn] Cursor finalized for partition: last_sync_time=${finalTime}, last_sync_id=${finalId}`,
        );
      } else {
        logger.info(
          `[StreamTaskIn] finalizeProcessingCursor: khÃ´ng cÃ³ báº£n ghi Ä‘Ã£ xá»­ lÃ½ trong phÃ¢n Ä‘oáº¡n, cursor giá»¯ nguyÃªn.`,
        );
      }
    } catch (err) {
      logger.warn(`[StreamTaskIn.finalizeProcessingCursor] Lá»—i finalize cursor: ${err.message}`);
    }
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // PROCESS ROW DATA
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  /**
   * Validates and applies one task row into destination aggregates.
   * @param {object} rowData
   * @param {{transaction?: object}} [context]
   * @returns {Promise<{action:string,idTaskBak:string,affected:number}>}
   */
  async processRowData(rowData, { transaction, preparedFiles = [], syncJobId = null } = {}) {
    if (!rowData) {
      throw new Error('rowData is required');
    }

    const backupId = String(rowData.ID || '').trim();
    if (!backupId) {
      throw new Error('Invalid task ID from staging');
    }

    const res = await this.upsertTaskAggregateById(rowData, {
      transaction,
      preparedFiles,
      syncJobId,
    });
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

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // UPSERT AGGREGATE â€” task-specific: task + task_users + system_logs
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  /**
   * Upserts one task and its related task_users + system_log entities.
   * @param {object} stagingRow
   * @param {{transaction?: object}} [context]
   * @returns {Promise<{action:string,idTaskBak:string,newTaskId:string,affected:number}>}
   */
  async upsertTaskAggregateById(
    stagingRow,
    { transaction, preparedFiles = [], syncJobId = null } = {},
  ) {
    if (!stagingRow) {
      return { action: 'none', affected: 0 };
    }

    const taskId = String(stagingRow.ID || '').trim();
    let totalAffected = 0;

    // â”€â”€ 1. Upsert task chÃ­nh â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const taskResult = await this.taskModel.processSingleRecord(stagingRow, transaction);

    if (!taskResult || !taskResult.newTaskId) {
      logger.error(`[SYNC FAILED] Task not inserted for ID=${taskId}`);
      return { action: 'none', affected: 0, failed: true };
    }

    const newTaskId = taskResult.newTaskId;
    totalAffected += 1;

    const createdAt = taskResult.createdAt || stagingRow.Created || new Date().toISOString();
    // â”€â”€ 2. Task users (TaskVBDenPermission) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let firstUserId = null;
    try {
      const taskUsersRows = await this.queryOldDb(
        `SELECT * FROM ${this.oldDbSchema}.TaskVBDenPermission WHERE TaskId = @taskId`,
        { taskId: String(stagingRow.ID) },
      );
      if (Array.isArray(taskUsersRows) && taskUsersRows.length > 0) {
        for (const userRow of taskUsersRows) {
          try {
            const userResult = await this.taskUsersModel.processSingleRecord(
              { ...userRow, newTaskId, createdAt },
              transaction,
            );
            if (userResult && !firstUserId) {
              firstUserId = userRow.UserId;
            }
            if (userResult && userResult.action !== 'skipped') {
              totalAffected += 1;
            }
          } catch (userErr) {
            // SUB-TABLE ERROR: Log warning only, do NOT throw
            logger.warn(
              `[StreamTaskInIncrementalModel] TaskUser sync failed (non-critical) userId=${userRow.ID}: ${userErr.message}`,
              { errorStack: userErr.stack },
            );
            await this.logNonCriticalJobError(syncJobId, taskId, `[TaskUser] ${userErr.message}`);
          }
        }
      }
    } catch (userError) {
      // Fetch error: Log warning only, do NOT throw
      logger.warn(
        `[StreamTaskInIncrementalModel] Failed to fetch task users for task_id=${taskId}: ${userError.message}`,
        { errorStack: userError.stack },
      );
      await this.logNonCriticalJobError(syncJobId, taskId, `[TaskUserFetch] ${userError.message}`);
    }

    const createdBy = firstUserId || taskResult?.createdBy || stagingRow.CreatedBy || null;

    // â”€â”€ 2b. Workitems (only when process_status = 2: Äang thá»±c hiá»‡n) â”€â”€â”€â”€â”€â”€â”€â”€â”€
    try {
      const workitemsResult = await this.syncWorkItemsForInProgressTask(
        {
          newTaskId,
          processStatus: taskResult?.process_status || stagingRow?.TrangThai || null,
          createdAt,
        },
        transaction,
      );
      if (workitemsResult?.success) {
        totalAffected += Number(workitemsResult.inserted || 0);
      }
    } catch (workitemErr) {
      logger.warn(
        `[StreamTaskInIncrementalModel] Workitems sync failed (non-critical) task_id=${newTaskId}: ${workitemErr.message}`,
        { errorStack: workitemErr.stack },
      );
      await this.logNonCriticalJobError(syncJobId, taskId, `[Workitems] ${workitemErr.message}`);
    }
    // â”€â”€ 3. System log (khÃ´ng sync lá»‹ch sá»­ cÅ©) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    try {
      const logResult = await this.systemLogsModel.createLogForTask(
        { idTask: newTaskId, userInfo: createdBy, createdAt },
        transaction,
      );
      if (logResult.success) {
        totalAffected += 1;
      } else {
        logger.warn(
          `[StreamTaskInIncrementalModel] Log creation returned success=false for task_id=${newTaskId}`,
          {
            logResult,
          },
        );
        await this.logNonCriticalJobError(
          syncJobId,
          taskId,
          '[SystemLog] createLogForTask returned success=false',
        );
      }
    } catch (logErr) {
      // SUB-TABLE ERROR: Log warning only, do NOT throw
      logger.warn(
        `[StreamTaskInIncrementalModel] System log creation failed (non-critical) task_id=${newTaskId}: ${logErr.message}`,
        { errorStack: logErr.stack },
      );
      await this.logNonCriticalJobError(syncJobId, taskId, `[SystemLog] ${logErr.message}`);
    }

    // â”€â”€ 4. File + Comment sync via linked incoming document â”€â”€â”€â”€â”€â”€â”€
    const vbId = stagingRow?.VBId ? String(stagingRow.VBId).trim() : null;

    if (vbId) {
      // â”€â”€ 4b. Comment sync (cáº¥u trÃºc giá»¯ nguyÃªn tá»« outgoing) â”€â”€â”€â”€
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
                transaction,
              );
              if (!result) continue;
              logger.info(
                `[AggregateSync][Comment] table=${commentModel?.oldDbTable} taskId=${taskId} newTaskId=${newTaskId} inserted=${result?.inserted || 0} updated=${result?.updated || 0}`,
              );
              totalAffected += Number(result.inserted || 0);
              totalAffected += Number(result.updated || 0);
            } catch (commentRowErr) {
              logger.warn(
                `[StreamTaskInIncrementalModel] Comment row sync failed table=${commentModel?.oldDbTable} taskId=${taskId}: ${commentRowErr.message}`,
              );
              await this.logNonCriticalJobError(
                syncJobId,
                taskId,
                `[CommentRow:${commentModel?.oldDbTable}] ${commentRowErr.message}`,
              );
            }
          }
        } catch (commentFetchErr) {
          logger.warn(
            `[StreamTaskInIncrementalModel] Comment fetch failed table=${commentModel?.oldDbTable} taskId=${taskId}: ${commentFetchErr.message}`,
          );
          await this.logNonCriticalJobError(
            syncJobId,
            taskId,
            `[CommentFetch:${commentModel?.oldDbTable}] ${commentFetchErr.message}`,
          );
        }
      }
    }

    return {
      action: taskResult.action,
      idTaskBak: taskId,
      newTaskId,
      affected: Math.max(1, totalAffected),
    };
  }

  /**
   * Records non-critical sub-step errors into sync_job_errors without failing the whole row.
   * @param {string|null} syncJobId
   * @param {string|number|null} recordId
   * @param {string} message
   * @returns {Promise<void>}
   */
  async logNonCriticalJobError(syncJobId, recordId, message) {
    if (!syncJobId || !message) return;
    try {
      await this.queryNewDb(
        `
        INSERT INTO sync_job_errors (job_id, record_id, error_message)
        VALUES (@jobId, @recordId, @errorMessage)
      `,
        {
          jobId: String(syncJobId),
          recordId: recordId == null ? null : String(recordId),
          errorMessage: String(message).slice(0, 1000),
        },
      );
    } catch (err) {
      logger.warn(
        `[StreamTaskInIncrementalModel] Failed to log non-critical job error: ${err.message}`,
      );
    }
  }

  _generateWorkitemId(prefix = 'wi') {
    const ts = Date.now();
    const rand = Math.floor(Math.random() * 10000);
    return `${prefix}_${ts}${rand}`;
  }

  _isInProgressStatus(value) {
    if (value === null || value === undefined) return false;
    const raw = String(value).trim();
    if (!raw) return false;
    const numeric = Number(raw);
    if (!Number.isNaN(numeric) && numeric === 2) return true;
    const normalized = raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/Ä‘/g, 'd')
      .replace(/Ä/g, 'D')
      .toLowerCase();
    return normalized.includes('dang thuc hien');
  }

  async _insertWorkitemIfMissing(payload, transaction) {
    const exists = await this.queryNewDbTx(
      `
        SELECT TOP 1 id
        FROM ${this.newDbName}.dbo.work_items WITH (READPAST)
        WHERE document_id = @documentId
          AND node_id = @nodeId
          AND role = @role
          AND assignee_user_id = @assigneeUserId
          AND state = 'open'
      `,
      {
        documentId: payload.document_id,
        nodeId: payload.node_id,
        role: payload.role,
        assigneeUserId: payload.assignee_user_id,
      },
      transaction,
    );
    if (exists?.length) {
      return { inserted: 0, id: exists[0].id };
    }

    await this.queryNewDbTx(
      `
        INSERT INTO ${this.newDbName}.dbo.work_items
        (id, document_id, node_id, role, assignee_user_id, node_type, state, created_at, bpmn_version, action_code)
        VALUES
        (@id, @document_id, @node_id, @role, @assignee_user_id, @node_type, @state, @created_at, @bpmn_version, @action_code)
      `,
      payload,
      transaction,
    );
    return { inserted: 1, id: payload.id };
  }

  async syncWorkItemsForInProgressTask({ newTaskId, processStatus, createdAt }, transaction) {
    if (!this._isInProgressStatus(processStatus)) {
      return { success: true, inserted: 0, skipped: true };
    }

    const users = await this.queryNewDbTx(
      `
        SELECT process_id, role
        FROM ${this.newDbName}.dbo.task_users WITH (READPAST)
        WHERE task_id = @taskId
          AND role IN ('assigner', 'supporter')
      `,
      { taskId: Number(newTaskId) },
      transaction,
    );

    if (!Array.isArray(users) || users.length === 0) {
      return { success: true, inserted: 0, skipped: true };
    }

    const owner = users.find((u) => String(u.role || '').toLowerCase() === 'assigner');
    const supporters = users.filter((u) => String(u.role || '').toLowerCase() === 'supporter');
    const docId = String(newTaskId);
    const ts = createdAt || new Date().toISOString();

    let inserted = 0;
    if (owner?.process_id) {
      const res = await this._insertWorkitemIfMissing(
        {
          id: this._generateWorkitemId('wi'),
          document_id: docId,
          node_id: 'Gateway_1ev9iva',
          role: 'NGUOI_CHU_TRI',
          assignee_user_id: String(owner.process_id),
          node_type: 'bpmn:ExclusiveGateway',
          state: 'open',
          created_at: ts,
          bpmn_version: 'TaskDocument',
          action_code: null,
        },
        transaction,
      );
      inserted += Number(res.inserted || 0);
    }

    for (const supporter of supporters) {
      if (!supporter?.process_id) continue;
      const res = await this._insertWorkitemIfMissing(
        {
          id: this._generateWorkitemId('wi_sup'),
          document_id: docId,
          node_id: 'Activity_0alxes6',
          role: 'NGUOI_PHOI_HOP',
          assignee_user_id: String(supporter.process_id),
          node_type: 'bpmn:UserTask',
          state: 'open',
          created_at: ts,
          bpmn_version: 'TaskDocument',
          action_code: null,
        },
        transaction,
      );
      inserted += Number(res.inserted || 0);
    }

    return { success: true, inserted };
  }
}

module.exports = StreamTaskInIncrementalModel;
