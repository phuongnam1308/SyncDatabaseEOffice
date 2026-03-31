const MigrationHelper = require('../../helpers/MigrationHelper');
const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const { tableMappings } = require('./config');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class StreamMissionMigrationModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_MISSION_MIGRATION' });
    this.oldConfig = tableMappings.mission;
    this.oldDbName = this.oldConfig.oldDatabase;
    this.oldDbSchema = this.oldConfig.oldSchema;
    this.oldDbTable = this.oldConfig.oldTable;
    this.oldUserDb = this.oldConfig.oldUserDatabase || 'WSS_Content_eoffice';
    this.newDbName = this.oldConfig.newDatabase || 'camunda';
    this.newDbSchema = this.oldConfig.newSchema || 'dbo';
    this.newTableSync = 'mission_schedule_sync_staging';
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
          
          console.log(`[StreamMissionMigrationModel] Source Schema Cached: 
            AllUserData: ${this.sourceSchema.allUserData.size} columns, 
            CodeItem: ${this.sourceSchema.codeItem.size} columns, 
            UserInfo exists: ${this.sourceSchema.hasUserInfo}`);
      } catch (err) {
          console.warn(`[StreamMissionMigrationModel] cacheSourceSchema Error: ${err.message}`);
      }
  }

  async initialize() {
    console.log(`[StreamMissionMigrationModel] Initializing...`);
    await super.initialize();
    
    // 🔥 Cache Source Schema to prevent "Invalid column name" errors
    await this.cacheSourceSchema();
    
    await this.ensureStagingTableExists();
    await this.ensureTargetColumnsExist();
    console.log(`[StreamMissionMigrationModel] Initialization complete.`);
  }

  async ensureTargetColumnsExist() {
    try {
      const table = this.oldConfig.newTable;
      const schema = this.newDbSchema || 'dbo';
      const fullTableRef = `[${this.newDbName}].[${schema}].[${table}]`;
      
      console.log(`[StreamMissionMigrationModel] Checking/Adding missing columns to ${fullTableRef}...`);
      
      const columnsToCheck = [
        { name: 'id_sp_bak', type: 'NVARCHAR(255)' },
        { name: 'table_bak', type: 'INT' },
        { name: 'calendar_format', type: 'VARCHAR(20)' },
        { name: 'work_date', type: 'DATETIME2' },
        { name: 'morning_location', type: 'NVARCHAR(255)' },
        { name: 'morning_content', type: 'NVARCHAR(MAX)' },
        { name: 'afternoon_location', type: 'NVARCHAR(255)' },
        { name: 'afternoon_content', type: 'NVARCHAR(MAX)' },
        { name: 'schedules', type: 'NVARCHAR(MAX)' }
      ];

      for (const col of columnsToCheck) {
        const query = `
          IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}' AND COLUMN_NAME = '${col.name}')
          BEGIN
              ALTER TABLE ${fullTableRef} ADD [${col.name}] ${col.type} NULL;
          END
        `;
        await this.queryNewDb(query);
      }

      // Đảm bảo có Index cho id_sp_bak để tối ưu tốc độ check trùng
      const indexQuery = `
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_${table}_id_sp_bak')
        BEGIN
            CREATE INDEX IX_${table}_id_sp_bak ON ${fullTableRef}(id_sp_bak);
        END
      `;
      await this.queryNewDb(indexQuery);
      
      console.log(`[StreamMissionMigrationModel] [ensureTargetColumnsExist] OK: All columns checked for ${table}`);
    } catch (err) {
      console.error(`[StreamMissionMigrationModel] [ensureTargetColumnsExist] ERROR: ${err.message}`);
    }
  }

  async ensureStagingTableExists() {
    try {
      const stagingTableRef = this.getStagingTableRef();
      console.log(`[StreamMissionMigrationModel] Checking/Creating staging table: ${stagingTableRef}`);
      const table = this.newTableSync;
      const schema = this.newDbSchema || 'dbo';

      const createQuery = `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${table}')
      BEGIN
          CREATE TABLE ${stagingTableRef} (
              [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
              [__sync_time] DATETIME2 NULL,
              [__sync_id_num] BIGINT NULL,
              [ItemID] BIGINT NOT NULL
          );
          CREATE UNIQUE INDEX IX_${table}_ItemID ON ${stagingTableRef}([ItemID]);
      END
      ELSE
      BEGIN
          -- Đảm bảo DROP index cũ nếu còn tồn tại để tránh lỗi duplicate NULL trên cột ID
          IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_${table}_ID' AND object_id = OBJECT_ID('${stagingTableRef}'))
          BEGIN
              DROP INDEX IX_${table}_ID ON ${stagingTableRef};
          END
      END
      `;
      await this.queryNewDb(createQuery);

      // 2. Danh sách các cột cần đảm bảo (Đã chuyển sang tiếng Anh cho đồng bộ)
      const columnsToAdd = [
        { name: 'ListName', type: 'NVARCHAR(MAX)' },
        { name: 'ItemID', type: 'BIGINT' },
        { name: 'CreatedDate', type: 'NVARCHAR(500)' },
        { name: 'ModifiedDate', type: 'NVARCHAR(500)' },
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
        { name: 'Organizer', type: 'NVARCHAR(MAX)' },
        
        { name: 'DocumentID', type: 'BIGINT' },
        { name: 'DocumentTitle', type: 'NVARCHAR(MAX)' },
        { name: 'DocumentSubject', type: 'NVARCHAR(MAX)' },
        { name: 'LoaiVanBan', type: 'NVARCHAR(MAX)' },
        { name: 'DepartmentId', type: 'NVARCHAR(500)' },
        { name: 'DocumentStatus', type: 'NVARCHAR(500)' },
        { name: 'DocumentStatusText', type: 'NVARCHAR(MAX)' },
        { name: 'DocumentWorkflowId', type: 'NVARCHAR(500)' },
        { name: 'DocumentApprover', type: 'NVARCHAR(MAX)' },
        { name: 'DocumentApprovedDate', type: 'NVARCHAR(500)' },
        { name: 'DocumentCreatedDate', type: 'NVARCHAR(500)' },
        { name: 'DocumentCreatedBy', type: 'NVARCHAR(500)' },
        { name: 'DocumentModified', type: 'NVARCHAR(500)' },
        { name: 'DocumentModifiedBy', type: 'NVARCHAR(500)' },
        { name: 'LinkedItemID', type: 'BIGINT' },
        { name: 'SPListId', type: 'NVARCHAR(500)' },
        { name: 'DocumentSubmitDate', type: 'NVARCHAR(500)' },
        { name: 'DocumentStep', type: 'NVARCHAR(500)' },
        { name: 'DocumentDocumentId', type: 'NVARCHAR(MAX)' },
        { name: 'DocumentTitle2', type: 'NVARCHAR(MAX)' },
        { name: 'DocumentUpdating', type: 'NVARCHAR(500)' },
        { name: 'Locker', type: 'NVARCHAR(500)' },
        { name: 'TaskId', type: 'NVARCHAR(500)' },
        { name: 'IsArchived', type: 'BIT' },
        { name: 'IsConverting', type: 'BIT' },
        { name: 'ConvertedDate', type: 'NVARCHAR(500)' },
        { name: 'ActionStatus', type: 'NVARCHAR(500)' },
        { name: 'CBNV', type: 'NVARCHAR(MAX)' },
        { name: 'Content', type: 'NVARCHAR(MAX)' },
        { name: 'ChenSo', type: 'BIT' },
        { name: 'DongMoc', type: 'BIT' },
        { name: 'EndLoop', type: 'BIT' },
        { name: 'IsKyQuyChe', type: 'BIT' },
        { name: 'IssuedDate', type: 'NVARCHAR(500)' },
        { name: 'KyHaiLien', type: 'BIT' },
        { name: 'ReccurencyType', type: 'NVARCHAR(500)' },
        { name: 'LoaiBanHanh', type: 'NVARCHAR(500)' },
        { name: 'LoaiMoc', type: 'NVARCHAR(500)' },
        { name: 'NgayDanTau', type: 'NVARCHAR(500)' },
        { name: 'ParentId', type: 'NVARCHAR(500)' },
        { name: 'PreviousStep', type: 'INT' },
        { name: 'Price', type: 'DECIMAL(18,2)' },
        { name: 'SoVanBanDi', type: 'NVARCHAR(MAX)' },
        { name: 'SoVanBanNum', type: 'NVARCHAR(500)' },
        { name: 'ThamQuyen', type: 'NVARCHAR(MAX)' },
        { name: 'VBBiThayThe', type: 'NVARCHAR(MAX)' },
        { name: 'YKien', type: 'NVARCHAR(MAX)' },
        { name: 'ApproverByStep', type: 'NVARCHAR(MAX)' },
        { name: 'SPListName', type: 'NVARCHAR(500)' },
        { name: 'AssignedToText', type: 'NVARCHAR(MAX)' },
        { name: 'ResourceFormId', type: 'NVARCHAR(500)' },
        { name: 'DocumentSiteName', type: 'NVARCHAR(MAX)' },
        { name: 'IsDaIn', type: 'BIT' },
        { name: 'IsDaKy', type: 'BIT' },
        { name: 'ChildId', type: 'NVARCHAR(500)' },
        { name: 'StampWithKey', type: 'NVARCHAR(MAX)' },
        { name: 'Name', type: 'NVARCHAR(MAX)' },
        { name: 'IsHubSendOut', type: 'BIT' },
        { name: 'HubPackageId', type: 'NVARCHAR(500)' },
        { name: 'GoiDauTu', type: 'NVARCHAR(MAX)' },
        { name: 'GoiDuAn', type: 'NVARCHAR(MAX)' },
        { name: 'DonViChuTri', type: 'NVARCHAR(MAX)' },
        { name: 'NgayKyKH', type: 'NVARCHAR(500)' },
        { name: 'SoKH', type: 'NVARCHAR(500)' },
        { name: 'DonViSoanThao', type: 'NVARCHAR(MAX)' },
        { name: 'GoiDuAn1', type: 'NVARCHAR(MAX)' },
        { name: 'IsNAS', type: 'BIT' },
        { name: 'NAS_MESS', type: 'NVARCHAR(MAX)' }
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

      // 3. Xử lý cột ID cũ (nếu có) để tránh lỗi 'Cannot insert NULL'
      const fixIdQuery = `
      IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}' AND TABLE_SCHEMA = '${schema}' AND COLUMN_NAME = 'ID' AND IS_NULLABLE = 'NO')
      BEGIN
          ALTER TABLE ${stagingTableRef} ALTER COLUMN [ID] BIGINT NULL;
      END
      `;
      await this.queryNewDb(fixIdQuery);
      console.log(`[StreamMissionMigrationModel] [ensureStagingTableExists] OK: ${stagingTableRef} is ready`);
    } catch (err) {
      console.error(`[StreamMissionMigrationModel] [ensureStagingTableExists] ERROR: ${err.message}`);
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
    const dateVal = new Date(raw);
    if (Number.isNaN(dateVal.getTime())) return null;
    return dateVal.toISOString();
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

    // 🔥 Build dynamic SELECT based on existing columns in Source DB
    const cols = this.sourceSchema;
    
    const udSelect = [
        `l.[tp_Title]            AS ListName`,
        `ud.[tp_ID]              AS ItemID`,
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
        ORDER BY ud.[tp_Modified] ASC, ud.[tp_ID] ASC
        OFFSET ${beginLimit} ROWS FETCH NEXT ${completedLimit} ROWS ONLY;
    `;

    const rows = await this.queryOldDb(query, { lastSyncTime, lastSyncId: Number(lastSyncId || 0) });
    console.log(`[StreamMissionMigrationModel] Fetched ${rows.length} rows from old DB`);
    return rows;
  }

  async syncOldToStaging(rows, { transaction } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return { stagedCount: 0 };
    console.log(`[StreamMissionMigrationModel] Staging ${rows.length} rows to ${this.newTableSync}...`);
    const internalColumns = new Set(['__sync_time', '__sync_id_num']);
    const columns = Object.keys(rows[0]).filter(c => !internalColumns.has(c));
    const keyColumn = 'ItemID';
    const stagingTableRef = this.getStagingTableRef();

    for (const row of rows) {
      const params = {};
      const columnNames = [];
      const paramNames = [];
      const updateAssigns = [];

      columns.forEach((col, idx) => {
        const pName = `p${idx}`;
        params[pName] = row[col] != null ? String(row[col]) : null;
        columnNames.push(`[${col}]`);
        paramNames.push(`@${pName}`);
        if (col !== keyColumn) {
          updateAssigns.push(`[${col}] = @${pName}`);
        }
      });

      params.__sync_time = row.__sync_time;
      params.__sync_id_num = row.__sync_id_num;

      const query = `
      IF EXISTS (SELECT 1 FROM ${stagingTableRef} WHERE [${keyColumn}] = @p${columns.indexOf(keyColumn)})
      BEGIN
          UPDATE ${stagingTableRef} 
          SET ${updateAssigns.join(', ')}, __sync_time = @__sync_time, __sync_id_num = @__sync_id_num 
          WHERE [${keyColumn}] = @p${columns.indexOf(keyColumn)}
      END
      ELSE
      BEGIN
          INSERT INTO ${stagingTableRef} (${columnNames.join(',')}, __sync_time, __sync_id_num)
          VALUES (${paramNames.join(',')}, @__sync_time, @__sync_id_num)
      END
      `;
      await this.queryNewDbTx(query, params, transaction);
    }

    console.log(`[StreamMissionMigrationModel] Staging complete for ${rows.length} rows`);
    return { stagedCount: rows.length };
  }

  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    if (!syncJobId) throw new Error('syncJobId is required');
    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);

    const rows = await this.fetchListFromOldDb(normalizedLastSyncTime, normalizedLastSyncId);
    await this.syncOldToStaging(rows);

    let nextSyncTime = normalizedLastSyncTime;
    let nextSyncId = normalizedLastSyncId;
    
    // Với thứ tự DESC, bản ghi đầu tiên là bản ghi mới nhất
    if (rows.length > 0) {
      nextSyncTime = this.extractRowSyncTime(rows[0]);
      nextSyncId = this.extractRowSyncId(rows[0]);
    }
    return { syncJobId, rows, totalCount: rows.length, lastSyncTime: nextSyncTime, lastSyncId: nextSyncId };
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
        ${cols.hasUserInfo ? `OUTER APPLY (SELECT TOP 1 * FROM [${this.oldUserDb}].[dbo].[UserInfo] uia WHERE ud.[tp_Author] = uia.[tp_ID]) ui_author` : ''}
        WHERE ud.[tp_ListId] IN (${listIdsStr})
        AND ud.tp_RowOrdinal = 0
        AND ud.[tp_IsCurrentVersion] = 1
        AND (ud.[tp_Modified] > @lastSyncTime OR (ud.[tp_Modified] = @lastSyncTime AND ud.[tp_ID] > @lastSyncId))
        ORDER BY ud.[tp_Modified] ASC, ud.[tp_ID] ASC
    `;
    const rows = await this.queryOldDb(query, { lastSyncTime, lastSyncId });
    return rows?.[0] || null;
  }

  async getSyncJobState(syncJobId) {
    const rows = await this.queryNewDb(`SELECT TOP 1 * FROM sync_jobs WHERE job_id = @syncJobId`, { syncJobId });
    return rows?.[0] || null;
  }

  async processOne(syncJobId) {
    console.log(`[StreamMissionMigrationModel] processOne: Starting job ${syncJobId}`);
    const jobState = await this.getSyncJobState(syncJobId);
    if (!jobState) throw new Error(`Job state not found: ${syncJobId}`);
    const rowData = await this.fetchOneFromSource({
      lastSyncTime: this.normalizeSyncTime(jobState.last_sync_time || DEFAULT_SYNC_TIME),
      lastSyncId: Number(jobState.last_sync_id || 0)
    });
    if (!rowData) {
        console.log(`[StreamMissionMigrationModel] processOne: No more data for job ${syncJobId}`);
        return { syncJobId, processed: false, done: true };
    }

    console.log(`[StreamMissionMigrationModel] processOne: Processing row ID ${rowData.ID}`);
    await this.processRowData(rowData);

    await this.queryNewDb(
      `UPDATE sync_jobs SET total_processed = ISNULL(total_processed,0) + 1, total_success = ISNULL(total_success,0) + 1,
       last_sync_time = @lastSyncTime, last_sync_id = @lastSyncId WHERE job_id = @syncJobId`,
      { syncJobId, lastSyncTime: this.extractRowSyncTime(rowData), lastSyncId: this.extractRowSyncId(rowData) }
    );
    console.log(`[StreamMissionMigrationModel] processOne: Successfully processed row ID ${rowData.ID}`);
    return { syncJobId, processed: true, done: false };
  }

  async processRowData(rowData, { transaction } = {}) {
    if (!rowData?.ID) throw new Error('ID is required');
    const recordId = String(rowData.ID);
    console.log(`[StreamMissionMigrationModel] processRowData: recordId=${recordId}`);
    const { externalKey } = this.oldConfig;

    // Mapping Người tạo (Created by)
    if (rowData.AuthorAccount) {
      console.log(`[StreamMissionMigrationModel] Mapping Author (resolveUserIdByAccountName): ${rowData.AuthorAccount}`);
      const missionDefaultRole = JSON.stringify([
        {"processKey":"QUY_TRINH_LICH_HOP","name":"QUY_TRINH_LICH_HOP","roles":[{"roleCode":"BAN_QUAN_LY_PHONG_HOP","name":"BAN_QUAN_LY_PHONG_HOP"},{"roleCode":"ADMIN","name":"ADMIN"}]},
        {"processKey":"QUY_TRINH_PHONG_HOP","name":"QUY_TRINH_PHONG_HOP","roles":[{"roleCode":"BAN_QUAN_LY_PHONG_HOP","name":"BAN_QUAN_LY_PHONG_HOP"}]},
        {"processKey":"LICH_TRUC_BAN_LANH_DAO","name":"LICH_TRUC_BAN_LANH_DAO","roles":[{"roleCode":"LANH_DAO","name":"LANH_DAO"}]},
        {"processKey":"dashboardPage","name":"dashboardPage","roles":[{"roleCode":"VT","name":"VT"}]}
      ]);
      const authorId = await this.helper.resolveUserIdByAccountName(rowData.AuthorAccount, transaction, missionDefaultRole);
      if (authorId) rowData.AuthorAccount = authorId;
      console.log(`[StreamMissionMigrationModel] Mapped Author to: ${rowData.AuthorAccount}`);
    }

    // Mapping Người chủ trì (Leader)
    if (rowData.Organizer) {
      console.log(`[StreamMissionMigrationModel] Mapping Organizer (resolveUserIdByFullName): ${rowData.Organizer}`);
      const leaderId = await this.helper.resolveUserIdByFullName(rowData.Organizer, transaction);
      if (leaderId) rowData.Organizer = leaderId;
      console.log(`[StreamMissionMigrationModel] Mapped Organizer to (ID): ${rowData.Organizer}`);
    }

    // 🔥 Fallback Địa điểm nâng cao: Nếu Location trống, bóc tách đơn vị từ Organizer
    if (!rowData.Location || rowData.Location.trim() === '' || rowData.Location === 'null') {
      const sourceText = rowData.Organizer || rowData.DonViChuTri || '';
      if (sourceText && typeof sourceText === 'string') {
        // Lấy phần sau dấu gạch ngang cuối cùng
        const parts = sourceText.split(' - ');
        const unitPart = parts[parts.length - 1].trim();
        
        // Lấy từ cuối cùng (thường là mã đơn vị)
        const unitWords = unitPart.split(' ');
        const unitCode = unitWords[unitWords.length - 1];

        if (unitCode) {
          console.log(`[StreamMissionMigrationModel] [Fallback Location] Bóc tách mã đơn vị: ${unitCode}`);
          const resolvedUnitName = await this.helper.resolveUnitNameByCode(unitCode, transaction);
          if (resolvedUnitName) {
            rowData.Location = resolvedUnitName;
            console.log(`[StreamMissionMigrationModel] [Fallback Location] Đã tìm thấy tên đơn vị: ${resolvedUnitName}`);
          }
        }
      }
    }

    const result = await this.upsertDataToNewDB(rowData, this.oldConfig, externalKey, recordId, transaction);
    console.log(`[StreamMissionMigrationModel] Upsert result for recordId=${recordId}: ${result.action}, ID=${result.id}`);
    return { 
        backupId: recordId, 
        affected: result.affected, 
        logs: [{ table: this.oldConfig.newTable, action: result.action }] 
    };
  }

  async getExistingColumns(tableName, schema = 'dbo') {
    const query = `
        SELECT 
            COLUMN_NAME, 
            DATA_TYPE, 
            COLUMNPROPERTY(OBJECT_ID(TABLE_SCHEMA + '.' + TABLE_NAME), COLUMN_NAME, 'IsIdentity') AS IsIdentity
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = @tableName AND TABLE_SCHEMA = @schema
    `;
    const result = await this.queryNewDb(query, { tableName, schema });
    const colMap = new Map();
    // Lưu trữ object { type, isIdentity }
    result.forEach(r => colMap.set(r.COLUMN_NAME.toLowerCase(), { 
        type: (r.DATA_TYPE || '').toLowerCase(), 
        isIdentity: r.IsIdentity === 1 
    }));
    return colMap;
  }

  async upsertDataToNewDB(rawData, config, externalKeyField, externalKeyValue, transaction) {
    const { newTable, newSchema, fieldMapping, defaultValues } = config;
    const { v4: uuidv4 } = require('uuid');
    const existingCols = await this.getExistingColumns(newTable, newSchema);
    console.log(`[StreamMissionMigrationModel] upsertDataToNewDB: table=${newTable}, externalKeyValue=${externalKeyValue}`);

    const params = {};
    const insertCols = [];
    const insertVals = [];
    const updateSet = [];

    // Chỉ chèn ID nếu cột ID hiện có trong DB, nó không phải Identity và nó là kiểu UniqueIdentifier (GUID)
    const idInfo = existingCols.get('id');
    const idType = idInfo?.type || '';
    const isIdIdentity = idInfo?.isIdentity || false;

    if (idType.includes('uniqueidentifier') && !isIdIdentity && !params.hasOwnProperty('id')) {
        const hasIdInMapping = Object.values(fieldMapping).some(v => v.toLowerCase() === 'id') ||
                              Object.keys(defaultValues || {}).some(v => v.toLowerCase() === 'id');
        if (!hasIdInMapping) {
            params['id'] = uuidv4().toUpperCase();
            insertCols.push('[id]'); insertVals.push('@id');
        }
    }

    // --- 1. Ánh xạ từ fieldMapping ---
    for (const [oldField, newField] of Object.entries(fieldMapping)) {
      const lowerNewField = newField.toLowerCase();
      const colInfo = existingCols.get(lowerNewField);
      if (!colInfo || colInfo.isIdentity) continue;
      
      const value = rawData[oldField];
      if (value !== undefined && value !== null) {
          params[lowerNewField] = value;
          // Sử dụng tên cột chuẩn từ database (viết thường hoặc theo schema)
          const actualColName = lowerNewField; 
          if (!insertCols.includes(`[${actualColName}]`)) {
              insertCols.push(`[${actualColName}]`); 
              insertVals.push(`@${actualColName}`);
              if (actualColName !== 'id' && actualColName !== 'created_at') {
                  updateSet.push(`[${actualColName}] = @${actualColName}`);
              }
          }
      }
    }

    // --- 2. Ánh xạ từ defaultValues (Ghi đè nếu vẫn chưa có trong params) ---
    for (const [newField, valueFn] of Object.entries(defaultValues || {})) {
      const lowerNewField = newField.toLowerCase();
      const colInfo = existingCols.get(lowerNewField);
      if (!colInfo || colInfo.isIdentity) continue;
      
      // Quan trọng: Phải kiểm tra undefined để bao gồm cả null (null là giá trị hợp lệ)
      if (params[lowerNewField] === undefined) {
          const val = typeof valueFn === 'function' ? valueFn(rawData) : valueFn;
          if (val !== undefined) {
              params[lowerNewField] = val;
              if (!insertCols.includes(`[${lowerNewField}]`)) {
                  insertCols.push(`[${lowerNewField}]`); 
                  insertVals.push(`@${lowerNewField}`);
                  if (lowerNewField !== 'id' && lowerNewField !== 'created_at') {
                      updateSet.push(`[${lowerNewField}] = @${lowerNewField}`);
                  }
              }
          }
      }
    }

    // --- 3. Tự động điền dữ liệu dựa trên kiểu dữ liệu của cột ---
    const currentParamKeys = new Set(Object.keys(params).map(k => k.toLowerCase()));
    for (const [col, info] of existingCols.entries()) {
      const lowerCol = col.toLowerCase();
      if (info.isIdentity || currentParamKeys.has(lowerCol)) continue;
      
      const type = info.type;
      let fallback = null;
      if (type.includes('char') || type.includes('text')) {
          // 🔥 ĐẶC BIỆT: calendar_format KHÔNG ĐƯỢC để rỗng
          if (lowerCol === 'calendar_format') {
              fallback = 'fullDay';
          } else {
              fallback = ''; 
          }
      } else if (type.includes('int') || type.includes('decimal') || type.includes('float') || type.includes('numeric')) {
          fallback = 0;
      } else if (type.includes('date') || type.includes('time')) {
          fallback = new Date();
      } else if (type.includes('bit')) {
          fallback = 0;
      }

      if (fallback !== null) {
          params[lowerCol] = fallback;
          insertCols.push(`[${col}]`); 
          insertVals.push(`@${lowerCol}`);
          if (lowerCol !== 'id' && lowerCol !== 'created_at') {
              updateSet.push(`[${col}] = @${lowerCol}`);
          }
      }
    }


    params._externalKeyValue = externalKeyValue;
    console.log(`[StreamMissionMigrationModel] upsertDataToNewDB params: ${JSON.stringify(params)}`);
    const tableRef = `[${this.newDbName}].[${newSchema}].[${newTable}]`;
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
    console.log(`[StreamMissionMigrationModel] queryNewDbTx result: action=${row?.action}, affected=${row?.affected}`);
    return { id: row?.id || null, action: row?.action || 'none', affected: Number(row?.affected || 0) };
  }
}

module.exports = StreamMissionMigrationModel;
