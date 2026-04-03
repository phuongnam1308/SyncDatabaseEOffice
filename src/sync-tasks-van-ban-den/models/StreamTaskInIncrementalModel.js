const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const logger = require('../../../utils/logger');
const sql = require('mssql');
const StreamTaskMigrationModel = require('./StreamTaskMigrationModel');
const StreamTaskUsersModel = require('./StreamTaskUsersModel');
const StreamSystemLogTasksModel = require('./StreamSystemLogTasksModel');

const DEFAULT_SYNC_TIME = '9999-12-31T23:59:59.999Z';

/** Task sync orchestrator (transaction-based: fetch → stage → process with atomic multi-table handling) */
class StreamTaskInIncrementalModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_TASK_INCREMENTAL' });
    this.newDbName = process.env.NEW_DB_NAME;
    this.oldDbSchema = 'dbo';
    this.oldDbTable = 'TaskVBDen';
    this.newDbSchema = 'dbo';
    this.newTableSync = 'task_sync';

    // Internal data models
    this.taskModel = null;
    this.taskUsersModel = null;
    this.systemLogsModel = null;
  }

  /** Initialize all models and staging tables */
  async initialize() {
    await super.initialize();
    
    try {
      this.taskModel = new StreamTaskMigrationModel();
      await this.taskModel.initialize();

      this.taskUsersModel = new StreamTaskUsersModel();
      await this.taskUsersModel.initialize();

      this.systemLogsModel = new StreamSystemLogTasksModel();
      await this.systemLogsModel.initialize();

      await this.ensureStagingTableExists();

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
   * DROP + CREATE để đảm bảo schema luôn fresh.
   */
  async ensureStagingTableExists() {
    const table = this.getStagingTableRef();

    const query = `
      IF OBJECT_ID('${table}', 'U') IS NOT NULL
          DROP TABLE ${table};

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
    `;

    await this.queryNewDb(query);
    logger.info('[StreamTaskInIncrementalModel] task_sync staging table ready');
  }

  // ═══════════════════════════════════════════════════════════════
  // COUNT
  // ═══════════════════════════════════════════════════════════════

  /**
   * Tính tổng số bản ghi cần đồng bộ, cap theo COMPLETED_LIMIT nếu có.
   * @param {string} lastSyncTime
   * @param {number} [lastSyncId=0]
   * @returns {Promise<number>}
   */
  async getCount(lastSyncTime, lastSyncId = 0) {
    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);
    const limit = Number(process.env.COMPLETED_LIMIT || 0);

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
    `;

    const rows = await this.queryOldDb(query, {
      lastSyncTime: normalizedLastSyncTime,
      lastSyncId: normalizedLastSyncId
    });

    const total = Number(rows?.[0]?.total || 0);
    if (Number.isFinite(limit) && limit > 0) {
      return Math.min(total, limit);
    }
    return total;
  }

  // ═══════════════════════════════════════════════════════════════
  // FETCH FROM OLD DB — DESC cursor, OFFSET/TAKE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Loads incremental source records from OLD DB after current cursor (DESC).
   * @param {string} lastSyncTime
   * @param {number} [lastSyncId=0]
   * @param {number|null} [take=null]
   * @param {number} [offset=0]
   * @returns {Promise<object[]>}
   */
  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0, take = null, offset = 0) {
    const syncTimeExpr = this.getSyncTimeExpression();
    const safeTake = Number.isFinite(Number(take)) && Number(take) > 0 ? Number(take) : null;
    const safeOffset = Number.isFinite(Number(offset)) && Number(offset) >= 0 ? Number(offset) : 0;

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
        __sync_time < @lastSyncTime
        OR (
          __sync_time = @lastSyncTime
          AND ISNULL(__sync_id_num, 9223372036854775807) < @lastSyncId
        )
      )
      ORDER BY
        __sync_time DESC,
        ISNULL(__sync_id_num, 9223372036854775807) DESC,
        ID DESC
      ${safeTake ? 'OFFSET @offset ROWS FETCH NEXT @take ROWS ONLY' : ''}
    `;

    return this.queryOldDb(query, {
      lastSyncTime,
      lastSyncId: Number(lastSyncId || 0),
      ...(safeTake ? { take: safeTake, offset: safeOffset } : {})
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

    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);

    const stageBatchSize = 1000;
    const stageOffset = Number(process.env.BEGIN_LIMIT || 0);

    const rows = await this.fetchListFromOldDb(
      normalizedLastSyncTime,
      normalizedLastSyncId,
      stageBatchSize,
      stageOffset
    );
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

  // ═══════════════════════════════════════════════════════════════
  // FETCH ONE FROM STAGING — ROW_NUMBER cursor
  // ═══════════════════════════════════════════════════════════════

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
              __sync_time DESC,
              ISNULL(__sync_id_num, 9223372036854775807) DESC,
              ID DESC
          ) AS rn
        FROM source_rows
        WHERE (
          __sync_time < @lastSyncTime
          OR (
            __sync_time = @lastSyncTime
            AND ISNULL(__sync_id_num, 9223372036854775807) < @lastSyncId
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

    if (!rows?.length) return null;

    const row = { ...rows[0] };
    delete row.rn;
    return row;
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
  // PROCESS ONE
  // ═══════════════════════════════════════════════════════════════

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

    // Safety check: ensure pool is initialized
    if (!this.newPool) {
      throw new Error('Database pool not initialized');
    }

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
        logger.error('[StreamTaskInIncrementalModel.processOne] rollback failed:', rollbackError);
      }
      throw error;
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
    const createdAt = stagingRow.Created || new Date().toISOString();
    let totalAffected = 0;

    // ── 1. Upsert task chính ──────────────────────────────────────
    const taskResult = await this.taskModel.processSingleRecord(stagingRow, transaction);

    if (!taskResult || !taskResult.newTaskId) {
      logger.error(`[SYNC FAILED] Task not inserted for ID=${taskId}`);
      return { action: 'none', affected: 0, failed: true };
    }

    const newTaskId = taskResult.newTaskId;
    const createdBy = taskResult?.createdBy || stagingRow.CreatedBy || null;
    logger.info(`[SYNC OK] task ID=${taskId} → new_id=${newTaskId} action=${taskResult.action}`);
    totalAffected += 1;

    // ── 2. Task users (TaskVBDenPermission) ───────────────────────
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
            if (userResult && userResult.action !== 'skipped') {
              totalAffected += 1;
              logger.info(
                `[user] userId=${userRow.ID} action=${userResult?.action}`
              );
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
        // Log creation returned false: Log warning only
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

    return {
      action: taskResult.action,
      idTaskBak: taskId,
      newTaskId,
      affected: Math.max(1, totalAffected)
    };
  }
}

module.exports = StreamTaskInIncrementalModel;