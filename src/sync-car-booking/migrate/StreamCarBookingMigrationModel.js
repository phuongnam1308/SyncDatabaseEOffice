const MigrationHelper = require('../../helpers/MigrationHelper');
const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const { tableMappings } = require('./config');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class StreamCarBookingMigrationModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_CAR_BOOKING_MIGRATION' });
    this.oldConfig = tableMappings.car_booking;
    this.oldDbName = this.oldConfig.oldDatabase;
    this.oldDbSchema = this.oldConfig.oldSchema;
    this.oldDbTable = this.oldConfig.oldTable;
    this.oldUserDb = this.oldConfig.oldUserDatabase || 'WSS_Content_eoffice';
    this.newDbName = this.oldConfig.newDatabase || 'camunda';
    this.newDbSchema = this.oldConfig.newSchema || 'dbo';
    this.newTableSync = 'car_booking_sync_staging';
    this.helper = new MigrationHelper(this.queryNewDbTx.bind(this), this.queryOldDb.bind(this));
    this.sourceSchema = {
        allUserData: new Set(),
        codeItem: new Set(),
        hasUserInfo: false
    };
  }

  async initialize() {
    console.log(`[StreamCarBookingMigrationModel] Initializing...`);
    await super.initialize();

    // 🔥 Cache Source Schema to prevent "Invalid column name" errors
    await this.cacheSourceSchema();

    await this.ensureStagingTableExists();
    await this.ensureTargetColumnsExist();
    console.log(`[StreamCarBookingMigrationModel] Initialization complete.`);
  }

  async cacheSourceSchema() {
      try {
          this.sourceSchema.allUserData = await this.helper.getExistingColumnsSource(this.oldDbName, 'AllUserData');
          this.sourceSchema.codeItem = await this.helper.getExistingColumnsSource('DataEOfficeSNP', 'CodeItem', 'SNP');
          this.sourceSchema.hasUserInfo = await this.helper.checkTableExistsSource(this.oldUserDb, 'UserInfo');

          console.log(`[StreamCarBookingMigrationModel] Source Schema Cached:
            AllUserData: ${this.sourceSchema.allUserData.size} columns,
            CodeItem: ${this.sourceSchema.codeItem.size} columns,
            UserInfo exists: ${this.sourceSchema.hasUserInfo}`);
      } catch (err) {
          console.warn(`[StreamCarBookingMigrationModel] cacheSourceSchema Error: ${err.message}`);
      }
  }

  async ensureTargetColumnsExist() {
    try {
      const db = this.newDbName || 'app_tancang';
      const schema = this.newDbSchema || 'dbo';

      // 1. Phân tích & Khởi tạo Bảng VEHICLE_REGISTRATIONS (Master)
      const masterTable = 'vehicle_registrations';
      const masterRef = `[${db}].[${schema}].[${masterTable}]`;

      const masterCols = [
        { name: 'id', type: 'uniqueidentifier', nullable: 'DEFAULT newid() NOT NULL' },
        { name: 'name', type: 'nvarchar(255)', nullable: 'NULL' },
        { name: 'request_type', type: 'nvarchar(255)', nullable: 'NOT NULL' },
        { name: 'priority', type: 'nvarchar(50)', nullable: 'NOT NULL' },
        { name: 'is_important_guest', type: 'nvarchar(10)', nullable: 'NOT NULL' },
        { name: 'passenger_count', type: 'int', nullable: 'NOT NULL' },
        { name: 'departure_time', type: 'datetime2', nullable: 'NOT NULL' },
        { name: 'return_time', type: 'datetime2', nullable: 'NOT NULL' },
        { name: 'departure_point', type: 'nvarchar(500)', nullable: 'NOT NULL' },
        { name: 'destination', type: 'nvarchar(500)', nullable: 'NOT NULL' },
        { name: 'contact_person', type: 'nvarchar(255)', nullable: 'NOT NULL' },
        { name: 'contact_phone', type: 'nvarchar(20)', nullable: 'NOT NULL' },
        { name: 'total_people', type: 'int', nullable: 'NULL' },
        { name: 'purpose', type: 'nvarchar(1000)', nullable: 'NOT NULL' },
        { name: 'notes', type: 'nvarchar(1000)', nullable: 'NULL' },
        { name: 'status', type: 'int', nullable: 'DEFAULT 1 NOT NULL' },
        { name: 'bpmn_version', type: 'nvarchar(50)', nullable: 'NULL' },
        { name: 'timezone', type: 'nvarchar(100)', nullable: "DEFAULT N'Asia/Ho_Chi_Minh' NOT NULL" },
        { name: 'vehicle_state', type: 'nvarchar(50)', nullable: "DEFAULT N'CHUA_TRINH' NOT NULL" },
        { name: 'status_code', type: 'nvarchar(100)', nullable: 'NULL' },
        { name: 'request_submitted_at', type: 'datetime2', nullable: 'NULL' },
        { name: 'waiting_confirmed_at', type: 'datetime2', nullable: 'NULL' },
        { name: 'created_at', type: 'datetime2', nullable: 'DEFAULT sysdatetime() NOT NULL' },
        { name: 'updated_at', type: 'datetime2', nullable: 'DEFAULT sysdatetime() NOT NULL' },
        { name: 'created_by', type: 'nvarchar(255)', nullable: 'NULL' },
        { name: 'department', type: 'nvarchar(255)', nullable: 'NULL' },
        { name: 'trip_duration_minutes', type: 'int', nullable: 'NULL' },
        { name: 'driver_ids', type: 'nvarchar(MAX)', nullable: 'NULL' },
        { name: 'car_ids', type: 'nvarchar(MAX)', nullable: 'NULL' },
        { name: 'coordination_information', type: 'nvarchar(MAX)', nullable: 'NULL' },
        { name: 'rejection_reason', type: 'nvarchar(MAX)', nullable: 'NULL' },
        { name: 'confirmed_driver_ids', type: 'nvarchar(MAX)', nullable: 'NULL' },
        { name: 'is_all_drivers_confirmed', type: 'bit', nullable: 'DEFAULT 0 NOT NULL' },
        { name: 'driver_notice_count', type: 'int', nullable: 'DEFAULT 0 NULL' },
        { name: 'leader_notice_count', type: 'int', nullable: 'DEFAULT 0 NULL' },
        { name: 'request_code', type: 'nvarchar(30)', nullable: 'NULL' },
        { name: 'driver_notice_times', type: 'nvarchar(MAX)', nullable: 'NULL' },
        { name: 'leader_notice_times', type: 'nvarchar(MAX)', nullable: 'NULL' },
        { name: 'leader_escalated_at', type: 'datetime', nullable: 'NULL' },
        { name: 'table_bak', type: 'int', nullable: 'NULL' },
        { name: 'id_sp_bak', type: 'nvarchar(255)', nullable: 'NULL' }
      ];

      console.log(`[StreamCarBookingMigrationModel] Checking/Creating Master table: ${masterTable}`);
      const createMasterIfNotExists = `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${masterTable}' AND TABLE_SCHEMA = '${schema}')
      BEGIN
          CREATE TABLE ${masterRef} (id uniqueidentifier DEFAULT newid() NOT NULL PRIMARY KEY);
      END
      `;
      await this.queryNewDb(createMasterIfNotExists);

      for (const col of masterCols) {
        if (col.name === 'id') continue;
        const alterQuery = `
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${masterTable}' AND COLUMN_NAME = '${col.name}')
        BEGIN
            ALTER TABLE ${masterRef} ADD [${col.name}] ${col.type} ${col.nullable};
        END
        `;
        await this.queryNewDb(alterQuery);
      }

      // Index Master
      await this.queryNewDb(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_${masterTable}_id_sp_bak' AND object_id = OBJECT_ID('${masterRef}')) CREATE INDEX IX_${masterTable}_id_sp_bak ON ${masterRef}(id_sp_bak);`);

      // 2. Phân tích & Khởi tạo Bảng VEHICLE_REGISTRATION_ASSIGNMENTS (Detail)
      const detailTable = 'vehicle_registration_assignments';
      const detailRef = `[${db}].[${schema}].[${detailTable}]`;

      const detailCols = [
        { name: 'id', type: 'uniqueidentifier', nullable: 'DEFAULT newid() NOT NULL' },
        { name: 'registration_id', type: 'uniqueidentifier', nullable: 'NOT NULL' },
        { name: 'car_id', type: 'nvarchar(100)', nullable: 'NOT NULL' },
        { name: 'driver_id', type: 'nvarchar(100)', nullable: 'NULL' },
        { name: 'is_confirmed', type: 'bit', nullable: 'DEFAULT 0 NULL' },
        { name: 'confirmed_at', type: 'datetime', nullable: 'NULL' },
        { name: 'created_at', type: 'datetime', nullable: 'DEFAULT getdate() NULL' },
        { name: 'table_bak', type: 'int', nullable: 'NULL' },
        { name: 'id_sp_bak', type: 'nvarchar(255)', nullable: 'NULL' }
      ];

      console.log(`[StreamCarBookingMigrationModel] Checking/Creating Detail table: ${detailTable}`);
      const createDetailIfNotExists = `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${detailTable}' AND TABLE_SCHEMA = '${schema}')
      BEGIN
          CREATE TABLE ${detailRef} (id uniqueidentifier DEFAULT newid() NOT NULL PRIMARY KEY);
      END
      `;
      await this.queryNewDb(createDetailIfNotExists);

      for (const col of detailCols) {
        if (col.name === 'id') continue;
        const alterQuery = `
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${detailTable}' AND COLUMN_NAME = '${col.name}')
        BEGIN
            ALTER TABLE ${detailRef} ADD [${col.name}] ${col.type} ${col.nullable};
        END
        `;
        await this.queryNewDb(alterQuery);
      }

      // Index Detail
      await this.queryNewDb(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_${detailTable}_id_sp_bak' AND object_id = OBJECT_ID('${detailRef}')) CREATE INDEX IX_${detailTable}_id_sp_bak ON ${detailRef}(id_sp_bak);`);
      await this.queryNewDb(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_vra_car' AND object_id = OBJECT_ID('${detailRef}')) CREATE INDEX idx_vra_car ON ${detailRef}(car_id);`);
      await this.queryNewDb(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_vra_driver' AND object_id = OBJECT_ID('${detailRef}')) CREATE INDEX idx_vra_driver ON ${detailRef}(driver_id);`);
      await this.queryNewDb(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_vra_registration' AND object_id = OBJECT_ID('${detailRef}')) CREATE INDEX idx_vra_registration ON ${detailRef}(registration_id);`);

      // 3. Khóa ngoại
      const fkQuery = `
      IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_vra_registration')
      BEGIN
          ALTER TABLE ${detailRef} ADD CONSTRAINT FK_vra_registration
          FOREIGN KEY (registration_id) REFERENCES ${masterRef}(id);
      END
      `;
      await this.queryNewDb(fkQuery);

      // 🔥 AUTO-INIT AUDIT TABLE
      await this.ensureAuditTableExists();

      console.log(`[StreamCarBookingMigrationModel] [ensureTargetColumnsExist] OK: Car Booking Schema verification complete.`);
    } catch (err) {
      console.error(`[StreamCarBookingMigrationModel] [ensureTargetColumnsExist] ERROR: ${err.message}`);
    }
  }

  async ensureStagingTableExists() {
    try {
      const stagingTableRef = this.getStagingTableRef();
      console.log(`[StreamCarBookingMigrationModel] Checking/Creating staging table: ${stagingTableRef}`);
      const table = this.newTableSync;
      const schema = this.newDbSchema || 'dbo';

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
        { name: 'WorkflowId', type: 'NVARCHAR(500)' },
        { name: 'Approver', type: 'NVARCHAR(MAX)' },
        { name: 'ApprovedDate', type: 'NVARCHAR(500)' },
        { name: 'DocumentCreatedDate', type: 'NVARCHAR(500)' },
        { name: 'DocumentCreatedBy', type: 'NVARCHAR(500)' },
        { name: 'DocumentModified', type: 'NVARCHAR(500)' },
        { name: 'DocumentModifiedBy', type: 'NVARCHAR(500)' },
        { name: 'LinkedItemID', type: 'BIGINT' },
        { name: 'SPListId', type: 'NVARCHAR(500)' },
        { name: 'SubmitDate', type: 'NVARCHAR(500)' },
        { name: 'Step', type: 'NVARCHAR(500)' },
        { name: 'DocumentId', type: 'NVARCHAR(MAX)' },
        { name: 'DocumentTitle2', type: 'NVARCHAR(MAX)' },
        { name: 'Updating', type: 'INT' },
        { name: 'Locker', type: 'NVARCHAR(500)' },
        { name: 'TaskId', type: 'NVARCHAR(500)' },
        { name: 'IsArchived', type: 'INT' },
        { name: 'IsConverting', type: 'INT' },
        { name: 'ConvertedDate', type: 'NVARCHAR(500)' },
        { name: 'ActionStatus', type: 'NVARCHAR(500)' },
        { name: 'CBNV', type: 'NVARCHAR(MAX)' },
        { name: 'Content', type: 'NVARCHAR(MAX)' },
        { name: 'ChenSo', type: 'INT' },
        { name: 'DongMoc', type: 'INT' },
        { name: 'EndLoop', type: 'INT' },
        { name: 'IsKyQuyChe', type: 'INT' },
        { name: 'IssuedDate', type: 'NVARCHAR(500)' },
        { name: 'KyHaiLien', type: 'INT' },
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
        { name: 'IsDaIn', type: 'INT' },
        { name: 'IsDaKy', type: 'INT' },
        { name: 'ChildId', type: 'NVARCHAR(500)' },
        { name: 'StampWithKey', type: 'NVARCHAR(MAX)' },
        { name: 'Name', type: 'NVARCHAR(MAX)' },
        { name: 'IsHubSendOut', type: 'INT' },
        { name: 'HubPackageId', type: 'NVARCHAR(500)' },
        { name: 'GoiDauTu', type: 'NVARCHAR(MAX)' },
        { name: 'GoiDuAn', type: 'NVARCHAR(MAX)' },
        { name: 'DonViChuTri', type: 'NVARCHAR(MAX)' },
        { name: 'NgayKyKH', type: 'NVARCHAR(500)' },
        { name: 'SoKH', type: 'NVARCHAR(500)' },
        { name: 'DonViSoanThao', type: 'NVARCHAR(MAX)' },
        { name: 'GoiDuAn1', type: 'NVARCHAR(MAX)' },
        { name: 'IsNAS', type: 'INT' },
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
      console.log(`[StreamCarBookingMigrationModel] [ensureStagingTableExists] OK: ${stagingTableRef} is ready`);
    } catch (err) {
      console.error(`[StreamCarBookingMigrationModel] [ensureStagingTableExists] ERROR: ${err.message}`);
      throw err;
    }
  }

  getStagingTableRef() {
    return this.newDbName ? `${this.newDbName}.${this.newDbSchema}.${this.newTableSync}` : `${this.newDbSchema}.${this.newTableSync}`;
  }

  normalizeSyncTime(value) {
    if (!value) return DEFAULT_SYNC_TIME;
    const dv = new Date(value);
    return isNaN(dv.getTime()) ? DEFAULT_SYNC_TIME : dv.toISOString();
  }

  extractRowSyncTime(row) {
    const raw = row?.__sync_time || row?.Modified || row?.Created || null;
    if (!raw) return null;
    const dv = new Date(raw);
    return isNaN(dv.getTime()) ? null : dv.toISOString();
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
        `ud.[tp_ID]              AS ID`,
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
                     (col === 'SiteName' ? 'DocumentSiteName' : col))))))))));

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
            @lastSyncTime = '1970-01-01T00:00:00.000Z' -- Lần chạy đầu tiên: Lấy từ bản ghi mới nhất
            OR ud.[tp_Modified] < @lastSyncTime
            OR (
                ud.[tp_Modified] = @lastSyncTime
                AND ud.[tp_ID] < @lastSyncId
            )
        )
        ORDER BY ud.[tp_Modified] DESC, ud.[tp_ID] DESC
        OFFSET ${beginLimit} ROWS FETCH NEXT ${completedLimit} ROWS ONLY;
    `;

    const rows = await this.queryOldDb(query, { lastSyncTime, lastSyncId: Number(lastSyncId || 0) });
    console.log(`[StreamCarBookingMigrationModel] Fetched ${rows.length} rows from old DB`);
    return rows;
  }

  async syncOldToStaging(rows, { transaction } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return { stagedCount: 0 };
    console.log(`[StreamCarBookingMigrationModel] Staging ${rows.length} rows to ${this.newTableSync}...`);
    const internalColumns = new Set(['__sync_time', '__sync_id_num']);
    const columns = Object.keys(rows[0]).filter(c => !internalColumns.has(c));
    if (!columns.length) return { stagedCount: 0 };

    const keyColumn = 'ID';
    const stagingTableRef = this.getStagingTableRef();

    // Helper to normalize values (e.g., 'false' -> 0, 'true' -> 1)
    const normalizeValue = (val, colName) => {
        if (val === 'false' || val === false) return 0;
        if (val === 'true' || val === true) return 1;

        // Handle numeric columns specifically if needed
        const intCols = [
            'ID', 'ItemID', 'DocumentID', 'LinkedItemID', 'Updating', 'IsArchived', 'IsConverting',
            'ChenSo', 'DongMoc', 'EndLoop', 'IsKyQuyChe', 'KyHaiLien', 'IsDaIn', 'IsDaKy',
            'IsHubSendOut', 'IsNAS', 'PreviousStep'
        ];
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
          params['id_key'] = normalizeValue(row[keyColumn], keyColumn);
          params['sync_time'] = row.__sync_time;
          params['sync_id_num'] = row.__sync_id_num;

          columns.forEach((col, index) => {
            const pName = `p${index}`;
            params[pName] = normalizeValue(row[col], col);
            if (col !== keyColumn) colPairs.push(`[${col}] = @${pName}`);
          });

          const updateSet = colPairs.length > 0 ? colPairs.join(', ') : `[${keyColumn}] = [${keyColumn}]`;
          const insertCols = columns.map(c => `[${c}]`).join(', ');
          const insertVals = columns.map((_, i) => `@p${i}`).join(', ');

          const query = `
          IF EXISTS (SELECT 1 FROM ${stagingTableRef} WHERE [${keyColumn}] = @id_key)
          BEGIN
              UPDATE ${stagingTableRef} SET ${updateSet}, __sync_time = @sync_time, __sync_id_num = @sync_id_num WHERE [${keyColumn}] = @id_key
          END
          ELSE
          BEGIN
              INSERT INTO ${stagingTableRef} (${insertCols}, __sync_time, __sync_id_num) VALUES (${insertVals}, @sync_time, @sync_id_num)
          END
          `;
          await this.queryNewDbTx(query, params, transaction);
          processedCount++;
      } catch (err) {
          console.error(`[StreamCarBookingMigrationModel] ERROR staging row ID=${row[keyColumn]}: ${err.message}`);
          console.error(`Problematic values: ${JSON.stringify(row)}`);
          if (err.message.includes('deadlock') || err.message.includes('connection')) throw err;
      }
    }
    console.log(`[StreamCarBookingMigrationModel] Staging complete for ${processedCount}/${rows.length} rows`);
    return { stagedCount: processedCount };
  }

  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    if (!syncJobId) throw new Error('syncJobId is required');
    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);

    const rows = await this.fetchListFromOldDb(normalizedLastSyncTime, normalizedLastSyncId);
    await this.syncOldToStaging(rows);

    let nextSyncTime = normalizedLastSyncTime;
    let nextSyncId = normalizedLastSyncId;

    // Với thứ tự DESC, bản ghi cuối cùng (index n-1) là bản ghi CŨ NHẤT trong batch đó
    if (rows.length > 0) {
      nextSyncTime = this.extractRowSyncTime(rows[rows.length - 1]);
      nextSyncId = this.extractRowSyncId(rows[rows.length - 1]);
    }
    return { syncJobId, rows, totalCount: rows.length, lastSyncTime: nextSyncTime, lastSyncId: nextSyncId };
  }

  async fetchOneFromSource({ lastSyncTime, lastSyncId }) {
    const listIds = this.oldConfig.listIds || [];
    const listIdsStr = listIds.map(id => `'${id}'`).join(',');
    const cols = this.sourceSchema;

    const udSelect = [
        `l.[tp_Title]            AS ListName`,
        `ud.[tp_ID]              AS ID`,
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
        cols.allUserData.has('nvarchar4') ? `ud.[nvarchar4] AS Organizer` : `NULL AS Organizer`,
        `ud.[tp_Modified] AS __sync_time`,
        `ud.[tp_ID] AS __sync_id_num`
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
                     (col === 'SiteName' ? 'DocumentSiteName' : col))))))))));

        if (cols.codeItem.has(col.toLowerCase())) {
            return `ci.[${col}] AS [${alias}]`;
        } else {
            return `NULL AS [${alias}]`;
        }
    });

    const query = `
        SELECT TOP 1
            ${udSelect.join(',\n            ')},
            ${ciSelect.join(',\n            ')}
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
            @lastSyncTime = '1970-01-01T00:00:00.000Z'
            OR ud.[tp_Modified] < @lastSyncTime 
            OR (ud.[tp_Modified] = @lastSyncTime AND ud.[tp_ID] < @lastSyncId)
        )
        ORDER BY ud.[tp_Modified] DESC, ud.[tp_ID] DESC
    `;
    const rows = await this.queryOldDb(query, { lastSyncTime, lastSyncId: Number(lastSyncId || 0) });
    return rows?.[0] || null;
  }

  async getSyncJobState(syncJobId) {
    const rows = await this.queryNewDb(`SELECT TOP 1 * FROM sync_jobs WHERE job_id = @syncJobId`, { syncJobId });
    return rows?.[0] || null;
  }

  async processOne(syncJobId) {
    console.log(`[StreamCarBookingMigrationModel] processOne: Starting job ${syncJobId}`);
    const jobState = await this.getSyncJobState(syncJobId);
    if (!jobState) throw new Error(`Job state not found: ${syncJobId}`);
    const rowData = await this.fetchOneFromSource({
      lastSyncTime: this.normalizeSyncTime(jobState.last_sync_time || DEFAULT_SYNC_TIME),
      lastSyncId: Number(jobState.last_sync_id || 0)
    });
    if (!rowData) {
        console.log(`[StreamCarBookingMigrationModel] processOne: No more data for job ${syncJobId}`);
        return { syncJobId, processed: false, done: true };
    }

    console.log(`[StreamCarBookingMigrationModel] processOne: Processing row ID ${rowData.ID}`);
    await this.processRowData(rowData);

    await this.queryNewDb(
      `UPDATE sync_jobs SET total_processed = ISNULL(total_processed,0) + 1, total_success = ISNULL(total_success,0) + 1,
       last_sync_time = @lastSyncTime, last_sync_id = @lastSyncId WHERE job_id = @syncJobId`,
      { syncJobId, lastSyncTime: this.extractRowSyncTime(rowData), lastSyncId: this.extractRowSyncId(rowData) }
    );
    console.log(`[StreamCarBookingMigrationModel] processOne: Successfully processed row ID ${rowData.ID}`);
    return { syncJobId, processed: true, done: false };
  }

  async processRowData(rowData, { transaction } = {}) {
    if (!rowData?.ID) {
        console.error(`[StreamCarBookingMigrationModel] processRowData ERROR: Row missing ID! Data = ${JSON.stringify(rowData)}`);
        throw new Error('ID is required');
    }
    const recordId = String(rowData.ID);
    console.log(`\n====================================================================`);
    console.log(`[StreamCarBookingMigrationModel] START PROCESSING RECORD ID: ${recordId}`);
    console.log(`[StreamCarBookingMigrationModel] RAW DATA FROM SOURCE:`);
    console.log(JSON.stringify(rowData, null, 2));

    try {
        const carBookingRoles = '[{"processKey":"VAN_BAN_DI","name":"VAN_BAN_DI","roles":[{"roleCode":"CAN_BO","name":"CAN_BO"}]},{"processKey":"QUY_TRINH_CV_PHONG_BAN","name":"QUY_TRINH_CV_PHONG_BAN","roles":[{"roleCode":"NGUOI_PHOI_HOP","name":"NGƯỜI PHỐI HỢP"}]},{"processKey":"PHUC_DAP_DV_CON","name":"PHUC_DAP_DV_CON","roles":[{"roleCode":"CAN_BO","name":"CAN_BO"},{"roleCode":"NHAN_VIEN_TCT","name":"NHAN_VIEN_TCT"}]},{"processKey":"quan_ly_tin_tuc","name":"quan_ly_tin_tuc","roles":[{"roleCode":"NGUOI_TAO_TIN","name":"NGUOI_TAO_TIN"}]},{"processKey":"SOANTHAO_PHATHANH_VBD","name":"SOANTHAO_PHATHANH_VBD","roles":[{"roleCode":"NGUOI_SOAN_THAO","name":"NGUOI_SOAN_THAO"}]},{"processKey":"QUY_TRINH_LICH_HOP","name":"QUY_TRINH_LICH_HOP","roles":[{"roleCode":"NGUOI_SOAN_LICH","name":"NGUOI_SOAN_LICH"},{"roleCode":"NGUOI_THAM_GIA","name":"NGUOI_THAM_GIA"},{"roleCode":"ADMIN","name":"ADMIN"}]},{"processKey":"quytrinhthuthaphoso1","name":"quytrinhthuthaphoso1","roles":[{"roleCode":"canbo","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qllsct","name":"qllsct","roles":[{"roleCode":"canbo","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtdvlfgttthcid","name":"qtdvlfgttthcid","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"dev_01","name":"dev_01","roles":[{"roleCode":"CB","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qlgttssddn","name":"qlgttssddn","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"quytrinhthuthaphoso","name":"quytrinhthuthaphoso","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtqlapi","name":"qtqlapi","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtdvdstphstsbnhs","name":"qtdvdstphstsbnhs","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtqllstthscd","name":"qtqllstthscd","roles":[{"roleCode":"canbo","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"listDetailImport","name":"listDetailImport","roles":[{"roleCode":"CANBO","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"kthsclone","name":"kthsclone","roles":[{"roleCode":"CANBO","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"tthsdn","name":"tthsdn","roles":[{"roleCode":"CANBO","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtqllssytl","name":"qtqllssytl","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qlgttssdcd","name":"qlgttssdcd","roles":[{"roleCode":"CANBO","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtqlkqgqtthccd","name":"qtqlkqgqtthccd","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"exceldoanhnghiep","name":"exceldoanhnghiep","roles":[{"roleCode":"canbo","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtdvldldtkqgqtthctsbncss","name":"qtdvldldtkqgqtthctsbncss","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtdvldstsdcdiddn","name":"qtdvldstsdcdiddn","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtdvttdtcn","name":"qtdvttdtcn","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtqltl","name":"qtqltl","roles":[{"roleCode":"canbo","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtdvldsidkqgqtthccd","name":"qtdvldsidkqgqtthccd","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"so2","name":"so2","roles":[{"roleCode":"CB","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"TVHSLT","name":"TVHSLT","roles":[{"roleCode":"CB","name":"CB","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtiedldtcd","name":"qtiedldtcd","roles":[{"roleCode":"canbo","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qldvcc","name":"qldvcc","roles":[{"roleCode":"canbo","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"ldsiqkqgqtthccd","name":"ldsiqkqgqtthccd","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtqllstths","name":"qtqllstths","roles":[{"roleCode":"canbo","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qlkqqgtthccd","name":"qlkqqgtthccd","roles":[{"roleCode":"canbo","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtth","name":"qtth","roles":[{"roleCode":"CANBOCQDV1","name":"Cán bộ CQDV1","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtdvttgikqtgqhstthc","name":"qtdvttgikqtgqhstthc","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qlhsdn","name":"qlhsdn","roles":[{"roleCode":"canbo","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtqllstthsdn","name":"qtqllstthsdn","roles":[{"roleCode":"canbo","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtdvlfkqgqtthcid","name":"qtdvlfkqgqtthcid","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"dongbo","name":"dongbo","roles":[{"roleCode":"CANBO","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtdldtkqgqtthcid","name":"qtdldtkqgqtthcid","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtiedldtdn","name":"qtiedldtdn","roles":[{"roleCode":"canbo","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qllsctcd","name":"qllsctcd","roles":[{"roleCode":"canbo","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtqlhth","name":"qtqlhth","roles":[{"roleCode":"canbo","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtqlgttsdcd","name":"qtqlgttsdcd","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtdvldsgttsdcdid","name":"qtdvldsgttsdcdid","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qlkqqgtthcdn","name":"qlkqqgtthcdn","roles":[{"roleCode":"canbo","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtdvlfkqgqtthcbnhs","name":"qtdvlfkqgqtthcbnhs","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"kths","name":"kths","roles":[{"roleCode":"canbokhaithac","name":"Cán bộ khai thác","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtdvlddkqgqtthcdn","name":"qtdvlddkqgqtthcdn","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"Mã quy trình","name":"Mã quy trình","roles":[{"roleCode":"CANBO","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"importexcel","name":"importexcel","roles":[{"roleCode":"canbo","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtdvttkqgqtthc","name":"qtdvttkqgqtthc","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtdvldldtkqgqtthcid","name":"qtdvldldtkqgqtthcid","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtttgttsdddkscddn","name":"qtttgttsdddkscddn","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"LUONG_PHONG","name":"LUONG_PHONG","roles":[{"roleCode":"CAN_BO","name":"CAN_BO","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtdvlttdtdn","name":"qtdvlttdtdn","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtdvlddkqgq1dn","name":"qtdvlddkqgq1dn","roles":[{"roleCode":"CANBO","name":"Cán Bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qllsctdn","name":"qllsctdn","roles":[{"roleCode":"canbo","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"qtqltldn","name":"qtqltldn","roles":[{"roleCode":"canbo","name":"Cán bộ","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"Administrator","name":"Administrator","roles":[{"roleCode":"CAN_BO","name":"CAN_BO","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"QUY_TRINH_PHONG_HOP","name":"QUY_TRINH_PHONG_HOP","roles":[{"roleCode":"XEM_PHONG_HOP","name":"XEM_PHONG_HOP","__groupId":"b59238b0-6de2-4bda-87ac-f62ccab182bf"}]},{"processKey":"KY_SO_HS_VBD","name":"KY_SO_HS_VBD","roles":[{"roleCode":"NGUOI_SOAN_THAO","name":"NGUOI_SOAN_THAO"}]},{"processKey":"CVDAN","name":"CVDAN","roles":[{"roleCode":"NGUOI_GIAO","name":"NGƯỜI GIAO"},{"roleCode":"NGUOI_CHU_TRI","name":"NGƯỜI CHỦ TRÌ"},{"roleCode":"NGUOI_PHOI_HOP","name":"NGƯỜI PHỐI HỢP"}]},{"processKey":"QUY_TRINH_KHAI_THAC_HO_SO","name":"QUY_TRINH_KHAI_THAC_HO_SO","roles":[{"roleCode":"NGUOI_KHAI_THAC","name":"NGUOI_KHAI_THAC"}]},{"processKey":"hosoluutru","name":"hosoluutru","roles":[{"roleCode":"HHLT_CANBO","name":"HHLT_CANBO"}]},{"processKey":"thhs","name":"thhs","roles":[{"roleCode":"bld","name":"bld"}]},{"processKey":"PHUC_DAP_DV","name":"PHUC_DAP_DV","roles":[{"roleCode":"PHONG_NHAN_VIEN_TCT","name":"PHONG_NHAN_VIEN_TCT"},{"roleCode":"CAN_BO","name":"CAN_BO"}]},{"processKey":"QUY_TRINH_DANG_KY_XE","name":"QUY_TRINH_DANG_KY_XE","roles":[{"roleCode":"NGUOI_DANG_KY_XE","name":"NGUOI_DANG_KY_XE"}]},{"processKey":"QTVBNB","name":"QTVBNB","roles":[{"roleCode":"CAN_BO","name":"CAN_BO"}]},{"processKey":"QUY_TRINH_PHAN_ANH_KIEN_NGHI","name":"QUY_TRINH_PHAN_ANH_KIEN_NGHI","roles":[{"roleCode":"NGUOI_PHAN_ANH","name":"NGUOI_PHAN_ANH"}]},{"processKey":"QT_MTHC","name":"QT_MTHC","roles":[{"roleCode":"NGUOI_TAO","name":"NGUOI_TAO"}]},{"processKey":"SOANTHAO_PHATHANH_CQD","name":"SOANTHAO_PHATHANH_CQD","roles":[{"roleCode":"NGUOI_SOAN_THAO","name":"NGUOI_SOAN_THAO"}]},{"processKey":"dashboardPage","name":"dashboardPage","roles":[{"roleCode":"VT","name":"VT"}]},{"processKey":"KY_SO_HS_K_DD","name":"KY_SO_HS_K_DD","roles":[{"roleCode":"NGUOI_SOAN_THAO","name":"NGUOI_SOAN_THAO"}]},{"processKey":"reportsOutGoingDocument","name":"reportsOutGoingDocument","roles":[{"roleCode":"VT","name":"VT"}]},{"processKey":"PHOIHOP_NHANDEBIET","name":"PHOIHOP_NHANDEBIET","roles":[{"roleCode":"CAN_BO","name":"CAN_BO"}]},{"processKey":"statisticsAndReports","name":"statisticsAndReports","roles":[{"roleCode":"VT","name":"VT"}]}]';

        // 🔥 1. Resolve Thông tin Người dùng (Waterfall) - Đồng nhất ID cho Master & Audit
        const authorCandidates = [
          { key: 'AuthorAccount', type: 'account', value: rowData.AuthorAccount },
          { key: 'AuthorName', type: 'name', value: rowData.AuthorName }
        ];

        let finalUserId = '6915f2387e39c2ba33cef79a'; // Fallback Van thu TCT nếu không tìm thấy
        for (const cand of authorCandidates) {
          if (!cand.value) continue;
          console.log(`[StreamCarBookingMigrationModel] Resolving Final User ID via [${cand.key}]: ${cand.value}`);
          let resolvedId = null;
          if (cand.type === 'account') {
            resolvedId = await this.helper.resolveUserIdByAccountName(cand.value, transaction, carBookingRoles);
          } else {
            resolvedId = await this.helper.resolveUserIdByFullName(cand.value, transaction, carBookingRoles);
          }
          if (resolvedId) {
              finalUserId = resolvedId;
              console.log(`[StreamCarBookingMigrationModel] >> SUCCESS Resolved User to UUID: ${finalUserId}`);
              await this._ensureUserHasRoles(finalUserId, carBookingRoles, transaction);
              break;
          }
        }

        // Đảm bảo đồng nhất tuyệt đối theo yêu cầu của USER
        rowData.AuthorAccount = finalUserId; // Sẽ map vào created_by
        rowData.Organizer = finalUserId;     // Sẽ map vào contact_person (Dùng chung 1 người cho tiện liên hệ)

        // 🔥 1.5. Xử lý các giá trị mặc định thực tế cho MASTER nếu bị thiếu
        if (!rowData.departure_point || String(rowData.departure_point).trim() === '') {
            rowData.departure_point = 'Tại đơn vị';
        }
        if (!rowData.Location || String(rowData.Location).trim() === '') {
            rowData.Location = 'Công tác nội thành/Theo lộ trình yêu cầu';
        }
        if (!rowData.Description || String(rowData.Description).trim() === '') {
            rowData.Description = 'Giải quyết công việc chuyên môn';
        }
        if (rowData.passenger_count === undefined || rowData.passenger_count === null) {
            rowData.passenger_count = 1;
        }

        // 🔥 1.6. Khai báo thời gian hiện tại
        const now = new Date();

        // 🔥 1.7. ÉP CỨNG DỮ LIỆU CHUẨN HIỂN THỊ (Strict Hardcoding - No Fallbacks)
        // name = destination (Location) theo yêu cầu của bạn
        rowData.name = rowData.Location;
        
        // contact_person là Tên hiển thị (không phải mã ID/UUID)
        rowData.contact_person = rowData.AuthorName || rowData.Organizer || 'Cán bộ 01';
        
        // Ép cứng đồng loạt các thông số nghiệp vụ (Strict)
        rowData.request_type = 'Tp';
        rowData.priority = 'bt';
        rowData.is_important_guest = 'co';
        rowData.status_code = 2;
        rowData.bpmn_version = 'QUY_TRINH_DANG_KY_XE';
        rowData.vehicle_state = 'CHO_DIEU_PHOI';
        rowData.request_code = 'YC-20260329-004';
        rowData.contact_phone = '0297227381';
        rowData.department = '68afbefecb36081f0bbbef2e';
        
        // Thời gian gốc từ SharePoint
        rowData.request_submitted_at = rowData.tp_Created || now;

        // 🔥 1.8. Tính toán các trường bổ trợ (Thời lượng & Chuẩn hóa thời gian)
        if (rowData.StartDate && rowData.EndDate) {
            const start = new Date(rowData.StartDate);
            const end = new Date(rowData.EndDate);
            const diffMs = end - start;
            rowData.trip_duration_minutes = diffMs > 0 ? Math.floor(diffMs / (1000 * 60)) : 0;
            // Đảm bảo không ghi đè thời gian kết thúc bằng thời gian hiện tại
            rowData.return_time = end;
        } else {
            rowData.trip_duration_minutes = 0;
        }

        // 🔥 2. Ghi vào bảng MASTER (vehicle_registrations)
        // Safeguard: Chuẩn hóa cột JSON array - chuỗi rỗng '' → '[]' để tránh lỗi constraint
        const normalizeArr = (v) => {
            if (v === null || v === undefined) return null;
            const s = String(v).trim();
            return s === '' ? '[]' : s;
        };
        rowData.driver_ids               = normalizeArr(rowData.driver_ids);
        rowData.car_ids                  = normalizeArr(rowData.car_ids);
        rowData.coordination_information = normalizeArr(rowData.coordination_information);

        console.log(`[StreamCarBookingMigrationModel] Executing Upsert for MASTER table...`);
        const masterResult = await this.upsertDataToNewDB(rowData, this.oldConfig, 'id_sp_bak', recordId, transaction);
        const masterId = masterResult.id;
        console.log(`[StreamCarBookingMigrationModel] MASTER Upsert successful: Action=${masterResult.action}, Master_ID=${masterId}`);

        // 🔥 3. Bóc tách JSON Detail (Chỉ áp dụng cho dữ liệu có điều phối)
        let coordination = [];
        try {
            const rawInfo = rowData.coordination_information || rowData.nvarcharMAX1;
            if (rawInfo && typeof rawInfo === 'string' && rawInfo.trim().startsWith('[')) {
                coordination = JSON.parse(rawInfo);
                console.log(`[StreamCarBookingMigrationModel] Parsed Coordination Info successfully: ${coordination.length} items found.`);
            }
        } catch (e) {
            console.warn(`[StreamCarBookingMigrationModel] WARNING: Failed to parse Coordination JSON: ${e.message}`);
        }

        if (Array.isArray(coordination) && coordination.length > 0) {
            console.log(`[StreamCarBookingMigrationModel] Upserting ${coordination.length} Coordination Items...`);
            let count = 0;
            for (const item of coordination) {
                const detailData = {
                    registration_id: masterId,
                    car_id: item.carId || item.car_id || 'UNKNOWN_CAR',
                    driver_id: item.driverId || item.driver_id || 'UNKNOWN_DRIVER',
                    is_confirmed: item.isConfirmed ? 1 : 0,
                    confirmed_at: item.confirmedAt ? new Date(item.confirmedAt) : null,
                    id_sp_bak: recordId,
                    table_bak: 1
                };
                await this.upsertDetailToNewDB(detailData, transaction);
                count++;
            }
            console.log(`[StreamCarBookingMigrationModel] Completed Upserting ${count} Coordination Items.`);
        } else {
            console.log(`[StreamCarBookingMigrationModel] No Coordination Items found. Generating 1 MOCK detail assignment...`);
            const mockCars = ['LC-20260316085406-YYAQZ3FB', 'LC-20260317155714-B2SY4GOP', 'LC-20260316154534-3VU6ZAWS', 'LC-20260317155520-S96ZHPI1', 'LC-20260316085106-914TB6XO', 'LC-20260316154406-YY7NLZA6', 'LC-20260316084914-TKE1NSHW', 'LC-20260316081003-VJBXL0CN', 'LC-20260316084952-DVELWNUF', 'LC-20260317012020-JL60VIXQ'];
            const mockDrivers = ['6928176e213f38bebc8024cf', '9cc1fccc-0ccb-4305-9cab-f701aa70e54c', '11dd5425-1f60-496f-920b-805027b0aa97', '69281962213f38bebc802aaa', 'bd97f40e-c9a1-4b07-a147-e134f12a1b30', '2baa768c-effc-46b0-b635-fb3c47cb7d02', 'b243d70a-c26e-42e1-92f3-71ca4e0d5de1', 'cd51a8be-f79d-460c-914e-a43fe0f62d06', 'b8f190da-70d0-4cf2-b290-a25c2ae31154', 'f2ed1e24-c2e7-4a3e-b1c0-9583e5e544be'];

            const detailData = {
                registration_id: masterId,
                car_id: mockCars[Math.floor(Math.random() * mockCars.length)],
                driver_id: mockDrivers[Math.floor(Math.random() * mockDrivers.length)],
                is_confirmed: 1,
                confirmed_at: new Date(),
                id_sp_bak: recordId,
                table_bak: 1
            };
            await this.upsertDetailToNewDB(detailData, transaction);
            console.log(`[StreamCarBookingMigrationModel] Completed Upserting 1 MOCK Coordination Item.`);
        }

        // 🔥 4. Tạo Nhật ký (Audit Trail) mặc định cho Quy trình Đặt xe
        console.log(`[StreamCarBookingMigrationModel] Creating Audit Trail...`);
        await this.createAuditTrail(masterId, rowData, transaction);
        console.log(`[StreamCarBookingMigrationModel] Completed Audit Trail Creation.`);

        console.log(`[StreamCarBookingMigrationModel] END PROCESSING RECORD ID: ${recordId}`);
        console.log(`====================================================================\n`);

        return {
            backupId: recordId,
            affected: masterResult.affected,
            logs: [
                { table: 'vehicle_registrations', action: masterResult.action },
                { table: 'audit', action: 'inserted_trail' }
            ]
        };
    } catch (err) {
        console.error(`\n[StreamCarBookingMigrationModel] ❌ CRITICAL ERROR processing record ID ${recordId}`);
        console.error(`[StreamCarBookingMigrationModel] Error Details: ${err.message}`);
        console.error(`[StreamCarBookingMigrationModel] Stack Trace: ${err.stack}`);
        console.error(`====================================================================\n`);
        throw err;
    }
  }

  async createAuditTrail(masterId, rowData, transaction) {
    const db = this.newDbName || 'app_tancang';
    const schema = 'dbo';
    const tableRef = `[${db}].[${schema}].[audit]`;
    const creatorId = rowData.AuthorAccount || 'SYSTEM_MIGRATION';
    const createTime = rowData.tp_Created ? new Date(rowData.tp_Created) : new Date();

    const auditSteps = [
      {
        action_code: 'TAO_VA_GUI_YEU_CAU_DANG_KY_XE',
        display_name: 'Người đăng ký xe',
        role: 'NGUOI_DANG_KY_XE',
        details: '"Tạo và gửi yêu cầu đăng ký xe"',
        action: 'Tạo và gửi yêu cầu đăng ký xe',
        from_node_id: 'Activity_00hcfcm',
        to_node_id: 'Activity_00hcfcm',
        curStatusCode: '1',
        stage_status: 'DA_XU_LY',
        receiver: creatorId,
        origin_id: 'preview'
      },
      {
        action_code: 'TAO_VA_GUI_YEU_CAU_DANG_KY_XE',
        display_name: 'Phòng hậu cần, đội xe',
        role: 'NGUOI_DANG_KY_XE',
        details: '"Yêu cầu điều phối"',
        action: 'Yêu cầu điều phối',
        from_node_id: 'Activity_00hcfcm',
        to_node_id: 'Gateway_1ilkpo8',
        curStatusCode: '2',
        stage_status: 'DA_XU_LY',
        receiver: 'PHONG_DOI_HAU_CAN_NGUOI_DIEU_PHOI',
        origin_id: 'preview'
      },
      {
        action_code: 'DIEU_PHOI_XE_PHONG_HAU_CAN',
        display_name: 'Điều phối yêu cầu',
        role: 'PHONG_HAU_CAN_DOI_XE',
        details: '"Đã điều phối"',
        action: 'Điều phối lại',
        from_node_id: 'Gateway_1ilkpo8',
        to_node_id: 'Gateway_1ilkpo8',
        curStatusCode: '2',
        stage_status: 'DA_XU_LY',
        receiver: 'TAI_XE_TIEP_NHAN',
        origin_id: 'wi_' + Date.now()
      }
    ];

    for (const step of auditSteps) {
        const query = `
        IF NOT EXISTS (SELECT 1 FROM ${tableRef} WHERE document_id = @document_id AND action_code = @action_code AND [action] = @action AND to_node_id = @to_node_id)
        BEGIN
            INSERT INTO ${tableRef} (
                document_id, [time], user_id, display_name, [role], action_code,
                from_node_id, to_node_id, [details], origin_id, created_by, receiver, roleProcess,
                [action], curStatusCode, stage_status, type_document, created_at, updated_at, table_bak
            )
            VALUES (
                @document_id, @time, @user_id, @display_name, @role, @action_code,
                @from_node_id, @to_node_id, @details, @origin_id, @created_by, @receiver, 'processor',
                @action, @curStatusCode, @stage_status, 'VEHICLE_REGISTRATION', @time, @time, 1
            )
        END
        `;
        const params = {
            document_id: masterId,
            time: createTime,
            user_id: creatorId,
            created_by: creatorId,
            ...step
        };
        try {
            console.log(`[StreamCarBookingMigrationModel] Inserting Audit Item: ActionCode=${step.action_code}, Role=${step.role}`);
            await this.queryNewDbTx(query, params, transaction);
        } catch (auditErr) {
            console.error(`\n[StreamCarBookingMigrationModel] ❌ AUDIT SQL EXECUTION FAILED!`);
            console.error(`[StreamCarBookingMigrationModel] Audit Step: ${step.action_code}`);
            console.error(`[StreamCarBookingMigrationModel] Error Message: ${auditErr.message}`);
            console.error(`[StreamCarBookingMigrationModel] Params Dump: ${JSON.stringify(params, null, 2)}`);
            console.error(`====================================================================\n`);
            throw auditErr;
        }
    }
  }

  async ensureAuditTableExists() {
    const db = this.newDbName || 'app_tancang';
    const schema = 'dbo';
    const table = 'audit';
    const tableRef = `[${db}].[${schema}].[${table}]`;

    console.log(`[StreamCarBookingMigrationModel] Checking/Creating Audit table: ${table}`);
    const createAuditTable = `
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${table}' AND TABLE_SCHEMA = '${schema}')
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
      { name: 'status_code', type: 'varchar(50)' },
      { name: 'bpmn_version', type: 'varchar(100)' },
      { name: 'type_of_process', type: 'varchar(100)' },
      { name: 'table_bak', type: 'int' }
    ];

    for (const col of auditCols) {
      const query = `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}' AND COLUMN_NAME = '${col.name}')
      BEGIN
          ALTER TABLE ${tableRef} ADD [${col.name}] ${col.type} ${col.nullable || 'NULL'};
      END
      `;
      await this.queryNewDb(query);
    }
  }

  async upsertDetailToNewDB(data, transaction) {
      const db = this.newDbName || 'app_tancang';
      const schema = this.newDbSchema || 'dbo';
      const table = 'vehicle_registration_assignments';
      const tableRef = `[${db}].[${schema}].[${table}]`;
      const { v4: uuidv4 } = require('uuid');

      const params = {
          id: uuidv4().toUpperCase(),
          registration_id: data.registration_id,
          car_id: data.car_id,
          driver_id: data.driver_id,
          is_confirmed: data.is_confirmed || 0,
          confirmed_at: data.confirmed_at,
          table_bak: data.table_bak || 1,
          id_sp_bak: data.id_sp_bak
      };

      const query = `
      IF NOT EXISTS (SELECT 1 FROM ${tableRef} WHERE registration_id = @registration_id AND car_id = @car_id AND driver_id = @driver_id)
      BEGIN
          INSERT INTO ${tableRef} (id, registration_id, car_id, driver_id, is_confirmed, confirmed_at, table_bak, id_sp_bak)
          VALUES (@id, @registration_id, @car_id, @driver_id, @is_confirmed, @confirmed_at, @table_bak, @id_sp_bak)
      END
      ELSE
      BEGIN
          UPDATE ${tableRef} SET
            is_confirmed = @is_confirmed,
            confirmed_at = @confirmed_at,
            table_bak = @table_bak,
            id_sp_bak = @id_sp_bak
          WHERE registration_id = @registration_id AND car_id = @car_id AND driver_id = @driver_id
      END
      `;
      try {
          console.log(`[StreamCarBookingMigrationModel] Upserting detail item: RegistrationID=${data.registration_id}, CarID=${data.car_id}, DriverID=${data.driver_id}`);
          return await this.queryNewDbTx(query, params, transaction);
      } catch (detailErr) {
          console.error(`\n[StreamCarBookingMigrationModel] ❌ DETAIL SQL EXECUTION FAILED!`);
          console.error(`[StreamCarBookingMigrationModel] Error Message: ${detailErr.message}`);
          console.error(`[StreamCarBookingMigrationModel] Problematic Table: ${tableRef}`);
          console.error(`[StreamCarBookingMigrationModel] Params Dump: ${JSON.stringify(params, null, 2)}`);
          console.error(`====================================================================\n`);
          throw detailErr;
      }
  }

  async getExistingColumns(tableName, schema = 'dbo') {
    const query = `
      SELECT COLUMN_NAME, DATA_TYPE
      FROM [${this.newDbName}].INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @tableName AND TABLE_SCHEMA = @schema
    `;
    const result = await this.queryNewDb(query, { tableName, schema });
    // Trả về Map [tên_cột_lowercase] -> [kiểu_dữ_liệu]
    const colMap = new Map();
    result.forEach(r => colMap.set(r.COLUMN_NAME.toLowerCase(), r.DATA_TYPE.toLowerCase()));
    return colMap;
  }

  async upsertDataToNewDB(rawData, config, externalKeyField, externalKeyValue, transaction) {
    const { newTable, newSchema, fieldMapping, defaultValues } = config;
    const { v4: uuidv4 } = require('uuid');
    const existingCols = await this.getExistingColumns(newTable, newSchema);
    console.log(`[StreamCarBookingMigrationModel] upsertDataToNewDB: table=${newTable}, externalKeyValue=${externalKeyValue}`);

    const params = {};
    const insertCols = [];
    const insertVals = [];
    const updateSet = [];

    // Tự động sinh ID nếu bảng có cột 'id' (case-insensitive) nhưng mapping không có
    if (existingCols.has('id') && !params.hasOwnProperty('id')) {
        const hasIdInMapping = Object.values(fieldMapping).some(v => v.toLowerCase() === 'id') ||
                              Object.keys(defaultValues || {}).some(v => v.toLowerCase() === 'id');
        if (!hasIdInMapping) {
            const newId = uuidv4().toUpperCase();
            params['id'] = newId;
            insertCols.push('[id]');
            insertVals.push('@id');
            // Thường không update ID
        }
    }

    for (const [oldField, newField] of Object.entries(fieldMapping)) {
      if (!existingCols.has(newField.toLowerCase())) continue;
      const value = rawData[oldField];
      if (value === undefined || value === null) continue;
      params[newField] = value;
      insertCols.push(`[${newField}]`);
      insertVals.push(`@${newField}`);

      // 🔥 NEVER update ID or created_at
      if (newField.toLowerCase() !== 'id' && newField.toLowerCase() !== 'created_at') {
        updateSet.push(`[${newField}] = @${newField}`);
      }
    }

    // --- 2. Ánh xạ từ defaultValues (Ghi đè nếu vẫn chưa có trong params) ---
    for (const [newField, valueFn] of Object.entries(defaultValues || {})) {
      const lowerNewField = newField.toLowerCase();
      if (!existingCols.has(lowerNewField)) continue;

      // Kiểm tra sự tồn tại (không phân biệt hoa thường)
      const exists = Object.keys(params).some(k => k.toLowerCase() === lowerNewField);
      if (!exists || params[Object.keys(params).find(k => k.toLowerCase() === lowerNewField)] === null) {
          const val = typeof valueFn === 'function' ? valueFn(rawData) : valueFn;
          if (val !== undefined && val !== null) {
              params[lowerNewField] = val;
              if (!insertCols.includes(`[${lowerNewField}]`)) {
                  insertCols.push(`[${lowerNewField}]`); insertVals.push(`@${lowerNewField}`);
                  if (lowerNewField !== 'id' && lowerNewField !== 'created_at') updateSet.push(`[${lowerNewField}] = @${lowerNewField}`);
              }
          }
      }
    }

    // --- 3. Tự động điền dữ liệu dựa trên kiểu dữ liệu của cột ---
    const currentParamKeys = new Set(Object.keys(params).map(k => k.toLowerCase()));
    for (const [col, type] of existingCols.entries()) {
      const lowerCol = col.toLowerCase();
      if (currentParamKeys.has(lowerCol)) continue;
        let fallback = null;
        if (type.includes('char') || type.includes('text')) fallback = '';
        else if (type.includes('int') || type.includes('decimal') || type.includes('float') || type.includes('numeric')) fallback = 0;
        else if (type.includes('date') || type.includes('time')) fallback = new Date();
        else if (type.includes('bit')) fallback = 0;

        if (fallback !== null) {
          params[lowerCol] = fallback;
          insertCols.push(`[${col}]`); insertVals.push(`@${lowerCol}`);
          if (lowerCol !== 'id' && lowerCol !== 'created_at') updateSet.push(`[${col}] = @${lowerCol}`);
        }
    }

    params._externalKeyValue = externalKeyValue;
    console.log(`[StreamCarBookingMigrationModel] upsertDataToNewDB params: ${JSON.stringify(params)}`);
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
    try {
        console.log(`[StreamCarBookingMigrationModel] Executing SQL Query...`);
        const result = await this.queryNewDbTx(query, params, transaction);
        const row = Array.isArray(result) ? result[0] : result;
        console.log(`[StreamCarBookingMigrationModel] SQL Execution Successful! Action=${row?.action}, Affected=${row?.affected}`);
        return { id: row?.id || null, action: row?.action || 'none', affected: Number(row?.affected || 0) };
    } catch (dbErr) {
        console.error(`\n[StreamCarBookingMigrationModel] ❌ SQL EXECUTION FAILED!`);
        console.error(`[StreamCarBookingMigrationModel] Error Message: ${dbErr.message}`);
        console.error(`[StreamCarBookingMigrationModel] Problematic Table: ${tableRef}`);
        console.error(`[StreamCarBookingMigrationModel] External Key Value: ${externalKeyValue}`);
        console.error(`[StreamCarBookingMigrationModel] Params Dump: ${JSON.stringify(params, null, 2)}`);
        console.error(`====================================================================\n`);
        throw dbErr;
    }
  }

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
        console.log(`[StreamCarBookingMigrationModel] Đã cập nhật roles_by_process (mới hoàn toàn) cho user id=${userId}`);
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
          } else {
             // Deep merge roles inside processKey
             const oldRolesMap = new Map((map.get(newItem.processKey).roles || []).map(r => [r.roleCode, r]));
             let innerListChanged = false;
             for (const roleObj of (newItem.roles || [])) {
                 if (!oldRolesMap.has(roleObj.roleCode)) {
                     oldRolesMap.set(roleObj.roleCode, roleObj);
                     innerListChanged = true;
                 }
             }
             if (innerListChanged) {
                 const mergedItem = map.get(newItem.processKey);
                 mergedItem.roles = Array.from(oldRolesMap.values());
                 map.set(newItem.processKey, mergedItem);
                 isChanged = true;
             }
          }
        }
      }

      if (isChanged) {
        const mergedRolesStr = JSON.stringify(Array.from(map.values()));
        const updateQ2 = `UPDATE [${this.newDbName}].[dbo].[users] SET roles_by_process = @roles WHERE id = @id`;
        await this.queryNewDbTx(updateQ2, { id: userId, roles: mergedRolesStr }, transaction);
        console.log(`[StreamCarBookingMigrationModel] Đã merge bổ sung roles_by_process cho user id=${userId}`);
      }
    } catch (e) {
      console.warn(`[StreamCarBookingMigrationModel] Không thể đảm bảo quyền roles_by_process cho ${userId}: ${e.message}`);
    }
  }
}

module.exports = StreamCarBookingMigrationModel;
