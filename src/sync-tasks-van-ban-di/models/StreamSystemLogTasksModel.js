const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const logger = require('../../../utils/logger');

/** Auto-generate system_log_tasks entries (8 columns with id_log_bak UUID) */
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

      // Step 1 & 2: Create table if missing (with all 8 columns including id_log_bak)
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
              id NVARCHAR(36) PRIMARY KEY,
              id_log_bak NVARCHAR(36) NULL,
              id_task INT NOT NULL,
              actions NVARCHAR(50) NOT NULL,
              details NVARCHAR(MAX) NULL,
              user_info NVARCHAR(255) NULL,
              created_at DATETIME2 DEFAULT GETDATE() NULL,
              updated_at DATETIME2 DEFAULT GETDATE() NULL
          )
      END
      `;

      await this.queryNewDb(createTableQuery);

      // Step 3 & 4: Add id_log_bak column if table already exists but column is missing
      const addColumnQuery = `
      IF EXISTS (
          SELECT 1
          FROM ${this.newDbName}.sys.tables t
          JOIN ${this.newDbName}.sys.schemas s ON t.schema_id = s.schema_id
          WHERE t.name = '${this.newDbTable}'
          AND s.name = '${this.newDbSchema}'
      )
      AND NOT EXISTS (
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

      await this.queryNewDb(addColumnQuery);

      logger.info('✅ system_log_tasks table and columns ready');
    } catch (err) {
      logger.error('❌ Ensure system_log_tasks failed:', err.message);
      throw err;
    }
  }

  /** Get table reference */
  getTableRef() {
    return `${this.newDbName}.${this.newDbSchema}.${this.newDbTable}`;
  }

  /** Create log entry for task: 8 columns (id, id_log_bak UUID, id_task, actions, details, user_info, timestamps) */
  async createLogForTask(params, transaction) {
    if (!params || !params.idTask) {
      throw new Error('idTask is required');
    }

    const tableRef = this.getTableRef();
    const createdAt = params.createdAt || new Date();
    const logId = this._generateUUID();
    const logIdBak = this._generateUUID();

    const insertQuery = `
      INSERT INTO ${tableRef}
      (id, id_log_bak, id_task, actions, details, user_info, created_at, updated_at)
      VALUES
      (@id, @idLogBak, @idTask, @actions, @details, @userInfo, @createdAt, @updatedAt)
    `;

    await this.queryNewDb(insertQuery, {
      id: logId,
      idLogBak: logIdBak,
      idTask: params.idTask,
      actions: 'POST',
      details: 'Tạo công việc',
      userInfo: params.userInfo || null,
      createdAt: createdAt,
      updatedAt: createdAt
    });

    logger.info(`[StreamSystemLogTasksModel] Created log ${logId} for task ${params.idTask}`);

    return {
      success: true,
      logId: logId,
      message: 'Log entry created successfully',
      idTask: params.idTask
    };
  }

  /** Generate UUID v4 format */
  _generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /** Cleanup staging - NO-OP (no staging for system logs) */
  async cleanupStagingTable() {
    try {
      logger.debug('[StreamSystemLogTasksModel] cleanupStagingTable called (NO-OP - no staging)');
      return {
        success: true,
        message: 'No staging table for system logs',
        table: this.newDbTable
      };
    } catch (error) {
      logger.error('[StreamSystemLogTasksModel.cleanupStagingTable]', error);
      throw error;
    }
  }

  /** Query logs for specific task */
  async getLogsForTask(idTask) {
    try {
      const tableRef = this.getTableRef();
      const query = `
        SELECT * FROM ${tableRef}
        WHERE id_task = @idTask
        ORDER BY created_at DESC
      `;

      const rows = await this.queryNewDb(query, { idTask: Number(idTask) });
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      logger.error('[StreamSystemLogTasksModel.getLogsForTask]', error);
      throw error;
    }
  }
}

module.exports = StreamSystemLogTasksModel;
