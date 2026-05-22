const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const logger = require('../../../utils/logger');

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
    if (process.env.DISABLE_ENSURE_SCHEMA === 'true') {
      logger.info('[StreamSystemLogTasksModel] DISABLE_ENSURE_SCHEMA is true, skipping system_log_tasks DDL');
    } else {
      await this.ensureSystemLogTasksTableExists();
    }
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
      const crypto = require('crypto');
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
