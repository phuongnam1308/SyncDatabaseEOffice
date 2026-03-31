const MigrationHelper = require('../../helpers/MigrationHelper');
const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const { tableMappings } = require('./config');
const { v4: uuidv4 } = require('uuid');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class StreamTgdScheduleMigrationModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_TGD_SCHEDULE_MIGRATION' });

    // 🔥 FIXED: Robustly access tableMappings from config.js
    const config = tableMappings && tableMappings.tgd_schedule;
    this.oldConfig = config;

    if (!this.oldConfig) {
        const availableKeys = tableMappings ? Object.keys(tableMappings).join(', ') : 'null';
        console.error(`[StreamTgdScheduleMigrationModel] CRITICAL ERROR: 'tgd_schedule' NOT FOUND in config.js. Available keys: [${availableKeys}]`);
        // We still assign dummy values to prevent 'oldDatabase' of undefined error during constructor
        this.oldConfig = {
            oldDatabase: 'WSS_Content_eoffice_khkd',
            oldSchema: 'dbo',
            oldTable: 'AllUserData',
            newTable: 'leadership_duty_details',
            newDatabase: 'DiOffice',
            listIds: []
        };
    }

    this.oldDbName = this.oldConfig.oldDatabase;
    this.oldDbSchema = this.oldConfig.oldSchema;
    this.oldDbTable = this.oldConfig.oldTable;
    this.oldUserDb = this.oldConfig.oldUserDatabase || 'WSS_Content_eoffice';

    // Bảng staging tạm thời
    this.newDbName = this.oldConfig.newDatabase || 'DiOffice';
    this.newDbSchema = this.oldConfig.newSchema || 'dbo';
    this.newTableSync = 'tgd_schedule_sync_staging';
    this.helper = new MigrationHelper(this.queryNewDbTx.bind(this), this.queryOldDb.bind(this));

    this.sourceSchema = {
        allUserData: new Set(),
        codeItem: new Set(),
        hasUserInfo: false
    };
  }

  /**
   * Sinh ID theo định dạng hệ thống: PREFIX_TIMESTAMP_RANDOM8
   * Ví dụ: LDD_1773063888230_1OLLTPRY
   */
  generateSystemId(prefix) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10).toUpperCase();
    return `${prefix}_${timestamp}_${random}`;
  }

  /**
   * Đảm bảo bản ghi cha (Schedules) tồn tại để tránh lỗi Foreign Key
   */
  async ensureScheduleParentExists(scheduleId, transaction = null) {
    if (!scheduleId || scheduleId.length < 5) {
      console.warn(`[StreamTgdScheduleMigrationModel] Invalid scheduleId: "${scheduleId}"`);
      return;
    }

    // 2. Tạo mới bản ghi mẫu (Parent) - Cập nhật theo schema thực tế (id, title, week, month, year, created_by, schedule_date, status, created_at, updated_at)
    console.log(`[StreamTgdScheduleMigrationModel] +++ ATTEMPTING TO CREATE PARENT SCHEDULE (CORRECT SCHEMA): ${scheduleId} +++`);
    const queryInsert = `
      INSERT INTO ${tableRef} (
        id, title, week, month, year, created_by, schedule_date, status, created_at, updated_at
      ) VALUES (
        @id, @title, 1, 1, 2026, 'SYSTEM', GETDATE(), 1, GETDATE(), GETDATE()
      )
    `;
    
    try {
      await this.queryNewDbTx(queryInsert, { 
        id: scheduleId, 
        title: 'Lịch trực ban Lãnh đạo (Đồng bộ)' 
      }, transaction);
      console.log(`[StreamTgdScheduleMigrationModel] Successfully created parent schedule: ${scheduleId}`);
    } catch (err) {
      console.error(`[StreamTgdScheduleMigrationModel] CRITICAL ERROR creating parent schedule: ${err.message}`);
      throw err;
    }
  }

  async cacheSourceSchema() {
      try {
          this.sourceSchema.allUserData = await this.helper.getExistingColumnsSource(this.oldDbName, 'AllUserData');
          this.sourceSchema.codeItem = await this.helper.getExistingColumnsSource('DataEOfficeSNP', 'CodeItem', 'SNP');
          this.sourceSchema.hasUserInfo = await this.helper.checkTableExistsSource(this.oldUserDb, 'UserInfo');

          console.log(`[StreamTgdScheduleMigrationModel] Source Schema Cached:
            AllUserData: ${this.sourceSchema.allUserData.size} columns,
            CodeItem: ${this.sourceSchema.codeItem.size} columns,
            UserInfo exists: ${this.sourceSchema.hasUserInfo}`);
      } catch (err) {
          console.warn(`[StreamTgdScheduleMigrationModel] cacheSourceSchema Error: ${err.message}`);
      }
  }

  async initialize() {
    console.log(`[StreamTgdScheduleMigrationModel] Initializing...`);
    await super.initialize();

    // 🔥 Cache Source Schema to prevent "Invalid column name" errors
    await this.cacheSourceSchema();

    await this.ensureStagingTableExists();
    await this.ensureTargetColumnsExist();
    console.log(`[StreamTgdScheduleMigrationModel] Initialization complete.`);
  }

  async ensureTargetColumnsExist() {
    try {
      const table = this.oldConfig.newTable;
      const schema = this.newDbSchema || 'dbo';
      const fullTableRef = `[${this.newDbName}].[${schema}].[${table}]`;

      console.log(`[StreamTgdScheduleMigrationModel] Checking/Adding missing columns to ${fullTableRef}...`);

      const columnsToCheck = [
        { name: '[type]', type: 'NVARCHAR(255)' }, // 'type' là từ khóa SQL
        { name: 'location', type: 'NVARCHAR(500)' },
        { name: 'participants', type: 'NVARCHAR(MAX)' },
        { name: 'description', type: 'NVARCHAR(MAX)' },
        { name: 'table_bak', type: 'INT' },
        { name: 'id_sp_bak', type: 'NVARCHAR(255)' },
        { name: 'morning_location', type: 'NVARCHAR(500)' },
        { name: 'morning_content', type: 'NVARCHAR(MAX)' },
        { name: 'afternoon_location', type: 'NVARCHAR(500)' },
        { name: 'afternoon_content', type: 'NVARCHAR(MAX)' },
        { name: 'calendar_format', type: 'NVARCHAR(255)' },
        { name: 'work_date', type: 'DATETIME' },
        { name: 'schedules', type: 'NVARCHAR(MAX)' }
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

      console.log(`[StreamTgdScheduleMigrationModel] [ensureTargetColumnsExist] OK: All columns checked for ${table}`);
    } catch (err) {
      console.error(`[StreamTgdScheduleMigrationModel] [ensureTargetColumnsExist] ERROR: ${err.message}`);
    }
  }

  async ensureStagingTableExists() {
    try {
      const stagingTableRef = this.getStagingTableRef();
      console.log(`[StreamTgdScheduleMigrationModel] Checking/Creating staging table: ${stagingTableRef}`);
      const schema = this.newDbSchema || 'dbo';
      const table = this.newTableSync;

      // 1. Tạo bảng cơ bản nếu chưa có - Sử dụng ItemID làm khóa chính staging
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

      // 2. Danh sách các cột cần đảm bảo
      const columnsToAdd = [
          { name: 'ListName', type: 'NVARCHAR(500)' },
          { name: 'ItemID', type: 'BIGINT' }, // Cho phép ItemID trùng với bộ nhớ cũ
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

          { name: 'DocumentID', type: 'BIGINT' },
          { name: 'DocumentTitle', type: 'NVARCHAR(MAX)' },
          { name: 'DocumentSubject', type: 'NVARCHAR(MAX)' },
          { name: 'LoaiVanBan', type: 'NVARCHAR(500)' },
          { name: 'DepartmentId', type: 'NVARCHAR(500)' },
          { name: 'DocumentStatus', type: 'NVARCHAR(500)' },
          { name: 'DocumentStatusText', type: 'NVARCHAR(MAX)' },
          { name: 'DocumentCreatedDate', type: 'NVARCHAR(500)' },
          { name: 'DocumentModified', type: 'NVARCHAR(500)' },
          { name: 'Content', type: 'NVARCHAR(MAX)' },
          { name: 'DonViChuTri', type: 'NVARCHAR(1000)' },
          { name: 'SoVanBanDi', type: 'NVARCHAR(500)' },
          { name: 'IssuedDate', type: 'NVARCHAR(500)' },
          { name: 'Updating', type: 'INT' },

          // Missing columns from CodeItem JOIN (Prevent "Invalid column name" errors)
          { name: 'IsNAS', type: 'NVARCHAR(50)' },
          { name: 'NAS_MESS', type: 'NVARCHAR(MAX)' },
          { name: 'Status', type: 'NVARCHAR(255)' },
          { name: 'StatusText', type: 'NVARCHAR(MAX)' },
          { name: 'WorkflowId', type: 'NVARCHAR(500)' },
          { name: 'Step', type: 'NVARCHAR(500)' },
          { name: 'DocumentCreatedBy', type: 'NVARCHAR(500)' },
          { name: 'DocumentModifiedBy', type: 'NVARCHAR(500)' },
          { name: 'LinkedItemID', type: 'BIGINT' },
          { name: 'DocumentSiteName', type: 'NVARCHAR(500)' },
          { name: 'GoiDuAn1', type: 'NVARCHAR(MAX)' },
          { name: 'GoiDuAn', type: 'NVARCHAR(MAX)' },
          { name: 'GoiDauTu', type: 'NVARCHAR(MAX)' },
          { name: 'DonViSoanThao', type: 'NVARCHAR(MAX)' },
          { name: 'SoKH', type: 'NVARCHAR(500)' },
          { name: 'NgayKyKH', type: 'NVARCHAR(500)' },
          { name: 'HubPackageId', type: 'NVARCHAR(500)' },
          { name: 'IsHubSendOut', type: 'NVARCHAR(50)' },
          { name: 'Name', type: 'NVARCHAR(MAX)' },
          { name: 'StampWithKey', type: 'NVARCHAR(MAX)' },
          { name: 'ChildId', type: 'NVARCHAR(500)' },
          { name: 'IsDaKy', type: 'NVARCHAR(50)' },
          { name: 'IsDaIn', type: 'NVARCHAR(50)' },
          { name: 'ResourceFormId', type: 'NVARCHAR(500)' },
          { name: 'AssignedToText', type: 'NVARCHAR(MAX)' },
          { name: 'SPListName', type: 'NVARCHAR(500)' },
          { name: 'ApproverByStep', type: 'NVARCHAR(MAX)' },
          { name: 'YKien', type: 'NVARCHAR(MAX)' },
          { name: 'VBBiThayThe', type: 'NVARCHAR(MAX)' },
          { name: 'ThamQuyen', type: 'NVARCHAR(500)' },
          { name: 'SoVanBanNum', type: 'NVARCHAR(500)' },
          { name: 'Price', type: 'NVARCHAR(500)' },
          { name: 'PreviousStep', type: 'NVARCHAR(500)' },
          { name: 'ParentId', type: 'NVARCHAR(500)' },
          { name: 'NgayDanTau', type: 'NVARCHAR(500)' },
          { name: 'LoaiMoc', type: 'NVARCHAR(500)' },
          { name: 'LoaiBanHanh', type: 'NVARCHAR(500)' },
          { name: 'ReccurencyType', type: 'NVARCHAR(500)' },
          { name: 'KyHaiLien', type: 'NVARCHAR(500)' },
          { name: 'EndLoop', type: 'NVARCHAR(500)' },
          { name: 'DongMoc', type: 'NVARCHAR(500)' },
          { name: 'ChenSo', type: 'NVARCHAR(500)' },
          { name: 'ActionStatus', type: 'NVARCHAR(500)' },
          { name: 'ConvertedDate', type: 'NVARCHAR(500)' },
          { name: 'IsConverting', type: 'NVARCHAR(50)' },
          { name: 'IsArchived', type: 'NVARCHAR(50)' },
          { name: 'TaskId', type: 'NVARCHAR(500)' },
          { name: 'Locker', type: 'NVARCHAR(500)' },
          { name: 'SubmitDate', type: 'NVARCHAR(500)' },
          { name: 'ApprovedDate', type: 'NVARCHAR(500)' },
          { name: 'Approver', type: 'NVARCHAR(500)' },
          { name: 'IsKyQuyChe', type: 'NVARCHAR(50)' },
          { name: 'CBNV', type: 'NVARCHAR(MAX)' },
          { name: 'DocumentId', type: 'NVARCHAR(500)' },
          { name: 'SPListId', type: 'NVARCHAR(500)' }
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

      console.log(`[StreamTgdScheduleMigrationModel] [ensureStagingTableExists] OK: ${stagingTableRef} is ready`);
    } catch (err) {
      console.error(`[StreamTgdScheduleMigrationModel] [ensureStagingTableExists] ERROR: ${err.message}`);
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
    return Number(row?.__sync_id_num ?? row?.ItemID ?? row?.ID ?? 0);
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
        'Title', 'Subject', 'LoaiVanBan', 'DepartmentId', 'Status', 'StatusText',
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

    const ciSelect = ciColumns.map(col => {
        const alias = col === 'ID' ? 'DocumentID' :
                     (col === 'Title' ? 'DocumentTitle' :
                     (col === 'Subject' ? 'DocumentSubject' :
                     (col === 'Status' ? 'DocumentStatus' :
                     (col === 'StatusText' ? 'DocumentStatusText' :
                     (col === 'Created' ? 'DocumentCreatedDate' :
                     (col === 'CreatedBy' ? 'DocumentCreatedBy' :
                     (col === 'Modified' ? 'DocumentModified' :
                     (col === 'ModifiedBy' ? 'DocumentModifiedBy' :
                     (col === 'SPItemId' ? 'LinkedItemID' :
                     (col === 'SiteName' ? 'DocumentSiteName' : col))))))))))

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
        INNER JOIN [${this.oldDbName}].[dbo].[AllLists] l
            ON ud.[tp_ListId] = l.[tp_ID]
        ${cols.hasUserInfo ? `LEFT JOIN [${this.oldUserDb}].[dbo].[UserInfo] ui_author ON ud.[tp_Author] = ui_author.[tp_ID]` : ''}
        ${cols.hasUserInfo ? `LEFT JOIN [${this.oldUserDb}].[dbo].[UserInfo] ui_editor ON ud.[tp_Editor] = ui_editor.[tp_ID]` : ''}
        LEFT JOIN [DataEOfficeSNP].[SNP].[CodeItem] ci ON ud.[tp_ID] = ci.[SPItemId]

        WHERE ud.[tp_ListId] IN (${listIdsStr})
        AND ud.[tp_IsCurrent] = 1
        AND ud.[tp_DeleteTransactionId] = 0x0
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
    console.log(`[StreamTgdScheduleMigrationModel] Fetched ${rows.length} rows from old DB`);
    return rows;
  }

  async syncOldToStaging(rows, { transaction } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return { stagedCount: 0 };
    console.log(`[StreamTgdScheduleMigrationModel] Staging ${rows.length} rows to ${this.newTableSync}...`);
    const internalColumns = new Set(['__sync_time', '__sync_id_num']);
    const columns = Object.keys(rows[0]).filter(c => !internalColumns.has(c));
    const keyColumn = 'ItemID';
    const stagingTableRef = this.getStagingTableRef();

    // Helper to normalize values (e.g., 'false' -> 0, 'true' -> 1)
    const normalizeValue = (val, colName) => {
        if (val === 'false' || val === false) return 0;
        if (val === 'true' || val === true) return 1;
        
        // Handle numeric columns specifically if needed
        const intCols = ['ItemID', 'DocumentID', 'LinkedItemID', 'Updating', 'IsNAS', 'IsHubSendOut', 'IsDaKy', 'IsDaIn', 'IsArchived', 'IsConverting', 'EndLoop', 'IsKyQuyChe', 'KyHaiLien'];
        if (intCols.includes(colName)) {
            if (val === null || val === undefined || val === '') return 0;
            const num = Number(val);
            return isNaN(num) ? 0 : num;
        }
        return val;
    };

    let processedCount = 0;
    for (const row of rows) {
      const params = {};
      const colPairs = [];

      try {
          // Tham số hóa ID đầu tiên để tránh xung đột
          params['id_key'] = normalizeValue(row[keyColumn], keyColumn);
          params['sync_time'] = row.__sync_time;
          params['sync_id_num'] = row.__sync_id_num;

          // Xử lý các cột còn lại bằng p0, p1, ...
          columns.forEach((col, index) => {
            const pName = `p${index}`;
            const rawVal = row[col];
            params[pName] = normalizeValue(rawVal, col);
            
            if (col !== keyColumn) {
              colPairs.push(`[${col}] = @${pName}`);
            }
          });

          const updateSet = colPairs.length > 0 ? colPairs.join(', ') : `[${keyColumn}] = [${keyColumn}]`;
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
          processedCount++;
      } catch (err) {
          console.error(`[StreamTgdScheduleMigrationModel] ERROR staging row with ItemID=${row[keyColumn]}: ${err.message}`);
          console.error(`Problematic values: ${JSON.stringify(row)}`);
          // Continue to next row in case of single failure, or rethrow if it's a connection issue
          if (err.message.includes('deadlock') || err.message.includes('connection')) throw err;
      }
    }

    console.log(`[StreamTgdScheduleMigrationModel] Staging complete for ${processedCount}/${rows.length} rows`);
    return { stagedCount: processedCount };
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
        `ud.[tp_ID] AS ItemID`,
        `ud.[tp_Created] AS tp_Created`,
        `ud.[tp_Modified] AS tp_Modified`,
        cols.hasUserInfo ? `ui_author.[tp_Title] AS AuthorName` : `NULL AS AuthorName`,
        cols.hasUserInfo ? `ui_author.[tp_Login] AS AuthorAccount` : `NULL AS AuthorAccount`,
        cols.allUserData.has('nvarchar1') ? `ud.[nvarchar1] AS Title` : `NULL AS Title`,
        cols.allUserData.has('datetime1') ? `ud.[datetime1] AS StartDate` : `NULL AS StartDate`,
        cols.allUserData.has('datetime2') ? `ud.[datetime2] AS EndDate` : `NULL AS EndDate`,
        cols.allUserData.has('nvarchar2') ? `ud.[nvarchar2] AS Location` : `NULL AS Location`,
        cols.allUserData.has('nvarchar3') ? `ud.[nvarchar3] AS Description` : `NULL AS Description`,
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
    console.log(`[StreamTgdScheduleMigrationModel] processOne: Starting job ${syncJobId}`);
    const jobState = await this.getSyncJobState(syncJobId);
    if (!jobState) throw new Error(`Job state not found: ${syncJobId}`);
    const rowData = await this.fetchOneFromSource({
      lastSyncTime: this.normalizeSyncTime(jobState.last_sync_time || DEFAULT_SYNC_TIME),
      lastSyncId: Number(jobState.last_sync_id || 0)
    });
    if (!rowData) {
        console.log(`[StreamTgdScheduleMigrationModel] processOne: No more data for job ${syncJobId}`);
        return { syncJobId, processed: false, done: true };
    }

    console.log(`[StreamTgdScheduleMigrationModel] processOne: Processing row ItemID ${rowData.ItemID}`);
    await this.processRowData(rowData);
    await this.queryNewDb(
      `UPDATE sync_jobs SET total_processed = ISNULL(total_processed,0) + 1, total_success = ISNULL(total_success,0) + 1,
       last_sync_time = @lastSyncTime, last_sync_id = @lastSyncId WHERE job_id = @syncJobId`,
      { syncJobId, lastSyncTime: this.extractRowSyncTime(rowData), lastSyncId: this.extractRowSyncId(rowData) }
    );
    console.log(`[StreamTgdScheduleMigrationModel] processOne: Successfully processed row ItemID ${rowData.ItemID}`);
    return { syncJobId, processed: true, done: false };
  }

  async processRowData(rowData, { transaction } = {}) {
    console.log(`[StreamTgdScheduleMigrationModel] ENTER processRowData for recordId=${rowData.ItemID}`);
    
    // --- 0. Xác định Schedule ID (Fix cứng theo yêu cầu người dùng) ---
    const scheduleId = 'LDS_1773063888220_HNP0JV0N';
    rowData.schedule_id = scheduleId; // Đảm bảo hàng con dùng đúng ID này
    
    console.log(`[StreamTgdScheduleMigrationModel] Using hardcoded scheduleId: "${scheduleId}"`);
    
    // Đảm bảo bản ghi cha tồn tại
    await this.ensureScheduleParentExists(scheduleId, transaction);
    console.log(`[StreamTgdScheduleMigrationModel] Finished ensureScheduleParentExists for: ${scheduleId}`);

    // --- 1. Resolve Thông tin Người dùng ---
    if (!rowData?.ItemID) throw new Error('ItemID is required');
    const recordId = String(rowData.ItemID);
    console.log(`[StreamTgdScheduleMigrationModel] processRowData: recordId=${recordId}`);
    const { externalKey } = this.oldConfig;

    if (rowData.AuthorAccount) {
      console.log(`[StreamTgdScheduleMigrationModel] Mapping Author: ${rowData.AuthorAccount}`);
      const authorId = await this.helper.resolveUserIdByFullName(rowData.AuthorAccount, transaction);
      if (authorId) rowData.AuthorAccount = authorId;
    }

    if (rowData.Organizer) {
      console.log(`[StreamTgdScheduleMigrationModel] Mapping Organizer (Leader): ${rowData.Organizer}`);
      const leaderId = await this.helper.findUserIdByName(rowData.Organizer);
      if (leaderId) {
        rowData.Organizer = leaderId;
      } else {
        console.log(`[StreamTgdScheduleMigrationModel] Leader not found: ${rowData.Organizer}. Using mapping default.`);
        rowData.Organizer = this.oldConfig.defaultValues?.leader_id || '6915f2387e39c2ba33cef79a';
      }
    }

    const result = await this.upsertDataToNewDB(rowData, this.oldConfig, externalKey, recordId, transaction);
    console.log(`[StreamTgdScheduleMigrationModel] Upsert result: ${result.action}, ID=${result.id}`);
    return { backupId: recordId, affected: result.affected, logs: [{ table: this.oldConfig.newTable, action: result.action }] };
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
    result.forEach(r => colMap.set(r.COLUMN_NAME.toLowerCase(), { 
        type: (r.DATA_TYPE || '').toLowerCase(), 
        isIdentity: r.IsIdentity === 1 
    }));
    return colMap;
  }

  async upsertDataToNewDB(rawData, config, externalKeyField, externalKeyValue, transaction) {
    const { newTable, newSchema, fieldMapping, defaultValues } = config;
    const existingCols = await this.getExistingColumns(newTable, newSchema);

    const params = {};
    const insertCols = [];
    const insertVals = [];
    const updateSet = [];

    // --- 1. Ánh xạ từ fieldMapping ---
    for (const [oldField, newField] of Object.entries(fieldMapping)) {
      const lowerNewField = newField.toLowerCase();
      const colInfo = existingCols.get(lowerNewField);
      if (!colInfo || colInfo.isIdentity) continue;
      
      const value = rawData[oldField];
      if (value !== undefined) {
          params[lowerNewField] = value;
          if (!insertCols.includes(`[${lowerNewField}]`)) {
              insertCols.push(`[${lowerNewField}]`); 
              insertVals.push(`@${lowerNewField}`);
              if (lowerNewField !== 'id' && lowerNewField !== 'created_at') {
                  updateSet.push(`[${lowerNewField}] = @${lowerNewField}`);
              }
          }
      }
    }

    // --- 2. Ánh xạ từ defaultValues (Ghi đè nếu thiếu hoặc NULL) ---
    for (const [newField, valueFn] of Object.entries(defaultValues || {})) {
      const lowerNewField = newField.toLowerCase();
      const colInfo = existingCols.get(lowerNewField);
      if (!colInfo || colInfo.isIdentity) continue;
      
      // Apply default if missing OR if value is null
      if (params[lowerNewField] === undefined || params[lowerNewField] === null) {
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

    // --- 3. Đảm bảo ID định dạng hệ thống (LDD_...) ---
    if (existingCols.has('id') && (params['id'] === undefined || params['id'] === null || params['id'] === '00000000-0000-0000-0000-000000000000' || params['id'] === '')) {
        params['id'] = this.generateSystemId('LDD');
        if (!insertCols.includes('[id]')) {
            insertCols.push('[id]');
            insertVals.push('@id');
        }
    }

    // --- 3.1 Đảm bảo schedule_id định dạng hệ thống (LDS_...) ---
    if (existingCols.has('schedule_id') && (params['schedule_id'] === undefined || params['schedule_id'] === null || params['schedule_id'] === '00000000-0000-0000-0000-000000000000' || params['schedule_id'] === '')) {
        // Ưu tiên dùng từ rowData nếu đã được gán (ở processRowData) hoặc config
        params['schedule_id'] = rowData.schedule_id || config.defaultValues?.schedule_id || this.generateSystemId('LDS');
        if (!insertCols.includes('[schedule_id]')) {
            insertCols.push('[schedule_id]');
            insertVals.push('@schedule_id');
        }
    }

    // --- 4. Tự động điền dữ liệu dựa trên kiểu dữ liệu của cột (Bỏ qua ID) ---
    const currentParamKeys = new Set(Object.keys(params).map(k => k.toLowerCase()));
    for (const [col, info] of existingCols.entries()) {
      const lowerCol = col.toLowerCase();
      if (info.isIdentity || currentParamKeys.has(lowerCol) || lowerCol === 'id') continue;
      
      const type = info.type;
      let fallback = null;
      if (type.includes('char') || type.includes('text')) {
          fallback = (lowerCol === 'calendar_format') ? 'fullDay' : '';
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
    
    // --- 5. LOG TRƯỚC KHI TRUY VẤN ---
    console.log(`[StreamTgdScheduleMigrationModel] --- EXECUTING UPSERT for ItemID ${rowData.ItemID} ---`);
    console.log(`[StreamTgdScheduleMigrationModel] schedule_id in params: "${params.schedule_id}"`);

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
      END`;
    const result = await this.queryNewDbTx(query, params, transaction);
    const row = Array.isArray(result) ? result[0] : result;
    return { id: row?.id || null, action: row?.action || 'none', affected: Number(row?.affected || 0) };
  }
}

module.exports = StreamTgdScheduleMigrationModel;
