const { v4: uuidv4 } = require('uuid');
const MigrationHelper = require('../../helpers/MigrationHelper');

const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const { tableMappings, mapStatus, parseDate } = require('./config');
const mapping = require('./mapping.json');
const requiredRoles = require('./required_process_roles.json');


const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class StreamPassportMigrationModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_PASSPORT_MIGRATION' });

    // Config bảng cũ
    this.oldConfig = tableMappings.passport;

    this.oldDbName = this.oldConfig.oldDatabase;
    this.oldDbSchema = this.oldConfig.oldSchema;
    this.oldDbTable = this.oldConfig.oldTable;
    this.oldUserDb = this.oldConfig.oldUserDatabase || 'WSS_Content_eoffice_khkd';

    // DB mới — đọc từ env: NEW_DB_NAME=app_tancang
    this.newDbName = this.oldConfig.newDatabase || process.env.NEW_DB_NAME;
    this.newDbSchema = this.oldConfig.newSchema;
    this.newTableSync = 'passport_borrow_request_sync_staging';
    this.helper = new MigrationHelper(this.queryNewDbTx.bind(this), this.queryOldDb.bind(this));
    this.requiredRoles = requiredRoles;
  }

  /**
   * Override initialize: kết nối DB xong tự động tạo bảng staging + ensure columns.
   */
  async initialize() {
    console.log(`[StreamPassportMigrationModel] Initializing...`);
    await super.initialize();
    await this.ensureStagingTableExists();
    await this.ensurePassportsColumnsExist();
    await this.ensurePassportBorrowRequestsColumnsExist();
    await this.ensureAuditTableExists();
    console.log(`[StreamPassportMigrationModel] Initialization complete.`);
  }

  /**
   * Tự khởi tạo các cột cần thiết cho bảng passports.
   * Bao gồm: tb_bak, sharepoint_item_id và các cột có thể thiếu.
   */
  async ensurePassportsColumnsExist() {
    try {
      const db = this.newDbName || process.env.NEW_DB_NAME;
      const schema = this.newDbSchema || 'dbo';
      const tableRef = `[${db}].[${schema}].[passports]`;

      console.log(`[StreamPassportMigrationModel] Ensuring passports columns...`);

      const extraCols = [
        { name: 'tb_bak',            type: 'INT',           default: 0    }, // 0 = Dữ liệu hệ thống mới, 1 = Dữ liệu migrate từ SharePoint
        { name: 'sharepoint_item_id', type: 'NVARCHAR(255)', default: null },
        { name: 'eoffice_account',    type: 'NVARCHAR(255)' },
        { name: 'usage_status',       type: 'NVARCHAR(50)'  },
        { name: 'is_deleted',         type: 'BIT',           default: 0    },
        { name: 'updated_by',         type: 'NVARCHAR(100)' },
      ];

      for (const col of extraCols) {
        // Sử dụng một khối SQL duy nhất để đảm bảo tính nguyên tử (Atomic), tránh race condition khi init song song
        const defaultClause = col.default !== undefined ? `DEFAULT ${col.default}` : '';
        const query = `
        IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'passports' AND COLUMN_NAME = '${col.name}')
        BEGIN
            -- 1. Nếu là tb_bak, kiểm tra xem có tên cũ table_bak không để rename
            ${col.name === 'tb_bak' ? `
            IF EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'passports' AND COLUMN_NAME = 'table_bak')
                EXEC sp_rename '${db}.${schema}.passports.table_bak', 'tb_bak', 'COLUMN';
            ELSE
            ` : ''}
            
            -- 2. Thêm cột mới
            IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'passports' AND COLUMN_NAME = '${col.name}')
            BEGIN
                ALTER TABLE ${tableRef} ADD [${col.name}] ${col.type} ${defaultClause};
                -- KHÔNG tự động update tb_bak = 1 ở đây để tránh đánh dấu sai dữ liệu cũ của hệ thống mới
            END
        END
        `;
        await this.queryNewDb(query);
      }
      console.log(`[StreamPassportMigrationModel] [ensurePassportsColumnsExist] OK`);
    } catch (err) {
      console.error(`[StreamPassportMigrationModel] [ensurePassportsColumnsExist] ERROR: ${err.message}`);
    }
  }

  /**
   * Thêm cột sharepoint_item_id vào bảng passport_borrow_requests (nếu chưa có).
   * Dùng làm external key để upsert chống trùng lặp.
   */
  async ensurePassportBorrowRequestsColumnsExist() {
    try {
      const db = this.newDbName || process.env.NEW_DB_NAME;
      const schema = this.newDbSchema || 'dbo';
      const tableRef = `[${db}].[${schema}].[passport_borrow_requests]`;

      console.log(`[StreamPassportMigrationModel] Ensuring passport_borrow_requests columns...`);

      const extraCols = [
        { name: 'request_code',               type: 'NVARCHAR(255)' },
        { name: 'type_request',               type: 'NVARCHAR(50)',  default: "'user'" },
        { name: 'requester_id',               type: 'NVARCHAR(100)' },
        { name: 'name_passport_request',      type: 'NVARCHAR(MAX)' },
        { name: 'borrow_date',                type: 'DATETIME2' },
        { name: 'departure_date',             type: 'DATETIME2' },
        { name: 'arrival_date',               type: 'DATETIME2' },
        { name: 'return_date',                type: 'DATETIME2' },
        { name: 'status',                     type: 'NVARCHAR(50)' },
        { name: 'note',                       type: 'NVARCHAR(MAX)' },
        { name: 'approval_reason',            type: 'NVARCHAR(MAX)' },
        { name: 'reject_reason',              type: 'NVARCHAR(MAX)' },
        { name: 'cancel_reason',              type: 'NVARCHAR(MAX)' },
        { name: 'is_deleted',                 type: 'BIT',           default: 0 },
        { name: 'is_specific_departure_date', type: 'BIT',           default: 0 },
        { name: 'created_by',                 type: 'NVARCHAR(100)' },
        { name: 'updated_by',                 type: 'NVARCHAR(100)' },
        { name: 'tb_bak',                     type: 'INT',           default: 0 }, // 0 = Dữ liệu hệ thống mới, 1 = Dữ liệu migrate từ SharePoint
        { name: 'sharepoint_item_id',         type: 'NVARCHAR(255)', default: null },
      ];

      for (const col of extraCols) {
        const defaultClause = col.default !== undefined ? `DEFAULT ${col.default}` : '';
        const query = `
        IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'passport_borrow_requests' AND COLUMN_NAME = '${col.name}')
        BEGIN
            -- 1. Xử lý rename cho tb_bak
            ${col.name === 'tb_bak' ? `
            IF EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'passport_borrow_requests' AND COLUMN_NAME = 'table_bak')
                EXEC sp_rename '${db}.${schema}.passport_borrow_requests.table_bak', 'tb_bak', 'COLUMN';
            ELSE
            ` : ''}
            
            -- 2. Thêm cột mới
            IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'passport_borrow_requests' AND COLUMN_NAME = '${col.name}')
            BEGIN
                ALTER TABLE ${tableRef} ADD [${col.name}] ${col.type} ${defaultClause};
                -- KHÔNG tự động update tb_bak = 1 ở đây để tránh đánh dấu sai dữ liệu cũ của hệ thống mới
            END
        END
        `;
        await this.queryNewDb(query);
      }

      // Index cho sharepoint_item_id
      const idxQuery = `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pbr_sharepoint_item_id' AND object_id = OBJECT_ID('${db}.${schema}.passport_borrow_requests'))
          CREATE INDEX IX_pbr_sharepoint_item_id ON ${tableRef}(sharepoint_item_id);
      `;
      await this.queryNewDb(idxQuery);
      console.log(`[StreamPassportMigrationModel] [ensurePassportBorrowRequestsColumnsExist] OK`);
    } catch (err) {
      console.error(`[StreamPassportMigrationModel] [ensurePassportBorrowRequestsColumnsExist] ERROR: ${err.message}`);
    }
  }

  /**
   * Tạo bảng staging nếu chưa tồn tại, tự động thêm các cột cần thiết.
   */
  async ensureStagingTableExists() {
    try {
      const stagingTableRef = this.getStagingTableRef();
      console.log(`[StreamPassportMigrationModel] Checking/Creating staging table: ${stagingTableRef}`);
      const schema = this.newDbSchema || 'dbo';
      const table = this.newTableSync;

      const createQuery = `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${table}')
      BEGIN
          CREATE TABLE ${stagingTableRef} (
              [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
              [__sync_time] DATETIME2 NULL,
              [__sync_id_num] BIGINT NULL,
              [ID] BIGINT NOT NULL
          );
          CREATE UNIQUE INDEX IX_${table}_ID ON ${stagingTableRef}([ID]);
      END
      `;
      await this.queryNewDb(createQuery);

      // Danh sách các cột cần đảm bảo tồn tại
      const columnsToAdd = [
        // Metadata
        { name: 'tp_Created', type: 'NVARCHAR(500)' },
        { name: 'tp_Modified', type: 'NVARCHAR(500)' },
        { name: 'tp_Author', type: 'INT' },
        { name: 'tp_Editor', type: 'INT' },
        { name: 'tp_IsCurrent', type: 'BIT' },
        { name: 'tp_ListId', type: 'NVARCHAR(255)' },
        // User info
        { name: 'AuthorName', type: 'NVARCHAR(500)' },
        { name: 'AuthorFullName', type: 'NVARCHAR(500)' },
        { name: 'AuthorAccount', type: 'NVARCHAR(500)' },
        { name: 'AuthorEmail', type: 'NVARCHAR(500)' },
        { name: 'EditorName', type: 'NVARCHAR(500)' },
        { name: 'EditorAccount', type: 'NVARCHAR(500)' },
        // Passport borrow fields
        { name: 'nvarchar1', type: 'NVARCHAR(MAX)' },
        { name: 'nvarchar4', type: 'NVARCHAR(MAX)' },
        { name: 'nvarchar5', type: 'NVARCHAR(MAX)' },
        { name: 'datetime1', type: 'DATETIME2' },
        { name: 'datetime2', type: 'DATETIME2' },
        { name: 'datetime3', type: 'DATETIME2' },
        { name: 'datetime4', type: 'DATETIME2' },
        { name: 'datetime5', type: 'DATETIME2' },
        { name: 'datetime6', type: 'DATETIME2' },
        { name: 'datetime7', type: 'DATETIME2' },
        { name: 'datetime8', type: 'DATETIME2' },
        { name: 'ntext1',    type: 'NVARCHAR(MAX)' },
        { name: 'ntext2',    type: 'NVARCHAR(MAX)' },
        { name: 'float1',   type: 'FLOAT' },
        { name: 'float2',   type: 'FLOAT' },
        { name: 'int1',     type: 'INT' },
        { name: 'int2',     type: 'INT' },
        { name: 'tb_bak',   type: 'INT' },  // 1 = đồng bộ từ SharePoint
      ];

      for (const col of columnsToAdd) {
        const alterQuery = `
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}' AND TABLE_SCHEMA = '${schema}' AND COLUMN_NAME = '${col.name}')
        BEGIN
            ALTER TABLE ${stagingTableRef} ADD [${col.name}] ${col.type} NULL;
        END
        `;
        await this.queryNewDb(alterQuery);
      }

      console.log(`[StreamPassportMigrationModel] [ensureStagingTableExists] OK: ${stagingTableRef} is ready`);
    } catch (err) {
      console.error(`[StreamPassportMigrationModel] [ensureStagingTableExists] ERROR: ${err.message}`);
      throw err;
    }
  }

  async ensureAuditTableExists() {
    const db = this.newDbName || 'app_tancang';
    const schema = 'dbo';
    const table = 'audit';
    const tableRef = `[${db}].[${schema}].[${table}]`;

    console.log(`[StreamPassportMigrationModel] Checking/Creating Audit table: ${table}`);
    const createAuditTable = `
    IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${table}' AND TABLE_SCHEMA = '${schema}')
    BEGIN
        CREATE TABLE ${tableRef} (id bigint IDENTITY(1,1) PRIMARY KEY);
    END
    `;
    await this.queryNewDb(createAuditTable);

    const auditCols = [
      { name: 'document_id', type: 'nvarchar(64)' },
      { name: 'time', type: 'datetime', nullable: 'DEFAULT getdate()' },
      { name: 'user_id', type: 'nvarchar(64)' },
      { name: 'display_name', type: 'nvarchar(255)' },
      { name: 'role', type: 'nvarchar(64)' },
      { name: 'action_code', type: 'nvarchar(64)' },
      { name: 'from_node_id', type: 'nvarchar(128)' },
      { name: 'to_node_id', type: 'nvarchar(128)' },
      { name: 'details', type: 'nvarchar(MAX)' },
      { name: 'origin_id', type: 'nvarchar(100)' },
      { name: 'created_by', type: 'nvarchar(100)' },
      { name: 'receiver', type: 'nvarchar(100)' },
      { name: 'receiver_unit', type: 'nvarchar(100)' },
      { name: 'group_', type: 'nvarchar(100)' },
      { name: 'roleProcess', type: 'nvarchar(100)' },
      { name: 'action', type: 'nvarchar(255)' },
      { name: 'deadline', type: 'datetime' },
      { name: 'stage_status', type: 'nvarchar(100)' },
      { name: 'curStatusCode', type: 'nvarchar(64)' },
      { name: 'created_at', type: 'datetime', nullable: 'DEFAULT getdate()' },
      { name: 'updated_at', type: 'datetime', nullable: 'DEFAULT getdate()' },
      { name: 'type_document', type: 'varchar(100)' },
      { name: 'processed_by', type: 'varchar(100)' },
      { name: 'acting_as', type: 'varchar(100)' },
      { name: 'table_backups', type: 'nvarchar(255)' },
      { name: 'bpmn_version', type: 'nvarchar(100)' },
    ];

    for (const col of auditCols) {
      const query = `
      IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}' AND COLUMN_NAME = '${col.name}')
      BEGIN
          ALTER TABLE ${tableRef} ADD [${col.name}] ${col.type} ${col.nullable || 'NULL'};
      END
      `;
      await this.queryNewDb(query);
    }
    console.log(`[StreamPassportMigrationModel] [ensureAuditTableExists] OK`);
  }

  getStagingTableRef() {
    const ref = this.newDbName
      ? `${this.newDbName}.${this.newDbSchema}.${this.newTableSync}`
      : `${this.newDbSchema}.${this.newTableSync}`;
    return ref;
  }

  normalizeSyncTime(value) {
    if (!value) return DEFAULT_SYNC_TIME;
    const dateValue = new Date(value);
    if (Number.isNaN(dateValue.getTime())) return DEFAULT_SYNC_TIME;
    return dateValue.toISOString();
  }

  extractRowSyncTime(row) {
    const raw = row?.__sync_time || row?.tp_Modified || row?.tp_Created || null;
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

  async getCount(lastSyncTime, lastSyncId = 0) {
    const listIds = this.oldConfig.listIds || [];
    const listIdsStr = listIds.map(id => `'${id}'`).join(',');
    const query = `
        SELECT COUNT(*) AS total
        FROM [${this.oldDbName}].[dbo].[AllUserData] ud
        WHERE ud.[tp_ListId] IN (${listIdsStr})
        AND ud.tp_RowOrdinal = 0
        AND ud.[tp_IsCurrent] = 1
        AND ud.[tp_DeleteTransactionId] = 0x0
        AND (
            ud.[tp_Modified] > @lastSyncTime
            OR (
                ud.[tp_Modified] = @lastSyncTime
                AND ud.[tp_ID] > @lastSyncId
            )
        )
    `;
    const rows = await this.queryOldDb(query, { lastSyncTime, lastSyncId: Number(lastSyncId || 0) });
    return Number(rows?.[0]?.total || 0);
  }

  /**
   * Fetch danh sách phiếu mượn từ old DB theo cursor (tp_Modified, tp_ID).
   */
  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0, offset = 0, limit = 2000) {
    const listIds = this.oldConfig.listIds || [];
    const listIdsStr = listIds.map(id => `'${id}'`).join(',');

    const query = `
        SELECT * FROM (
            SELECT
                ud.[tp_ID]        AS ID,
                ud.[tp_Created]   AS tp_Created,
                ud.[tp_Modified]  AS tp_Modified,
                ud.[nvarchar1]    AS nvarchar1,
                ud.[nvarchar4]    AS nvarchar4,
                ud.[nvarchar5]    AS nvarchar5,
                ud.[datetime4]    AS datetime4,
                ud.[datetime6]    AS datetime6,
                ud.[datetime7]    AS datetime7,
                ud.[datetime8]    AS datetime8,
                ud.[ntext1]       AS ntext1,
                ud.[ntext2]       AS ntext2,
                ud.[float1]       AS float1,
                ud.[float2]       AS float2,
                ud.[float3]       AS float3,
                ud.[int1]         AS int1,
                ud.[int2]         AS int2,
                ud.[tp_Author]    AS tp_Author,
                ud.[tp_Editor]    AS tp_Editor,
                ud.[tp_IsCurrent] AS tp_IsCurrent,
                ud.[tp_ListId]    AS tp_ListId,
                ui_author.[tp_Title] AS AuthorName,
                ui_author.[tp_Title] AS AuthorFullName,
                ui_author.[tp_Login] AS AuthorAccount,
                ui_author.[tp_Email] AS AuthorEmail,
                ui_editor.[tp_Title] AS EditorName,
                ui_editor.[tp_Login] AS EditorAccount,

                -- Sync Tracking
                ud.[tp_Modified]  AS __sync_time,
                ud.[tp_ID]        AS __sync_id_num,
                ROW_NUMBER() OVER (ORDER BY ud.[tp_Modified] ASC, ud.[tp_ID] ASC) AS __page_rn

            FROM [${this.oldDbName}].[dbo].[AllUserData] ud
            LEFT JOIN [${this.oldUserDb}].[dbo].[UserInfo] ui_author
                ON ud.[tp_Author] = ui_author.[tp_ID]
            LEFT JOIN [${this.oldUserDb}].[dbo].[UserInfo] ui_editor
                ON ud.[tp_Editor] = ui_editor.[tp_ID]
            WHERE ud.[tp_ListId] IN (${listIdsStr})
              AND ud.[tp_IsCurrent] = 1
              AND ud.[tp_DeleteTransactionId] = 0x0
              AND (
                  @lastSyncTime = '1970-01-01T00:00:00.000Z'
                  OR ud.[tp_Modified] > @lastSyncTime
                  OR (
                      ud.[tp_Modified] = @lastSyncTime
                      AND ud.[tp_ID] > @lastSyncId
                  )
              )
        ) AS t
        WHERE __page_rn > @offset AND __page_rn <= (@offset + @limit)
        ORDER BY __page_rn;
    `;

    const rows = await this.queryOldDb(query, { 
      lastSyncTime, 
      lastSyncId: Number(lastSyncId || 0),
      offset: Number(offset || 0),
      limit: Number(limit || 2000)
    });
    console.log(`[StreamPassportMigrationModel] Fetched ${rows.length} rows from old DB`);
    return rows;
  }

  /**
   * Lưu dữ liệu từ old DB vào staging table (upsert).
   */
  async syncOldToStaging(rows, { transaction } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return { stagedCount: 0 };
    console.log(`[StreamPassportMigrationModel] Staging ${rows.length} rows to ${this.newTableSync}...`);
    const internalColumns = new Set(['__sync_time', '__sync_id_num']);
    const keyColumn = 'ID';
    const stagingTableRef = this.getStagingTableRef();

    for (const row of rows) {
      // Inject tb_bak = 1 để đánh dấu record đến từ SharePoint
      row.tb_bak = 1;

      const columns = Object.keys(row).filter(c => !internalColumns.has(c));
      const params = {};
      for (const column of columns) {
        params[column] = row[column] !== undefined ? row[column] : null;
      }
      params.__sync_time = row.__sync_time;
      params.__sync_id_num = row.__sync_id_num;
      const updateSet = columns.filter(c => c !== keyColumn).map(c => `[${c}] = @${c}`).join(', ');
      const query = `
      IF EXISTS (SELECT 1 FROM ${stagingTableRef} WHERE [${keyColumn}] = @${keyColumn})
      BEGIN
          UPDATE ${stagingTableRef} SET ${updateSet}, __sync_time = @__sync_time, __sync_id_num = @__sync_id_num WHERE [${keyColumn}] = @${keyColumn}
      END
      ELSE
      BEGIN
          INSERT INTO ${stagingTableRef} (${columns.map(c => `[${c}]`).join(',')}, __sync_time, __sync_id_num)
          VALUES (${columns.map(c => `@${c}`).join(',')}, @__sync_time, @__sync_id_num)
      END
      `;
      await this.queryNewDbTx(query, params, transaction);
    }
    console.log(`[StreamPassportMigrationModel] Staging complete for ${rows.length} rows`);
    return { stagedCount: rows.length };
  }

  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    if (!syncJobId) throw new Error('syncJobId is required');
    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);

    const totalCount = await this.getCount(normalizedLastSyncTime, normalizedLastSyncId);
    console.log(`[StreamPassportMigrationModel] Total records to sync: ${totalCount}`);

    // Cập nhật Dashboard ngay lập tức
    await this.queryNewDb(`UPDATE sync_jobs SET total_to_sync = @total WHERE job_id = @jobId`, {
      total: totalCount,
      jobId: syncJobId
    });

    const fetchBatchSize = Number(process.env.STAGING_FETCH_BATCH_SIZE || 2000);
    const numIterations = Math.ceil(totalCount / fetchBatchSize);

    let totalStagedCount = 0;
    let nextSyncTime = normalizedLastSyncTime;
    let nextSyncId = normalizedLastSyncId;

    for (let i = 0; i < numIterations; i++) {
        const offset = i * fetchBatchSize;
        logger.info(`[StreamPassportMigrationModel] Fetching batch ${i + 1}/${numIterations} (Offset: ${offset}, Limit: ${fetchBatchSize})`);
        
        const rows = await this.fetchListFromOldDb(normalizedLastSyncTime, normalizedLastSyncId, offset, fetchBatchSize);
        if (!rows || rows.length === 0) break;

        const stageResult = await this.syncOldToStaging(rows);
        totalStagedCount += Number(stageResult?.stagedCount || rows.length || 0);

        // Cập nhật cursor và LOG chi tiết từng bản ghi
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
        logger.info(`🔥 [StreamPassportMigrationModel] Batch ${i + 1}/${numIterations} staged: ${totalStagedCount}/${totalCount}. LastSyncTime: ${nextSyncTime}, LastSyncId: ${nextSyncId}`);
    }

    return { 
        syncJobId, 
        rows: [], 
        totalCount: totalCount, 
        stagedCount: totalStagedCount,
        lastSyncTime: nextSyncTime, 
        lastSyncId: nextSyncId 
    };
  }

  async getSyncJobState(syncJobId) {
    const rows = await this.queryNewDb(`SELECT TOP 1 * FROM sync_jobs WHERE job_id = @syncJobId`, { syncJobId });
    return rows?.[0] || null;
  }

  async fetchOneFromStaging({ lastSyncTime, lastSyncId }) {
    const tableRef = this.getStagingTableRef();
    const query = `
        SELECT TOP 1 *
        FROM ${tableRef}
        WHERE (
            @lastSyncTime = '2100-01-01T00:00:00.000Z'
            OR [__sync_time] < @lastSyncTime
            OR ([__sync_time] = @lastSyncTime AND [ID] < @lastSyncId)
        )
        ORDER BY [__sync_time] DESC, [ID] DESC
    `;
    const rows = await this.queryNewDb(query, {
        lastSyncTime,
        lastSyncId: Number(lastSyncId || 0)
    });
    return rows?.[0] || null;
  }

  async processOne(syncJobId) {
    if (!syncJobId) throw new Error('syncJobId is required');
    const state = await this.getSyncJobState(syncJobId);
    const lastSyncTime = this.normalizeSyncTime(state?.last_sync_time);
    const lastSyncId = Number(state?.last_sync_id || 0);

    const stagingTableRef = this.getStagingTableRef();
    
    // Đếm tổng số bản ghi trong staging để log progress
    const totalStagingRows = await this.queryNewDb(`SELECT COUNT(*) as total FROM ${stagingTableRef}`);
    const total = Number(totalStagingRows?.[0]?.total || 0);
    const current = Number(state?.total_processed || 0) + 1;

    // [STAGING FIRST] Lấy bản ghi tiếp theo từ staging
    const row = await this.fetchOneFromStaging({ lastSyncTime, lastSyncId });
    if (!row) {
        console.log(`[StreamPassportMigrationModel] [processOne] No more records in staging for job ${syncJobId}. (Processed: ${state?.total_processed || 0}/${total})`);
        return { backupId: null, affected: 0, done: true };
    }

    const backupId = String(row.ID);
    console.log(`[StreamPassportMigrationModel] [processOne] [${current}/${total}] Processing record ID=${backupId}, SyncTime=${row.__sync_time}`);

    const startTime = Date.now();
    await this.processRowData(row);
    const duration = Date.now() - startTime;

    const nextSyncTime = this.extractRowSyncTime(row);
    const nextSyncId   = this.extractRowSyncId(row);

    // ✅ Cập nhật cursor trong sync_jobs để lần sau không lấy lại bản ghi này
    await this.queryNewDb(
      `UPDATE sync_jobs
       SET total_processed = ISNULL(total_processed, 0) + 1,
           total_success   = ISNULL(total_success, 0) + 1,
           last_sync_time  = @lastSyncTime,
           last_sync_id    = @lastSyncId
       WHERE job_id = @syncJobId`,
      { syncJobId, lastSyncTime: nextSyncTime, lastSyncId: nextSyncId }
    );

    console.log(`[StreamPassportMigrationModel] [processOne] Done ID=${backupId} in ${duration}ms. Next cursor: ${nextSyncTime} / ${nextSyncId}`);
    return { syncJobId, processed: true, done: false, current, total };
  }

  /**
   * Xử lý một row dữ liệu từ old DB và upsert vào bảng passport_borrow_requests.
   */
  async processRowData(rowData, { transaction } = {}) {
    if (!rowData?.ID) throw new Error('ID is required');

    const recordId = String(rowData.ID);
    console.log(`[StreamPassportMigrationModel] processRowData: recordId=${recordId}`);
    const { externalKey } = this.oldConfig;

    // 1. Resolve người tạo phiếu (requester) từ thông tin Author
    let requesterId = await this.helper.robustUserResolver(rowData, transaction);
    console.log(`[StreamPassportMigrationModel] [recordId=${recordId}] Resolved Requester: ${requesterId || 'FALLBACK'}`);

    // Update roles_by_process & Group for the requester
    if (requesterId) {
      await this._ensureUserHasRoles(requesterId, transaction);
      await this._ensureUserInGroup(requesterId, transaction);
    }

    // 2. Map trạng thái từ hệ thống cũ sang hệ thống mới
    const mappedStatus = mapStatus(rowData.nvarchar4);
    
    // 3. Chuẩn bị dữ liệu - các field bắt buộc có fallback để không bao giờ bỏ qua bản ghi
    const FALLBACK_USER = process.env.VANTHU_USER_ID || 'eac9bcb6-efcd-4b23-a656-dd351037a138';
    rowData.requester_id = requesterId || FALLBACK_USER;
    rowData.created_by   = requesterId || FALLBACK_USER;
    rowData.status       = mappedStatus || 'Chờ phê duyệt';
    rowData.request_code = rowData.nvarchar1 || `HC-SYNC-${recordId}`;
    rowData.name_passport_request = rowData.AuthorFullName || rowData.AuthorName || 'Chưa xác định (Sync)';
    rowData.type_request = 'user';

    // 4. Xử lý ngày tháng — fallback về today nếu không có ngày mượn
    rowData.borrow_date    = parseDate(rowData.datetime4) || parseDate(rowData.tp_Created) || new Date();
    rowData.return_date    = parseDate(rowData.datetime7) || null;
    rowData.departure_date = parseDate(rowData.datetime6) || null;
    rowData.arrival_date   = parseDate(rowData.datetime8) || null;

    // 5. Ý kiến/ghi chú
    rowData.note = rowData.ntext1 || null;

    // 6. Lý do phê duyệt/từ chối/hủy từ nvarchar5
    const actionReason = rowData.nvarchar5 || null;
    if (mappedStatus === 'REJECTED' && actionReason) {
      rowData.reject_reason = actionReason;
    } else if (mappedStatus === 'CANCELLED' && actionReason) {
      rowData.cancel_reason = actionReason;
    } else if (mappedStatus === 'COMPLETED' && actionReason) {
      rowData.approval_reason = actionReason;
    }

    console.log(`[StreamPassportMigrationModel] [recordId=${recordId}] Data Prepared: Code=${rowData.request_code}, Status=${rowData.status}, BorrowDate=${rowData.borrow_date.toISOString()}`);

    // 7. Upsert vào bảng mới
    const result = await this.upsertPassportBorrowRequest(rowData, externalKey, recordId, transaction);
    
    // 8. Tạo audit trail mặc định
    if (result.id) {
      await this.createDefaultAuditForPassport(result.id, requesterId, mappedStatus, transaction);
    }

    return {
      backupId: recordId,
      affected: result.affected,
      logs: [{ table: this.oldConfig.newTable, action: result.action }]
    };
  }

  /**
   * Upsert vào bảng passport_borrow_requests theo external key (sharepoint_item_id).
   */
  async upsertPassportBorrowRequest(rawData, externalKeyField, externalKeyValue, transaction) {
    const db = this.newDbName || 'app_tancang';
    const schema = this.newDbSchema || 'dbo';
    const tableRef = `[${db}].[${schema}].[passport_borrow_requests]`;

    // Lấy danh sách cột thực tế trong bảng
    const existingCols = await this.getExistingColumns('passport_borrow_requests', schema);
    console.log(`[StreamPassportMigrationModel] upsertPassportBorrowRequest: table=passport_borrow_requests, externalKeyValue=${externalKeyValue}`);

    const params = {};
    const insertCols = [];
    const insertVals = [];
    const updateSet = [];

    // Sinh UUID mới cho id
    if (existingCols.has('id')) {
      params['id'] = uuidv4();
      insertCols.push('[id]');
      insertVals.push('@id');
      // Không update id
    }

    /**
     * Danh sách field mapping: { newField: value }
     * Chỉ insert/update các field tồn tại trong bảng.
     */
    const fieldValues = {
      request_code:           rawData.request_code,
      type_request:           rawData.type_request || 'user',
      requester_id:           rawData.requester_id,
      name_passport_request:  rawData.name_passport_request,
      borrow_date:            rawData.borrow_date,
      return_date:            rawData.return_date,
      departure_date:         rawData.departure_date,
      arrival_date:           rawData.arrival_date,
      status:                 rawData.status,
      note:                   rawData.note,
      approval_reason:        rawData.approval_reason || null,
      reject_reason:          rawData.reject_reason || null,
      cancel_reason:          rawData.cancel_reason || null,
      is_deleted:             0,
      is_specific_departure_date: rawData.departure_date ? 1 : 0,
      created_by:             rawData.created_by,
      updated_by:             rawData.created_by,
      created_at:             parseDate(rawData.tp_Created) || new Date(),
      updated_at:             parseDate(rawData.tp_Modified) || new Date(),
      sharepoint_item_id:     externalKeyValue,
      tb_bak:                 1,  // 1 = đồng bộ từ SharePoint
    };

    for (const [field, value] of Object.entries(fieldValues)) {
      if (!existingCols.has(field.toLowerCase())) continue;
      // Chỉ bỏ qua nếu giá trị là undefined (chưa khai báo), null là giá trị hợp lệ cho các cột nullable
      if (value === undefined) continue;
      params[field] = value;
      insertCols.push(`[${field}]`);
      insertVals.push(`@${field}`);
      // Không update id và created_at
      if (field.toLowerCase() !== 'id' && field.toLowerCase() !== 'created_at') {
        updateSet.push(`[${field}] = @${field}`);
      }
    }

    params._externalKeyValue = externalKeyValue;

    const query = `
      DECLARE @OutputTable TABLE (id NVARCHAR(255));
      DECLARE @affected INT;

      IF EXISTS (SELECT 1 FROM ${tableRef} WHERE [${externalKeyField}] = @_externalKeyValue)
      BEGIN
          UPDATE ${tableRef} SET ${updateSet.length ? updateSet.join(', ') : `${externalKeyField} = ${externalKeyField}`}
          OUTPUT INSERTED.id INTO @OutputTable
          WHERE [${externalKeyField}] = @_externalKeyValue;

          SELECT @affected = @@ROWCOUNT;
          SELECT (SELECT TOP 1 id FROM @OutputTable) AS id, @affected AS affected, 'updated' AS action;
      END
      ELSE
      BEGIN
          INSERT INTO ${tableRef} (${insertCols.join(', ')})
          OUTPUT INSERTED.id INTO @OutputTable
          VALUES (${insertVals.join(', ')});

          SELECT @affected = @@ROWCOUNT;
          SELECT (SELECT TOP 1 id FROM @OutputTable) AS id, @affected AS affected, 'inserted' AS action;
      END
    `;

    const result = await this.queryNewDbTx(query, params, transaction);
    const row = Array.isArray(result) ? result[0] : result;
    console.log(`[StreamPassportMigrationModel] upsertPassportBorrowRequest result: action=${row?.action}, affected=${row?.affected}`);
    return { id: row?.id || null, action: row?.action || 'none', affected: Number(row?.affected || 0) };
  }

  /**
   * Tạo audit trail mặc định cho phiếu mượn hộ chiếu sau khi migrate. Đã cập nhật khớp mẫu chuẩn: type=PASSPORT_REQUEST.
   */
  async createDefaultAuditForPassport(requestId, requesterId, status, transaction = null) {
    const db = this.newDbName || 'app_tancang';
    const auditTable = `[${db}].[dbo].[audit]`;
    const creatorId = requesterId || 'SYSTEM_MIGRATION';
    const typeDoc = 'PASSPORT_REQUEST';

    // 1. Bước CREATE (Luôn có)
    const createActionLabel = N('Tạo phiếu mượn hộ chiếu');
    const stageStatus = (status === 'COMPLETED' || status === 'IN_USE') ? 'DA_XU_LY' : 'CHUA_XU_LY';
    
    const insertCreateQuery = `
      IF NOT EXISTS (
          SELECT 1 FROM ${auditTable}
          WHERE document_id = @requestId
            AND action_code = 'CREATE'
            AND type_document = @typeDoc
      )
      BEGIN
          INSERT INTO ${auditTable}
          (
            document_id, [time], user_id, display_name, [role], action_code,
            from_node_id, to_node_id, details, origin_id, created_by,
            receiver, roleProcess, [action], stage_status,
            curStatusCode, type_document, bpmn_version, created_at, updated_at
          )
          VALUES
          (
            @requestId, SYSUTCDATETIME(), @creatorId, N'Người tạo phiếu',
            'NGUOI_TAO_PHIEU', 'CREATE',
            'StartEvent_1', 'Gateway_0rbwxs6',
            N'${JSON.stringify({ transferType: 'migration', source: 'sharepoint' }).replace(/'/g, "''")}',
            'migration_origin',
            @creatorId, @creatorId, 'NGUOI_TAO_PHIEU',
            @createActionLabel,
            @stageStatus, '1', @typeDoc, 'QT_MTHC',
            SYSUTCDATETIME(), SYSUTCDATETIME()
          );
      END
    `;

    try {
      await this.queryNewDbTx(insertCreateQuery, {
        requestId, creatorId, createActionLabel, stageStatus, typeDoc
      }, transaction);

      // 2. Bước kết quả (Nếu đã COMPLETED, REJECTED, CANCELLED...)
      const finalStates = ['COMPLETED', 'IN_USE', 'REJECTED', 'CANCELLED'];
      if (finalStates.includes(status)) {
        let actionCode = 'APPROVE';
        let actionLabel = N('Phê duyệt');
        let fromNode = 'Gateway_0rbwxs6';
        let toNode = 'Gateway_0fkk071';

        if (status === 'REJECTED') {
          actionCode = 'REJECT';
          actionLabel = N('Từ chối');
          toNode = 'Gateway_0rbwxs6'; // REJECT thường quay lại chính node đó hoặc trả về
        } else if (status === 'CANCELLED') {
          actionCode = 'CANCEL';
          actionLabel = N('Hủy phiếu');
          toNode = 'EndEvent_1';
        }

        const insertFinalQuery = `
          IF NOT EXISTS (
              SELECT 1 FROM ${auditTable}
              WHERE document_id = @requestId
                AND action_code = @actionCode
                AND type_document = @typeDoc
          )
          BEGIN
              INSERT INTO ${auditTable}
              (
                document_id, [time], user_id, display_name, [role], action_code,
                from_node_id, to_node_id, details, origin_id, created_by,
                receiver, roleProcess, [action], stage_status,
                curStatusCode, type_document, bpmn_version, created_at, updated_at
              )
              VALUES
              (
                @requestId, DATEADD(SECOND, 5, SYSUTCDATETIME()), @creatorId, N'Người phê duyệt',
                'CHI_HUY_DON_VI', @actionCode,
                @fromNode, @toNode,
                null, 'migration_origin',
                @creatorId, @creatorId, 'CHI_HUY_DON_VI',
                @actionLabel,
                'DA_XU_LY', @actionCode, @typeDoc, 'QT_MTHC',
                DATEADD(SECOND, 5, SYSUTCDATETIME()), DATEADD(SECOND, 5, SYSUTCDATETIME())
              );
          END
        `;
        await this.queryNewDbTx(insertFinalQuery, {
          requestId, creatorId, actionLabel, actionCode, fromNode, toNode, typeDoc
        }, transaction);
      }
    } catch (err) {
      console.error(`[StreamPassportMigrationModel] createDefaultAuditForPassport ERROR: ${err.message}`);
    }
  }

  /**
   * Lấy danh sách cột hiện có trong bảng (case-insensitive).
   */
  async getExistingColumns(tableName, schema = 'dbo') {
    const query = `
      SELECT COLUMN_NAME, DATA_TYPE
      FROM [${this.newDbName}].INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @tableName AND TABLE_SCHEMA = @schema
    `;
    const result = await this.queryNewDb(query, { tableName, schema });
    const colMap = new Map();
    result.forEach(r => colMap.set(r.COLUMN_NAME.toLowerCase(), r.DATA_TYPE.toLowerCase()));
    return colMap;
  }

  /**
   * Đảm bảo User có đủ các quyền quy trình cần thiết.
   * Merge quyền mới vào quyền cũ nếu chưa có.
   */
  async _ensureUserHasRoles(userId, transaction = null) {
    if (!userId || !this.requiredRoles) return;
    try {
      const db = this.newDbName || process.env.NEW_DB_NAME;
      const q = `SELECT TOP 1 roles_by_process FROM [${db}].[dbo].[users] WHERE id = @id`;
      const rows = await this.queryNewDbTx(q, { id: userId }, transaction);
      if (!rows || rows.length === 0) return;

      const currentRolesStr = rows[0].roles_by_process;
      const newRoles = this.requiredRoles;

      if (!currentRolesStr || currentRolesStr.trim() === '' || currentRolesStr.trim() === '[]') {
        const updateQ = `UPDATE [${db}].[dbo].[users] SET roles_by_process = @roles WHERE id = @id`;
        await this.queryNewDbTx(updateQ, { id: userId, roles: JSON.stringify(newRoles) }, transaction);
        console.log(`[StreamPassportMigrationModel] Cấp mới roles_by_process cho userId=${userId}`);
        return;
      }

      const existingRolesArr = JSON.parse(currentRolesStr);
      if (!Array.isArray(existingRolesArr)) return;

      const roleMap = new Map();
      existingRolesArr.forEach(item => {
        if (item && item.processKey) roleMap.set(item.processKey, item);
      });

      let changed = false;
      newRoles.forEach(newItem => {
        if (newItem && newItem.processKey && !roleMap.has(newItem.processKey)) {
          roleMap.set(newItem.processKey, newItem);
          changed = true;
        }
      });

      if (changed) {
        const mergedRolesStr = JSON.stringify(Array.from(roleMap.values()));
        const updateQ = `UPDATE [${db}].[dbo].[users] SET roles_by_process = @roles WHERE id = @id`;
        await this.queryNewDbTx(updateQ, { id: userId, roles: mergedRolesStr }, transaction);
        console.log(`[StreamPassportMigrationModel] Đã merge bổ sung roles_by_process cho userId=${userId}`);
      }
    } catch (e) {
      console.error(`[StreamPassportMigrationModel] Lỗi khi merge roles_by_process cho userId=${userId}: ${e.message}`);
    }
  }

  /**
   * Gán User vào nhóm cố định (group_user_id = 'b59238b0-6de2-4bda-87ac-f62ccab182bf').
   */
  async _ensureUserInGroup(userId, transaction = null) {
    if (!userId) return;
    try {
      const db = this.newDbName || process.env.NEW_DB_NAME;
      const groupUserId = 'b59238b0-6de2-4bda-87ac-f62ccab182bf';
      
      const checkQ = `SELECT 1 FROM [${db}].[dbo].[user_group_users] WHERE user_id = @userId AND group_user_id = @groupUserId`;
      const rows = await this.queryNewDbTx(checkQ, { userId, groupUserId }, transaction);
      
      if (!rows || rows.length === 0) {
        const insertQ = `INSERT INTO [${db}].[dbo].[user_group_users] (user_id, group_user_id) VALUES (@userId, @groupUserId)`;
        await this.queryNewDbTx(insertQ, { userId, groupUserId }, transaction);
        console.log(`[StreamPassportMigrationModel] Assigned userId=${userId} to group=${groupUserId}`);
      }
    } catch (err) {
      console.error(`[StreamPassportMigrationModel] _ensureUserInGroup ERROR: ${err.message}`);
    }
  }
}

// Helper: wrap string in N'' for nvarchar (only used in template literals)
function N(str) { return str; }

module.exports = StreamPassportMigrationModel;
