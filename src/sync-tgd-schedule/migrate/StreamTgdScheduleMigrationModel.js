const MigrationHelper = require('../../helpers/MigrationHelper');
const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const { tableMappings } = require('./config');
const { v4: uuidv4 } = require('uuid');
const { ensureTrackingColumns } = require('../../helpers/StagingQueueHelper');

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

  getWeekInfo(dateInput) {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return null;

    // Lấy thứ 2 của tuần chứa ngày đó (Coi thứ 2 là đầu tuần)
    const day = d.getDay();
    const diffToMonday = d.getDate() - day + (day === 0 ? -6 : 1); 
    const monday = new Date(d.setDate(diffToMonday));
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday.getTime());
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    // Tính số thứ tự của tuần trong năm (ISO 8601 mode)
    const dCopy = new Date(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()));
    dCopy.setUTCDate(dCopy.getUTCDate() + 4 - (dCopy.getUTCDay()||7));
    const yearStart = new Date(Date.UTC(dCopy.getUTCFullYear(),0,1));
    const weekNo = Math.ceil((((dCopy - yearStart) / 86400000) + 1)/7);

    return {
      week: weekNo,
      year: monday.getFullYear(),
      month: monday.getMonth() + 1,
      from_date: monday,
      to_date: sunday,
      schedule_time: new Date(dateInput)
    };
  }

  /**
   * Đảm bảo bản ghi cha (Schedules) tồn tại và tự động suy luận ID dựa trên dutyDate
   * @returns {Promise<string>} schedule_id
   */
  async ensureScheduleParentExists(dutyDate, leaderId, transaction = null) {
      if (!dutyDate) return null;
      const weekInfo = this.getWeekInfo(dutyDate);
      if (!weekInfo) return null;

      const cacheKey = `${weekInfo.year}_${weekInfo.week}`;
      
      // 1. Kiểm tra Cache RAM tĩnh (Tránh select quá nhiều)
      if (this.parentScheduleCache && this.parentScheduleCache.has(cacheKey)) {
          return this.parentScheduleCache.get(cacheKey);
      }

      const schema = this.newDbSchema || 'dbo';
      const parentTableRef = `[${this.newDbName}].[${schema}].[leadership_duty_schedules]`;

      // 2. Lock theo key để diệt "Race Condition" lúc các vòng lặp Promise.all chạy song song
      if (!this.parentScheduleLocks) this.parentScheduleLocks = new Map();

      if (!this.parentScheduleLocks.has(cacheKey)) {
          const lockPromise = (async () => {
              try {
                  // 2.1 Kiểm tra DB trong trường hợp đã chạy từ lượt đồng bộ trước đó
                  const checkQuery = `SELECT TOP 1 id FROM ${parentTableRef} WHERE week = @week AND year = @year`;
                  const rows = await this.queryNewDbTx(checkQuery, { week: weekInfo.week, year: weekInfo.year }, transaction);
                  
                  let scheduleId = '';
                  if (rows && rows.length > 0) {
                      scheduleId = rows[0].id;
                      console.log(`[StreamTgdScheduleMigrationModel] Đã map được với Lịch trực cũ: ID=${scheduleId}`);
                  } else {
                      // 2.2 Tạo mới ID và bản ghi NẾU THỰC SỰ CHƯA CÓ
                      scheduleId = this.generateSystemId('LDS');
                      const title = `Lịch trực chỉ huy tuần ${weekInfo.week} năm ${weekInfo.year}`;
                      const createdBy = leaderId || 'SYSTEM';
                      const queryInsert = `
                          INSERT INTO ${parentTableRef} (
                            id, title, week, month, year, created_by, schedule_date, status, created_at, updated_at, schedule_time, from_date, to_date, table_bak
                          ) VALUES (
                            @id, @title, @week, @month, @year, @created_by, GETDATE(), 1, GETDATE(), GETDATE(), @schedule_time, @from_date, @to_date, 1
                          )
                      `;
                      await this.queryNewDbTx(queryInsert, {
                          id: scheduleId,
                          title,
                          week: weekInfo.week,
                          month: weekInfo.month,
                          year: weekInfo.year,
                          created_by: createdBy,
                          schedule_time: weekInfo.schedule_time,
                          from_date: weekInfo.from_date,
                          to_date: weekInfo.to_date
                      }, transaction);
                      console.log(`[StreamTgdScheduleMigrationModel] Đã tự tạo Parent Schedule mới: ${title} ---> ID: ${scheduleId}`);
                  }

                  if (!this.parentScheduleCache) this.parentScheduleCache = new Map();
                  this.parentScheduleCache.set(cacheKey, scheduleId);
                  
                  return scheduleId;
              } catch (err) {
                  console.error(`[StreamTgdScheduleMigrationModel] Lỗi Ensure Schedule Parent: ${err.message}`);
                  throw err;
              }
          })();

          // Hủy lock nếu rác lỗi giữa chừng để tiến trình sau còn chạy
          lockPromise.catch(() => {
              this.parentScheduleLocks.delete(cacheKey);
              if (this.parentScheduleCache) this.parentScheduleCache.delete(cacheKey);
          });

          this.parentScheduleLocks.set(cacheKey, lockPromise);
      }

      return await this.parentScheduleLocks.get(cacheKey);
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

    if (process.env.DISABLE_ENSURE_SCHEMA === 'true') {
      console.log(`[StreamTgdScheduleMigrationModel] Skipping staging table and column checks (disabled via environment variable)`);
      return;
    }

    await this.ensureStagingTableExists();
    await this.ensureTargetColumnsExist();
    console.log(`[StreamTgdScheduleMigrationModel] Initialization complete.`);
  }

  async ensureTargetColumnsExist() {
    try {
      const table = this.oldConfig.newTable;
      const schema = this.newDbSchema || 'dbo';
      const fullTableRef = `[${this.newDbName}].[${schema}].[${table}]`;
      const parentTableRef = `[${this.newDbName}].[${schema}].[leadership_duty_schedules]`;

      console.log(`[StreamTgdScheduleMigrationModel] Checking/Adding missing columns to ${fullTableRef} and ${parentTableRef}...`);

      // 1. Kiểm tra bảng cha (Schedules)
      const parentCols = [
        { name: 'table_bak', type: 'INT' },
        { name: 'id_sp_bak', type: 'NVARCHAR(255)' },
        { name: 'schedule_time', type: 'DATETIME' },
        { name: 'from_date', type: 'DATETIME' },
        { name: 'to_date', type: 'DATETIME' },
        { name: 'week', type: 'INT' },
        { name: 'month', type: 'INT' },
        { name: 'year', type: 'INT' }
      ];
      for (const col of parentCols) {
        const queryParent = `
          IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'leadership_duty_schedules' AND COLUMN_NAME = '${col.name}')
          BEGIN
              ALTER TABLE ${parentTableRef} ADD ${col.name} ${col.type} NULL;
          END
        `;
        await this.queryNewDb(queryParent);
      }

      // 2. Kiểm tra bảng con (Details)
      const columnsToCheck = [
        { name: '[type]', type: 'NVARCHAR(255)' },
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

      console.log(`[StreamTgdScheduleMigrationModel] [ensureTargetColumnsExist] OK: All columns checked`);
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

      await ensureTrackingColumns(this, {
        tableRef: stagingTableRef,
        tableName: table,
        schemaName: schema,
        dbName: this.newDbName,
        label: this.modelName,
      });

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

  async getCount(lastSyncTime, lastSyncId = 0) {
    const listIds = this.oldConfig.listIds || [];
    const listIdsStr = listIds.map(id => `'${id}'`).join(',');
    const query = `
        SELECT COUNT(*) AS total
        FROM [${this.oldDbName}].[dbo].[AllUserData] ud
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
    `;
    const rows = await this.queryOldDb(query, { lastSyncTime, lastSyncId: Number(lastSyncId || 0) });
    return Number(rows?.[0]?.total || 0);
  }

  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0, offset = 0, limit = 2000) {
    const listIds = this.oldConfig.listIds || [];
    const listIdsStr = listIds.map(id => `'${id}'`).join(',');

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
        SELECT * FROM (
            SELECT
                ${udSelect.join(',\n                ')},
                ${ciSelect.join(',\n                ')},
                ud.[tp_Modified] AS __sync_time,
                ud.[tp_ID] AS __sync_id_num,
                ROW_NUMBER() OVER (ORDER BY ud.[tp_Modified] ASC, ud.[tp_ID] ASC) AS __page_rn

            FROM [${this.oldDbName}].[dbo].[AllUserData] ud
            INNER JOIN [${this.oldDbName}].[dbo].[AllLists] l
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
    console.log(`[StreamTgdScheduleMigrationModel] Fetched ${rows.length} rows from old DB`);
    return rows;
  }

  async syncOldToStaging(rows, { transaction } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return { stagedCount: 0 };
    console.log(`[StreamTgdScheduleMigrationModel] Staging ${rows.length} rows to ${this.newTableSync}...`);
    const internalColumns = new Set(['__sync_time', '__sync_id_num']);
    const columns = Object.keys(rows[0] || {}).filter(
      (c) => !String(c).startsWith('__') && !internalColumns.has(c)
    );
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

    const totalCount = await this.getCount(normalizedLastSyncTime, normalizedLastSyncId);
    console.log(`[StreamTgdScheduleMigrationModel] Total records to sync: ${totalCount}`);

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
        logger.info(`[StreamTgdScheduleMigrationModel] Fetching batch ${i + 1}/${numIterations} (Offset: ${offset}, Limit: ${fetchBatchSize})`);
        
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
            logger.info(`  └─ [Compare] rowID: ${row.ItemID} | T: ${rowTime} ID: ${rowId} vs Cursor(T: ${nextSyncTime} ID: ${nextSyncId}) -> Ahead: ${isAhead}`);

            if (isAhead) {
                nextSyncTime = rowTime;
                nextSyncId = rowId;
            }
        }
        logger.info(`🔥 [StreamTgdScheduleMigrationModel] Batch ${i + 1}/${numIterations} staged: ${totalStagedCount}/${totalCount}. LastSyncTime: ${nextSyncTime}, LastSyncId: ${nextSyncId}`);
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
    try {
      console.log(`[StreamTgdScheduleMigrationModel] ENTER processRowData for recordId=${rowData.ItemID}`);
      
      // --- 1. Resolve Thông tin Người dùng (Làm trước để có Leader ID) ---
      if (!rowData?.ItemID) throw new Error('ItemID is required');
      const recordId = String(rowData.ItemID);
      console.log(`[StreamTgdScheduleMigrationModel] processRowData: recordId=${recordId}`);
      const { externalKey } = this.oldConfig;

      const authorCustomRoles = '[{"processKey":"QUY_TRINH_LICH_HOP","name":"QUY_TRINH_LICH_HOP","roles":[{"roleCode":"BAN_QUAN_LY_PHONG_HOP","name":"BAN_QUAN_LY_PHONG_HOP"},{"roleCode":"ADMIN","name":"ADMIN"}]},{"processKey":"QUY_TRINH_PHONG_HOP","name":"QUY_TRINH_PHONG_HOP","roles":[{"roleCode":"BAN_QUAN_LY_PHONG_HOP","name":"BAN_QUAN_LY_PHONG_HOP"}]},{"processKey":"LICH_TRUC_BAN_LANH_DAO","name":"LICH_TRUC_BAN_LANH_DAO","roles":[{"roleCode":"LANH_DAO","name":"LANH_DAO"}]},{"processKey":"dashboardPage","name":"dashboardPage","roles":[{"roleCode":"VT","name":"VT"}]}]';
      
      // Kịch bản Waterfall Fallback dò tìm User chặt chẽ cho Leader (created_by + leader_id)
      const candidates = [
        { key: 'Organizer', type: 'name', value: rowData.Organizer },
        { key: 'AuthorName', type: 'name', value: rowData.AuthorName },
        { key: 'AuthorAccount', type: 'account', value: rowData.AuthorAccount },
        { key: 'AuthorEmail', type: 'account', value: rowData.AuthorEmail ? rowData.AuthorEmail.split('@')[0] : null },
        { key: 'EditorName', type: 'name', value: rowData.EditorName },
        { key: 'EditorAccount', type: 'account', value: rowData.EditorAccount }
      ];

      let resolvedLeaderId = null;

      for (const cand of candidates) {
        if (!cand.value) continue;
        console.log(`[StreamTgdScheduleMigrationModel] Dò tìm Leader qua [${cand.key}]: ${cand.value}`);
        
        if (cand.type === 'name') {
          resolvedLeaderId = await this.helper.resolveUserIdByFullName(cand.value, transaction, authorCustomRoles);
        } else {
          resolvedLeaderId = await this.helper.resolveUserIdByAccountName(cand.value, transaction, authorCustomRoles);
        }
        
        if (resolvedLeaderId) {
          console.log(`[StreamTgdScheduleMigrationModel] ---> Đã khóa mục tiêu Leader ID: ${resolvedLeaderId}`);
          await this._ensureUserHasRoles(resolvedLeaderId, authorCustomRoles, transaction);
          break;
        }
      }

      if (resolvedLeaderId) {
        rowData.Organizer = resolvedLeaderId;
      } else {
        console.log(`[StreamTgdScheduleMigrationModel] Fallback Waterfall thất bại, dùng ID cứng.`);
        rowData.Organizer = this.oldConfig.defaultValues?.leader_id || '6915f2387e39c2ba33cef79a';
      }
      
      // Xử lý nốt để nguyên cái Account cũ update lại
      if (rowData.AuthorAccount && typeof rowData.AuthorAccount === 'string' && rowData.AuthorAccount.includes('|')) {
         const authorId = await this.helper.resolveUserIdByAccountName(rowData.AuthorAccount, transaction, authorCustomRoles);
         if (authorId) {
            rowData.AuthorAccount = authorId;
            await this._ensureUserHasRoles(authorId, authorCustomRoles, transaction);
         }
      }

      // --- 2. Xác định Schedule ID theo Tuần/Năm (Động) SAU KHI ĐÃ CÓ LEADER ID ---
      const dutyDate = rowData.StartDate || new Date();
      let parentLeaderId = rowData.Organizer;
      
      if (!parentLeaderId) {
          const defaultLeaderId = this.oldConfig.defaultValues?.leader_id;
          parentLeaderId = typeof defaultLeaderId === 'function' ? defaultLeaderId(rowData) : defaultLeaderId;
      }
      if (!parentLeaderId) parentLeaderId = '6915f2387e39c2ba33cef79a'; // Fallback cuối cùng
      
      const scheduleId = await this.ensureScheduleParentExists(dutyDate, parentLeaderId, transaction);
      
      if (scheduleId) {
          rowData.schedule_id = scheduleId; // Bắt buộc hàng con map với ID vừa tạo
          console.log(`[StreamTgdScheduleMigrationModel] Bản ghi con ItemID=${rowData.ItemID} map với Parent ID: "${scheduleId}"`);
      }

      const result = await this.upsertDataToNewDB(rowData, this.oldConfig, externalKey, recordId, transaction);
      console.log(`[StreamTgdScheduleMigrationModel] Upsert result: ${result.action}, ID=${result.id}`);
      return { backupId: recordId, affected: result.affected, logs: [{ table: this.oldConfig.newTable, action: result.action }] };
    } catch (err) {
      console.error(`[StreamTgdScheduleMigrationModel] CRITICAL ERROR inside processRowData for ItemID ${rowData?.ItemID}: ${err.message}`);
      return { backupId: rowData?.ItemID, affected: 0, logs: [{ table: this.oldConfig?.newTable, action: 'error_skipped' }] };
    }
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

    // --- 3.1 Đảm bảo schedule_id lấy chuẩn ID động (Ghi đè config cứng) ---
    if (existingCols.has('schedule_id')) {
        let finalScheduleId = params['schedule_id'];
        
        if (rawData.schedule_id) {
            finalScheduleId = rawData.schedule_id; // Ép dùng ID động vừa gen
        } else if (!finalScheduleId || finalScheduleId === '00000000-0000-0000-0000-000000000000') {
            const configScheduleId = config.defaultValues?.schedule_id;
            finalScheduleId = typeof configScheduleId === 'function' ? configScheduleId(rawData) : configScheduleId;
        }
        
        if (!finalScheduleId || finalScheduleId === '00000000-0000-0000-0000-000000000000') {
            finalScheduleId = this.generateSystemId('LDS');
        }
        
        params['schedule_id'] = finalScheduleId;

        if (!insertCols.includes('[schedule_id]')) {
            insertCols.push('[schedule_id]');
            insertVals.push('@schedule_id');
            updateSet.push(`[schedule_id] = @schedule_id`);
        } else if (!updateSet.includes(`[schedule_id] = @schedule_id`)) {
            updateSet.push(`[schedule_id] = @schedule_id`);
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
    console.log(`[StreamTgdScheduleMigrationModel] --- EXECUTING UPSERT for ItemID ${rawData.ItemID} ---`);
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

  /**
   * Đảm bảo tính riêng biệt: Chỉ riêng chức năng TGD mới tự động quét và merge Quyền cho các User
   * cũ đê đảm bảo họ luôn có quyền "LICH_TRUC_BAN_LANH_DAO".
   */
  async _ensureUserHasRoles(userId, customRolesStr, transaction = null) {
    if (!userId || !customRolesStr) return;
    try {
      const q = `SELECT TOP 1 roles_by_process FROM [${this.newDbName}].[dbo].[users] WHERE id = @id`;
      const rows = await this.queryNewDbTx(q, { id: userId }, transaction);
      if (!rows || rows.length === 0) return;
      
      const currentRolesStr = rows[0].roles_by_process;
      
      if (!currentRolesStr || currentRolesStr.trim() === '' || currentRolesStr.trim() === '[]') {
        const updateQ = `UPDATE [${this.newDbName}].[dbo].[users] SET roles_by_process = @roles WHERE id = @id`;
        await this.queryNewDbTx(updateQ, { id: userId, roles: customRolesStr }, transaction);
        console.log(`[StreamTgdScheduleMigrationModel] Đã cấp mới roles_by_process cho id=${userId}`);
        return;
      }

      const oldArr = JSON.parse(currentRolesStr);
      const newArr = JSON.parse(customRolesStr);
      
      if (!Array.isArray(oldArr) || !Array.isArray(newArr)) return;

      const map = new Map();
      for (const item of oldArr) {
        if (item && item.processKey) map.set(item.processKey, item);
      }

      let isChanged = false;
      for (const newItem of newArr) {
        if (newItem && newItem.processKey) {
          if (!map.has(newItem.processKey)) {
            map.set(newItem.processKey, newItem);
            isChanged = true;
          }
        }
      }

      if (isChanged) {
        const mergedRolesStr = JSON.stringify(Array.from(map.values()));
        const updateQ = `UPDATE [${this.newDbName}].[dbo].[users] SET roles_by_process = @roles WHERE id = @id`;
        await this.queryNewDbTx(updateQ, { id: userId, roles: mergedRolesStr }, transaction);
        console.log(`[StreamTgdScheduleMigrationModel] Đã chèn bổ sung quyền LICH_TRUC_BAN_LANH_DAO cho id=${userId} mà không làm mất quyền cũ.`);
      }
    } catch (e) {
      console.log(`[StreamTgdScheduleMigrationModel] Lỗi khi merge roles_by_process cho id=${userId}: ${e.message}`);
    }
  }
}

module.exports = StreamTgdScheduleMigrationModel;
