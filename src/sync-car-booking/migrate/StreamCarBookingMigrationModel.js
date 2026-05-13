const logger = require('../../../utils/logger');
const MigrationHelper = require('../../helpers/MigrationHelper');
const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const { tableMappings } = require('./config');
const {
  claimNextStagingRow,
  ensureTrackingColumns,
  markRowFailed,
  markRowSuccess,
  startHeartbeatLoop,
  updateHeartbeat,
} = require('../../helpers/StagingQueueHelper');

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
    this.heartbeatIntervalMs = Number(process.env.HEARTBEAT_INTERVAL_MS || 30000);

    // Multi-DB List Discovery
    this.listIdCache = {}; // { dbName: [listId1, listId2] }
    this.canonicalListTitle = null;
    this.cachedCarIds = [];
    this.cachedDriverIds = [];
  }

  async initialize() {
    logger.info(`[StreamCarBookingMigrationModel] Initializing...`);
    await super.initialize();

    // 🔥 Cache Source Schema to prevent "Invalid column name" errors
    await this.cacheSourceSchema();

    await this.ensureStagingTableExists();
    await this.ensureTargetColumnsExist();
    await this.ensureReferenceTablesExist();
    await this.seedCars();
    await this.seedDrivers();
    await this.cacheReferenceIds();
    logger.info(`[StreamCarBookingMigrationModel] Initialization complete.`);
  }

  async cacheReferenceIds() {
    try {
      const db = this.newDbName || 'camunda';
      const schema = 'dbo';

      const cars = await this.queryNewDb(`SELECT id FROM [${db}].[${schema}].[list_cars] WHERE status = 1`);
      this.cachedCarIds = cars.map(c => c.id);

      const drivers = await this.queryNewDb(`SELECT id FROM [${db}].[${schema}].[list_drivers] WHERE status = 1`);
      this.cachedDriverIds = drivers.map(d => d.id);

      logger.info(`[StreamCarBookingMigrationModel] Cached ${this.cachedCarIds.length} cars and ${this.cachedDriverIds.length} drivers for random assignment.`);
    } catch (err) {
      logger.warn(`[StreamCarBookingMigrationModel] Failed to cache reference IDs: ${err.message}`);
    }
  }

  async cacheSourceSchema() {
      try {
          this.sourceSchema.allUserData = await this.helper.getExistingColumnsSource(this.oldDbName, 'AllUserData');
          this.sourceSchema.codeItem = await this.helper.getExistingColumnsSource('DataEOfficeSNP', 'CodeItem', 'SNP');
          this.sourceSchema.hasUserInfo = await this.helper.checkTableExistsSource(this.oldUserDb, 'UserInfo');
          this.sourceSchema.hasDepartment = await this.helper.checkTableExistsSource(this.oldUserDb, 'Department');

          logger.info(`[StreamCarBookingMigrationModel] Source Schema Cached:
            AllUserData: ${this.sourceSchema.allUserData.size} columns,
            CodeItem: ${this.sourceSchema.codeItem.size} columns,
            UserInfo exists: ${this.sourceSchema.hasUserInfo},
            Department exists: ${this.sourceSchema.hasDepartment}`);
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
        { name: 'id_sp_bak', type: 'nvarchar(255)', nullable: 'NULL' },
        { name: 'source_db', type: 'nvarchar(255)', nullable: 'NULL' }
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
      const dropMasterIdx = `IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_${masterTable}_id_sp_bak' AND object_id = OBJECT_ID('${masterRef}')) DROP INDEX IX_${masterTable}_id_sp_bak ON ${masterRef};`;
      await this.queryNewDb(dropMasterIdx);
      await this.queryNewDb(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_${masterTable}_sp_source' AND object_id = OBJECT_ID('${masterRef}')) CREATE UNIQUE INDEX IX_${masterTable}_sp_source ON ${masterRef}(id_sp_bak, source_db) WHERE id_sp_bak IS NOT NULL AND source_db IS NOT NULL;`);

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
        { name: 'id_sp_bak', type: 'nvarchar(255)', nullable: 'NULL' },
        { name: 'source_db', type: 'nvarchar(255)', nullable: 'NULL' }
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
      const dropDetailIdx = `IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_${detailTable}_id_sp_bak' AND object_id = OBJECT_ID('${detailRef}')) DROP INDEX IX_${detailTable}_id_sp_bak ON ${detailRef};`;
      await this.queryNewDb(dropDetailIdx);
      // Note: Detail doesn't necessarily need unique on (id_sp_bak, source_db) if it's 1-to-many,
      // but if SharePoint has 1 row per assignment (which it doesn't seem to, it's parsed from JSON),
      // we'll at least index it for performance.
      await this.queryNewDb(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_${detailTable}_sp_source' AND object_id = OBJECT_ID('${detailRef}')) CREATE INDEX IX_${detailTable}_sp_source ON ${detailRef}(id_sp_bak, source_db);`);
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
              [ID] BIGINT NOT NULL,
              [source_db] NVARCHAR(255) NULL
          );
          CREATE UNIQUE INDEX IX_${table}_ID_Source ON ${stagingTableRef}([ID], [source_db]);
      END
      `;
      await this.queryNewDb(createQuery);
      await ensureTrackingColumns(this, {
        tableRef: stagingTableRef,
        tableName: table,
        schemaName: schema,
        dbName: this.newDbName,
        label: this.modelName,
      });

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
        { name: 'NAS_MESS', type: 'NVARCHAR(MAX)' },
        { name: 'DepartmentName', type: 'NVARCHAR(MAX)' },
        { name: 'source_db', type: 'NVARCHAR(255)' },
        // ★ Staging flags — dùng cho cơ chế claim/process chuẩn
        { name: 'MigrateFlg',     type: 'INT' },
        { name: 'MigrateErrFlg',  type: 'INT' },
        { name: 'MigrateErrMess', type: 'NVARCHAR(MAX)' }
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

      // Đảm bảo index tổng hợp tồn tại
      const indexCheckQuery = `
      IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_${table}_ID' AND object_id = OBJECT_ID('${stagingTableRef}'))
      BEGIN
          DROP INDEX IX_${table}_ID ON ${stagingTableRef};
      END
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_${table}_ID_Source' AND object_id = OBJECT_ID('${stagingTableRef}'))
      BEGIN
          CREATE UNIQUE INDEX IX_${table}_ID_Source ON ${stagingTableRef}([ID], [source_db]);
      END
      `;
      await this.queryNewDb(indexCheckQuery);
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

  /**
   * Giải quyết List IDs cho một database cụ thể của module Đặt xe.
   */
  async resolveListIdsForDb(dbName) {
    if (this.listIdCache[dbName]) return this.listIdCache[dbName];

    const referenceIds = this.oldConfig.listIds || [];

    // 1. Lấy Title mẫu từ reference DB (khkd) nếu chưa có
    if (!this.canonicalListTitle) {
      const refDb = this.oldDbName;
      const refId = referenceIds[0];
      const titleQuery = `SELECT TOP 1 tp_Title FROM [${refDb}].[dbo].[AllLists] WHERE tp_ID = @refId`;
      try {
        const rows = await this.queryOldDb(titleQuery, { refId });
        if (rows?.length) {
          this.canonicalListTitle = rows[0].tp_Title;
          logger.info(`[StreamCarBookingMigrationModel] Canonical List Title discovered: "${this.canonicalListTitle}"`);
        }
      } catch (err) {
        logger.error(`[StreamCarBookingMigrationModel] Failed to discover canonical title from ${refDb}: ${err.message}`);
      }
    }

    // 2. Tìm List IDs trong target DB theo Title (ưu tiên Exact Match)
    let discoveredIds = [];
    if (this.canonicalListTitle) {
      const discoveryQuery = `SELECT tp_ID FROM [${dbName}].[dbo].[AllLists] WHERE tp_Title = @title AND tp_DeleteTransactionId = 0x0`;
      try {
        const rows = await this.queryOldDb(discoveryQuery, { title: this.canonicalListTitle });
        discoveredIds = rows.map(r => String(r.tp_ID).toUpperCase());
      } catch (err) {
        logger.error(`[StreamCarBookingMigrationModel] discoveryQuery failed for DB ${dbName}: ${err.message}`);
      }
    }

    // 3. Nếu chưa thấy, thử tìm theo từ khóa đặc thù cho Đặt xe
    if (discoveredIds.length === 0) {
      const keywords = ['Lịch xe', 'Đặt xe', 'Đăng ký xe', 'Lịch đăng ký xe'];
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
          logger.info(`[StreamCarBookingMigrationModel] [${dbName}] Found potential lists: ${rows.map(r => r.tp_Title).join(', ')}`);
        }
      } catch (err) {
        logger.error(`[StreamCarBookingMigrationModel] likeQuery failed for DB ${dbName}: ${err.message}`);
      }
    }

    if (discoveredIds.length > 0) {
      this.listIdCache[dbName] = discoveredIds;
      logger.info(`[StreamCarBookingMigrationModel] Final resolved List IDs for [${dbName}]: ${discoveredIds.join(', ')}`);
      return discoveredIds;
    }

    // 4. Fallback cuối cùng
    if (dbName === this.oldDbName) {
      logger.warn(`[StreamCarBookingMigrationModel] Using hardcoded reference IDs for ${dbName}.`);
      return referenceIds;
    }

    logger.error(`[StreamCarBookingMigrationModel] !!! KHÔNG TÌM THẤY DANH SÁCH ĐẶT XE TẠI DB: ${dbName} !!!`);
    return [];
  }

  async getCount(lastSyncTime, lastSyncId = 0) {
    const dbs = this.oldConfig.databaseList || [this.oldDbName];

    let total = 0;
    for (const db of dbs) {
      const listIds = await this.resolveListIdsForDb(db);
      if (!listIds?.length) continue;

      const listIdsStr = listIds.map(id => `'${id}'`).join(',');
      const query = `
          SELECT COUNT(*) AS total
          FROM [${db}].[dbo].[AllUserData] ud
          WHERE ud.[tp_ListId] IN (${listIdsStr})
          AND ud.tp_RowOrdinal = 0
      `;
      try {
        const rows = await this.queryOldDb(query, { lastSyncTime, lastSyncId: Number(lastSyncId || 0) });
        const dbCount = Number(rows?.[0]?.total || 0);
        total += dbCount;
        logger.info(`[StreamCarBookingMigrationModel] [getCount] DB: ${db} -> ${dbCount} items`);
      } catch (err) {
        logger.error(`[StreamCarBookingMigrationModel] [getCount] Failed for DB: ${db}: ${err.message}`);
      }
    }
    return total;
  }

  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0, offset = 0, limit = 2000, dbName = null) {
    const targetDb = dbName || this.oldDbName;
    const resolvedListIds = await this.resolveListIdsForDb(targetDb);
    const listIdsStr = resolvedListIds.map(id => `'${id}'`).join(',');

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
        cols.allUserData.has('nvarchar1') ? `CAST(ud.[nvarchar1] AS NVARCHAR(MAX)) AS Title` : `NULL AS Title`,
        cols.allUserData.has('datetime1') ? `ud.[datetime1] AS StartDate` : `NULL AS StartDate`,
        cols.allUserData.has('datetime2') ? `ud.[datetime2] AS EndDate` : `NULL AS EndDate`,
        cols.allUserData.has('nvarchar2') ? `CAST(ud.[nvarchar2] AS NVARCHAR(MAX)) AS Location` : `NULL AS Location`,
        cols.allUserData.has('nvarchar3') ? `CAST(ud.[nvarchar3] AS NVARCHAR(MAX)) AS Description` : `NULL AS Description`,
        cols.allUserData.has('nvarchar4') ? `CAST(ud.[nvarchar4] AS NVARCHAR(MAX)) AS Organizer` : `NULL AS Organizer`
    ];

    const ciSelect = [
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
    ].map(col => {
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
        SELECT * FROM (
            SELECT
                ${udSelect.join(',\n                ')},
                ${ciSelect.join(',\n                ')},
                ${cols.hasDepartment ? `dept.[Title] AS DepartmentName` : `NULL AS DepartmentName`},
                ud.[tp_Modified] AS __sync_time,
                ud.[tp_ID] AS __sync_id_num,
                ROW_NUMBER() OVER (ORDER BY ud.[tp_Modified] ASC, ud.[tp_ID] ASC) AS __page_rn

            FROM [${targetDb}].[dbo].[AllUserData] ud
            INNER JOIN [${targetDb}].[dbo].[AllLists] l
                ON ud.[tp_ListId] = l.[tp_ID]
            ${cols.hasUserInfo ? `LEFT JOIN [${this.oldUserDb}].[dbo].[UserInfo] ui_author ON ud.[tp_Author] = ui_author.[tp_ID]` : ''}
            ${cols.hasUserInfo ? `LEFT JOIN [${this.oldUserDb}].[dbo].[UserInfo] ui_editor ON ud.[tp_Editor] = ui_editor.[tp_ID]` : ''}
            LEFT JOIN [DataEOfficeSNP].[SNP].[CodeItem] ci ON ud.[tp_ID] = ci.[SPItemId] AND CAST(ud.[tp_ListId] AS NVARCHAR(100)) = CAST(ci.[SPListId] AS NVARCHAR(100))
            ${cols.hasDepartment ? `LEFT JOIN [${this.oldUserDb}].[dbo].[Department] dept ON ci.[DepartmentId] = dept.[ID]` : ''}

            WHERE ud.[tp_ListId] IN (${listIdsStr})
            AND ud.tp_RowOrdinal = 0
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
    return rows;
  }

  async syncOldToStaging(rows, { transaction, dbName } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return { stagedCount: 0 };
    const targetDb = dbName || this.oldDbName;
    console.log(`[StreamCarBookingMigrationModel] Staging ${rows.length} rows from ${targetDb} to ${this.newTableSync}...`);
    const internalColumns = new Set(['__sync_time', '__sync_id_num', 'source_db']);
    const columns = Object.keys(rows[0] || {}).filter(
      (c) => !String(c).startsWith('__') && !internalColumns.has(c)
    );
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
          params['source_db'] = targetDb;

          columns.forEach((col, index) => {
            const pName = `p${index}`;
            params[pName] = normalizeValue(row[col], col);
            if (col !== keyColumn) colPairs.push(`[${col}] = @${pName}`);
          });

          // Metadata flags
          params.MigrateFlg = 0;
          params.MigrateErrFlg = 0;

          const updateSet = colPairs.length > 0 ? colPairs.join(', ') : `[${keyColumn}] = [${keyColumn}]`;
          const insertCols = columns.map(c => `[${c}]`).join(', ');
          const insertVals = columns.map((_, i) => `@p${i}`).join(', ');

          const query = `
          IF EXISTS (SELECT 1 FROM ${stagingTableRef} WHERE [${keyColumn}] = @id_key AND [source_db] = @source_db)
          BEGIN
              UPDATE ${stagingTableRef} SET ${updateSet}, __sync_time = @sync_time, __sync_id_num = @sync_id_num, MigrateFlg = @MigrateFlg, MigrateErrFlg = @MigrateErrFlg, MigrateErrMess = NULL WHERE [${keyColumn}] = @id_key AND [source_db] = @source_db
          END
          ELSE
          BEGIN
              INSERT INTO ${stagingTableRef} (${insertCols}, __sync_time, __sync_id_num, source_db, MigrateFlg, MigrateErrFlg) VALUES (${insertVals}, @sync_time, @sync_id_num, @source_db, @MigrateFlg, @MigrateErrFlg)
          END
          `;
          await this.queryNewDbTx(query, params, transaction);
          processedCount++;
      } catch (err) {
          console.error(`[StreamCarBookingMigrationModel] ERROR staging row ID=${row[keyColumn]} from ${targetDb}: ${err.message}`);
          if (err.message.includes('deadlock') || err.message.includes('connection')) throw err;
      }
    }
    return { stagedCount: processedCount };
  }

  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    if (!syncJobId) throw new Error('syncJobId is required');
    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);
    const stagingTableRef = this.getStagingTableRef();

    // ★ Cleanup stale records (MigrateFlg=2)
    try {
      await this.queryNewDb(`UPDATE ${stagingTableRef} SET MigrateFlg = 0 WHERE MigrateFlg = 2`);
    } catch (e) {}

    const totalCount = await this.getCount(normalizedLastSyncTime, normalizedLastSyncId);
    logger.info(`[StreamCarBookingMigrationModel] Total records across all DBs: ${totalCount}`);

    // Cập nhật Dashboard
    await this.queryNewDb(`UPDATE sync_jobs SET total_to_sync = @total WHERE job_id = @jobId`, {
      total: totalCount,
      jobId: syncJobId
    });

    const fetchBatchSize = Number(process.env.STAGING_FETCH_BATCH_SIZE || 2000);
    const dbs = this.oldConfig.databaseList || [this.oldDbName];

    let totalStagedCount = 0;
    let nextSyncTime = normalizedLastSyncTime;
    let nextSyncId = normalizedLastSyncId;

    let dbIdx = 0;
    for (const db of dbs) {
      dbIdx++;
      try {
        logger.info(`[StreamCarBookingMigrationModel] [SITE ${dbIdx}/${dbs.length}] Processing database: ${db}`);

        // Resolve List IDs cho DB này
        const listIds = await this.resolveListIdsForDb(db);
        if (listIds.length === 0) {
          logger.warn(`[StreamCarBookingMigrationModel] No List IDs resolved for DB ${db}. Skipping.`);
          continue;
        }
        const listIdsStr = listIds.map(id => `'${id}'`).join(',');

        // Lấy count riêng cho DB này
        const dbCountQuery = `
            SELECT COUNT(*) AS total
            FROM [${db}].[dbo].[AllUserData]
            WHERE [tp_ListId] IN (${listIdsStr})
            AND tp_RowOrdinal = 0
        `;
        const dbCountRes = await this.queryOldDb(dbCountQuery, { lastSyncTime: normalizedLastSyncTime, lastSyncId: normalizedLastSyncId });
        const dbCount = Number(dbCountRes?.[0]?.total || 0);

        if (dbCount === 0) {
          logger.info(`[StreamCarBookingMigrationModel] No new records in ${db}`);
          continue;
        }

        const numIterations = Math.ceil(dbCount / fetchBatchSize);
        for (let i = 0; i < numIterations; i++) {
            const offset = i * fetchBatchSize;
            logger.info(`[StreamCarBookingMigrationModel] [${db}] Fetching batch ${i + 1}/${numIterations} (Offset: ${offset})`);

            const rows = await this.fetchListFromOldDb(normalizedLastSyncTime, normalizedLastSyncId, offset, fetchBatchSize, db);
            if (!rows || rows.length === 0) break;

            const stageResult = await this.syncOldToStaging(rows, { dbName: db });
            totalStagedCount += Number(stageResult?.stagedCount || rows.length || 0);

            // Cập nhật cursor (Global)
            for (const row of rows) {
                const rowTime = this.extractRowSyncTime(row);
                const rowId = this.extractRowSyncId(row);
                if (!rowTime) continue;

                const isAhead = this.isCursorAhead(rowTime, rowId, nextSyncTime, nextSyncId);
                if (isAhead) {
                    nextSyncTime = rowTime;
                    nextSyncId = rowId;
                }
            }
            logger.info(`[StreamCarBookingMigrationModel] [${db}] Staged so far: ${totalStagedCount}. Cursor: ${nextSyncTime} / ${nextSyncId}`);
        }
      } catch (dbErr) {
        logger.error(`[StreamCarBookingMigrationModel] [SKIPPED SITE] Error processing database ${db}: ${dbErr.message}`);
        // Tiếp tục tới DB tiếp theo
      }
    }

    // Đếm pending thực tế trong staging
    let pendingCount = totalStagedCount;
    try {
      const pendingRes = await this.queryNewDb(`SELECT COUNT(1) AS cnt FROM ${stagingTableRef} WHERE ISNULL(MigrateFlg, 0) = 0 AND ISNULL(MigrateErrFlg, 0) = 0`);
      pendingCount = Number(pendingRes?.[0]?.cnt || 0);
    } catch (e) {}

    return {
        syncJobId,
        rows: [],
        totalCount: pendingCount,
        stagedCount: totalStagedCount,
        lastSyncTime: nextSyncTime,
        lastSyncId: nextSyncId
    };
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
        cols.allUserData.has('nvarchar1') ? `CAST(ud.[nvarchar1] AS NVARCHAR(MAX)) AS Title` : `NULL AS Title`,
        cols.allUserData.has('datetime1') ? `ud.[datetime1] AS StartDate` : `NULL AS StartDate`,
        cols.allUserData.has('datetime2') ? `ud.[datetime2] AS EndDate` : `NULL AS EndDate`,
        cols.allUserData.has('nvarchar2') ? `CAST(ud.[nvarchar2] AS NVARCHAR(MAX)) AS Location` : `NULL AS Location`,
        cols.allUserData.has('nvarchar3') ? `CAST(ud.[nvarchar3] AS NVARCHAR(MAX)) AS Description` : `NULL AS Description`,
        cols.allUserData.has('nvarchar4') ? `CAST(ud.[nvarchar4] AS NVARCHAR(MAX)) AS Organizer` : `NULL AS Organizer`,
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

  async fetchOneFromStaging() {
    const stagingTableRef = this.getStagingTableRef();
    const row = await claimNextStagingRow(this, {
      tableRef: stagingTableRef,
      orderBy: 'SY_SyncId ASC',
      owner: `pid_${process.pid}`,
      label: this.modelName,
    });
    if (row) {
      logger.info(`[${this.modelName}] [START] Processing started: SY_SyncId=${row.SY_SyncId}, ID=${row.ID}`);
    }
    return row;
  }

  async updateHeartbeat(rowData, transaction = null) {
    if (!rowData?.SY_SyncId) return 0;
    return updateHeartbeat(this, {
      tableRef: this.getStagingTableRef(),
      keyWhere: 'SY_SyncId = @syncId',
      params: { syncId: rowData.SY_SyncId },
      transaction,
      rowToken: `SY_SyncId=${rowData.SY_SyncId}`,
      label: this.modelName,
    });
  }

  async processOne(syncJobId) {
    const stagingTableRef = this.getStagingTableRef();
    let rowData = null;

    try {
      rowData = await this.fetchOneFromStaging();
    } catch (e) {
      logger.error(`[StreamCarBookingMigrationModel] Error claiming row from staging: ${e.message}`);
      return { syncJobId, processed: false, done: false };
    }

    if (!rowData) {
      logger.info(`[StreamCarBookingMigrationModel] No more pending records in staging for job ${syncJobId}`);
      return { syncJobId, processed: false, done: true };
    }

    const recordId = rowData.ID;
    const dbSource = rowData.source_db || this.oldDbName;
    rowData.source_db = dbSource; // Ensure it's set for processRowData
    logger.info(`[StreamCarBookingMigrationModel] processOne: Processing row ID ${recordId} from ${dbSource}`);
    const stopHeartbeat = startHeartbeatLoop(
      () => this.updateHeartbeat(rowData),
      this.heartbeatIntervalMs,
    );

    try {
      await this.processRowData(rowData);

      // Mark success
      await markRowSuccess(this, {
        tableRef: stagingTableRef,
        keyWhere: 'SY_SyncId = @syncId',
        params: { syncId: rowData.SY_SyncId },
        rowToken: `SY_SyncId=${rowData.SY_SyncId}`,
        label: this.modelName,
      });

      // Update Dashboard
      await this.queryNewDb(
        `UPDATE sync_jobs SET total_processed = ISNULL(total_processed,0) + 1, total_success = ISNULL(total_success,0) + 1 WHERE job_id = @syncJobId`,
        { syncJobId }
      );
      stopHeartbeat();

      return { syncJobId, processed: true, done: false };
    } catch (err) {
      stopHeartbeat();
      logger.error(`[StreamCarBookingMigrationModel] processOne: Error ID ${recordId}: ${err.message}`);

      // Mark error
      await markRowFailed(this, {
        tableRef: stagingTableRef,
        keyWhere: 'SY_SyncId = @syncId',
        params: { syncId: rowData.SY_SyncId },
        rowToken: `SY_SyncId=${rowData.SY_SyncId}`,
        errorMessage: err.message,
        label: this.modelName,
      });

      await this.queryNewDb(
        `UPDATE sync_jobs SET total_processed = ISNULL(total_processed,0) + 1, total_errors = ISNULL(total_errors,0) + 1 WHERE job_id = @syncJobId`,
        { syncJobId }
      );

      return { syncJobId, processed: false, done: false, error: err.message };
    }
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
        let finalUserId = null;

        // 1a. Tách tên thuần (Loại bỏ phòng ban phía sau dấu "-")
        // Ví dụ: "Hoàng Thị Lan Phương - TB ATPC" -> "Hoàng Thị Lan Phương"
        let pureName = null;
        if (rowData.AuthorName) {
            pureName = String(rowData.AuthorName).split('-')[0].trim();
            console.log(`[StreamCarBookingMigrationModel] Extracted pure name: "${pureName}" from "${rowData.AuthorName}"`);
        }

        // 1b. Dùng MigrationHelper để tự động dò tìm hoặc tạo User ID
        if (pureName) {
            try {
                if (this.helper && typeof this.helper.syncAndMapUser === 'function') {
                    finalUserId = await this.helper.syncAndMapUser(pureName, transaction);
                } else if (this.helper && typeof this.helper.mapUserName === 'function') {
                    finalUserId = await this.helper.mapUserName(pureName, transaction);
                }

                if (finalUserId) {
                    console.log(`[StreamCarBookingMigrationModel] Mapped User via Helper (${pureName}) -> ${finalUserId}`);
                }
            } catch (e) {
                console.warn(`[StreamCarBookingMigrationModel] Lỗi tìm user qua Helper: ${e.message}`);
            }
        }

        // 1c. Thử tìm ID theo Account (username) nếu Tên thất bại hoặc Helper không tìm thấy
        if (!finalUserId && rowData.AuthorAccount) {
            try {
                const qAccount = `SELECT TOP 1 id FROM [${this.newDbName}].[dbo].[users] WHERE username = @account OR email LIKE @account + '@%'`;
                const accRows = await this.queryNewDbTx(qAccount, { account: String(rowData.AuthorAccount).trim() }, transaction);
                if (accRows && accRows.length > 0) {
                    finalUserId = accRows[0].id;
                    console.log(`[StreamCarBookingMigrationModel] Mapped User by Account (${rowData.AuthorAccount}) -> ${finalUserId}`);
                }
            } catch (e) {
                console.warn(`[StreamCarBookingMigrationModel] Lỗi tìm user bằng Account: ${e.message}`);
            }
        }

        // 1d. Fallback an toàn nếu vẫn không tìm thấy
        if (!finalUserId) {
            finalUserId = 'b23406e3-5c75-41d3-91e0-1654293ae6b2';
            console.log(`[StreamCarBookingMigrationModel] User not found for ${rowData.AuthorName || rowData.AuthorAccount}. Using fallback Admin ID: ${finalUserId}`);
        }

        rowData.AuthorAccount = finalUserId;
        
        console.log(`[StreamCarBookingMigrationModel] Using User ID: ${finalUserId}`);

        // Đảm bảo user có quyền (roles) cần thiết nếu chưa có
        await this._ensureUserHasRoles(finalUserId, carBookingRoles, transaction);

        if (!rowData.Organizer) {
            rowData.Organizer = finalUserId;     // Map Organizer sang cùng user nếu bị rỗng
        }

        // 🔥 1.5. Xử lý các giá trị mặc định thực tế cho MASTER nếu bị thiếu
        if (!rowData.departure_point || String(rowData.departure_point).trim() === '') {
            rowData.departure_point = N('Tại đơn vị');
        }
        if (!rowData.Location || String(rowData.Location).trim() === '') {
            rowData.Location = N('Công tác nội thành/Theo lộ trình yêu cầu');
        }
        if (!rowData.Description || String(rowData.Description).trim() === '') {
            rowData.Description = N('Giải quyết công việc chuyên môn');
        }
        if (rowData.passenger_count === undefined || rowData.passenger_count === null) {
            rowData.passenger_count = 1;
        }

        // 🔥 1.6. Khai báo thời gian hiện tại
        const now = new Date();

        // 🔥 1.7. ÉP CỨNG DỮ LIỆU CHUẨN HIỂN THỊ (Strict Hardcoding - No Fallbacks)
        // name = Title gốc từ SharePoint (nếu có), fallback sang Location
        rowData.name = rowData.Title || rowData.Location || N('Yêu cầu đặt xe');

        // contact_person là Tên hiển thị (Theo yêu cầu: Thay bằng ID người dùng)
        rowData.contact_person = finalUserId;

        // Mapping Phòng ban từ DepartmentName
        if (rowData.DepartmentName) {
            const mappedDeptId = await this.helper.mapSenderUnitId(rowData.DepartmentName, transaction);
            if (mappedDeptId) {
                rowData.department = mappedDeptId;
                console.log(`[StreamCarBookingMigrationModel] Resolved Department: ${rowData.DepartmentName} -> ${mappedDeptId}`);
            }
        }

        // Mapping Status dựa trên DocumentStatus (SharePoint) -> status_code (DiOffice)
        // Mặc định 2 (Đã duyệt) nếu không bóc tách được
        let statusCode = 2;
        if (rowData.DocumentStatus === 1 || rowData.DocumentStatus === '1') statusCode = 1; // Chờ duyệt
        if (rowData.DocumentStatus === 3 || rowData.DocumentStatus === '3') statusCode = 2; // Đã duyệt
        if (rowData.DocumentStatus === 4 || rowData.DocumentStatus === '4') statusCode = 3; // Từ chối
        rowData.status_code = statusCode;

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
        // Lấy thời gian đi từ tp_Created và thời gian về từ tp_Modified theo yêu cầu USER
        const parseDateFallback = (str) => {
            if (!str) return null;
            if (str instanceof Date) return isNaN(str.getTime()) ? null : str;
            // Làm sạch khoảng trắng và thêm dấu cách trước AM/PM nếu thiếu (ví dụ: "6:36AM" -> "6:36 AM")
            let cleanStr = String(str).replace(/\s+/g, ' ').trim();
            cleanStr = cleanStr.replace(/([aApP][mM])$/, ' $1');
            const d = new Date(cleanStr);
            return isNaN(d.getTime()) ? null : d;
        };

        const start = parseDateFallback(rowData.tp_Created || rowData.CreatedDate);
        const end = parseDateFallback(rowData.tp_Modified || rowData.ModifiedDate);

        rowData.departure_time = start || now;
        rowData.return_time = end || now;

        if (rowData.departure_time && rowData.return_time) {
            const diffMs = rowData.return_time - rowData.departure_time;
            rowData.trip_duration_minutes = diffMs > 0 ? Math.floor(diffMs / (1000 * 60)) : 0;
        } else {
            rowData.trip_duration_minutes = 0;
        }

        // 🔥 2. Ghi vào bảng MASTER (vehicle_registrations)
        // Safeguard: Chuẩn hóa cột JSON array/số - chuỗi rỗng hoặc null → NULL (không ghi '[]' hay 0 giả)
        const normalizeNullable = (v) => {
            if (v === null || v === undefined) return null;
            const s = String(v).trim();
            return s === '' || s === 'null' || s === 'undefined' ? null : s;
        };
        rowData.driver_ids               = normalizeNullable(rowData.driver_ids);
        rowData.car_ids                  = normalizeNullable(rowData.car_ids);
        rowData.coordination_information = normalizeNullable(rowData.coordination_information);
        rowData.confirmed_driver_ids     = normalizeNullable(rowData.confirmed_driver_ids);
        rowData.driver_notice_count      = (rowData.driver_notice_count === null || rowData.driver_notice_count === undefined || String(rowData.driver_notice_count).trim() === '') ? null : Number(rowData.driver_notice_count);
        rowData.leader_notice_times      = normalizeNullable(rowData.leader_notice_times);

        logger.info(`[StreamCarBookingMigrationModel] Executing Upsert for MASTER table...`);
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
            
            const carList = this.cachedCarIds.length > 0 ? this.cachedCarIds : ['LC-20260224035946-Q6DQ2AL8'];
            const driverList = this.cachedDriverIds.length > 0 ? this.cachedDriverIds : ['DR-20260316075949-SF8X4UZA'];

            for (const item of coordination) {
                // 3a. Tìm ID Xe đã có sẵn trên hệ thống mới (Hoặc tự tạo nếu chưa có)
                let finalCarId = item.carId || item.car_id;
                if (finalCarId && isNaN(finalCarId)) {
                    finalCarId = await this.getOrCreateCar(finalCarId, transaction);
                } else {
                    finalCarId = null;
                }
                
                // Nếu không tìm thấy xe khớp tên và tạo thất bại, chọn random 1 xe có sẵn
                if (!finalCarId) {
                    finalCarId = carList[Math.floor(Math.random() * carList.length)];
                }

                // 3b. Tìm ID Tài xế đã có sẵn trên hệ thống mới (Hoặc tự tạo nếu chưa có)
                let finalDriverId = item.driverId || item.driver_id;
                if (finalDriverId && isNaN(finalDriverId)) {
                    finalDriverId = await this.getOrCreateDriver(finalDriverId, transaction);
                } else {
                    finalDriverId = null;
                }
                
                // Nếu không tìm thấy tài xế khớp tên và tạo thất bại, chọn random 1 tài xế có sẵn
                if (!finalDriverId) {
                    finalDriverId = driverList[Math.floor(Math.random() * driverList.length)];
                }

                const detailData = {
                    registration_id: masterId,
                    car_id: finalCarId || 'UNKNOWN_CAR',
                    driver_id: finalDriverId || 'UNKNOWN_DRIVER',
                    is_confirmed: item.isConfirmed ? 1 : 0,
                    confirmed_at: item.confirmedAt ? new Date(item.confirmedAt) : null,
                    id_sp_bak: recordId,
                    table_bak: 1,
                    source_db: rowData.source_db
                };
                await this.upsertDetailToNewDB(detailData, transaction);
                count++;
            }
            console.log(`[StreamCarBookingMigrationModel] Completed Upserting ${count} Coordination Items.`);
        } else {
            console.log(`[StreamCarBookingMigrationModel] No Coordination Items found. Generating 1 RANDOM detail assignment...`);

            // Fallback lists nếu cache bị rỗng
            const fallbackCars = ['LC-20260224035946-Q6DQ2AL8', 'LC-20260316085406-YYAQZ3FB', 'LC-20260317155714-B2SY4GOP'];
            const fallbackDrivers = ['DR-20260316075949-SF8X4UZA', '6928176e213f38bebc8024cf', '9cc1fccc-0ccb-4305-9cab-f701aa70e54c'];

            const carList = this.cachedCarIds.length > 0 ? this.cachedCarIds : fallbackCars;
            const driverList = this.cachedDriverIds.length > 0 ? this.cachedDriverIds : fallbackDrivers;

            const detailData = {
                registration_id: masterId,
                car_id: carList[Math.floor(Math.random() * carList.length)],
                driver_id: driverList[Math.floor(Math.random() * driverList.length)],
                is_confirmed: 1,
                confirmed_at: new Date(),
                id_sp_bak: recordId,
                table_bak: 1,
                source_db: rowData.source_db
            };
            await this.upsertDetailToNewDB(detailData, transaction);
            console.log(`[StreamCarBookingMigrationModel] Completed Upserting 1 RANDOM Coordination Item.`);
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
    const creatorId = rowData.AuthorAccount || 'b23406e3-5c75-41d3-91e0-1654293ae6b2';

    const parseSharePointDate = (str) => {
      if (!str) return new Date();
      if (str instanceof Date) return isNaN(str.getTime()) ? new Date() : str;
      // Làm sạch khoảng trắng (ví dụ "Oct  8 2014  6:36AM" -> "Oct 8 2014 6:36 AM")
      let cleanStr = String(str).replace(/\s+/g, ' ').trim();
      cleanStr = cleanStr.replace(/([aApP][mM])$/, ' $1');
      const d = new Date(cleanStr);
      if (isNaN(d.getTime())) {
          console.warn(`[StreamCarBookingMigrationModel] Failed to parse date string "${str}", fallback to now.`);
          return new Date();
      }
      return d;
    };

    const rawTimeStr = rowData.tp_Modified || rowData.tp_Created || rowData.created_at || rowData.ModifiedDate;
    const createTime = parseSharePointDate(rawTimeStr);

    let auditSteps = [];

    // 2. Luôn tạo log mặc định đủ 3 bước (Submit -> Coordinate -> Finish) theo yêu cầu USER
    // Cộng thêm giây để đảm bảo thứ tự hiển thị trong UI
    const time1 = createTime;
    const time2 = new Date(createTime.getTime() + 1000); // +1s
    const time3 = new Date(createTime.getTime() + 2000); // +2s

    auditSteps.push(
        {
            action_code: 'TAO_VA_GUI_YEU_CAU_DANG_KY_XE',
            display_name: 'b23406e3-5c75-41d3-91e0-1654293ae6b2',
            role: 'NGUOI_DANG_KY_XE',
            details: N('Tạo tạo mới yêu cầu'),
            action: N('Tạo tạo mới yêu cầu'),
            from_node_id: 'Activity_00hcfcm',
            to_node_id: 'Gateway_1ilkpo8',
            curStatusCode: '1',
            stage_status: 'DA_XU_LY',
            receiver: creatorId,
            origin_id: 'migrated_init',
            time: time1
        },
        {
            action_code: 'DIEU_PHOI_XE',
            display_name: 'b23406e3-5c75-41d3-91e0-1654293ae6b2',
            role: 'BO_PHAN_DIEU_PHOI',
            details: N('Đã điều phối'),
            action: N('Điều phối'),
            from_node_id: 'Gateway_1ilkpo8',
            to_node_id: 'Gateway_1ilkpo8',
            curStatusCode: '2',
            stage_status: 'DA_XU_LY',
            receiver: creatorId,
            origin_id: 'migrated_coord',
            time: time2
        },
        {
            action_code: 'TAI_XE_XAC_NHAN_YEU_CAU',
            display_name: 'b23406e3-5c75-41d3-91e0-1654293ae6b2',
            role: 'BO_PHAN_VAN_THU',
            details: N('Tài xế xác nhận chuyến xe'),
            action: N('Xác nhận yêu cầu đăng ký xe'),
            from_node_id: 'Activity_0k060ta',
            to_node_id: 'Event_1ffnh4z',
            curStatusCode: '3',
            stage_status: 'DA_XU_LY',
            receiver: creatorId,
            origin_id: 'migrated_finish',
            time: time3
        }
    );

    // 3. Thực hiện Insert
    for (const step of auditSteps) {
        const query = `
        IF NOT EXISTS (SELECT 1 FROM ${tableRef} WHERE document_id = @document_id AND action_code = @action_code AND [time] = @time)
        BEGIN
            INSERT INTO ${tableRef} (
                document_id, [time], user_id, display_name, [role], action_code,
                from_node_id, to_node_id, [details], origin_id, created_by, receiver, roleProcess,
                [action], curStatusCode, stage_status, type_document, created_at, modifiedAt, table_bak, table_backups
            )
            VALUES (
                @document_id, @time, @user_id, @display_name, @role, @action_code,
                @from_node_id, @to_node_id, @details, @origin_id, @created_by, @receiver, 'processor',
                @action, @curStatusCode, @stage_status, 'VEHICLE_REGISTRATION', @time, @time, 1, 'auto create'
            )
        END
        `;
        const params = {
            document_id: masterId,
            time: step.time || createTime,
            user_id: step.user_id || creatorId,
            created_by: creatorId,
            ...step
        };
        // Xóa thuộc tính time khỏi params để tránh trùng lặp
        delete params.time;

        try {
            await this.queryNewDbTx(query, { ...params, time: step.time || createTime }, transaction);
        } catch (auditErr) {
            logger.warn(`[StreamCarBookingMigrationModel] Audit insertion failed: ${auditErr.message}`);
        }
    }
  }

  /**
   * Parse HTML YKien từ SharePoint
   * Cấu trúc: <span class='noidung title'>Name (Date)</span> <div class='noidung'>Comment</div>
   */
  parseYKienHTML(html, masterId) {
    const steps = [];
    try {
        // Regex bóc tách các khối ý kiến
        // Format: <span class='noidung title'>... (DD/MM/YYYY HH:mm)</span> ... <div class='noidung'>...</div>
        const entryRegex = /<span class='noidung title'>\s*(.*?)\s*\((\d{1,2}\/\d{1,2}\/\d{4}\s*\d{1,2}:\d{2})\)\s*<\/span>\s*<div class='noidung'>\s*(.*?)\s*<\/div>/gs;

        let match;
        let index = 0;
        while ((match = entryRegex.exec(html)) !== null) {
            const userName = match[1].trim();
            const dateStr = match[2].trim();
            const comment = match[3].trim().replace(/<br\s*\/?>/gi, '\n').replace(/&nbsp;/g, ' ');

            // Parse ngày Việt Nam (DD/MM/YYYY HH:mm)
            const [dmy, hm] = dateStr.split(/\s+/);
            const [d, m, y] = dmy.split('/');
            const [h, min] = hm.split(':');
            const stepTime = new Date(y, m - 1, d, h, min);

            steps.push({
                action_code: index === 0 ? 'DONG_BO_Y_KIEN_CUOI' : `DONG_BO_Y_KIEN_${index}`,
                display_name: userName,
                role: 'NGUOI_XU_LY',
                details: JSON.stringify(comment),
                action: N('Ghi ý kiến/Phê duyệt'),
                from_node_id: 'Activity_External',
                to_node_id: 'Activity_External',
                curStatusCode: '2',
                stage_status: 'DA_XU_LY',
                receiver: 'SYSTEM',
                origin_id: `sp_bak_${masterId}_${index}`,
                time: isNaN(stepTime.getTime()) ? new Date() : stepTime,
                user_id: 'b23406e3-5c75-41d3-91e0-1654293ae6b2' // Theo yêu cầu USER: Ép cứng ID
            });
            index++;
        }

        // Sắp xếp theo thời gian tăng dần
        steps.sort((a, b) => a.time - b.time);
        return steps;
    } catch (e) {
        logger.error(`[StreamCarBookingMigrationModel] Error parsing YKien HTML: ${e.message}`);
        return [];
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
      { name: 'modifiedAt', type: 'datetime', nullable: 'DEFAULT getdate()' },
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

  // =========================================================================
  // HELPER: TỰ ĐỘNG TẠO XE & TÀI XẾ NẾU CHƯA CÓ TRÊN HỆ THỐNG MỚI
  // =========================================================================
  async getOrCreateDriver(driverNameOrId, transaction) {
      if (!driverNameOrId || String(driverNameOrId).trim() === '') return null;
      const name = String(driverNameOrId).trim();
      const db = this.newDbName || 'app_tancang';
      const schema = 'dbo';
      const tableRef = `[${db}].[${schema}].[list_drivers]`;
      
      // Kiểm tra xem đã tồn tại chưa
      const exist = await this.queryNewDbTx(`SELECT TOP 1 id FROM ${tableRef} WHERE id = @name OR full_name = @name OR full_name LIKE '%' + @name + '%'`, { name }, transaction);
      if (exist && exist.length > 0) {
          console.log(`[StreamCarBookingMigrationModel] Found Driver ID: ${name} -> ${exist[0].id}`);
          return exist[0].id;
      }
      
      // Tự động tạo mới
      const { v4: uuidv4 } = require('uuid');
      const newId = uuidv4().toUpperCase();
      await this.queryNewDbTx(`
          INSERT INTO ${tableRef} (
              id, full_name, phone_number, id_card, license_number, license_class, license_issued_date,
              status, created_at, updated_at, booking_available
          )
          VALUES (
              @id, @name, '0000000000', '000000000000', 'UNKNOWN', 'B2', GETDATE(),
              1, GETDATE(), GETDATE(), 1
          )
      `, { id: newId, name }, transaction);
      
      console.log(`[StreamCarBookingMigrationModel] Auto-created new Driver: "${name}" -> ${newId}`);
      return newId;
  }

  async getOrCreateCar(carNameOrPlate, transaction) {
      if (!carNameOrPlate || String(carNameOrPlate).trim() === '') return null;
      const name = String(carNameOrPlate).trim();
      const db = this.newDbName || 'app_tancang';
      const schema = 'dbo';
      const tableRef = `[${db}].[${schema}].[list_cars]`;
      
      // Kiểm tra xem đã tồn tại chưa
      const exist = await this.queryNewDbTx(`SELECT TOP 1 id FROM ${tableRef} WHERE id = @name OR license_plate = @name OR brand = @name`, { name }, transaction);
      if (exist && exist.length > 0) {
          console.log(`[StreamCarBookingMigrationModel] Found Car ID: ${name} -> ${exist[0].id}`);
          return exist[0].id;
      }
      
      // Tự động tạo mới
      const { v4: uuidv4 } = require('uuid');
      const newId = uuidv4().toUpperCase();
      await this.queryNewDbTx(`
          INSERT INTO ${tableRef} (
              id, license_plate, car_type, brand, manager, status_car, status, created_at, updated_at, booking_available
          )
          VALUES (
              @id, @name, 'UNKNOWN', @name, 'admin', N'Sẵn sàng', 1, GETDATE(), GETDATE(), 1
          )
      `, { id: newId, name }, transaction);
      
      console.log(`[StreamCarBookingMigrationModel] Auto-created new Car: "${name}" -> ${newId}`);
      return newId;
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
          confirmed_at: data.confirmed_at || null,
          table_bak: 1, // Fixed: Missing in params but used in query
          id_sp_bak: data.id_sp_bak,
          source_db: data.source_db || null
      };

      const query = `
      IF NOT EXISTS (SELECT 1 FROM ${tableRef} WHERE registration_id = @registration_id AND car_id = @car_id AND driver_id = @driver_id AND source_db = @source_db)
      BEGIN
          INSERT INTO ${tableRef} (id, registration_id, car_id, driver_id, is_confirmed, confirmed_at, table_bak, id_sp_bak, source_db)
          VALUES (@id, @registration_id, @car_id, @driver_id, @is_confirmed, @confirmed_at, @table_bak, @id_sp_bak, @source_db)
      END
      ELSE
      BEGIN
          UPDATE ${tableRef} SET
            is_confirmed = @is_confirmed,
            confirmed_at = @confirmed_at,
            table_bak = @table_bak,
            id_sp_bak = @id_sp_bak
          WHERE registration_id = @registration_id AND car_id = @car_id AND driver_id = @driver_id AND source_db = @source_db
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

        // Fix: Never pass NULL or Invalid Date for created_at/updated_at to avoid "Invalid date" validation errors
        if ((val === null || (val instanceof Date && isNaN(val.getTime()))) &&
            (lowerNewField === 'created_at' || lowerNewField === 'updated_at')) {
            params[lowerNewField] = new Date(); // Fallback to now for NOT NULL columns
        } else if (val !== undefined && val !== null) {
            params[lowerNewField] = val;
        }

        if (params[lowerNewField] !== undefined && params[lowerNewField] !== null) {
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

    // Ensure source_db is correctly set for persistence if it exists in schema
    if (rawData.source_db && existingCols.has('source_db')) {
        const lowerSourceDb = 'source_db';
        params[lowerSourceDb] = rawData.source_db;
        if (!insertCols.includes(`[${lowerSourceDb}]`)) {
            insertCols.push(`[${lowerSourceDb}]`); insertVals.push(`@${lowerSourceDb}`);
            // No need to update source_db usually, but good for completeness if strategy is update
            if (!updateSet.some(s => s.includes(`[${lowerSourceDb}]`))) {
                updateSet.push(`[${lowerSourceDb}] = @${lowerSourceDb}`);
            }
        }
    }

    // --- 4. Final Parameter Sanitization (Safety check for Dates) ---
    for (const key of Object.keys(params)) {
        const val = params[key];
        if (val instanceof Date && isNaN(val.getTime())) {
            // Invalid Date object detected
            if (key.toLowerCase() === 'created_at' || key.toLowerCase() === 'updated_at') {
                params[key] = new Date(); // Fallback for mandatory fields
            } else {
                params[key] = null; // Let DB handle optional fields
            }
        }
    }

    params._externalKeyValue = externalKeyValue;
    params._sourceDb = rawData.source_db || null;

    console.log(`[StreamCarBookingMigrationModel] upsertDataToNewDB params (Sanitized): ${JSON.stringify(params)}`);
    const tableRef = `[${this.newDbName}].[${newSchema}].[${newTable}]`;
    const query = `
      DECLARE @OutputTable TABLE (id NVARCHAR(255));
      DECLARE @affected INT;

      IF EXISTS (SELECT 1 FROM ${tableRef} WHERE [${externalKeyField}] = @_externalKeyValue AND source_db = @_sourceDb)
      BEGIN
          UPDATE ${tableRef} SET ${updateSet.length ? updateSet.join(', ') : `${externalKeyField} = ${externalKeyField}`}
          OUTPUT INSERTED.id INTO @OutputTable
          WHERE [${externalKeyField}] = @_externalKeyValue AND source_db = @_sourceDb;

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

  async ensureReferenceTablesExist() {
    const db = this.newDbName || 'camunda';
    const schema = 'dbo';

    // 1. list_drivers
    const tableDrivers = 'list_drivers';
    const refDrivers = `[${db}].[${schema}].[${tableDrivers}]`;
    const createDriversTable = `
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${tableDrivers}' AND TABLE_SCHEMA = '${schema}')
    BEGIN
        CREATE TABLE ${refDrivers} (id varchar(40) PRIMARY KEY);
    END
    `;
    await this.queryNewDb(createDriversTable);

    const driverCols = [
      { name: 'id', type: 'varchar(40) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL' },
      { name: 'full_name', type: 'nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL' },
      { name: 'phone_number', type: 'varchar(20) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL' },
      { name: 'id_card', type: 'varchar(20) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL' },
      { name: 'email', type: 'nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NULL' },
      { name: 'address', type: 'nvarchar(500) COLLATE SQL_Latin1_General_CP1_CI_AS NULL' },
      { name: 'license_number', type: 'varchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL' },
      { name: 'license_class', type: 'nvarchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL' },
      { name: 'license_issued_date', type: 'datetime2 NOT NULL' },
      { name: 'note', type: 'nvarchar(1000) COLLATE SQL_Latin1_General_CP1_CI_AS NULL' },
      { name: 'status', type: 'int DEFAULT 1 NOT NULL' },
      { name: 'created_at', type: 'datetime2 DEFAULT sysdatetime() NOT NULL' },
      { name: 'updated_at', type: 'datetime2 DEFAULT sysdatetime() NOT NULL' },
      { name: 'driverId', type: 'varchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS NULL' },
      { name: 'total_trips', type: 'int DEFAULT 0 NOT NULL' },
      { name: 'experience_years', type: 'int DEFAULT 0 NULL' },
      { name: 'booking_available', type: 'bit DEFAULT 1 NOT NULL' }
    ];

    for (const col of driverCols) {
      await this.queryNewDb(`
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tableDrivers}' AND COLUMN_NAME = '${col.name}' AND TABLE_SCHEMA = '${schema}')
        BEGIN
            ALTER TABLE ${refDrivers} ADD [${col.name}] ${col.type};
        END
      `);
    }

    // Index cho drivers
    await this.queryNewDb(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_list_drivers_search' AND object_id = OBJECT_ID('${refDrivers}'))
          CREATE NONCLUSTERED INDEX IX_list_drivers_search ON ${refDrivers} (full_name ASC, phone_number ASC) WITH (FILLFACTOR = 100);
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_list_drivers_status' AND object_id = OBJECT_ID('${refDrivers}'))
          CREATE NONCLUSTERED INDEX IX_list_drivers_status ON ${refDrivers} (status ASC) WITH (FILLFACTOR = 100);
    `);

    // 2. list_cars
    const tableCars = 'list_cars';
    const refCars = `[${db}].[${schema}].[${tableCars}]`;
    const createCarsTable = `
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${tableCars}' AND TABLE_SCHEMA = '${schema}')
    BEGIN
        CREATE TABLE ${refCars} (id varchar(40) PRIMARY KEY);
    END
    `;
    await this.queryNewDb(createCarsTable);

    const carCols = [
      { name: 'id', type: 'varchar(40) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL' },
      { name: 'license_plate', type: 'nvarchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL' },
      { name: 'car_type', type: 'nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL' },
      { name: 'brand', type: 'nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL' },
      { name: 'seat_count', type: 'int NULL' },
      { name: 'manager', type: 'nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL' },
      { name: 'status_car', type: 'nvarchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT N\'Sẵn sàng\' NOT NULL' },
      { name: 'status', type: 'int DEFAULT 1 NOT NULL' },
      { name: 'note', type: 'nvarchar(1000) COLLATE SQL_Latin1_General_CP1_CI_AS NULL' },
      { name: 'created_at', type: 'datetime2 DEFAULT sysdatetime() NOT NULL' },
      { name: 'updated_at', type: 'datetime2 DEFAULT sysdatetime() NOT NULL' },
      { name: 'total_trips', type: 'int DEFAULT 0 NOT NULL' },
      { name: 'booking_available', type: 'bit DEFAULT 1 NOT NULL' },
      { name: 'maintenance', type: 'nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL' }
    ];

    for (const col of carCols) {
      await this.queryNewDb(`
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tableCars}' AND COLUMN_NAME = '${col.name}' AND TABLE_SCHEMA = '${schema}')
        BEGIN
            ALTER TABLE ${refCars} ADD [${col.name}] ${col.type};
        END
      `);
    }

    await this.queryNewDb(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_list_cars_status' AND object_id = OBJECT_ID('${refCars}'))
          CREATE NONCLUSTERED INDEX IX_list_cars_status ON ${refCars} (status ASC) WITH (FILLFACTOR = 100);
    `);
  }

  async seedDrivers() {
    const drivers = [
        {
          id: 'DR-20260316075949-SF8X4UZA',
          full_name: 'Canbo3',
          phone_number: '0903456123',
          id_card: '020201023142',
          email: 'Canbo3@gmail.com',
          address: '125 Nguyễn Duy Trinh, P. Bình Trưng Đông, TP Thủ Đức, TP.HCM',
          license_number: '790123456781',
          license_class: 'B2',
          license_issued_date: '2020-05-12T07:00:00.000Z',
          note: null,
          status: 1,
          created_at: '2026-03-16T14:59:48.613Z',
          updated_at: '2026-03-17T00:59:51.740Z',
          driverId: '69281962213f38bebc802aaa',
          total_trips: 3,
          experience_years: 6,
          booking_available: 1
        },
        { name: 'Mr Công', phone: '0963607288', license: 'QH - 59:95', note: 'PTGĐ Toàn' },
        { name: 'Mr Tuấn', phone: '0363456166', license: 'QH - 68:69', note: 'TGĐ Thuấn' },
        { name: 'Mr Trung', phone: '0987497125', license: 'QH - 61:39', note: 'PTGĐ Minh' },
        { name: 'Mr Tú', phone: '0974157555', license: 'QH - 61:66', note: 'PTGĐ Phương Nam' },
        { name: 'Mr Trúc', phone: '0987366165', license: 'QH - 59:59', note: 'PTGĐ Trúc' }
    ];

    const { v4: uuidv4 } = require('uuid');
    const db = this.newDbName || 'camunda';
    const schema = 'dbo';
    const tableRef = `[${db}].[${schema}].[list_drivers]`;

    for (const d of drivers) {
        const idToUse = d.id || uuidv4().toUpperCase();
        const phoneToUse = d.phone_number || d.phone;

        const query = `
        IF NOT EXISTS (SELECT 1 FROM ${tableRef} WHERE id = @id OR phone_number = @phone)
        BEGIN
            INSERT INTO ${tableRef} (
              id, full_name, phone_number, id_card, email, address,
              license_number, license_class, license_issued_date, note,
              status, created_at, updated_at, driverId,
              total_trips, experience_years, booking_available
            )
            VALUES (
              @id, @full_name, @phone, @id_card, @email, @address,
              @license_number, @license_class, @license_issued_date, @note,
              @status, @created_at, @updated_at, @driverId,
              @total_trips, @experience_years, @booking_available
            )
        END
        `;
        const params = {
            id: idToUse,
            full_name: d.full_name || d.name,
            phone: phoneToUse,
            id_card: d.id_card || d.license,
            email: d.email || null,
            address: d.address || null,
            license_number: d.license_number || d.license,
            license_class: d.license_class || 'B2',
            license_issued_date: d.license_issued_date ? new Date(d.license_issued_date) : new Date(),
            note: d.note || null,
            status: d.status || 1,
            created_at: d.created_at ? new Date(d.created_at) : new Date(),
            updated_at: d.updated_at ? new Date(d.updated_at) : new Date(),
            driverId: d.driverId || null,
            total_trips: d.total_trips || 0,
            experience_years: d.experience_years || 0,
            booking_available: d.booking_available !== undefined ? d.booking_available : 1
        };
        await this.queryNewDb(query, params);
    }
    console.log(`[StreamCarBookingMigrationModel] Seeding of drivers complete.`);
  }

  async seedCars() {
    const cars = [
      {
        id: 'LC-20260224035946-Q6DQ2AL8',
        license_plate: '222222',
        car_type: '7cho',
        brand: '222222',
        seat_count: 7,
        manager: 'admin_a',
        status_car: 'SAN_SANG',
        status: 1,
        note: '222222',
        created_at: '2026-02-24T10:59:48.094Z',
        updated_at: '2026-03-12T16:18:51.426Z',
        total_trips: 0,
        booking_available: 1
      }
    ];

    const { v4: uuidv4 } = require('uuid');
    const db = this.newDbName || 'camunda';
    const schema = 'dbo';
    const tableRef = `[${db}].[${schema}].[list_cars]`;

    for (const c of cars) {
      const idToUse = c.id || uuidv4().toUpperCase();
      const query = `
      IF NOT EXISTS (SELECT 1 FROM ${tableRef} WHERE id = @id OR license_plate = @plate)
      BEGIN
          INSERT INTO ${tableRef} (
            id, license_plate, car_type, brand, seat_count, manager,
            status_car, status, note, created_at, updated_at,
            total_trips, booking_available
          )
          VALUES (
            @id, @plate, @type, @brand, @seats, @manager,
            @status_car, @status, @note, @created_at, @updated_at,
            @total_trips, @booking_available
          )
      END
      `;
      const params = {
        id: idToUse,
        plate: c.license_plate,
        type: c.car_type,
        brand: c.brand,
        seats: c.seat_count,
        manager: c.manager,
        status_car: c.status_car,
        status: c.status || 1,
        note: c.note || null,
        created_at: c.created_at ? new Date(c.created_at) : new Date(),
        updated_at: c.updated_at ? new Date(c.updated_at) : new Date(),
        total_trips: c.total_trips || 0,
        booking_available: c.booking_available !== undefined ? c.booking_available : 1
      };
      await this.queryNewDb(query, params);
    }
    console.log(`[StreamCarBookingMigrationModel] Seeding of cars complete.`);
  }

}

// Helper: wrap string in N'' for nvarchar (only used in template literals)
function N(str) { return str; }

module.exports = StreamCarBookingMigrationModel;
