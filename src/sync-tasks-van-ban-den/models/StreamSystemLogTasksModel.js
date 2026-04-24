const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const logger = require('../../../utils/logger');
const crypto = require('crypto');

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

/**
 * Safely parse dates, treating 'NULL' string as null
 */
function safeDateParse(dateValue, fieldName = '') {
  if (!dateValue) return null;
  if (typeof dateValue === 'string' && dateValue.toUpperCase() === 'NULL') return null;

  try {
    if (typeof dateValue.getTime === 'function' && !isNaN(dateValue.getTime())) {
      return dateValue.toISOString();
    }
    if (typeof dateValue === 'string') {
      const parsed = new Date(dateValue);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
  } catch (e) {
    if (fieldName) logger.warn(`[safeDateParse] Failed to convert ${fieldName}: ${e.message}`);
  }
  return null;
}

/** Auto-generate system_log_tasks entries (10 columns with id_log_bak UUID) */
class StreamSystemLogTasksModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_SYSTEM_LOG_TASKS_MODEL' });
    this.newDbName = process.env.NEW_DB_NAME;
    this.newDbSchema = 'dbo';
    this.newDbTable = 'system_log_tasks';
  }

  /** Initialize model */
  async initialize() {
    await super.initialize();
    await this.ensureSystemLogTasksTableExists();
    logger.info('[StreamSystemLogTasksModel] Initialized');
  }

  /** Ensure system_log_tasks table exists with proper schema */
  async ensureSystemLogTasksTableExists() {
    try {
      const tableRef = `${this.newDbName}.${this.newDbSchema}.${this.newDbTable}`;

      const createTableQuery = `
      IF NOT EXISTS (
          SELECT 1
          FROM ${this.newDbName}.sys.tables t
          JOIN ${this.newDbName}.sys.schemas s ON t.schema_id = s.schema_id
          WHERE t.name = '${this.newDbTable}'
          AND s.name = '${this.newDbSchema}'
      )
      BEGIN
          CREATE TABLE ${tableRef} (
              id          NVARCHAR(255)  NOT NULL,
              actions     NVARCHAR(50)   NULL,
              details     NVARCHAR(MAX)  NULL,
              user_info   NVARCHAR(MAX)  NULL,
              timestamps  DATETIME       NULL,
              created_at  DATETIME2(0)   DEFAULT GETDATE() NULL,
              updated_at  DATETIME2(0)   DEFAULT GETDATE() NULL,
              task_id     VARCHAR(1000)  NULL,
              note        NVARCHAR(500)  NULL
          )
      END
      `;

      await this.queryNewDb(createTableQuery, {});

      const addColumnQuery = `
      IF NOT EXISTS (
          SELECT 1
          FROM ${this.newDbName}.sys.columns c
          JOIN ${this.newDbName}.sys.tables t ON c.object_id = t.object_id
          JOIN ${this.newDbName}.sys.schemas s ON t.schema_id = s.schema_id
          WHERE t.name = '${this.newDbTable}'
          AND s.name = '${this.newDbSchema}'
          AND c.name = 'id_log_bak'
      )
      BEGIN
          ALTER TABLE ${tableRef}
          ADD id_log_bak NVARCHAR(36) NULL
      END
      `;

      await this.queryNewDb(addColumnQuery, {});

      logger.info('[StreamSystemLogTasksModel] system_log_tasks ready');
    } catch (err) {
      logger.error('Ensure system_log_tasks failed:', err.message);
      throw err;
    }
  }

  /** Get table reference */
  getTableRef() {
    return `${this.newDbName}.${this.newDbSchema}.${this.newDbTable}`;
  }

  _normalizeText(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text.length ? text : null;
  }

  _isSafeTableName(tableName) {
    return /^[A-Za-z0-9_]+$/.test(tableName);
  }

  _sortTimeExpr(alias = 'src') {
    return `
      COALESCE(
        TRY_CONVERT(datetime2, ${alias}.NgayTao, 120),
        TRY_CONVERT(datetime2, ${alias}.NgayTao, 121),
        TRY_CONVERT(datetime2, ${alias}.NgayTao, 103),
        TRY_CONVERT(datetime2, ${alias}.NgayTao, 105),
        TRY_CONVERT(datetime2, ${alias}.NgayTao)
      )
    `;
  }

  async fetchAllAuditsByOldDocumentId(oldDocumentId) {
    const normalizedDocumentId = this._normalizeText(oldDocumentId);
    if (!normalizedDocumentId) return [];

    const safeTables = AUDIT_TABLES.filter((tableName) => this._isSafeTableName(tableName));
    if (!safeTables.length) return [];

    const sortExpr = this._sortTimeExpr('src');
    const unionParts = safeTables.map((tableName) => `
      SELECT
        src.*,
        N'${tableName}' AS __source_table,
        ${sortExpr} AS __sync_sort_time,
        TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), src.ID))), '')) AS __sync_sort_id
      FROM dbo.[${tableName}] src
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(255), src.VBId))) = @oldDocumentId
    `);

    const query = `
      SELECT *
      FROM (
        ${unionParts.join('\nUNION ALL\n')}
      ) AS audits
      ORDER BY
        audits.__sync_sort_time ASC,
        ISNULL(audits.__sync_sort_id, 0) ASC
    `;

    const rows = await this.queryOldDb(query, { oldDocumentId: normalizedDocumentId });
    return Array.isArray(rows) ? rows : [];
  }

  _deterministicUuid(seed) {
    const hash = crypto.createHash('md5').update(String(seed || '')).digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  }

  async upsertHistoryLogEntry(logEntry, transaction) {
    const tableRef = this.getTableRef();
    const sourceKey = this._normalizeText(logEntry.sourceKey);
    if (!sourceKey) {
      throw new Error('sourceKey is required');
    }

    const checkQuery = `
      SELECT TOP 1 id
      FROM ${tableRef}
      WHERE task_id = @taskId AND note = @note
      ORDER BY updated_at DESC
    `;
    const existed = await this.queryNewDbTx(
      checkQuery,
      { taskId: logEntry.taskId, note: sourceKey },
      transaction
    );

    if (existed?.[0]?.id) {
      await this.queryNewDbTx(
        `
          UPDATE ${tableRef}
          SET
            actions = @actions,
            details = @details,
            user_info = @userInfo,
            timestamps = @timestamps,
            updated_at = @updatedAt
          WHERE id = @id
        `,
        {
          id: existed[0].id,
          actions: logEntry.actions,
          details: logEntry.details,
          userInfo: logEntry.userInfo,
          timestamps: logEntry.timestamps,
          updatedAt: logEntry.updatedAt
        },
        transaction
      );
      return { action: 'updated', id: existed[0].id };
    }

    const newId = this._generateUUID();
    await this.queryNewDbTx(
      `
        INSERT INTO ${tableRef}
        (id, actions, details, user_info, timestamps, created_at, updated_at, task_id, note, id_log_bak)
        VALUES
        (@id, @actions, @details, @userInfo, @timestamps, @createdAt, @updatedAt, @taskId, @note, @idLogBak)
      `,
      {
        id: newId,
        actions: logEntry.actions,
        details: logEntry.details,
        userInfo: logEntry.userInfo,
        timestamps: logEntry.timestamps,
        createdAt: logEntry.createdAt,
        updatedAt: logEntry.updatedAt,
        taskId: logEntry.taskId,
        note: sourceKey,
        idLogBak: this._deterministicUuid(sourceKey)
      },
      transaction
    );
    return { action: 'inserted', id: newId };
  }

  async syncFullHistoryForTask(params, transaction) {
    const taskId = this._normalizeText(params?.idTask);
    const oldDocumentId = this._normalizeText(params?.oldDocumentId);
    if (!taskId || !oldDocumentId) {
      return { success: false, inserted: 0, updated: 0, total: 0 };
    }

    const fallbackUserInfo = this._normalizeText(params?.userInfo);
    const fallbackTime = safeDateParse(params?.createdAt || new Date(), 'createdAt') || new Date().toISOString();

    const audits = await this.fetchAllAuditsByOldDocumentId(oldDocumentId);
    if (!audits.length) {
      return { success: true, inserted: 0, updated: 0, total: 0 };
    }

    let inserted = 0;
    let updated = 0;

    for (const audit of audits) {
      const sourceTable = this._normalizeText(audit.__source_table) || 'LuanChuyenVanBan';
      const sourceId = this._normalizeText(audit.ID) || this._generateUUID();
      const sourceKey = `AUDIT:${sourceTable}:${sourceId}`;

      const timestamps =
        safeDateParse(audit.NgayTao, 'NgayTao') ||
        safeDateParse(audit.Created, 'Created') ||
        safeDateParse(audit.Modified, 'Modified') ||
        fallbackTime;

      const result = await this.upsertHistoryLogEntry(
        {
          taskId,
          actions: this._normalizeText(audit.Category) || 'POST',
          details: this._normalizeText(audit.HanhDong) || 'Cập nhật xử lý văn bản',
          userInfo: this._normalizeText(audit.NguoiXuLy) || fallbackUserInfo,
          timestamps,
          createdAt: timestamps,
          updatedAt: new Date().toISOString(),
          sourceKey
        },
        transaction
      );

      if (result.action === 'inserted') inserted += 1;
      if (result.action === 'updated') updated += 1;
    }

    logger.info(
      `[StreamSystemLogTasksModel] synced full history for task_id=${taskId}, oldDocumentId=${oldDocumentId}, inserted=${inserted}, updated=${updated}`
    );
    return { success: true, inserted, updated, total: audits.length };
  }

  async createLogForTask(params, transaction) {
    if (!params || !params.idTask) {
      throw new Error('idTask is required');
    }

    const tableRef = this.getTableRef();
    // Safely parse createdAt with fallback to now, convert to ISO string
    const parsedCreatedAt = safeDateParse(params.createdAt || new Date(), 'createdAt');
    const now = parsedCreatedAt || new Date().toISOString();
    const taskId = String(params.idTask).trim();

    try {
      /** 1. CHECK EXIST */
      const checkQuery = `
        SELECT TOP 1 id
        FROM ${tableRef}
        WHERE task_id = @taskId
        ORDER BY updated_at DESC
      `;

      const existed = await this.queryNewDbTx(
        checkQuery,
        { taskId },
        transaction
      );

      /** 2. UPDATE nếu đã tồn tại */
      if (existed?.[0]?.id) {
        const updateQuery = `
          UPDATE ${tableRef}
          SET
            actions     = @actions,
            details     = @details,
            user_info   = @userInfo,
            timestamps  = @timestamps,
            updated_at  = @updatedAt,
            note        = @note
          WHERE id = @id
        `;

        const updateResult = await this.queryNewDbTx(
          updateQuery,
          {
            id: existed[0].id,
            actions: 'POST',
            details: 'Tạo công việc',
            userInfo: params.userInfo || null,
            timestamps: now,
            updatedAt: now,
            note: params.note || null,
          },
          transaction
        );

        logger.info(`[StreamSystemLogTasksModel] Updated log for task_id ${taskId}`);

        return {
          success: true,
          logId: existed[0].id,
          message: 'Log updated successfully',
          taskId
        };
      }

      /** 3. INSERT nếu chưa tồn tại */
      const logId = this._generateUUID();
      const logIdBak = this._generateUUID();

      const insertQuery = `
        INSERT INTO ${tableRef}
        (id, actions, details, user_info, timestamps, created_at, updated_at, task_id, note, id_log_bak)
        VALUES
        (@id, @actions, @details, @userInfo, @timestamps, @createdAt, @updatedAt, @taskId, @note, @idLogBak);
        SELECT SCOPE_IDENTITY() as id
      `;

      let insertResult;
      try {
        // Safe parse all date values before passing to DB
        const safeTimestamps = safeDateParse(now, 'timestamps') || now;
        const safeCreatedAt = safeDateParse(now, 'createdAt') || now;
        const safeUpdatedAt = safeDateParse(new Date(), 'updatedAt') || new Date().toISOString();
        
        insertResult = await this.queryNewDbTx(
          insertQuery,
          {
            id: logId,
            actions: 'POST',
            details: 'Tạo công việc',
            userInfo: params.userInfo || null,
            timestamps: safeTimestamps,
            createdAt: safeCreatedAt,
            updatedAt: safeUpdatedAt,
            taskId,
            note: params.note || null,
            idLogBak: logIdBak
          },
          transaction
        );
      } catch (insertErr) {
        logger.error(`[StreamSystemLogTasksModel] INSERT FAILED for task_id=${taskId}: ${insertErr.message}`, insertErr);
        throw insertErr;
      }

      // Verify INSERT success
      if (!insertResult || insertResult.length === 0) {
        const msg = `Insert failed: No result returned for task_id=${taskId}`;
        logger.error(`[StreamSystemLogTasksModel] ${msg}`);
        throw new Error(msg);
      }

      logger.info(`[StreamSystemLogTasksModel] Created log ${logId} for task_id ${taskId}`);

      return {
        success: true,
        logId,
        message: 'Log entry created successfully',
        taskId
      };

    } catch (err) {
      logger.error(`[StreamSystemLogTasksModel] createLogForTask failed task_id=${params.idTask}: ${err.message}`);
      throw err;
    }
  }

  /** Generate UUID v4 (improved with crypto fallback) */
  _generateUUID() {
    // Try using crypto if available (Node.js 15.7.0+)
    try {
      if (crypto.randomUUID) {
        return crypto.randomUUID();
      }
    } catch (e) {
      // Fallback
    }
    
    // Fallback to Math.random() based UUID (less ideal but works)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}

module.exports = StreamSystemLogTasksModel;
