const MigrationHelper = require('../../helpers/MigrationHelper');
const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const { tableMappings } = require('./config');
const { ensureTrackingColumns } = require('../../helpers/StagingQueueHelper');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class StreamEventMigrationModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_EVENT_MIGRATION' });

    // Config bảng cũ
    this.oldConfig = tableMappings.event;

    this.oldDbName = this.oldConfig.oldDatabase;
    this.oldDbSchema = this.oldConfig.oldSchema;
    this.oldDbTable = this.oldConfig.oldTable;
    this.oldUserDb = this.oldConfig.oldUserDatabase || 'WSS_Content_eoffice';

    // Bảng staging tạm thời
    this.newDbName = this.oldConfig.newDatabase || 'camunda';
    this.newDbSchema = this.oldConfig.newSchema || 'dbo';
    this.newTableSync = 'event_sync_staging';
    this.helper = new MigrationHelper(this.queryNewDbTx.bind(this), this.queryOldDb.bind(this));

    this.sourceSchema = {
        allUserData: new Set(),
        codeItem: new Set(),
        hasUserInfo: false
    };
  }

  async cacheSourceSchema() {
      try {
          this.sourceSchema.allUserData = await this.helper.getExistingColumnsSource(this.oldDbName, 'AllUserData');
          this.sourceSchema.codeItem = await this.helper.getExistingColumnsSource('DataEOfficeSNP', 'CodeItem', 'SNP');
          this.sourceSchema.hasUserInfo = await this.helper.checkTableExistsSource(this.oldUserDb, 'UserInfo');

          console.log(`[StreamEventMigrationModel] Source Schema Cached:
            AllUserData: ${this.sourceSchema.allUserData.size} columns,
            CodeItem: ${this.sourceSchema.codeItem.size} columns,
            UserInfo exists: ${this.sourceSchema.hasUserInfo}`);
      } catch (err) {
          console.warn(`[StreamEventMigrationModel] cacheSourceSchema Error: ${err.message}`);
      }
  }

  async initialize() {
    console.log(`[StreamEventMigrationModel] Initializing...`);
    await super.initialize();

    // 🔥 Cache Source Schema to prevent "Invalid column name" errors
    await this.cacheSourceSchema();

    await this.ensureStagingTableExists();
    await this.ensureTargetColumnsExist();
    console.log(`[StreamEventMigrationModel] Initialization complete.`);
  }

  async ensureTargetColumnsExist() {
    try {
      const table = this.oldConfig.newTable;
      const schema = this.newDbSchema || 'dbo';
      const fullTableRef = `[${this.newDbName}].[${schema}].[${table}]`;

      console.log(`[StreamEventMigrationModel] Checking/Adding missing columns to ${fullTableRef}...`);

      // Check if table exists first
      const tableCheck = await this.queryNewDb(`SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${table}'`);
      if (!tableCheck || tableCheck.length === 0) {
        console.warn(`[StreamEventMigrationModel] Target table ${table} not found. Skipping column ensure.`);
        return;
      }

      const columnsToCheck = [
        { name: '[type]', type: 'NVARCHAR(255)' },
        { name: 'location', type: 'NVARCHAR(500)' },
        { name: 'participants', type: 'NVARCHAR(MAX)' },
        { name: 'description', type: 'NVARCHAR(MAX)' },
        { name: 'table_bak', type: 'INT' },
        { name: 'id_sp_bak', type: 'NVARCHAR(255)' }
      ];

      for (const col of columnsToCheck) {
        const query = `
          IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}' AND COLUMN_NAME = '${col.name.replace('[', '').replace(']', '')}')
          BEGIN
              ALTER TABLE ${fullTableRef} ADD ${col.name} ${col.type} NULL;
          END
        `;
        await this.queryNewDb(query);
      }

      // Đảm bảo có Index cho id_sp_bak
      const indexQuery = `
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_${table}_id_sp_bak')
        BEGIN
            CREATE INDEX IX_${table}_id_sp_bak ON ${fullTableRef}(id_sp_bak);
        END
      `;
      await this.queryNewDb(indexQuery);

      console.log(`[StreamEventMigrationModel] [ensureTargetColumnsExist] OK: All columns checked for ${table}`);
    } catch (err) {
      console.error(`[StreamEventMigrationModel] [ensureTargetColumnsExist] ERROR: ${err.message}`);
    }
  }

  async ensureStagingTableExists() {
    try {
      const stagingTableRef = this.getStagingTableRef();
      console.log(`[StreamEventMigrationModel] Checking/Creating staging table: ${stagingTableRef}`);
      const schema = this.newDbSchema || 'dbo';
      const table = this.newTableSync;

      // 1. Tạo bảng cơ bản nếu chưa có
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

      // 2. Danh sách các cột cần đảm bảo
      const columnsToAdd = [
          { name: 'ListName', type: 'NVARCHAR(500)' },
          { name: 'tp_Created', type: 'NVARCHAR(500)' },
          { name: 'tp_Modified', type: 'NVARCHAR(500)' },
          { name: 'AuthorName', type: 'NVARCHAR(500)' },
          { name: 'AuthorAccount', type: 'NVARCHAR(500)' },
          { name: 'AuthorEmail', type: 'NVARCHAR(500)' },
          { name: 'EditorName', type: 'NVARCHAR(500)' },
          { name: 'EditorAccount', type: 'NVARCHAR(500)' },
          { name: 'Title', type: 'NVARCHAR(MAX)' },
          { name: 'StartDate', type: 'NVARCHAR(500)' },
          { name: 'EndDate', type: 'NVARCHAR(500)' },
          { name: 'Location', type: 'NVARCHAR(MAX)' },
          { name: 'Description', type: 'NVARCHAR(MAX)' },
          { name: 'Organizer', type: 'NVARCHAR(500)' },

          { name: 'CreatedDate', type: 'NVARCHAR(500)' },
          { name: 'ModifiedDate', type: 'NVARCHAR(500)' },
          { name: 'DocumentID', type: 'BIGINT' },
          { name: 'DocumentTitle', type: 'NVARCHAR(MAX)' },
          { name: 'DocumentSubject', type: 'NVARCHAR(MAX)' },
          { name: 'LoaiVanBan', type: 'NVARCHAR(500)' },

          { name: 'DepartmentId', type: 'NVARCHAR(500)' },
          { name: 'DocumentStatus', type: 'NVARCHAR(500)' },
          { name: 'DocumentStatusText', type: 'NVARCHAR(MAX)' },
          { name: 'DocumentWorkflowId', type: 'NVARCHAR(500)' },
          { name: 'DocumentApprover', type: 'NVARCHAR(500)' },
          { name: 'DocumentApprovedDate', type: 'NVARCHAR(500)' },
          { name: 'DocumentSubmitDate', type: 'NVARCHAR(500)' },
          { name: 'DocumentStep', type: 'NVARCHAR(500)' },
          { name: 'DocumentDocumentId', type: 'NVARCHAR(500)' },
          { name: 'DocumentUpdating', type: 'NVARCHAR(500)' },
          { name: 'DocumentCreatedDate', type: 'NVARCHAR(500)' },
          { name: 'DocumentCreatedBy', type: 'NVARCHAR(500)' },
          { name: 'DocumentModified', type: 'NVARCHAR(500)' },
          { name: 'DocumentModifiedBy', type: 'NVARCHAR(500)' },
          { name: 'LinkedItemID', type: 'NVARCHAR(500)' },
          { name: 'DocumentSiteName', type: 'NVARCHAR(500)' },
          { name: 'Content', type: 'NVARCHAR(MAX)' },
          { name: 'DonViChuTri', type: 'NVARCHAR(1000)' },
          { name: 'SoVanBanDi', type: 'NVARCHAR(500)' },
          { name: 'IssuedDate', type: 'NVARCHAR(500)' },
          { name: 'IsNAS', type: 'BIT' },
          { name: 'NAS_MESS', type: 'NVARCHAR(MAX)' },
          { name: 'SoKH', type: 'NVARCHAR(500)' },
          { name: 'DonViSoanThao', type: 'NVARCHAR(1000)' },
          { name: 'NgayKyKH', type: 'NVARCHAR(500)' },
          { name: 'GoiDuAn', type: 'NVARCHAR(MAX)' },
          { name: 'GoiDuAn1', type: 'NVARCHAR(MAX)' },
          { name: 'GoiDauTu', type: 'NVARCHAR(MAX)' },
          { name: 'HubPackageId', type: 'NVARCHAR(500)' },
          { name: 'IsHubSendOut', type: 'BIT' },
          { name: 'ChildId', type: 'NVARCHAR(500)' },
          { name: 'IsDaKy', type: 'BIT' },
          { name: 'IsDaIn', type: 'BIT' },
          { name: 'StampWithKey', type: 'NVARCHAR(500)' },
          { name: 'Locker', type: 'NVARCHAR(500)' },
          { name: 'TaskId', type: 'NVARCHAR(500)' },
          { name: 'CBNV', type: 'NVARCHAR(1000)' },
          { name: 'ChenSo', type: 'NVARCHAR(500)' },
          { name: 'DongMoc', type: 'NVARCHAR(500)' },
          { name: 'IsArchived', type: 'BIT' },
          { name: 'IsConverting', type: 'BIT' },
          { name: 'ConvertedDate', type: 'NVARCHAR(500)' },
          { name: 'ActionStatus', type: 'NVARCHAR(500)' },
          { name: 'EndLoop', type: 'BIT' },
          { name: 'IsKyQuyChe', type: 'BIT' },
          { name: 'KyHaiLien', type: 'BIT' },
          { name: 'ReccurencyType', type: 'NVARCHAR(500)' },
          { name: 'LoaiBanHanh', type: 'NVARCHAR(500)' },
          { name: 'LoaiMoc', type: 'NVARCHAR(500)' },
          { name: 'NgayDanTau', type: 'NVARCHAR(500)' },
          { name: 'ParentId', type: 'NVARCHAR(500)' },
          { name: 'PreviousStep', type: 'NVARCHAR(500)' },
          { name: 'Price', type: 'NVARCHAR(500)' },
          { name: 'SoVanBanDi', type: 'NVARCHAR(500)' },
          { name: 'SoVanBanNum', type: 'NVARCHAR(500)' },
          { name: 'ThamQuyen', type: 'NVARCHAR(MAX)' },
          { name: 'VBBiThayThe', type: 'NVARCHAR(MAX)' },
          { name: 'YKien', type: 'NVARCHAR(MAX)' },
          { name: 'SPListId', type: 'NVARCHAR(500)' },
          { name: 'SPListName', type: 'NVARCHAR(500)' },
          { name: 'ResourceFormId', type: 'NVARCHAR(500)' },
          { name: 'AssignedToText', type: 'NVARCHAR(MAX)' },
          { name: 'ApproverByStep', type: 'NVARCHAR(MAX)' },
          { name: 'Name', type: 'NVARCHAR(MAX)' }
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

      await ensureTrackingColumns(this, {
        tableRef: stagingTableRef,
        tableName: table,
        schemaName: schema,
        dbName: this.newDbName,
        label: this.modelName,
      });

      console.log(`[StreamEventMigrationModel] [ensureStagingTableExists] OK: ${stagingTableRef} is ready`);
    } catch (err) {
      console.error(`[StreamEventMigrationModel] [ensureStagingTableExists] ERROR: ${err.message}`);
      throw err;
    }
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
    const raw = row?.__sync_time || row?.Modified || row?.Created || null;
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
    const listIds = this.oldConfig.listIds || [];
    const listIdsStr = listIds.map(id => `'${id}'`).join(',');
    const completedLimit = process.env.COMPLETED_LIMIT || 10000;
    const beginLimit = process.env.BEGIN_LIMIT || 0;

    const cols = this.sourceSchema;

    const udSelect = [
        `l.[tp_Title]            AS ListName`,
        `ud.[tp_ID]              AS ID`,
        `ud.[tp_Created]         AS CreatedDate`,
        `ud.[tp_Modified]        AS ModifiedDate`,
        `ud.[tp_Created]         AS tp_Created`,
        `ud.[tp_Modified]        AS tp_Modified`,
        cols.hasUserInfo ? `ui_author.[tp_Title]    AS AuthorName` : `NULL AS AuthorName`,
        cols.hasUserInfo ? `ui_author.[tp_Login]    AS AuthorAccount` : `NULL AS AuthorAccount`,
        cols.hasUserInfo ? `ui_author.[tp_Email]    AS AuthorEmail` : `NULL AS AuthorEmail`,

        cols.hasUserInfo ? `ui_editor.[tp_Title]    AS EditorName` : `NULL AS EditorName`,
        cols.hasUserInfo ? `ui_editor.[tp_Login]    AS EditorAccount` : `NULL AS EditorAccount`,
        cols.allUserData.has('nvarchar1') ? `ud.[nvarchar1] AS Title` : `NULL AS Title`,
        cols.allUserData.has('datetime1') ? `ud.[datetime1] AS StartDate` : `NULL AS StartDate`,
        cols.allUserData.has('datetime2') ? `ud.[datetime2] AS EndDate` : `NULL AS EndDate`,
        cols.allUserData.has('nvarchar2') ? `ud.[nvarchar2] AS Location` : `NULL AS Location`,
        cols.allUserData.has('nvarchar3') ? `ud.[nvarchar3] AS Description` : `NULL AS Description`,
        cols.allUserData.has('nvarchar4') ? `ud.[nvarchar4] AS Organizer` : `NULL AS Organizer`
    ];

    const ciColumns = [
        'ID', 'Title', 'Subject', 'LoaiVanBan', 'DepartmentId', 'Status', 'StatusText',
        'WorkflowId', 'Approver', 'ApprovedDate', 'Created', 'CreatedBy', 'Modified',
        'ModifiedBy', 'SPItemId', 'SPListId', 'SubmitDate', 'Step', 'DocumentId',
        'Updating', 'Locker', 'TaskId', 'IsArchived', 'IsConverting', 'ConvertedDate',
        'ActionStatus', 'CBNV', 'Content', 'ChenSo', 'DongMoc', 'EndLoop', 'IsKyQuyChe',
        'IssuedDate', 'KyHaiLien', 'ReccurencyType', 'LoaiBanHanh', 'LoaiMoc', 'NgayDanTau',
        'ParentId', 'PreviousStep', 'Price', 'SoVanBanDi', 'SoVanBanNum', 'ThamQuyen',
        'VBBiThayThe', 'YKien', 'ApproverByStep', 'SPListName', 'AssignedToText',
        'ResourceFormId', 'SiteName', 'IsDaIn', 'IsDaKy', 'ChildId', 'StampWithKey',
        'Name', 'IsHubSendOut', 'HubPackageId', 'GoiDauTu', 'GoiDuAn', 'DonViChuTri',
        'NgayKyKH', 'SoKH', 'DonViSoanThao', 'GoiDuAn1', 'IsNAS', 'NAS_MESS'
    ];

    const ciAliasMap = {
        'ID': 'DocumentID',
        'Title': 'DocumentTitle',
        'Subject': 'DocumentSubject',
        'Created': 'DocumentCreatedDate',
        'CreatedBy': 'DocumentCreatedBy',
        'Modified': 'DocumentModified',
        'ModifiedBy': 'DocumentModifiedBy',
        'SPItemId': 'LinkedItemID',
        'Status': 'DocumentStatus',
        'StatusText': 'DocumentStatusText',
        'WorkflowId': 'DocumentWorkflowId',
        'Approver': 'DocumentApprover',
        'ApprovedDate': 'DocumentApprovedDate',
        'SubmitDate': 'DocumentSubmitDate',
        'Step': 'DocumentStep',
        'DocumentId': 'DocumentDocumentId',
        'Updating': 'DocumentUpdating',
        'SiteName': 'DocumentSiteName'
    };

    const ciSelect = ciColumns.map(col => {
        const alias = ciAliasMap[col] || col;




        if (cols.codeItem.has(col.toLowerCase())) {
            return `ci.[${col}] AS [${alias}]`;
        } else {
            return `NULL AS [${alias}]`;
        }
    });

    const query = `
        SELECT
            ${udSelect.join(',\n            ')},
            ${ciSelect.join(',\n            ')},
            ud.[tp_Modified] AS __sync_time,
            ud.[tp_ID] AS __sync_id_num

        FROM [${this.oldDbName}].[dbo].[AllUserData] ud
        LEFT JOIN [${this.oldDbName}].[dbo].[AllLists] l
            ON ud.[tp_ListId] = l.[tp_ID]
        ${cols.hasUserInfo ? `OUTER APPLY (SELECT TOP 1 * FROM [${this.oldUserDb}].[dbo].[UserInfo] uia WHERE ud.[tp_Author] = uia.[tp_ID]) ui_author` : ''}
        ${cols.hasUserInfo ? `OUTER APPLY (SELECT TOP 1 * FROM [${this.oldUserDb}].[dbo].[UserInfo] uie WHERE ud.[tp_Editor] = uie.[tp_ID]) ui_editor` : ''}
        OUTER APPLY (
            SELECT TOP 1 *
            FROM [DataEOfficeSNP].[SNP].[CodeItem] ci2
            WHERE ci2.[SPItemId] = ud.[tp_ID]
            ORDER BY ci2.[ID] DESC
        ) ci

        WHERE ud.[tp_ListId] IN (${listIdsStr})
        AND ud.tp_RowOrdinal = 0
        AND ud.[tp_IsCurrentVersion] = 1
        AND (
            ud.[tp_Modified] > @lastSyncTime
            OR (
                ud.[tp_Modified] = @lastSyncTime
                AND ud.[tp_ID] > @lastSyncId
            )
        )
        ORDER BY ud.[tp_Modified] DESC, ud.[tp_ID] DESC
        OFFSET ${beginLimit} ROWS FETCH NEXT ${completedLimit} ROWS ONLY;
    `;

    const rows = await this.queryOldDb(query, { lastSyncTime, lastSyncId: Number(lastSyncId || 0) });
    console.log(`[StreamEventMigrationModel] Fetched ${rows.length} rows from old DB`);
    return rows;
  }

  async syncOldToStaging(rows, { transaction } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return { stagedCount: 0 };
    console.log(`[StreamEventMigrationModel] Staging ${rows.length} rows to ${this.newTableSync}...`);
    const internalColumns = new Set(['__sync_time', '__sync_id_num']);
    const columns = Object.keys(rows[0] || {}).filter(
      (c) => !String(c).startsWith('__') && !internalColumns.has(c)
    );
    if (!columns.length) return { stagedCount: 0 };

    const keyColumn = 'ID';
    const stagingTableRef = this.getStagingTableRef();

    for (const row of rows) {
      const params = {};
      const colPairs = [];

      // Tham số hóa ID đầu tiên để tránh xung đột
      params['id_key'] = row[keyColumn] != null ? Number(row[keyColumn]) : 0;
      params['sync_time'] = row.__sync_time;
      params['sync_id_num'] = row.__sync_id_num;

      // Xử lý các cột còn lại bằng p0, p1, ...
      columns.forEach((col, index) => {
        const pName = `p${index}`;
        params[pName] = row[col] != null ? String(row[col]) : null;
        if (col !== keyColumn) {
          colPairs.push(`[${col}] = @${pName}`);
        }
      });

      const updateSet = colPairs.join(', ');
      const insertCols = columns.map(c => `[${c}]`).join(', ');
      const insertVals = columns.map((_, i) => `@p${i}`).join(', ');

      const query = `
      IF EXISTS (SELECT 1 FROM ${stagingTableRef} WHERE [${keyColumn}] = @id_key)
      BEGIN
          UPDATE ${stagingTableRef}
          SET ${updateSet}, __sync_time = @sync_time, __sync_id_num = @sync_id_num
          WHERE [${keyColumn}] = @id_key
      END
      ELSE
      BEGIN
          INSERT INTO ${stagingTableRef} (${insertCols}, __sync_time, __sync_id_num)
          VALUES (${insertVals}, @sync_time, @sync_id_num)
      END
      `;
      await this.queryNewDbTx(query, params, transaction);
    }

    console.log(`[StreamEventMigrationModel] Staging complete for ${rows.length} rows`);
    return { stagedCount: rows.length };
  }

  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    if (!syncJobId) throw new Error('syncJobId is required');
    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);

    const rows = await this.fetchListFromOldDb(normalizedLastSyncTime, normalizedLastSyncId);
    const stageResult = await this.syncOldToStaging(rows);

    let nextSyncTime = normalizedLastSyncTime;
    let nextSyncId = normalizedLastSyncId;

    if (rows.length > 0) {
      nextSyncTime = this.extractRowSyncTime(rows[0]);
      nextSyncId = this.extractRowSyncId(rows[0]);
    }
    return { syncJobId, rows, totalCount: rows.length, lastSyncTime: nextSyncTime, lastSyncId: nextSyncId };
  }

  async getSyncJobState(syncJobId) {
    const rows = await this.queryNewDb(`SELECT TOP 1 * FROM sync_jobs WHERE job_id = @syncJobId`, { syncJobId });
    return rows?.[0] || null;
  }

  async fetchOneFromSource({ lastSyncTime, lastSyncId }) {
    const listIds = this.oldConfig.listIds || [];
    const listIdsStr = listIds.map(id => `'${id}'`).join(',');
    const cols = this.sourceSchema;

    const select = [
        `ud.[tp_ID] AS ID`,
        `ud.[tp_Created] AS tp_Created`,
        `ud.[tp_Modified] AS tp_Modified`,
        cols.hasUserInfo ? `ui_author.[tp_Title] AS AuthorName` : `NULL AS AuthorName`,
        cols.hasUserInfo ? `ui_author.[tp_Login] AS AuthorAccount` : `NULL AS AuthorAccount`,
        cols.allUserData.has('nvarchar1') ? `ud.[nvarchar1] AS Title` : `NULL AS Title`,
        cols.allUserData.has('datetime1') ? `ud.[datetime1] AS StartDate` : `NULL AS StartDate`,
        cols.allUserData.has('datetime2') ? `ud.[datetime2] AS EndDate` : `NULL AS EndDate`,
        cols.allUserData.has('nvarchar2') ? `ud.[nvarchar2] AS Location` : `NULL AS Location`,
        cols.allUserData.has('nvarchar4') ? `ud.[nvarchar4] AS Organizer` : `NULL AS Organizer`,
        `ud.[tp_Modified] AS __sync_time`,
        `ud.[tp_ID] AS __sync_id_num`
    ];

    const query = `
        SELECT TOP 1
            ${select.join(',\n            ')}
        FROM [${this.oldDbName}].[dbo].[AllUserData] ud
        ${cols.hasUserInfo ? `LEFT JOIN [${this.oldUserDb}].[dbo].[UserInfo] ui_author ON ud.[tp_Author] = ui_author.[tp_ID]` : ''}
        WHERE ud.[tp_ListId] IN (${listIdsStr})
        AND ud.tp_RowOrdinal = 0
        AND ud.[tp_IsCurrentVersion] = 1
        AND (ud.[tp_Modified] > @lastSyncTime OR (ud.[tp_Modified] = @lastSyncTime AND ud.[tp_ID] > @lastSyncId))
        ORDER BY ud.[tp_Modified] DESC, ud.[tp_ID] DESC
    `;
    const rows = await this.queryOldDb(query, { lastSyncTime, lastSyncId });
    return rows?.[0] || null;
  }

  async processOne(syncJobId) {
    const jobState = await this.getSyncJobState(syncJobId);
    if (!jobState) throw new Error(`Job state not found: ${syncJobId}`);
    const rowData = await this.fetchOneFromSource({
      lastSyncTime: this.normalizeSyncTime(jobState.last_sync_time || DEFAULT_SYNC_TIME),
      lastSyncId: Number(jobState.last_sync_id || 0)
    });
    if (!rowData) return { syncJobId, processed: false, done: true };

    await this.processRowData(rowData);
    await this.queryNewDb(
      `UPDATE sync_jobs SET total_processed = ISNULL(total_processed,0) + 1, total_success = ISNULL(total_success,0) + 1,
       last_sync_time = @lastSyncTime, last_sync_id = @lastSyncId WHERE job_id = @syncJobId`,
      { syncJobId, lastSyncTime: this.extractRowSyncTime(rowData), lastSyncId: this.extractRowSyncId(rowData) }
    );
    return { syncJobId, processed: true, done: false };
  }

  async processRowData(rowData, { transaction } = {}) {
    if (!rowData?.ID) throw new Error('ID is required');
    const recordId = String(rowData.ID);
    const { externalKey } = this.oldConfig;

    console.log(`\n\n[StreamEventMigrationModel] ----------------- START PROCESSING RECORD ID: ${recordId} -----------------`);
    console.log(`[StreamEventMigrationModel] RAW ROW DATA FROM OLD DB:`);
    console.log(JSON.stringify(rowData, null, 2));

    if (rowData.AuthorAccount) {
      console.log(`[StreamEventMigrationModel] Resolving AuthorAccount: ${rowData.AuthorAccount}`);
      const authorId = await this.helper.mapUserName(rowData.AuthorAccount, transaction);
      if (authorId) {
          rowData.AuthorAccount = authorId;
          console.log(`[StreamEventMigrationModel] Resolved AuthorAccount to New UUID: ${authorId}`);
      } else {
          console.log(`[StreamEventMigrationModel] Cannot resolve AuthorAccount. Kept as: ${rowData.AuthorAccount}`);
      }
    }

    const result = await this.upsertDataToNewDB(rowData, this.oldConfig, externalKey, recordId, transaction);
    console.log(`[StreamEventMigrationModel] ----------------- END PROCESSING RECORD ID: ${recordId} -----------------\n\n`);
    return { backupId: recordId, affected: result.affected, logs: [{ table: this.oldConfig.newTable, action: result.action }] };
  }

  async getExistingColumns(tableName, schema = 'dbo') {
    const query = `SELECT COLUMN_NAME, DATA_TYPE FROM [${this.newDbName}].INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @tableName AND TABLE_SCHEMA = @schema`;
    const result = await this.queryNewDb(query, { tableName, schema });
    const colMap = new Map();
    result.forEach(r => colMap.set(r.COLUMN_NAME.toLowerCase(), r.DATA_TYPE.toLowerCase()));
    return colMap;
  }

  async upsertDataToNewDB(rawData, config, externalKeyField, externalKeyValue, transaction) {
    const { newTable, newSchema, fieldMapping, defaultValues } = config;
    const { v4: uuidv4 } = require('uuid');
    const existingCols = await this.getExistingColumns(newTable, newSchema);

    console.log(`[StreamEventMigrationModel] Initiating Upsert for Table: ${newTable}`);

    const params = {};
    const insertCols = [];
    const insertVals = [];
    const updateSet = [];

    // Track columns (case-insensitive) to prevent duplicates in query
    const handledCols = new Set();
    const normalize = (val) => val.toLowerCase();

    // 1. Generate UUID for ID if table has 'id' column and it's not provided
    const idKey = 'id';
    if (existingCols.has(idKey)) {
        const hasIdInMapping = Object.values(fieldMapping).some(v => normalize(v) === idKey) ||
                              Object.keys(defaultValues || {}).some(v => normalize(v) === idKey);
        const isInt = (existingCols.get(idKey) || '').includes('int');
        if (!hasIdInMapping && !isInt) {
            params[idKey] = uuidv4().toUpperCase();
            insertCols.push(`[${idKey}]`); insertVals.push(`@${idKey}`);
            handledCols.add(idKey);
        }
    }

    // 2. Process fieldMapping
    for (const [oldField, newFieldRaw] of Object.entries(fieldMapping)) {
      const newField = normalize(newFieldRaw);
      if (!existingCols.has(newField) || handledCols.has(newField)) continue;

      const value = rawData[oldField];
      if (value === undefined || value === null) continue;

      params[newField] = value;
      insertCols.push(`[${newField}]`); insertVals.push(`@${newField}`);
      if (newField !== 'id' && newField !== 'created_at' && newField !== 'createdat') {
          updateSet.push(`[${newField}] = @${newField}`);
      }
      handledCols.add(newField);
    }

    // 3. Process defaultValues
    for (const [newFieldRaw, valueFn] of Object.entries(defaultValues || {})) {
      const newField = normalize(newFieldRaw);
      if (!existingCols.has(newField) || handledCols.has(newField)) continue;

      params[newField] = typeof valueFn === 'function' ? valueFn(rawData) : valueFn;
      insertCols.push(`[${newField}]`); insertVals.push(`@${newField}`);
      if (newField !== 'id' && newField !== 'created_at' && newField !== 'createdat') {
          updateSet.push(`[${newField}] = @${newField}`);
      }
      handledCols.add(newField);
    }

    // 4. Fallback for other existing database columns
    for (const [col, type] of existingCols.entries()) {
      if (!handledCols.has(col)) {
        if (col === 'id') continue; // Prevent IDENTITY_INSERT error
        let fallback = null;
        if (type.includes('char') || type.includes('text')) fallback = 'Chưa xác định';
        else if (type.includes('int') || type.includes('decimal')) fallback = 0;
        else if (type.includes('date')) fallback = new Date();
        else if (type.includes('bit')) fallback = 0;

        if (fallback !== null) {
          params[col] = fallback;
          insertCols.push(`[${col}]`); insertVals.push(`@${col}`);
          if (col !== 'id' && col !== 'created_at' && col !== 'createdat') {
              updateSet.push(`[${col}] = @${col}`);
          }
          handledCols.add(col);
        }
      }
    }

    console.log(`[StreamEventMigrationModel] FINAL MAPPED PARAMS FOR SQL:`);
    console.log(JSON.stringify(params, null, 2));

    params._externalKeyValue = externalKeyValue;
    const tableRef = `[${this.newDbName}].[${newSchema}].[${newTable}]`;
    const query = `
      DECLARE @OutputTable TABLE (id NVARCHAR(255));
      IF EXISTS (SELECT 1 FROM ${tableRef} WHERE [${externalKeyField}] = @_externalKeyValue)
      BEGIN
          UPDATE ${tableRef} SET ${updateSet.length ? updateSet.join(', ') : `${externalKeyField} = ${externalKeyField}`}
          OUTPUT INSERTED.id INTO @OutputTable WHERE [${externalKeyField}] = @_externalKeyValue;
          SELECT (SELECT TOP 1 id FROM @OutputTable) AS id, @@ROWCOUNT AS affected, 'updated' AS action;
      END
      ELSE
      BEGIN
          INSERT INTO ${tableRef} (${insertCols.join(', ')})
          OUTPUT INSERTED.id INTO @OutputTable VALUES (${insertVals.join(', ')});
          SELECT (SELECT TOP 1 id FROM @OutputTable) AS id, @@ROWCOUNT AS affected, 'inserted' AS action;
      END
    `;

    console.log(`[StreamEventMigrationModel] EXECUTING SQL QUERY...`);
    const result = await this.queryNewDbTx(query, params, transaction);
    const row = Array.isArray(result) ? result[0] : result;
    console.log(`[StreamEventMigrationModel] SQL EXECUTED. Action: ${row?.action}, Affected: ${row?.affected}`);
    return { id: row?.id || null, action: row?.action || 'none', affected: Number(row?.affected || 0) };
  }
}

module.exports = StreamEventMigrationModel;
