const MigrationHelper = require('../../helpers/MigrationHelper');
const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const { tableMappings } = require('./config');
const logger = require('../../../utils/logger');
const {
  claimNextStagingRow,
  ensureTrackingColumns,
  markRowFailed,
  markRowSuccess,
  startHeartbeatLoop,
  updateHeartbeat,
} = require('../../helpers/StagingQueueHelper');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

const SYNC_START_DATE = process.env.SYNC_START_DATE || null;
const SYNC_END_DATE = process.env.SYNC_END_DATE || null;
const SYNC_MIN_DATE = process.env.SYNC_MIN_DATE || '1970-01-01T00:00:00.000Z';

class StreamMeetingMigrationModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_MEETING_MIGRATION' });

    // Config bảng cũ
    this.oldConfig = tableMappings.meeting;

    this.oldDbName = this.oldConfig.oldDatabase;
    this.oldDbSchema = this.oldConfig.oldSchema;
    this.oldDbTable = this.oldConfig.oldTable;

    // Bảng staging tạm thời
    this.newDbName = this.oldConfig.newDatabase;
    this.newDbSchema = this.oldConfig.newSchema;
    this.newTableSync = 'meeting_sync_staging';
    this.helper = new MigrationHelper(this.queryNewDbTx.bind(this), this.queryOldDb.bind(this));

    // Multi-DB List Discovery
    this.listIdCache = {}; // { dbName: [listId1, listId2] }
    this.canonicalListTitle = null;
    this.heartbeatIntervalMs = Number(process.env.HEARTBEAT_INTERVAL_MS || 30000);
  }

  /**
   * Override initialize: kết nối DB xong tự động tạo bảng staging nếu chưa có.
   */
  async initialize() {
    await super.initialize();
    await this.ensureStagingTableExists();
  }

  /**
   * Tự động tạo bảng staging `meeting_sync_staging` trong DB mới nếu chưa tồn tại.
   * Schema cố định khớp với các alias được SELECT ra từ AllUserData (đã parse XML).
   */
    async ensureStagingTableExists() {
      try {
        const stagingTableRef = this.getStagingTableRef();
        const schema = this.newDbSchema || 'dbo';
        const table = this.newTableSync;

        const query = `
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${table}')
        BEGIN
            CREATE TABLE ${stagingTableRef} (
                [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
                [__sync_time] DATETIME2 NULL,
                [__sync_id_num] BIGINT NULL,

                [ID] BIGINT NOT NULL,
                [TieuDe] NVARCHAR(1000) NULL,
                [BatDau] DATETIME NULL,
                [KetThuc] DATETIME NULL,
                [DiaDiem] NVARCHAR(1000) NULL,
                [LoaiHop] NVARCHAR(500) NULL,
                [NoiDung] NVARCHAR(MAX) NULL,
                [ThoiLuongGiay] INT NULL,
                [ChuTri] NVARCHAR(500) NULL,
                [ThuKy] NVARCHAR(500) NULL,
                [tp_Created] DATETIME NULL,
                [tp_Modified] DATETIME NULL,
                [tp_Version] INT NULL,

                [source_db] NVARCHAR(255) NULL,
                [MigrateFlg] INT DEFAULT 0 NULL, -- 0: Pending, 1: Success, 2: Processing, 3: Error
                [MigrateErrFlg] INT DEFAULT 0 NULL
            );

            CREATE UNIQUE INDEX IX_${table}_ID_Source ON ${stagingTableRef}([ID], [source_db]);
        END
        ELSE
        BEGIN
            -- Ensure source_db exists
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${table}' AND COLUMN_NAME = 'source_db')
            BEGIN
                ALTER TABLE ${stagingTableRef} ADD [source_db] NVARCHAR(255) NULL;
                IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_${table}_ID' AND object_id = OBJECT_ID('${stagingTableRef}')) 
                BEGIN
                    DECLARE @dropSqlID NVARCHAR(MAX) = 'DROP INDEX [IX_${table}_ID] ON [${schema}].[${table}]';
                    EXEC sp_executesql @dropSqlID;
                END

                IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_${table}_ID_Source')
                    CREATE UNIQUE INDEX IX_${table}_ID_Source ON ${stagingTableRef}([ID], [source_db]);
            END

            -- Ensure MigrateFlg exists
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${table}' AND COLUMN_NAME = 'MigrateFlg')
                ALTER TABLE ${stagingTableRef} ADD [MigrateFlg] INT DEFAULT 0 NOT NULL;
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${table}' AND COLUMN_NAME = 'MigrateErrFlg')
                ALTER TABLE ${stagingTableRef} ADD [MigrateErrFlg] INT DEFAULT 0 NOT NULL;
        END
        `;

        await this.queryNewDb(query);
        await ensureTrackingColumns(this, {
          tableRef: stagingTableRef,
          tableName: table,
          schemaName: schema,
          dbName: this.newDbName,
          label: this.modelName,
        });

        console.log(`[ensureStagingTableExists] OK: ${stagingTableRef}`);

      } catch (err) {
        console.error(`[ensureStagingTableExists] ERROR: ${err.message}`);
        throw err;
      }
    }

  log(level, message, meta = {}) {
    const payload = {
      model: this.modelName,
      level,
      message,
      ...meta,
      timestamp: new Date().toISOString()
    };

    if (typeof super.log === 'function') {
      return super.log(level, message, meta);
    }

    console.log(JSON.stringify(payload));
  }
  getStagingTableRef() {
    const ref = this.newDbName
      ? `${this.newDbName}.${this.newDbSchema}.${this.newTableSync}`
      : `${this.newDbSchema}.${this.newTableSync}`;

    this.log('DEBUG', 'getStagingTableRef', { ref });
    return ref;
  }

  sanitizeColumnName(column) {
    if (!/^[A-Za-z0-9_]+$/.test(column)) {
      throw new Error(`Invalid column name from source: ${column}`);
    }
    return `[${column}]`;
  }

  normalizeSyncTime(value) {
    if (!value) {
      this.log('DEBUG', 'normalizeSyncTime default');
      return DEFAULT_SYNC_TIME;
    }
    const dateValue = new Date(value);
    if (Number.isNaN(dateValue.getTime())) {
      this.log('WARN', 'Invalid sync time, fallback default', { value });
      return DEFAULT_SYNC_TIME;
    }
    return dateValue.toISOString();
  }

  extractRowSyncTime(row) {
    const raw = row?.__sync_time || row?.Modified || row?.Created || row?.PostTime || null;
    if (!raw) return null;
    const dateValue = new Date(raw);
    if (Number.isNaN(dateValue.getTime())) return null;
    return dateValue.toISOString();
  }

  extractRowSyncId(row) {
    return Number(row?.__sync_id_num ?? row?.ID ?? 0);
  }

  isCursorAhead(aTime, aId, bTime, bId) {
    const ta = new Date(aTime || DEFAULT_SYNC_TIME).getTime();
    const tb = new Date(bTime || DEFAULT_SYNC_TIME).getTime();
    if (ta > tb) return true;
    if (ta < tb) return false;
    return Number(aId || 0) > Number(bId || 0);
  }

  /**
   * Giải quyết List IDs cho một database cụ thể.
   * Dùng Title "Lịch họp" hoặc tương đương.
   */
  async resolveListIdsForDb(dbName) {
    if (this.listIdCache[dbName]) return this.listIdCache[dbName];

    // Reference ID từ .env hoặc config cũ (nếu có)
    const referenceIds = ['B0F4D2C4-D65B-42AB-A37A-9D45118A2A2C'];

    // 1. Khám phá Title mẫu từ reference DB (khkd)
    if (!this.canonicalListTitle) {
      const refDb = this.oldDbName;
      const refId = referenceIds[0];
      const titleQuery = `SELECT TOP 1 tp_Title FROM [${refDb}].[dbo].[AllLists] WHERE tp_ID = @refId`;
      try {
        const rows = await this.queryOldDb(titleQuery, { refId });
        if (rows?.length) {
          this.canonicalListTitle = rows[0].tp_Title;
          logger.info(`[StreamMeetingMigrationModel] Canonical List Title discovered: "${this.canonicalListTitle}"`);
        }
      } catch (err) {
        logger.error(`[StreamMeetingMigrationModel] Discovery canonical title failed: ${err.message}`);
      }
    }

    // 2. Tìm theo Title
    let discoveredIds = [];
    if (this.canonicalListTitle) {
      const discoveryQuery = `SELECT tp_ID FROM [${dbName}].[dbo].[AllLists] WHERE tp_Title = @title AND tp_DeleteTransactionId = 0x0`;
      try {
        const rows = await this.queryOldDb(discoveryQuery, { title: this.canonicalListTitle });
        discoveredIds = rows.map(r => String(r.tp_ID).toUpperCase());
      } catch (err) {
        logger.error(`[StreamMeetingMigrationModel] Discovery error in ${dbName}: ${err.message}`);
      }
    }

    // 3. Keyword fallback
    if (discoveredIds.length === 0) {
      const keywords = ['Lịch họp', 'Đăng ký họp'];
      try {
        const patterns = keywords.map(k => `tp_Title LIKE N'%${k}%'`).join(' OR ');
        const likeQuery = `
          SELECT tp_ID, tp_Title
          FROM [${dbName}].[dbo].[AllLists]
          WHERE (${patterns})
          AND tp_DeleteTransactionId = 0x0
          AND tp_Title NOT LIKE N'%Đính kèm%'
          AND tp_Title NOT LIKE N'%Văn bản%'
          AND tp_Title NOT LIKE N'%Tài liệu%'
        `;

        const rows = await this.queryOldDb(likeQuery);
        if (rows?.length) {
          discoveredIds = rows.map(r => String(r.tp_ID).toUpperCase());
          logger.info(`[StreamMeetingMigrationModel] [${dbName}] Found potential lists: ${rows.map(r => r.tp_Title).join(', ')}`);
        }
      } catch (e) {
        logger.error(`[StreamMeetingMigrationModel] likeQuery failed for DB ${dbName}: ${e.message}`);
      }
    }

    if (discoveredIds.length > 0) {
      this.listIdCache[dbName] = discoveredIds;
      logger.info(`[StreamMeetingMigrationModel] Resolved IDs for [${dbName}]: ${discoveredIds.join(', ')}`);
      return discoveredIds;
    }

    // Fallback
    if (dbName === this.oldDbName) return referenceIds;
    return [];
  }

  async getCount(lastSyncTime, lastSyncId = 0) {
    const dbs = this.oldConfig.databaseList || [this.oldDbName];
    let total = 0;
    for (const db of dbs) {
      const listIds = await this.resolveListIdsForDb(db);
      if (!listIds.length) continue;
      const listIdsStr = listIds.map(id => `'${id}'`).join(',');
      const query = `
          SELECT COUNT(*) AS total
          FROM [${db}].[dbo].[AllUserData]
          WHERE [tp_ListId] IN (${listIdsStr})
          AND tp_RowOrdinal = 0
          AND [tp_IsCurrentVersion] = 1
          AND [tp_DeleteTransactionId] = 0x0
          AND (
              [tp_Modified] > @lastSyncTime
              OR (
                  [tp_Modified] = @lastSyncTime
                  AND [tp_ID] > @lastSyncId
              )
          )
      `;
      try {
        const rows = await this.queryOldDb(query, { lastSyncTime, lastSyncId: Number(lastSyncId || 0) });
        total += Number(rows?.[0]?.total || 0);
      } catch (e) {
        logger.error(`[StreamMeetingMigrationModel] getCount failed for ${db}: ${e.message}`);
      }
    }
    return total;
  }

  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0, offset = 0, limit = 2000, dbName = null, listIds = []) {
    const targetDb = dbName || this.oldDbName;
    const finalIds = listIds.length > 0 ? listIds : await this.resolveListIdsForDb(targetDb);
    const listIdsStr = finalIds.map(id => `'${id}'`).join(',');

    const query = `
        SELECT * FROM (
            SELECT
                U.tp_ID AS ID,
                CAST(U.tp_ColumnSet AS XML).value('(nvarchar1)[1]', 'nvarchar(255)')  AS TieuDe,
                CAST(U.tp_ColumnSet AS XML).value('(datetime1)[1]', 'datetime')       AS BatDau,
                CAST(U.tp_ColumnSet AS XML).value('(datetime2)[1]', 'datetime')       AS KetThuc,
                CAST(U.tp_ColumnSet AS XML).value('(nvarchar3)[1]', 'nvarchar(255)')  AS DiaDiem,
                CAST(U.tp_ColumnSet AS XML).value('(nvarchar6)[1]', 'nvarchar(255)')  AS LoaiHop,
                CAST(U.tp_ColumnSet AS XML).value('(ntext7)[1]', 'nvarchar(max)')     AS NoiDung,
                CAST(U.tp_ColumnSet AS XML).value('(int2)[1]', 'int')                 AS ThoiLuongGiay,
                CAST(U.tp_ColumnSet AS XML).value('(nvarchar10)[1]', 'nvarchar(255)') AS ChuTri,
                CAST(U.tp_ColumnSet AS XML).value('(nvarchar14)[1]', 'nvarchar(255)') AS ThuKy,
                U.tp_Created,
                U.tp_Modified,
                U.tp_Version,

                U.tp_Modified AS __sync_time,
                U.tp_ID       AS __sync_id_num,
                ROW_NUMBER() OVER (ORDER BY U.tp_Modified ASC, U.tp_ID ASC) AS __page_rn

            FROM [${targetDb}].dbo.AllUserData U
            WHERE
                U.tp_ListId IN (${listIdsStr})
                AND U.tp_RowOrdinal = 0
                AND U.tp_IsCurrentVersion = 1
                AND (
                    U.tp_Modified > @lastSyncTime
                    OR (
                        U.tp_Modified = @lastSyncTime
                        AND U.tp_ID > @lastSyncId
                    )
                )
                AND U.tp_Modified >= '${SYNC_MIN_DATE}'
        ) AS t
        WHERE __page_rn > @offset AND __page_rn <= (@offset + @limit)
        ORDER BY __page_rn;
    `;

    return this.queryOldDb(query, {
      lastSyncTime,
      lastSyncId: Number(lastSyncId || 0),
      offset: Number(offset || 0),
      limit: Number(limit || 2000)
    });
  }

  async syncOldToStaging(rows, { transaction, dbName } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return { stagedCount: 0 };

    const targetDb = dbName || this.oldDbName;
    const internalColumns = new Set(['__sync_time', '__sync_id_num', '__page_rn', 'source_db']);
    const columns = Object.keys(rows[0] || {}).filter(
      (c) => !String(c).startsWith('__') && !internalColumns.has(c)
    );

    if (!columns.length) return { stagedCount: 0 };
    const stagingTableRef = this.getStagingTableRef();
    const keyColumn = 'ID';

    let processedCount = 0;
    for (const row of rows) {
      try {
        const params = { source_db: targetDb };
        for (const col of columns) {
           params[col] = row[col];
        }
        params.__sync_time = row.__sync_time;
        params.__sync_id_num = row.__sync_id_num;

        const updateSet = columns.filter(c => c !== keyColumn).map(c => `[${c}] = @${c}`).join(', ');
        const insertCols = [...columns, '__sync_time', '__sync_id_num', 'source_db'].join(', ');
        const insertVals = [...columns, '__sync_time', '__sync_id_num', 'source_db'].map(c => `@${c}`).join(', ');

        const query = `
          IF EXISTS (SELECT 1 FROM ${stagingTableRef} WHERE [${keyColumn}] = @${keyColumn} AND [source_db] = @source_db)
          BEGIN
              UPDATE ${stagingTableRef}
              SET ${updateSet}, __sync_time = @__sync_time, __sync_id_num = @__sync_id_num, MigrateFlg = 0
              WHERE [${keyColumn}] = @${keyColumn} AND [source_db] = @source_db
          END
          ELSE
          BEGIN
              INSERT INTO ${stagingTableRef} (${insertCols}) VALUES (${insertVals})
          END
        `;
        await this.queryNewDbTx(query, params, transaction);
        processedCount++;
      } catch (err) {
        logger.error(`[StreamMeetingMigrationModel] Staging error ID=${row.ID} from ${targetDb}: ${err.message}`);
      }
    }
    return { stagedCount: processedCount };
  }

  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    if (!syncJobId) throw new Error('syncJobId is required');
    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);

    const totalCount = await this.getCount(normalizedLastSyncTime, normalizedLastSyncId);
    logger.info(`[StreamMeetingMigrationModel] Total meeting records across systems: ${totalCount}`);

    await this.queryNewDb(`UPDATE sync_jobs SET total_to_sync = @total WHERE job_id = @jobId`, {
      total: totalCount,
      jobId: syncJobId
    });

    const dbs = this.oldConfig.databaseList || [this.oldDbName];
    const fetchBatchSize = 2000;
    let totalStagedCount = 0;
    let nextSyncTime = normalizedLastSyncTime;
    let nextSyncId = normalizedLastSyncId;

    let dbIdx = 0;
    for (const db of dbs) {
      dbIdx++;
      try {
        logger.info(`[StreamMeetingMigrationModel] [SITE ${dbIdx}/${dbs.length}] Processing database: ${db}`);
        const listIds = await this.resolveListIdsForDb(db);
        if (!listIds.length) continue;
        const listIdsStr = listIds.map(id => `'${id}'`).join(',');

        const dbCountQuery = `
            SELECT COUNT(*) AS total FROM [${db}].[dbo].[AllUserData]
            WHERE [tp_ListId] IN (${listIdsStr}) AND tp_RowOrdinal = 0 AND [tp_IsCurrentVersion] = 1 AND [tp_DeleteTransactionId] = 0x0
            AND ([tp_Modified] > @lastSyncTime OR ([tp_Modified] = @lastSyncTime AND [tp_ID] > @lastSyncId))
        `;
        const dbCountRes = await this.queryOldDb(dbCountQuery, { lastSyncTime: normalizedLastSyncTime, lastSyncId: normalizedLastSyncId });
        const dbCount = Number(dbCountRes?.[0]?.total || 0);

        if (dbCount === 0) {
          logger.info(`[StreamMeetingMigrationModel] No new records in ${db}`);
          continue;
        }

        const numIterations = Math.ceil(dbCount / fetchBatchSize);
        for (let i = 0; i < numIterations; i++) {
          const offset = i * fetchBatchSize;
          const rows = await this.fetchListFromOldDb(normalizedLastSyncTime, normalizedLastSyncId, offset, fetchBatchSize, db, listIds);
          if (!rows?.length) break;

          const stageResult = await this.syncOldToStaging(rows, { dbName: db });
          totalStagedCount += Number(stageResult?.stagedCount || 0);

          for (const row of rows) {
            const rowTime = this.extractRowSyncTime(row);
            const rowId = this.extractRowSyncId(row);
            if (rowTime && this.isCursorAhead(rowTime, rowId, nextSyncTime, nextSyncId)) {
              nextSyncTime = rowTime;
              nextSyncId = rowId;
            }
          }
        }
      } catch (dbErr) {
        logger.error(`[StreamMeetingMigrationModel] [SKIPPED SITE] Error processing database ${db}: ${dbErr.message}`);
      }
    }

    const stagingTableRef = this.getStagingTableRef();
    let pendingCount = totalStagedCount;
    try {
      const pendingRes = await this.queryNewDb(`SELECT COUNT(1) AS cnt FROM ${stagingTableRef} WHERE ISNULL(MigrateFlg, 0) = 0 AND ISNULL(MigrateErrFlg, 0) = 0`);
      pendingCount = Number(pendingRes?.[0]?.cnt || 0);
    } catch (e) {}

    return {
      syncJobId,
      totalCount: pendingCount,
      stagedCount: totalStagedCount,
      lastSyncTime: nextSyncTime,
      lastSyncId: nextSyncId
    };
  }

  async getSyncJobState(syncJobId) {
    if (!syncJobId) throw new Error('syncJobId is required');
    const rows = await this.queryNewDb(
      `SELECT TOP 1 job_id, total_to_sync, total_processed, total_success, total_errors, last_sync_time, last_sync_id
       FROM sync_jobs WHERE job_id = @syncJobId`,
      { syncJobId }
    );
    return rows?.[0] || null;
  }

  async fetchOneFromStaging() {
    const stagingTableRef = this.getStagingTableRef();
    const row = await claimNextStagingRow(this, {
      tableRef: stagingTableRef,
      orderBy: '__sync_time ASC, __sync_id_num ASC',
      owner: `pid_${process.pid}`,
      label: this.modelName,
    });
    if (row) {
      logger.info(`[${this.modelName}] [START] Processing started: ID=${row.ID}, source_db=${row.source_db}`);
    }
    return row;
  }

  async claimNextFromStaging() {
    return this.fetchOneFromStaging();
  }

  async updateHeartbeat(rowData, transaction = null) {
    if (!rowData?.ID) return 0;
    return updateHeartbeat(this, {
      tableRef: this.getStagingTableRef(),
      keyWhere: 'ID = @recordId AND source_db = @sourceDb',
      params: { recordId: String(rowData.ID), sourceDb: rowData.source_db },
      transaction,
      rowToken: `ID=${rowData.ID}, source_db=${rowData.source_db}`,
      label: this.modelName,
    });
  }

  async processOne(syncJobId) {
    if (!syncJobId) throw new Error('syncJobId is required');

    const rowData = await this.fetchOneFromStaging();
    if (!rowData) {
      return { syncJobId, processed: false, done: true };
    }

    const recordId = String(rowData.ID);
    const sourceDb = rowData.source_db;
    const stopHeartbeat = startHeartbeatLoop(
      () => this.updateHeartbeat(rowData),
      this.heartbeatIntervalMs,
    );

    try {
      const result = await this.processRowData(rowData);

      await markRowSuccess(this, {
        tableRef: this.getStagingTableRef(),
        keyWhere: 'ID = @recordId AND source_db = @sourceDb',
        params: { recordId, sourceDb },
        rowToken: `ID=${recordId}, source_db=${sourceDb}`,
        label: this.modelName,
      });

      await this.queryNewDb(
        `UPDATE sync_jobs SET total_processed = ISNULL(total_processed,0) + 1, total_success = ISNULL(total_success,0) + 1 WHERE job_id = @syncJobId`,
        { syncJobId }
      );
      stopHeartbeat();

      return { syncJobId, processed: true, done: false };
    } catch (err) {
      stopHeartbeat();
      logger.error(`[StreamMeetingMigrationModel] Error processing record ID=${recordId} from ${sourceDb}: ${err.message}`);
      await markRowFailed(this, {
        tableRef: this.getStagingTableRef(),
        keyWhere: 'ID = @recordId AND source_db = @sourceDb',
        params: { recordId, sourceDb },
        rowToken: `ID=${recordId}, source_db=${sourceDb}`,
        errorMessage: err.message,
        label: this.modelName,
      });
      await this.queryNewDb(
        `UPDATE sync_jobs SET total_processed = ISNULL(total_processed,0) + 1, total_errors = ISNULL(total_errors,0) + 1 WHERE job_id = @syncJobId`,
        { syncJobId }
      );
      return { syncJobId, processed: true, done: false };
    }
  }
  /**
   * processFn cốt lõi để transform và nạp vào 4 bảng mới
   */
  async processRowData(rowData, { transaction } = {}) {
    if (!rowData?.ID) {
      throw new Error('ID from old record is required');
    }

    const recordId = String(rowData.ID);

    const { externalKey } = tableMappings.meeting;
    const isOnlineZoom = typeof rowData.DiaDiem === 'string' &&  rowData.DiaDiem.toLowerCase().includes('zoom');


    if (rowData.ChuTri) {
      rowData.ChuTri = await this.helper.mapUserName(rowData.ChuTri, transaction);
    }

    if (rowData.ThuKy) {
      rowData.ThuKy = await this.helper.mapUserName(rowData.ThuKy, transaction);
    }

    if (rowData.DiaDiem) {
      rowData.DiaDiem = await this.helper.mapMeetingRoom(
        rowData.DiaDiem,
        transaction
      );
    }
    const result = await this.upsertDataToNewDB(
      rowData,
      tableMappings.meeting,
      externalKey,
      recordId,
      transaction
    );

    const meetingId = result.id;
    if (isOnlineZoom && meetingId) {
      await this.helper.createOnlineMeeting(meetingId, 'ZOOM', transaction);
    }
    await this.helper.createRecurrenceKhong(
      meetingId,
      rowData.BatDau,
      transaction
    );

    await this.helper.createChairmanAndSecretary(
      meetingId,
      rowData.ChuTri,
      rowData.ThuKy,
      transaction
    );
    await this.createDefaultAuditForMigration(meetingId, rowData.created_by, transaction);

    return {
      backupId: recordId,
      affected: result.affected,
      logs: [{ table: 'meetings', action: result.action }]
    };
  }

  async createDefaultAuditForMigration(meetingId, creatorUserId, transaction = null) {
    const query = `
      INSERT INTO ${this.newDbName}.${this.newDbSchema}.audit
      (
        document_id,
        time,
        user_id,
        display_name,
        role,
        action_code,
        from_node_id,
        to_node_id,
        details,
        origin_id,
        created_by,
        receiver,
        roleProcess,
        action,
        stage_status,
        curStatusCode,
        type_document,
        created_at,
        updated_at,
        table_bak
      )
      VALUES
      (
        @meetingId,
        SYSUTCDATETIME(),
        'SYSTEM_MIGRATION',
        NULL,
        'NGUOI_SOAN_LICH',
        'CREATE',
        'Activity_1rl80cg',
        'Activity_1rl80cg',
        '{"transferType":"to_person"}',
        NULL,
        'SYSTEM_MIGRATION',
        'SYSTEM_MIGRATION',
        'processor',
        N'Tạo văn bản',
        'DA_XU_LY',
        '1',
        'Meetings',
        SYSUTCDATETIME(),
        SYSUTCDATETIME(),
        1
      ),
      (
        @meetingId,
        SYSUTCDATETIME(),
        'SYSTEM_MIGRATION',
        'System Migration',
        'NGUOI_SOAN_LICH',
        'TRINH_LICH',
        'Activity_1rl80cg',
        'Gateway_16pjuoq',
        '{"note":""}',
        'migration_origin',
        'SYSTEM_MIGRATION',
        'BAN_QUAN_LY_PHONG',
        'processor',
        N'Chuyển Ban quản lý phòng',
        'DONG_Y_PHE_DUYET',
        '2',
        'Meetings',
        SYSUTCDATETIME(),
        SYSUTCDATETIME(),
        1
      ),
      (
        @meetingId,
        SYSUTCDATETIME(),
        'SYSTEM_MIGRATION',
        'Quản lý phòng',
        'BAN_QUAN_LY_PHONG_HOP',
        'PHE_DUYET_LICH',
        'Gateway_16pjuoq',
        'Activity_18dmg6c',
        '{"transferType":"to_person"}',
        'migration_origin',
        'SYSTEM_MIGRATION',
        'SYSTEM_MIGRATION',
        'seat',
        N'Gán vị trí chỗ ngồi',
        'CHUA_XU_LY',
        '3',
        'Meetings',
        SYSUTCDATETIME(),
        SYSUTCDATETIME(),
        1
      )
    `;
    console.log('[StreamMeetingMigrationModel] createDefaultAuditForMigration', { meetingId });
    await this.helper.queryNewDbTx(
      query,
      { meetingId },
      transaction
    );
  }

  async getExistingColumns(tableName, schema = 'dbo') {
    const result = await this.queryNewDb(
      `
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = @tableName
            AND TABLE_SCHEMA = @schema
            `,
      { tableName, schema }
    );

    return new Set(result.map(r => r.COLUMN_NAME.toLowerCase()));
  }


  async upsertDataToNewDB(rawData, config, externalKeyField, externalKeyValue, transaction) {
    const { newTable, newSchema, fieldMapping, defaultValues } = config;

    // ✅ Lấy column tồn tại thực tế trong DB
    const existingCols = await this.getExistingColumns(newTable, newSchema);

    const params = {};
    const insertCols = [];
    const insertVals = [];
    const updateSet = [];

    /* ================= MAP FIELD ================= */
    for (const [oldField, newField] of Object.entries(fieldMapping)) {

      if (!existingCols.has(newField.toLowerCase())) continue;

      const value = rawData[oldField];

      // BỎ nếu null hoặc undefined
      if (value === undefined || value === null) continue;

      params[newField] = value;

      insertCols.push(`[${newField}]`);
      insertVals.push(`@${newField}`);

      // 🔥 NEVER update ID or created_at
      if (newField.toLowerCase() !== 'id' && newField.toLowerCase() !== 'created_at') {
        updateSet.push(`[${newField}] = @${newField}`);
      }
    }
    /* ================= DEFAULT VALUES ================= */
    for (const [newField, valueFn] of Object.entries(defaultValues || {})) {
      if (!existingCols.has(newField.toLowerCase())) continue; // 🔥 BỎ column không tồn tại

      if (!params.hasOwnProperty(newField)) {
        params[newField] =
          typeof valueFn === 'function'
            ? valueFn(rawData)
            : valueFn;

        insertCols.push(`[${newField}]`);
        insertVals.push(`@${newField}`);
      }
    }

    if (!existingCols.has(externalKeyField)) {
      throw new Error(`External key column '${externalKeyField}' does not exist in ${newTable}`);
    }

    params._externalKeyValue = externalKeyValue;

    const tableRef = `[${newSchema}].[${newTable}]`;

    const query = `
      DECLARE @OutputTable TABLE (id NVARCHAR(255));
      DECLARE @affected INT;

      IF EXISTS (
          SELECT 1 FROM ${tableRef}
          WHERE [${externalKeyField}] = @_externalKeyValue
      )
      BEGIN
          UPDATE ${tableRef}
          SET ${updateSet.length ? updateSet.join(', ') : `${externalKeyField} = ${externalKeyField}`}
          OUTPUT INSERTED.id INTO @OutputTable
          WHERE [${externalKeyField}] = @_externalKeyValue;

          SELECT @affected = @@ROWCOUNT;
          SELECT (SELECT TOP 1 id FROM @OutputTable) AS id, @affected AS affected, 'updated' AS action;
      END
      ELSE
      BEGIN
          INSERT INTO ${tableRef}
          (${insertCols.join(', ')})
          OUTPUT INSERTED.id INTO @OutputTable
          VALUES (${insertVals.join(', ')});

          SELECT @affected = @@ROWCOUNT;
          SELECT (SELECT TOP 1 id FROM @OutputTable) AS id, @affected AS affected, 'inserted' AS action;
      END
      `;
    const result = await this.queryNewDbTx(query, params, transaction);
    const row = Array.isArray(result) ? result[0] : result;

    return {
      id: row?.id || null,
      action: row?.action || 'none',
      affected: Number(row?.affected || 0)
    };
  }
}

module.exports = StreamMeetingMigrationModel;
