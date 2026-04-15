const MigrationHelper = require('../../helpers/MigrationHelper');
const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const { tableMappings } = require('./config');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

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
        IF NOT EXISTS (
            SELECT 1
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = '${schema}'
            AND TABLE_NAME = '${table}'
        )
        BEGIN
            CREATE TABLE ${stagingTableRef} (
                [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
                [__sync_time] DATETIME2 NULL,
                [__sync_id_num] BIGINT NULL,

                [ID] BIGINT NOT NULL,
                [TieuDe] NVARCHAR(500) NULL,
                [BatDau] NVARCHAR(500) NULL,
                [KetThuc] NVARCHAR(500) NULL,
                [DiaDiem] NVARCHAR(500) NULL,
                [LoaiHop] NVARCHAR(500) NULL,
                [NoiDung] NVARCHAR(500) NULL,
                [ThoiLuongGiay] NVARCHAR(500) NULL,
                [ChuTri] NVARCHAR(500) NULL,
                [ThuKy] NVARCHAR(500) NULL,
                [tp_Created] NVARCHAR(500) NULL,
                [tp_Modified] NVARCHAR(500) NULL,
                [tp_Version] NVARCHAR(500) NULL
            );

            CREATE UNIQUE INDEX IX_${table}_ID
            ON ${stagingTableRef}([ID]);
        END
        `;

        await this.queryNewDb(query);

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

  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0) {
    const query = `
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
            U.tp_ID       AS __sync_id_num

        FROM ${this.oldDbName}.dbo.AllUserData U
        WHERE
            U.tp_ListId = 'B0F4D2C4-D65B-42AB-A37A-9D45118A2A2C'
            AND U.tp_RowOrdinal = 0
            AND U.tp_IsCurrentVersion = 1

            AND (
                U.tp_Modified > @lastSyncTime
                OR (
                    U.tp_Modified = @lastSyncTime
                    AND U.tp_ID > @lastSyncId
                )
            )

        ORDER BY
            U.tp_Modified ASC,
            U.tp_ID ASC
    `;

    return this.queryOldDb(query, {
      lastSyncTime,
      lastSyncId: Number(lastSyncId || 0)
    });
  }

  async syncOldToStaging(rows, { transaction } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { stagedCount: 0 };
    }

    const internalColumns = new Set(['__sync_time', '__sync_id_num']);
    const columns = Object.keys(rows[0] || {}).filter(
      (c) => !String(c).startsWith('__') && !internalColumns.has(c)
    );

    if (!columns.length) return { stagedCount: 0 };

    // Bảng staging đã được tạo sẵn trong ensureStagingTableExists() lúc initialize
    const keyColumn = 'ID';
    const stagingTableRef = this.getStagingTableRef();

    for (const row of rows) {
      const params = {};
      for (const column of columns) {
        params[column] = row[column] != null ? String(row[column]) : null;
      }

      params.__sync_time = row.__sync_time;
      params.__sync_id_num = row.__sync_id_num;

      const updateSet = columns
        .filter(c => c !== keyColumn)
        .map(c => `[${c}] = @${c}`)
        .join(', ');

      const query = `
      IF EXISTS (SELECT 1 FROM ${stagingTableRef} WHERE [${keyColumn}] = @${keyColumn})
      BEGIN
          UPDATE ${stagingTableRef}
          SET ${updateSet},
              __sync_time = @__sync_time,
              __sync_id_num = @__sync_id_num
          WHERE [${keyColumn}] = @${keyColumn}
      END
      ELSE
      BEGIN
          INSERT INTO ${stagingTableRef} (
              ${columns.map(c => `[${c}]`).join(',')},
              __sync_time,
              __sync_id_num
          )
          VALUES (
              ${columns.map(c => `@${c}`).join(',')},
              @__sync_time,
              @__sync_id_num
          )
      END
      `;

      await this.queryNewDbTx(query, params, transaction);
    }

    return { stagedCount: rows.length };
  }

  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    if (!syncJobId) throw new Error('syncJobId is required');

    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);

    console.log('[STREAM_MEETING_MIGRATION] START SYNC', {
      syncJobId,
      sourceLastSyncTime: normalizedLastSyncTime,
      sourceLastSyncId: normalizedLastSyncId
    });

    const rows = await this.fetchListFromOldDb(normalizedLastSyncTime, normalizedLastSyncId);

    const stageResult = await this.syncOldToStaging(rows);

    console.log('[STREAM_MEETING_MIGRATION] STAGED:', stageResult?.stagedCount);

    let nextSyncTime = normalizedLastSyncTime;
    let nextSyncId = normalizedLastSyncId;

    for (const row of rows) {
      const rowTime = this.extractRowSyncTime(row);
      const rowId = this.extractRowSyncId(row);
      if (!rowTime) continue;

      const isAhead = this.isCursorAhead(rowTime, rowId, nextSyncTime, nextSyncId);
      logger.info(`  └─ [Compare] rowID: ${row.ID} | T: ${rowTime} ID: ${rowId} vs Cursor(T: ${nextSyncTime} ID: ${nextSyncId}) -> Ahead: ${isAhead}`);

      if (isAhead) {
        nextSyncTime = rowTime;
        nextSyncId = rowId;
      }
    }

    console.log('[STREAM_MEETING_MIGRATION] NEXT CURSOR:', {
      lastSyncTime: nextSyncTime,
      lastSyncId: nextSyncId
    });

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

  async getSyncJobState(syncJobId) {
    if (!syncJobId) throw new Error('syncJobId is required');
    const rows = await this.queryNewDb(
      `SELECT TOP 1 job_id, total_to_sync, total_processed, total_success, total_errors, last_sync_time, last_sync_id
       FROM sync_jobs WHERE job_id = @syncJobId`,
      { syncJobId }
    );
    return rows?.[0] || null;
  }

  async fetchOneFromSource({ lastSyncTime, lastSyncId }) {
    const query = `
            SELECT TOP 1
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

                -- sync tracking
                U.tp_Modified AS __sync_time,
                U.tp_ID       AS __sync_id_num

            FROM ${this.oldDbName}.dbo.AllUserData U
            WHERE
                U.tp_ListId = 'B0F4D2C4-D65B-42AB-A37A-9D45118A2A2C'
                AND U.tp_RowOrdinal = 0
                AND U.tp_IsCurrentVersion = 1

                AND (
                    U.tp_Modified > @lastSyncTime
                    OR (
                        U.tp_Modified = @lastSyncTime
                        AND U.tp_ID > @lastSyncId
                    )
                )

            ORDER BY U.tp_Modified ASC, U.tp_ID ASC
        `;

    const rows = await this.queryOldDb(query, {
      lastSyncTime,
      lastSyncId
    });

    return rows?.[0] || null;
  }
  
  async processOne(syncJobId) {
    if (!syncJobId) throw new Error('syncJobId is required');

    const jobState = await this.getSyncJobState(syncJobId);
    if (!jobState) throw new Error(`Job state not found: ${syncJobId}`);

    // 🔥 Chỉ đọc từ DB
    const sourceLastSyncTime = this.normalizeSyncTime(
      jobState.last_sync_time || DEFAULT_SYNC_TIME
    );

    const sourceLastSyncId = Number(
      jobState.last_sync_id || 0
    );

    const rowData = await this.fetchOneFromSource({
      lastSyncTime: sourceLastSyncTime,
      lastSyncId: sourceLastSyncId
    });

    if (!rowData) {
      return { syncJobId, processed: false, done: true };
    }

    const result = await this.processRowData(rowData);

    const newSyncTime = this.extractRowSyncTime(rowData);
    const newSyncId = this.extractRowSyncId(rowData);

    await this.queryNewDb(
      `UPDATE sync_jobs
      SET total_processed = ISNULL(total_processed,0) + 1,
          total_success   = ISNULL(total_success,0) + 1,
          last_sync_time  = @lastSyncTime,
          last_sync_id    = @lastSyncId
      WHERE job_id = @syncJobId`,
      {
        syncJobId,
        lastSyncTime: newSyncTime,
        lastSyncId: newSyncId
      }
    );

    return {
      syncJobId,
      processed: true,
      done: false
    };
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
        'meeting',
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
        'meeting',
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
        NULL,
        'migration_origin',
        'SYSTEM_MIGRATION',
        'SYSTEM_MIGRATION',
        'seat',
        N'Gán vị trí chỗ ngồi',
        'CHUA_XU_LY',
        '3',
        'meeting',
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
