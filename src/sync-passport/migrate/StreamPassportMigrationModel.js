const { v4: uuidv4 } = require('uuid');
const MigrationHelper = require('../../helpers/MigrationHelper');
const logger = require('../../../utils/logger');
const dbUtils = require('../../../utils/dbUtils');

const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const { tableMappings, mapStatus, parseDate } = require('./config');
const mapping = require('./mapping.json');
const requiredRoles = require('./required_process_roles.json');
const {
  claimNextStagingRow,
  ensureTrackingColumns,
  markRowFailed,
  markRowSuccess,
  releaseStaleClaims,
  startHeartbeatLoop,
  updateHeartbeat,
} = require('../../helpers/StagingQueueHelper');


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
    this.heartbeatIntervalMs = Number(process.env.HEARTBEAT_INTERVAL_MS || 30000);

    // Multi-DB List Discovery
    this.listIdCache = {}; // { dbName: [listId1, listId2] }
    this.canonicalListTitle = null;
  }

  /**
   * Override initialize: kết nối DB xong tự động tạo bảng staging + ensure columns.
   */
  async initialize() {
    logger.info(`[StreamPassportMigrationModel] Initializing...`);
    await super.initialize();
    await this.ensureStagingTableExists();
    await this.ensurePassportsColumnsExist();
    await this.ensurePassportBorrowRequestsColumnsExist();
    await this.ensurePassportVouchersTableExists();
    await this.ensurePassportVoucherItemsTableExists();
    await this.ensureAuditTableExists();
    await this.ensurePassportHistoriesTableExists();

    // Seed dữ liệu mẫu cho test
    await this.seedPassportMockData();
    await this.seedAuditMockData();
    await this.seedPassportHistoriesMockData();

    logger.info(`[StreamPassportMigrationModel] Initialization complete.`);
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

      logger.info(`[StreamPassportMigrationModel] Ensuring passports columns...`);

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
      logger.info(`[StreamPassportMigrationModel] [ensurePassportsColumnsExist] OK`);
    } catch (err) {
      logger.error(`[StreamPassportMigrationModel] [ensurePassportsColumnsExist] ERROR: ${err.message}`);
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

      logger.info(`[StreamPassportMigrationModel] Ensuring passport_borrow_requests columns...`);

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
        { name: 'trip_content',               type: 'NVARCHAR(MAX)' },          // Lý do/ghi chú chuyến đi từ ntext2[].Value
        { name: 'passport_type',              type: 'NVARCHAR(50)',  default: "'ORDINARY'" }, // Loại hộ chiếu, fix cứng ORDINARY khi migrate
        { name: 'approval_reason',            type: 'NVARCHAR(MAX)' },
        { name: 'reject_reason',              type: 'NVARCHAR(MAX)' },
        { name: 'cancel_reason',              type: 'NVARCHAR(MAX)' },
        { name: 'is_deleted',                 type: 'BIT',           default: 0 },
        { name: 'is_specific_departure_date', type: 'BIT',           default: 0 },
        { name: 'created_by',                 type: 'NVARCHAR(100)' },
        { name: 'updated_by',                 type: 'NVARCHAR(100)' },
        { name: 'tb_bak',                     type: 'INT',           default: 0 }, // 0 = Dữ liệu hệ thống mới, 1 = Dữ liệu migrate từ SharePoint
        { name: 'sharepoint_item_id',         type: 'NVARCHAR(255)', default: null },
        { name: 'source_db',                  type: 'NVARCHAR(255)', default: null },
        { name: 'passport_id',                type: 'NVARCHAR(100)', default: null },
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

      // Unique Index cho sharepoint_item_id + source_db
      const dropIdxQuery = `IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pbr_sharepoint_item_id' AND object_id = OBJECT_ID('${db}.${schema}.passport_borrow_requests')) DROP INDEX IX_pbr_sharepoint_item_id ON ${tableRef};`;
      await this.queryNewDb(dropIdxQuery);

      const idxQuery = `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pbr_sharepoint_item_source' AND object_id = OBJECT_ID('${db}.${schema}.passport_borrow_requests'))
          CREATE UNIQUE INDEX IX_pbr_sharepoint_item_source ON ${tableRef}(sharepoint_item_id, source_db) WHERE sharepoint_item_id IS NOT NULL AND source_db IS NOT NULL;
      `;
      await this.queryNewDb(idxQuery);
      logger.info(`[StreamPassportMigrationModel] [ensurePassportBorrowRequestsColumnsExist] OK`);
    } catch (err) {
      logger.error(`[StreamPassportMigrationModel] [ensurePassportBorrowRequestsColumnsExist] ERROR: ${err.message}`);
    }
  }

  /**
   * Tạo bảng staging nếu chưa tồn tại, tự động thêm các cột cần thiết.
   */
  async ensureStagingTableExists() {
    try {
      const stagingTableRef = this.getStagingTableRef();
      logger.info(`[StreamPassportMigrationModel] Checking/Creating staging table: ${stagingTableRef}`);
      const schema = this.newDbSchema || 'dbo';
      const table = this.newTableSync;

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
          -- Note: We use a composite index for multi-DB support
          CREATE UNIQUE INDEX IX_${table}_ID_Source ON ${stagingTableRef}([ID], [source_db]);
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
        { name: 'tp_Title', type: 'NVARCHAR(MAX)' },
        // User info
        { name: 'AuthorName', type: 'NVARCHAR(500)' },
        { name: 'AuthorFullName', type: 'NVARCHAR(500)' },
        { name: 'AuthorAccount', type: 'NVARCHAR(500)' },
        { name: 'AuthorEmail', type: 'NVARCHAR(500)' },
        { name: 'EditorName', type: 'NVARCHAR(500)' },
        { name: 'EditorAccount', type: 'NVARCHAR(500)' },
        // Passport borrow fields
        { name: 'nvarchar1', type: 'NVARCHAR(MAX)' },
        { name: 'nvarchar2', type: 'NVARCHAR(MAX)' },
        { name: 'nvarchar3', type: 'NVARCHAR(MAX)' },
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
        { name: 'float3',   type: 'FLOAT' },
        { name: 'int1',     type: 'INT' },
        { name: 'int2',     type: 'INT' },
        { name: 'tb_bak',   type: 'INT' },  // 1 = đồng bộ từ SharePoint
        { name: 'source_db', type: 'NVARCHAR(255)' }, // Phân biệt site collection
        // ★ Staging flags — dùng cho cơ chế claim/process chuẩn
        { name: 'MigrateFlg',     type: 'INT',          default: '0' },  // 0=chưa xử lý, 2=đang xử lý, 1=thành công
        { name: 'MigrateErrFlg',  type: 'INT',          default: '0' },  // 1=lỗi xử lý
        { name: 'MigrateErrMess', type: 'NVARCHAR(MAX)' },               // message lỗi
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

      // Đảm bảo index tổng hợp tồn tại (Migration từ bản cũ chỉ có [ID])
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
      await ensureTrackingColumns(this, {
        tableRef: stagingTableRef,
        tableName: table,
        schemaName: schema,
        dbName: this.newDbName,
        label: this.modelName,
      });

      logger.info(`[StreamPassportMigrationModel] [ensureStagingTableExists] OK: ${stagingTableRef} is ready`);
    } catch (err) {
      logger.error(`[StreamPassportMigrationModel] [ensureStagingTableExists] ERROR: ${err.message}`);
      throw err;
    }
  }

  /**
   * Tạo bảng passport_vouchers nếu chưa tồn tại.
   * Bảng này lưu phiếu giao/nhận hộ chiếu.
   */
  async ensurePassportVouchersTableExists() {
    try {
      const db = this.newDbName || process.env.NEW_DB_NAME;
      const schema = this.newDbSchema || 'dbo';
      const table = 'passport_vouchers';
      const tableRef = `[${db}].[${schema}].[${table}]`;

      logger.info(`[StreamPassportMigrationModel] Checking/Creating table: ${table}`);

      const createQuery = `
      IF NOT EXISTS (SELECT 1 FROM [${db}].INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${table}' AND TABLE_SCHEMA = '${schema}')
      BEGIN
          CREATE TABLE ${tableRef} (
              [id] UNIQUEIDENTIFIER DEFAULT NEWID() NOT NULL PRIMARY KEY,
              [voucher_code] NVARCHAR(100) NULL,
              [voucher_type] NVARCHAR(50) NULL,
              [status] NVARCHAR(50) NULL,
              [request_id] NVARCHAR(100) NULL,
              [handover_user_id] NVARCHAR(100) NULL,
              [receiver_user_id] NVARCHAR(100) NULL,
              [handover_date] DATETIME2 NULL,
              [note] NVARCHAR(MAX) NULL,
              [created_by] NVARCHAR(100) NULL,
              [updated_by] NVARCHAR(100) NULL,
              [created_at] DATETIME2 DEFAULT SYSUTCDATETIME(),
              [updated_at] DATETIME2 DEFAULT SYSUTCDATETIME(),
              [is_deleted] BIT DEFAULT 0,
              [tb_bak] INT DEFAULT 0,
              [sharepoint_item_id] NVARCHAR(255) NULL
          );
      END
      `;
      await this.queryNewDb(createQuery);

      // Ensure extra columns nếu bảng đã tồn tại nhưng thiếu cột
      const extraCols = [
        { name: 'voucher_code',      type: 'NVARCHAR(100)' },
        { name: 'voucher_type',      type: 'NVARCHAR(50)' },
        { name: 'status',            type: 'NVARCHAR(50)' },
        { name: 'request_id',        type: 'NVARCHAR(100)' },
        { name: 'handover_user_id',  type: 'NVARCHAR(100)' },
        { name: 'receiver_user_id',  type: 'NVARCHAR(100)' },
        { name: 'handover_date',     type: 'DATETIME2' },
        { name: 'note',              type: 'NVARCHAR(MAX)' },
        { name: 'created_by',        type: 'NVARCHAR(100)' },
        { name: 'updated_by',        type: 'NVARCHAR(100)' },
        { name: 'created_at',        type: 'DATETIME2' },
        { name: 'updated_at',        type: 'DATETIME2' },
        { name: 'is_deleted',        type: 'BIT',           default: 0 },
        { name: 'tb_bak',            type: 'INT',           default: 0 },
        { name: 'sharepoint_item_id', type: 'NVARCHAR(255)' },
      ];

      for (const col of extraCols) {
        const defaultClause = col.default !== undefined ? `DEFAULT ${col.default}` : '';
        const checkQuery = `SELECT 1 AS cnt FROM [${db}].INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}' AND COLUMN_NAME = '${col.name}'`;
        const colExists = await this.queryNewDb(checkQuery);
        if (!colExists || colExists.length === 0 || colExists[0].cnt === 0) {
          const query = `ALTER TABLE ${tableRef} ADD [${col.name}] ${col.type} ${defaultClause} NULL;`;
          await this.queryNewDb(query);
        }
      }

      logger.info(`[StreamPassportMigrationModel] [ensurePassportVouchersTableExists] OK`);
    } catch (err) {
      logger.error(`[StreamPassportMigrationModel] [ensurePassportVouchersTableExists] ERROR: ${err.message}`);
    }
  }

  /**
   * Tạo bảng passport_voucher_items nếu chưa tồn tại.
   * Bảng chi tiết hộ chiếu trong từng phiếu giao/nhận.
   */
  async ensurePassportVoucherItemsTableExists() {
    try {
      const db = this.newDbName || process.env.NEW_DB_NAME;
      const schema = this.newDbSchema || 'dbo';
      const table = 'passport_voucher_items';
      const tableRef = `[${db}].[${schema}].[${table}]`;

      logger.info(`[StreamPassportMigrationModel] Checking/Creating table: ${table}`);

      // Tạo bảng BẢN VỚI FK references
      const createQuery = `
      IF NOT EXISTS (SELECT 1 FROM [${db}].INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${table}' AND TABLE_SCHEMA = '${schema}')
      BEGIN
          CREATE TABLE ${tableRef} (
              [id] UNIQUEIDENTIFIER DEFAULT NEWID() NOT NULL PRIMARY KEY,
              [voucher_id] UNIQUEIDENTIFIER NOT NULL,
              [request_id] NVARCHAR(100) NULL,
              [passport_id] NVARCHAR(100) NOT NULL,
              [full_name] NVARCHAR(255) NULL,
              [passport_number] NVARCHAR(20) NULL,
              [passport_type] NVARCHAR(50) NULL,
              [expiry_date] DATE NULL,
              [item_condition] NVARCHAR(MAX) NULL,
              [note] NVARCHAR(255) NULL
          );

          -- Index on voucher_id for faster lookups
          CREATE NONCLUSTERED INDEX IX_PassportVoucherItem_VoucherId
            ON ${tableRef} ([voucher_id] ASC);
      END
      `;
      await this.queryNewDb(createQuery);

      // Ensure extra columns nếu bảng đã tồn tại nhưng thiếu cột
      const extraCols = [
        { name: 'voucher_id',      type: 'UNIQUEIDENTIFIER' },
        { name: 'request_id',      type: 'NVARCHAR(100)' },
        { name: 'passport_id',     type: 'NVARCHAR(100)' },
        { name: 'full_name',       type: 'NVARCHAR(255)' },
        { name: 'passport_number', type: 'NVARCHAR(20)' },
        { name: 'passport_type',   type: 'NVARCHAR(50)' },
        { name: 'expiry_date',     type: 'DATE' },
        { name: 'item_condition',  type: 'NVARCHAR(MAX)' },
        { name: 'note',            type: 'NVARCHAR(255)' },
      ];

      for (const col of extraCols) {
        const query = `
        IF NOT EXISTS (SELECT 1 FROM [${db}].INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}' AND COLUMN_NAME = '${col.name}')
        BEGIN
            ALTER TABLE ${tableRef} ADD [${col.name}] ${col.type} NULL;
        END
        `;
        await this.queryNewDb(query);
      }

      // Thêm FK nếu chưa có (bọc try-catch để không crash nếu FK đã tồn tại)
      try {
        await this.queryNewDb(`
          IF NOT EXISTS (SELECT 1 FROM [${db}].sys.foreign_keys WHERE name = 'FK_VoucherItem_Voucher')
          BEGIN
              ALTER TABLE ${tableRef}
              ADD CONSTRAINT FK_VoucherItem_Voucher
              FOREIGN KEY ([voucher_id]) REFERENCES [${db}].[${schema}].[passport_vouchers]([id]);
          END
        `);
        await this.queryNewDb(`
          IF NOT EXISTS (SELECT 1 FROM [${db}].sys.foreign_keys WHERE name = 'FK_VoucherItem_Passport')
          BEGIN
              ALTER TABLE ${tableRef}
              ADD CONSTRAINT FK_VoucherItem_Passport
              FOREIGN KEY ([passport_id]) REFERENCES [${db}].[${schema}].[passports]([id]);
          END
        `);
        await this.queryNewDb(`
          IF NOT EXISTS (SELECT 1 FROM [${db}].sys.foreign_keys WHERE name = 'FK_VoucherItem_Request')
          BEGIN
              ALTER TABLE ${tableRef}
              ADD CONSTRAINT FK_VoucherItem_Request
              FOREIGN KEY ([request_id]) REFERENCES [${db}].[${schema}].[passport_borrow_requests]([id]);
          END
        `);
      } catch (fkErr) {
        logger.warn(`[StreamPassportMigrationModel] FK constraint creation skipped: ${fkErr.message}`);
      }

      logger.info(`[StreamPassportMigrationModel] [ensurePassportVoucherItemsTableExists] OK`);
    } catch (err) {
      logger.error(`[StreamPassportMigrationModel] [ensurePassportVoucherItemsTableExists] ERROR: ${err.message}`);
    }
  }

  /**
   * Seed dữ liệu mẫu cho bản passport_voucher_items theo yêu cầu test.
   */
  async seedPassportMockData() {
    try {
      const db = this.newDbName || process.env.NEW_DB_NAME;
      const schema = this.newDbSchema || 'dbo';
      const itemTableRef = `[${db}].[${schema}].[passport_voucher_items]`;

      const checkEmpty = await this.queryNewDb(`SELECT COUNT(1) AS cnt FROM ${itemTableRef}`);
      if (checkEmpty?.[0]?.cnt > 0) return; // Đã có dữ liệu thì không seed

      logger.info(`[StreamPassportMigrationModel] Seeding mock passport_voucher_items data...`);

      const insertQuery = `
      -- Tạm tắt check FK constrain để có thể insert dữ liệu mẫu mà chưa có bản ghi cha
      ALTER TABLE ${itemTableRef} NOCHECK CONSTRAINT ALL;

      INSERT INTO ${itemTableRef} (
          id, voucher_id, request_id, passport_id, full_name, passport_number, passport_type, expiry_date, item_condition, note
      ) VALUES
      ('BAF76B69-5273-46CC-8BE3-00C0694C5FAF', '4FF397C7-CDA7-412A-B822-96F0DEB1E714', '12167205-723a-446e-8a69-cc809c0f0a92', 'e3938fb7-dab4-4cac-b419-38c6eed46cca', N'Đặng Minh Hùng', N'B12345', N'OFFICIAL', '2026-03-30', N'Tốt', NULL),
      ('817BFD74-C169-44D2-8F01-026EA56CBDCC', '6E32D9F8-5371-40E8-87C7-0A60C5F45FD0', '7ae7dd7e-884d-4540-b6c6-4f50d014f431', '39bfcf07-c9a6-4188-b412-e0f2dfcbd6d2', N'Ngô Ngọc Mai', N'B375375798', N'SERVICE', '2026-03-08', N'Tốt', N'Hộ chiếu còn tốt'),
      ('33353791-8CD7-4464-8142-02A6C2C51F72', '2A220225-8EB9-42EC-A68F-9D2B90879358', '08c7bb34-2935-43d8-93a3-11c5c7c8b13b', 'eb11934c-8f44-4626-9fcc-42792b6486ca', N'Ngô Ngọc Mai', N'A112233445589', N'ORDINARY', '2026-02-28', N'Tốt', NULL);

      -- Khôi phục check FK constrain
      ALTER TABLE ${itemTableRef} CHECK CONSTRAINT ALL;
      `;

      await this.queryNewDb(insertQuery);
      logger.info(`[StreamPassportMigrationModel] [seedPassportMockData] Data seeded OK`);
    } catch (err) {
      logger.warn(`[StreamPassportMigrationModel] [seedPassportMockData] Skip or Error: ${err.message}`);
    }
  }
  /**
   * Seed dữ liệu mẫu cho bản audit theo yêu cầu test.
   */
  async seedAuditMockData() {
    try {
      const db = this.newDbName || process.env.NEW_DB_NAME;
      const schema = this.newDbSchema || 'dbo';
      const itemTableRef = `[${db}].[${schema}].[audit]`;

      const checkEmpty = await this.queryNewDb(`SELECT COUNT(1) AS cnt FROM ${itemTableRef} WHERE type_document = 'PASSPORT_REQUEST'`);
      if (checkEmpty?.[0]?.cnt > 0) return; // Đã có dữ liệu thì không seed

      logger.info(`[StreamPassportMigrationModel] Seeding mock audit data...`);

      const insertQuery = `
      SET IDENTITY_INSERT ${itemTableRef} ON;

      INSERT INTO ${itemTableRef} (
          id, document_id, [time], user_id, display_name, [role], action_code, from_node_id, to_node_id, details, origin_id, created_by, receiver, receiver_unit, group_, roleProcess, [action], deadline, stage_status, curStatusCode, created_at, updated_at, type_document, processed_by, table_backups, acting_as, status_code, bpmn_version, type_of_process, table_bak
      ) VALUES
      (66721, 'e0b55b9f-b923-4dfa-a81d-38b36acda419', '2026-04-03 03:57:03.677', '9a7b7d77-4eb9-4fc1-ac0f-9e4e783f39b7', N'Người phê duyệt', 'CHI_HUY_DON_VI', 'APPROVE', 'Gateway_0rbwxs6', 'Gateway_0fkk071', NULL, 'migration_origin', '9a7b7d77-4eb9-4fc1-ac0f-9e4e783f39b7', '9a7b7d77-4eb9-4fc1-ac0f-9e4e783f39b7', NULL, NULL, 'approver', N'Phê duyệt', NULL, 'DA_XU_LY', 'APPROVE', '2026-04-03 03:57:03.677', '2026-04-03 03:57:03.677', 'PASSPORT_REQUEST', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
      (66727, 'db466dce-11ca-4201-8b21-45d1c6b81827', '2026-04-03 03:57:04.053', '81ceae11-f9ec-4ce7-ad9a-f4274ec256c9', N'Người phê duyệt', 'CHI_HUY_DON_VI', 'APPROVE', 'Gateway_0rbwxs6', 'Gateway_0fkk071', NULL, 'migration_origin', '81ceae11-f9ec-4ce7-ad9a-f4274ec256c9', '81ceae11-f9ec-4ce7-ad9a-f4274ec256c9', NULL, NULL, 'approver', N'Phê duyệt', NULL, 'DA_XU_LY', 'APPROVE', '2026-04-03 03:57:04.053', '2026-04-03 03:57:04.053', 'PASSPORT_REQUEST', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
      (66729, 'f42003a9-d15c-4157-bee0-be2609086c82', '2026-04-03 03:57:04.157', '33decba6-7ea1-4d17-9b1a-ef4577ff1955', N'Người phê duyệt', 'CHI_HUY_DON_VI', 'APPROVE', 'Gateway_0rbwxs6', 'Gateway_0fkk071', NULL, 'migration_origin', '33decba6-7ea1-4d17-9b1a-ef4577ff1955', '33decba6-7ea1-4d17-9b1a-ef4577ff1955', NULL, NULL, 'approver', N'Phê duyệt', NULL, 'DA_XU_LY', 'APPROVE', '2026-04-03 03:57:04.157', '2026-04-03 03:57:04.157', 'PASSPORT_REQUEST', NULL, NULL, NULL, NULL, NULL, NULL, NULL);

      SET IDENTITY_INSERT ${itemTableRef} OFF;
      `;

      await this.queryNewDb(insertQuery);
      logger.info(`[StreamPassportMigrationModel] [seedAuditMockData] Data seeded OK`);
    } catch (err) {
      logger.warn(`[StreamPassportMigrationModel] [seedAuditMockData] Skip or Error: ${err.message}`);
    }
  }

  async ensureAuditTableExists() {
    const db = this.newDbName || process.env.NEW_DB_NAME;
    const schema = 'dbo';
    const table = 'audit';
    const tableRef = `[${db}].[${schema}].[${table}]`;

    logger.info(`[StreamPassportMigrationModel] Checking/Creating Audit table: ${table}`);
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
      { name: 'acting_as', type: 'varchar(100)' },
      { name: 'status_code', type: 'varchar(50)' },
      { name: 'bpmn_version', type: 'varchar(100)' },
      { name: 'type_of_process', type: 'varchar(100)' },
      { name: 'table_bak', type: 'int' }
    ];

    for (const col of auditCols) {
      const checkQuery = `SELECT 1 AS cnt FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}' AND COLUMN_NAME = '${col.name}'`;
      const colExists = await this.queryNewDb(checkQuery);
      if (!colExists || colExists.length === 0 || colExists[0].cnt === 0) {
        const query = `ALTER TABLE ${tableRef} ADD [${col.name}] ${col.type} ${col.nullable || 'NULL'};`;
        await this.queryNewDb(query);
      }
    }

    // Tạo 11 Nonclustered Indexes cho Audit (bao bọc try-catch để tránh crash định kỳ nếu db đã tồn tại)
    try {
      const idxQueries = [
        `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_doc_receiverunit_id_desc' AND object_id = OBJECT_ID('${tableRef}'))
         CREATE NONCLUSTERED INDEX IX_audit_doc_receiverunit_id_desc ON ${tableRef} (document_id ASC, receiver_unit ASC, id DESC) INCLUDE (action_code, created_at, deadline, receiver, roleProcess, stage_status);`,

        `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_doc_role_receiver_id_desc' AND object_id = OBJECT_ID('${tableRef}'))
         CREATE NONCLUSTERED INDEX IX_audit_doc_role_receiver_id_desc ON ${tableRef} (document_id ASC, roleProcess ASC, receiver ASC, id DESC) INCLUDE (action_code, created_at, deadline, processed_by, receiver_unit, stage_status);`,

        `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_doc_stage_id_desc' AND object_id = OBJECT_ID('${tableRef}'))
         CREATE NONCLUSTERED INDEX IX_audit_doc_stage_id_desc ON ${tableRef} (document_id ASC, stage_status ASC, id DESC) INCLUDE (created_at, created_by, processed_by, receiver, receiver_unit, roleProcess, user_id);`,

        `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_doc_time_created_getdetails' AND object_id = OBJECT_ID('${tableRef}'))
         CREATE NONCLUSTERED INDEX IX_audit_doc_time_created_getdetails ON ${tableRef} (document_id ASC, time ASC, created_at ASC) INCLUDE (action, action_code, created_by, display_name, from_node_id, receiver, role, roleProcess, stage_status, to_node_id, type_document, updated_at, user_id);`,

        `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_latest' AND object_id = OBJECT_ID('${tableRef}'))
         CREATE NONCLUSTERED INDEX IX_audit_latest ON ${tableRef} (document_id ASC, type_document ASC, id DESC) INCLUDE (created_by, receiver, receiver_unit, stage_status);`,

        `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_pick_receive' AND object_id = OBJECT_ID('${tableRef}'))
         CREATE NONCLUSTERED INDEX IX_audit_pick_receive ON ${tableRef} (document_id ASC, receiver ASC, receiver_unit ASC, id DESC) INCLUDE (action_code, roleProcess, stage_status);`,

        `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_receiver' AND object_id = OBJECT_ID('${tableRef}'))
         CREATE NONCLUSTERED INDEX IX_audit_receiver ON ${tableRef} (receiver ASC, document_id ASC, id DESC) INCLUDE (stage_status);`,

        `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_receiver_doc_id_desc' AND object_id = OBJECT_ID('${tableRef}'))
         CREATE NONCLUSTERED INDEX IX_audit_receiver_doc_id_desc ON ${tableRef} (receiver ASC, document_id ASC, id DESC) INCLUDE (action_code, created_by, processed_by, receiver_unit, roleProcess, stage_status, user_id);`,

        `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_receiver_unit' AND object_id = OBJECT_ID('${tableRef}'))
         CREATE NONCLUSTERED INDEX IX_audit_receiver_unit ON ${tableRef} (receiver_unit ASC, document_id ASC, id DESC) INCLUDE (stage_status);`,

        `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_stage' AND object_id = OBJECT_ID('${tableRef}'))
         CREATE NONCLUSTERED INDEX IX_audit_stage ON ${tableRef} (document_id ASC, stage_status ASC);`,

        `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_submited_processed' AND object_id = OBJECT_ID('${tableRef}'))
         CREATE NONCLUSTERED INDEX IX_audit_submited_processed ON ${tableRef} (document_id ASC, processed_by ASC, id DESC) INCLUDE (action_code, deadline, receiver, receiver_unit, roleProcess) WHERE ([stage_status]='DA_XU_LY');`,

        `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_audit_doc_stage_role' AND object_id = OBJECT_ID('${tableRef}'))
         CREATE NONCLUSTERED INDEX idx_audit_doc_stage_role ON ${tableRef} (document_id ASC, stage_status ASC, roleProcess ASC, receiver ASC) INCLUDE (action_code, details);`
      ];

      for (const q of idxQueries) {
        await this.queryNewDb(q);
      }
    } catch (err) {
      logger.warn(`[StreamPassportMigrationModel] [ensureAuditTableExists] Index Creation Skip or Error: ${err.message}`);
    }

    logger.info(`[StreamPassportMigrationModel] [ensureAuditTableExists] OK`);
  }

  async ensurePassportHistoriesTableExists() {
    try {
      const db = this.newDbName || process.env.NEW_DB_NAME;
      const schema = this.newDbSchema || 'dbo';
      const table = 'passport_histories';
      const tableRef = `[${db}].[${schema}].[${table}]`;

      logger.info(`[StreamPassportMigrationModel] Checking/Creating Passport Histories table: ${table}`);

      const createTableQuery = `
      IF NOT EXISTS (SELECT 1 FROM [${db}].INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${table}' AND TABLE_SCHEMA = '${schema}')
      BEGIN
          CREATE TABLE ${tableRef} (
              id uniqueidentifier DEFAULT newid() NOT NULL,
              request_id nvarchar(100) NOT NULL,
              [action] nvarchar(255) NOT NULL,
              note nvarchar(MAX) NULL,
              performer_id nvarchar(100) NULL,
              performed_at datetime2 DEFAULT getdate() NULL,
              CONSTRAINT PK_passport_histories PRIMARY KEY (id)
          );

          CREATE NONCLUSTERED INDEX IX_PassportHistory_RequestId ON ${tableRef} (request_id);
      END
      `;
      await this.queryNewDb(createTableQuery);

      // Add FK constraints separately to avoid errors if parent tables don't exist yet or columns different
      try {
        await this.queryNewDb(`
          IF NOT EXISTS (SELECT 1 FROM [${db}].sys.foreign_keys WHERE name = 'FK_PassportHistory_Performer')
          BEGIN
              ALTER TABLE ${tableRef}
              ADD CONSTRAINT FK_PassportHistory_Performer
              FOREIGN KEY ([performer_id]) REFERENCES [${db}].[${schema}].[users]([id]);
          END
        `);
        await this.queryNewDb(`
          IF NOT EXISTS (SELECT 1 FROM [${db}].sys.foreign_keys WHERE name = 'FK_PassportHistory_Request')
          BEGIN
              ALTER TABLE ${tableRef}
              ADD CONSTRAINT FK_PassportHistory_Request
              FOREIGN KEY ([request_id]) REFERENCES [${db}].[${schema}].[passport_borrow_requests]([id]);
          END
        `);
      } catch (fkErr) {
        logger.warn(`[StreamPassportMigrationModel] [passport_histories] FK constraint skip: ${fkErr.message}`);
      }

      logger.info(`[StreamPassportMigrationModel] [ensurePassportHistoriesTableExists] OK`);
    } catch (err) {
      logger.error(`[StreamPassportMigrationModel] [ensurePassportHistoriesTableExists] ERROR: ${err.message}`);
    }
  }

  async seedPassportHistoriesMockData() {
    try {
      const db = this.newDbName || process.env.NEW_DB_NAME;
      const schema = this.newDbSchema || 'dbo';
      const tableRef = `[${db}].[${schema}].[passport_histories]`;

      const checkExisted = await this.queryNewDb(`SELECT COUNT(1) AS cnt FROM ${tableRef} WHERE id = '8DB1D95E-77F4-45EA-8FEB-01FF678520FC'`);
      if (checkExisted?.[0]?.cnt > 0) return;

      logger.info(`[StreamPassportMigrationModel] Seeding mock passport_histories data...`);

      const insertQuery = `
      INSERT INTO ${tableRef} (id, request_id, [action], note, performer_id, performed_at)
      VALUES ('8DB1D95E-77F4-45EA-8FEB-01FF678520FC', '8636318f-4f96-459b-83e2-9c41168d1029', 'FORWARD', N'Chỉ huy chuyển tiếp cho: phogiamdoctc', '2916a5f3-2dd9-4f82-8741-ef957454f904', '2026-03-17 23:14:12.0300000');
      `;
      await this.queryNewDb(insertQuery);
      logger.info(`[StreamPassportMigrationModel] [seedPassportHistoriesMockData] OK`);
    } catch (err) {
      logger.warn(`[StreamPassportMigrationModel] [seedPassportHistoriesMockData] Error: ${err.message}`);
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

  // ─────────────────────────────────────────────────────────────────────────────
  // PASSPORT LIST DISCOVERY — 5-level fallback strategy
  //
  // Level 1 : In-memory cache (per DB, per process lifetime)
  // Level 2 : Exact match on canonicalListTitle fetched from reference DB
  // Level 3 : Expanded LIKE keyword search (all known naming variants)
  // Level 4 : Column-signature scan — detect list by characteristic columns
  // Level 5 : Hardcoded referenceIds (only for the reference DB itself)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Danh sách từ khóa tên list Passport (không phân biệt hoa thường).
   * Đọc từ env PASSPORT_LIST_KEYWORDS (cách nhau bằng |) nếu có, fallback về default.
   * ⚠ Thêm mới: "Yêu cầu mượn" vì đó là prefix thực tế của list "Yêu cầu mượn Hộ chiếu" trong khkd.
   */
  get _passportListKeywords() {
    if (process.env.PASSPORT_LIST_KEYWORDS) {
      return process.env.PASSPORT_LIST_KEYWORDS.split('|').map(k => k.trim()).filter(Boolean);
    }
    return [
      'Yêu cầu mượn',       // ← Tên thực tế: "Yêu cầu mượn Hộ chiếu"
      'Hộ chiếu',
      'Passport',
      'Phiếu mượn hộ chiếu',
      'Phiếu mượn HC',
      'Borrow Passport',
      'Passport Borrow',
      'Quản lý hộ chiếu',
      'Mượn hộ chiếu',
      'Mượn HC',
    ];
  }

  /**
   * Các cột đặc trưng của list Phiếu mượn Hộ chiếu trong AllUserData.
   * Nếu một list có ít nhất MIN_SIGNATURE_COLS trong số này → nhận diện là passport list.
   */
  get _passportSignatureColumns() {
    return ['nvarchar1', 'datetime4', 'datetime6', 'datetime7', 'datetime8', 'ntext1', 'ntext2', 'float1'];
  }

  /**
   * Số cột tối thiểu phải match để coi là passport list (column-signature fallback).
   */
  get _minSignatureCols() {
    return Number(process.env.PASSPORT_SIGNATURE_MIN_COLS || 5);
  }

  /**
   * [STRATEGY 2] Exact-match theo canonicalListTitle lấy từ reference DB.
   * canonicalListTitle được cache ở instance level để chỉ query 1 lần.
   */
  async _resolveCanonicalTitle() {
    if (this.canonicalListTitle) return;

    const refDb  = this.oldDbName;   // WSS_Content_eoffice_khkd
    const refId  = (this.oldConfig.listIds || [])[0];
    if (!refId) {
      logger.warn(`[PassportDiscovery] No reference listId configured — skipping canonical title discovery.`);
      return;
    }

    try {
      const rows = await this.queryOldDb(
        `SELECT TOP 1 tp_Title FROM [${refDb}].[dbo].[AllLists] WHERE tp_ID = @refId`,
        { refId }
      );
      if (rows?.length) {
        this.canonicalListTitle = rows[0].tp_Title?.trim();
        logger.info(`[PassportDiscovery] Canonical title from reference DB [${refDb}]: "${this.canonicalListTitle}"`);
      } else {
        logger.warn(`[PassportDiscovery] Reference listId ${refId} not found in [${refDb}].[AllLists].`);
      }
    } catch (err) {
      logger.error(`[PassportDiscovery] Cannot fetch canonical title from [${refDb}]: ${err.message}`);
    }
  }

  /**
   * [STRATEGY 3] Exact-match trên canonicalListTitle tại target DB.
   */
  async _discoverByExactTitle(dbName) {
    if (!this.canonicalListTitle) return [];
    try {
      const rows = await this.queryOldDb(
        `SELECT tp_ID, tp_Title
         FROM [${dbName}].[dbo].[AllLists]
         WHERE tp_Title = @title
           AND tp_DeleteTransactionId = 0x0`,
        { title: this.canonicalListTitle }
      );
      if (rows?.length) {
        logger.info(`[PassportDiscovery] [${dbName}] ✔ Exact-title match: "${this.canonicalListTitle}" → ${rows.length} list(s)`);
        return rows.map(r => ({ id: String(r.tp_ID).toUpperCase(), title: r.tp_Title }));
      }
    } catch (err) {
      logger.warn(`[PassportDiscovery] [${dbName}] Exact-title query failed: ${err.message}`);
    }
    return [];
  }

  /**
   * [STRATEGY 4] Expanded LIKE keyword search — covers all known naming variants.
   * Loại bỏ các system list bằng negative title filters (KHÔNG dùng tp_Hidden — cột không tồn tại trên nhiều DB).
   */
  async _discoverByKeywords(dbName) {
    const keywords = this._passportListKeywords;
    // Build LIKE patterns — SQL Server thường case-insensitive theo collation nên không cần COLLATE riêng
    const patterns = keywords
      .map(k => `tp_Title LIKE N'%${k.replace(/'/g, "''")}%'`)
      .join('\n          OR ');

    // Lọc bỏ các system list phổ biến theo tên — an toàn hơn dùng tp_Hidden
    const negativeFilters = [
      `tp_Title NOT LIKE N'%Đính kèm%'`,
      `tp_Title NOT LIKE N'%Attachments%'`,
      `tp_Title NOT LIKE N'%Văn bản đến%'`,
      `tp_Title NOT LIKE N'%Văn bản đi%'`,
      `tp_Title NOT LIKE N'%Tài liệu%'`,
      `tp_Title NOT LIKE N'%Document%'`,
      `tp_Title NOT LIKE N'%Style Library%'`,
      `tp_Title NOT LIKE N'%Form Templates%'`,
    ].join('\n          AND ');

    try {
      const rows = await this.queryOldDb(`
        SELECT tp_ID, tp_Title
        FROM [${dbName}].[dbo].[AllLists]
        WHERE (${patterns})
          AND tp_DeleteTransactionId = 0x0
          AND ${negativeFilters}
        ORDER BY tp_Title
      `);

      if (rows?.length) {
        const found = rows.map(r => ({ id: String(r.tp_ID).toUpperCase(), title: r.tp_Title }));
        logger.info(`[PassportDiscovery] [${dbName}] ✔ Keyword match → ${found.map(f => `"${f.title}"`).join(', ')}`);
        return found;
      }
      logger.info(`[PassportDiscovery] [${dbName}] ○ Keyword search: no match (none of ${keywords.length} keywords found in list titles).`);
    } catch (err) {
      logger.warn(`[PassportDiscovery] [${dbName}] Keyword search failed: ${err.message}`);
    }
    return [];
  }

  /**
   * [STRATEGY 5] Column-signature fallback.
   * Scan AllUserData để tìm tp_ListId có records với đủ cột đặc trưng của Passport.
   * Chỉ chạy nếu 2 chiến lược trên đều thất bại.
   *
   * Cách hoạt động:
   *   SELECT DISTINCT tp_ListId FROM AllUserData WHERE tp_RowOrdinal=0
   *     → với mỗi listId, lấy 1 row mẫu → check xem bao nhiêu signature columns có giá trị NOT NULL
   *     → nếu ≥ _minSignatureCols cột có dữ liệu → candidate
   *   Sau đó cross-check với AllLists để lấy tp_Title xác nhận không phải system list.
   */
  async _discoverByColumnSignature(dbName) {
    const sigCols = this._passportSignatureColumns;
    const minCols = this._minSignatureCols;

    logger.info(`[PassportDiscovery] [${dbName}] ⚙ Running column-signature fallback (min ${minCols}/${sigCols.length} cols)...`);

    try {
      // Bước 1: Lấy candidate lists từ AllLists — CHỈ dùng tp_Title để lọc, KHÔNG dùng tp_Hidden
      // (tp_Hidden không tồn tại trên nhiều phiên bản SharePoint On-Premise → crash)
      const candidateListsRows = await this.queryOldDb(`
        SELECT al.tp_ID, al.tp_Title
        FROM [${dbName}].[dbo].[AllLists] al
        WHERE al.tp_DeleteTransactionId = 0x0
          AND al.tp_Title NOT LIKE N'%Đính kèm%'
          AND al.tp_Title NOT LIKE N'%Attachments%'
          AND al.tp_Title NOT LIKE N'%Style Library%'
          AND al.tp_Title NOT LIKE N'%_catalogs%'
          AND al.tp_Title NOT LIKE N'%Form Templates%'
          AND al.tp_Title NOT LIKE N'%Pages%'
          AND al.tp_Title NOT LIKE N'%Site Assets%'
          AND al.tp_Title NOT LIKE N'%Site Collection%'
          AND al.tp_Title NOT LIKE N'%Workflow%'
          AND al.tp_Title NOT LIKE N'%Lookup%'
          AND LEN(al.tp_Title) > 2
        ORDER BY al.tp_Title
      `);

      if (!candidateListsRows?.length) {
        logger.warn(`[PassportDiscovery] [${dbName}] ⚙ No candidate lists found for signature scan.`);
        return [];
      }

      logger.info(`[PassportDiscovery] [${dbName}] ⚙ Scanning ${candidateListsRows.length} candidate lists for column signature...`);
      const matched = [];

      for (const listRow of candidateListsRows) {
        const listId    = String(listRow.tp_ID).toUpperCase();
        const listTitle = listRow.tp_Title;

        try {
          // Lấy 1 sample row từ list này để đếm số cột có dữ liệu
          const sampleRows = await this.queryOldDb(`
            SELECT TOP 1 ${sigCols.map(c => `[${c}]`).join(', ')}
            FROM [${dbName}].[dbo].[AllUserData]
            WHERE tp_ListId = @listId
              AND tp_RowOrdinal = 0
              AND tp_IsCurrent = 1
          `, { listId });

          if (!sampleRows?.length) continue; // List trống, bỏ qua

          const sample = sampleRows[0];
          // Đếm signature columns có giá trị (NOT NULL)
          const nonNullCount = sigCols.filter(col => sample[col] !== null && sample[col] !== undefined).length;

          if (nonNullCount >= minCols) {
            logger.info(`[PassportDiscovery] [${dbName}] ✔ Column-signature match: "${listTitle}" (${nonNullCount}/${sigCols.length} sig-cols not null) → ListId: ${listId}`);
            matched.push({ id: listId, title: listTitle });
          }
        } catch (rowErr) {
          // Bỏ qua list lỗi (permission, schema khác), tiếp tục scan các list khác
          logger.info(`[PassportDiscovery] [${dbName}] ⚙ Skipping list "${listTitle}" during sig-scan: ${rowErr.message}`);
        }
      }

      if (matched.length === 0) {
        logger.info(`[PassportDiscovery] [${dbName}] ○ Column-signature scan: no match across ${candidateListsRows.length} lists.`);
      }
      return matched;
    } catch (err) {
      logger.warn(`[PassportDiscovery] [${dbName}] Column-signature scan failed entirely: ${err.message}`);
      return [];
    }
  }

  /**
   * Giải quyết List IDs cho một database cụ thể.
   * Áp dụng 5-level fallback strategy, mỗi level đều isolated bởi try-catch.
   * Kết quả được cache in-memory để các lần gọi sau không query lại.
   */
  async resolveListIdsForDb(dbName) {
    // ── Level 1: In-memory cache ──────────────────────────────────────────────
    if (this.listIdCache[dbName]) {
      return this.listIdCache[dbName];
    }

    const referenceIds = this.oldConfig.listIds || [];
    let discovered = []; // [{ id, title }]

    // ── Level 2: Fetch canonicalListTitle từ reference DB (1 lần duy nhất) ───
    await this._resolveCanonicalTitle();

    // ── Level 3: Exact-title match ────────────────────────────────────────────
    discovered = await this._discoverByExactTitle(dbName);

    // ── Level 4: Expanded keyword LIKE search ─────────────────────────────────
    if (discovered.length === 0) {
      discovered = await this._discoverByKeywords(dbName);
    }

    // ── Level 5: Column-signature scan (heavy fallback, chỉ chạy khi cần) ────
    if (discovered.length === 0 && process.env.PASSPORT_ENABLE_SIGNATURE_SCAN !== 'false') {
      discovered = await this._discoverByColumnSignature(dbName);
    }

    // ── Kết quả ───────────────────────────────────────────────────────────────
    if (discovered.length > 0) {
      const ids = discovered.map(d => d.id);
      this.listIdCache[dbName] = ids;

      // Log rõ từng list tìm thấy và số record sơ bộ
      for (const d of discovered) {
        try {
          const countRows = await this.queryOldDb(
            `SELECT COUNT(*) AS cnt FROM [${dbName}].[dbo].[AllUserData] WHERE tp_ListId = @listId AND tp_RowOrdinal = 0`,
            { listId: d.id }
          );
          const cnt = Number(countRows?.[0]?.cnt || 0);
          logger.info(`[PassportDiscovery] [${dbName}] ✅ List "${d.title}" (${d.id}) → ${cnt} record(s)`);
        } catch (_) {
          logger.info(`[PassportDiscovery] [${dbName}] ✅ List "${d.title}" (${d.id})`);
        }
      }

      return ids;
    }

    // ── Fallback cứng: chỉ dùng referenceIds cho chính reference DB ──────────
    if (dbName === this.oldDbName && referenceIds.length > 0) {
      logger.warn(`[PassportDiscovery] [${dbName}] ⚠ All discovery strategies failed — using hardcoded reference IDs: ${referenceIds.join(', ')}`);
      this.listIdCache[dbName] = referenceIds;
      return referenceIds;
    }

    // ── Không tìm thấy — log rõ lý do để dễ debug ───────────────────────────
    // Cache [] để tránh re-scan tốn kém; restart process sẽ clear cache.
    this.listIdCache[dbName] = [];
    logger.warn(
      `[PassportDiscovery] [${dbName}] ⛔ No passport list found after all strategies` +
      ` (canonical="${this.canonicalListTitle || 'N/A'}", keywords=${this._passportListKeywords.length}, sig-scan=${process.env.PASSPORT_ENABLE_SIGNATURE_SCAN !== 'false'}).` +
      ` Site will be skipped.`
    );
    return [];
  }

  async getCount(lastSyncTime, lastSyncId = 0) {
    const dbs = this.oldConfig.databaseList || [this.oldDbName];

    let total = 0;
    for (const db of dbs) {
      const listIds = await this.resolveListIdsForDb(db);
      if (listIds.length === 0) continue;

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
        logger.info(`[StreamPassportMigrationModel] [getCount] DB: ${db} -> ${dbCount} items (using ${listIds.length} resolved lists)`);
      } catch (err) {
        logger.error(`[StreamPassportMigrationModel] [getCount] Failed for DB: ${db}: ${err.message}`);
      }
    }
    return total;
  }

  /**
   * Fetch danh sách phiếu mượn từ một DB cụ thể theo cursor (tp_Modified, tp_ID).
   */
  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0, offset = 0, limit = 2000, dbName = null, listIds = null) {
    const targetDb = dbName || this.oldDbName;
    const resolvedListIds = listIds || await this.resolveListIdsForDb(targetDb);
    const listIdsStr = resolvedListIds.map(id => `'${id}'`).join(',');

    const query = `
        SELECT * FROM (
            SELECT
                ud.[tp_ID]        AS ID,
                ud.[tp_Created]   AS tp_Created,
                ud.[tp_Modified]  AS tp_Modified,
                ud.[nvarchar1]    AS nvarchar1,
                ud.[nvarchar2]    AS nvarchar2,
                ud.[nvarchar3]    AS nvarchar3,
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
                ud.[nvarchar1]    AS tp_Title,
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

            FROM [${targetDb}].[dbo].[AllUserData] ud
            LEFT JOIN [${targetDb}].[dbo].[UserInfo] ui_author
                ON ud.[tp_Author] = ui_author.[tp_ID]
            LEFT JOIN [${targetDb}].[dbo].[UserInfo] ui_editor
                ON ud.[tp_Editor] = ui_editor.[tp_ID]
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

  /**
   * Lưu dữ liệu từ old DB vào staging table (upsert).
   */
  async syncOldToStaging(rows, { transaction, dbName } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return { stagedCount: 0 };
    logger.info(`[StreamPassportMigrationModel] Staging ${rows.length} rows from ${dbName} to ${this.newTableSync}...`);
    const internalColumns = new Set(['__sync_time', '__sync_id_num', 'source_db']);
    const stagingTableRef = this.getStagingTableRef();

    for (const row of rows) {
      // Inject tb_bak = 1 và source_db
      row.tb_bak = 1;
      row.source_db = dbName || this.oldDbName;

      const columns = Object.keys(row || {}).filter(
        (c) => !String(c).startsWith('__') && !internalColumns.has(c)
      );
      const params = {};
      for (const column of columns) {
        params[column] = row[column] !== undefined ? row[column] : null;
      }
      params.__sync_time = row.__sync_time;
      params.__sync_id_num = row.__sync_id_num;
      params.source_db = row.source_db;

      // Update condition based on composite key (ID + source_db)
      const updateSet = columns.filter(c => c !== 'ID' && c !== 'source_db').map(c => `[${c}] = @${c}`).join(', ');
      const query = `
      IF EXISTS (SELECT 1 FROM ${stagingTableRef} WHERE [ID] = @ID AND [source_db] = @source_db)
      BEGIN
          UPDATE ${stagingTableRef} SET ${updateSet}, __sync_time = @__sync_time, __sync_id_num = @__sync_id_num, MigrateFlg = 0, MigrateErrFlg = 0, MigrateErrMess = NULL WHERE [ID] = @ID AND [source_db] = @source_db
      END
      ELSE
      BEGIN
          INSERT INTO ${stagingTableRef} (${columns.map(c => `[${c}]`).join(',')}, __sync_time, __sync_id_num, source_db, MigrateFlg, MigrateErrFlg)
          VALUES (${columns.map(c => `@${c}`).join(',')}, @__sync_time, @__sync_id_num, @source_db, 0, 0)
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
    const stagingTableRef = this.getStagingTableRef();

    // ★ Cleanup stale records (MigrateFlg=2) trước khi hút mới
    try {
      const resetCount = await releaseStaleClaims(this, {
        tableRef: stagingTableRef,
        staleMinutes: 10,
        label: this.modelName,
        releaseMessage: 'Reset stale from getList start'
      });
      if (resetCount > 0) {
        logger.info(`[${this.modelName}] [PRE-SYNC-CLEANUP] Reset ${resetCount} stale processing records.`);
      }
    } catch (cleanupErr) {
      logger.warn(`[StreamPassportMigrationModel] Cleanup stale records failed: ${cleanupErr.message}`);
    }

    const totalCount = await this.getCount(normalizedLastSyncTime, normalizedLastSyncId);
    logger.info(`[StreamPassportMigrationModel] Total records across all DBs: ${totalCount}`);

    // Cập nhật Dashboard ngay lập tức
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
        logger.info(`[StreamPassportMigrationModel] [SITE ${dbIdx}/${dbs.length}] Processing database: ${db}`);

        // Resolve List IDs cho DB này
        const listIds = await this.resolveListIdsForDb(db);
        if (listIds.length === 0) {
          logger.warn(`[StreamPassportMigrationModel] No List IDs resolved for DB ${db}. Skipping.`);
          continue;
        }
        const listIdsStr = listIds.map(id => `'${id}'`).join(',');

        // Lấy count riêng cho DB này để chạy phân trang đúng
        const dbCountQuery = `
            SELECT COUNT(*) AS total
            FROM [${db}].[dbo].[AllUserData]
            WHERE [tp_ListId] IN (${listIdsStr})
            AND tp_RowOrdinal = 0
        `;
        const dbCountRes = await this.queryOldDb(dbCountQuery, { lastSyncTime: normalizedLastSyncTime, lastSyncId: normalizedLastSyncId });
        const dbCount = Number(dbCountRes?.[0]?.total || 0);

        if (dbCount === 0) {
          logger.info(`[StreamPassportMigrationModel] No new records in ${db}`);
          continue;
        }

        const numIterations = Math.ceil(dbCount / fetchBatchSize);
        for (let i = 0; i < numIterations; i++) {
            const offset = i * fetchBatchSize;
            logger.info(`[StreamPassportMigrationModel] [${db}] Fetching batch ${i + 1}/${numIterations} (Offset: ${offset})`);

            const rows = await this.fetchListFromOldDb(normalizedLastSyncTime, normalizedLastSyncId, offset, fetchBatchSize, db, listIds);
            if (!rows || rows.length === 0) break;

            const stageResult = await this.syncOldToStaging(rows, { dbName: db });
            totalStagedCount += Number(stageResult?.stagedCount || rows.length || 0);

            // Cập nhật cursor (Global cursor across all DBs)
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
            logger.info(`[StreamPassportMigrationModel] [${db}] Staged: ${totalStagedCount} so far. Cursor: ${nextSyncTime} / ${nextSyncId}`);
        }
      } catch (dbErr) {
        logger.error(`[StreamPassportMigrationModel] [SKIPPED SITE] Error processing database ${db}: ${dbErr.message}`);
      }
    }

    // ★ Đếm pending thực tế trong staging (chưa xử lý)
    let pendingCount = totalStagedCount;
    try {
      const pendingRes = await this.queryNewDb(`
        SELECT COUNT(1) AS cnt FROM ${stagingTableRef}
        WHERE ISNULL(MigrateFlg, 0) = 0
          AND ISNULL(MigrateErrFlg, 0) = 0
      `);
      pendingCount = Number(pendingRes?.[0]?.cnt || 0);
    } catch (e) {
      logger.warn(`[StreamPassportMigrationModel] Không đếm được pending staging: ${e.message}`);
    }
    logger.info(`[StreamPassportMigrationModel] Pending records trong Staging: ${pendingCount}`);

    return {
        syncJobId,
        rows: [],
        totalCount: pendingCount,
        stagedCount: totalStagedCount,
        lastSyncTime: nextSyncTime,
        lastSyncId: nextSyncId
    };
  }

  async getSyncJobState(syncJobId) {
    const rows = await this.queryNewDb(`SELECT TOP 1 * FROM sync_jobs WHERE job_id = @syncJobId`, { syncJobId });
    return rows?.[0] || null;
  }

  /**
   * ★ Atomic claim: Lấy 1 bản ghi từ staging.
   * Cải tiến: Tự động reset record bị kẹt (>10p) trước khi lấy.
   */
  async fetchOneFromStaging() {
    try {
      const tableRef = this.getStagingTableRef();
      const label = this.modelName;

      // 1. Auto-reset record PROCESSING quá cũ (> 10 phút)
      await releaseStaleClaims(this, {
        tableRef,
        staleMinutes: 10,
        label,
      });

      // 2. Log thống kê chi tiết trạng thái Staging
      const stats = await this.queryNewDb(`
        SELECT 
          SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 0 THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN MigrateFlg = 2 THEN 1 ELSE 0 END) as processing,
          SUM(CASE WHEN MigrateFlg = 1 THEN 1 ELSE 0 END) as success,
          SUM(CASE WHEN MigrateFlg = 3 THEN 1 ELSE 0 END) as failed
        FROM ${tableRef}
      `);
      
      const { pending = 0, processing = 0, success = 0, failed = 0 } = stats[0] || {};
      const totalRemaining = Number(pending) + Number(processing);
      
      logger.info(`[${label}] [STAGING_STATS] PENDING=${pending}, PROCESSING=${processing}, SUCCESS=${success}, FAILED=${failed}. TOTAL_REMAINING=${totalRemaining}`);

      if (pending === 0) {
        return null; // Không còn record nào sẵn sàng (có thể vẫn còn record đang processing ở worker khác)
      }

      // 3. Claim record (MigrateFlg=0 → 2)
      const row = await claimNextStagingRow(this, {
        tableRef,
        orderBy: '[__sync_time] DESC, [ID] DESC',
        owner: `pid_${process.pid}_worker`,
        label,
      });

      if (row) {
        logger.info(`[${label}] [CLAIMED] Record ID=${row.ID} claimed by worker ${process.pid}`);
      }
      return row;
    } catch (error) {
      logger.error(`[StreamPassportMigrationModel.fetchOneFromStaging] FATAL: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updateHeartbeat(rowId, transaction = null) {
    if (!rowId) return 0;
    return updateHeartbeat(this, {
      tableRef: this.getStagingTableRef(),
      keyWhere: 'ID = @ID',
      params: { ID: rowId },
      transaction,
      rowToken: `ID=${rowId}`,
      label: this.modelName,
    });
  }

  /**
   * ★ Xử lý 1 bản ghi staging trong transaction với retry.
   * MigrateFlg: 0 → 2 (claimed) → 1 (thành công) hoặc 0+ErrFlg (lỗi).
   */
  /**
   * ★ Xử lý 1 bản ghi staging với retry và logging chi tiết.
   */
  async processOne(syncJobId) {
    if (!syncJobId) throw new Error('syncJobId is required');
    const label = this.modelName;
    let rowData = null;
    let stopHeartbeat = null;

    try {
      // 1. Claim 1 record
      rowData = await this.fetchOneFromStaging();

      if (!rowData) {
        // Kiểm tra xem job thực sự đã xong chưa (Hết cả PENDING và PROCESSING)
        const tableRef = this.getStagingTableRef();
        const check = await this.queryNewDb(`
          SELECT 
            SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 0 THEN 1 ELSE 0 END) as pending,
            SUM(CASE WHEN MigrateFlg = 2 THEN 1 ELSE 0 END) as processing
          FROM ${tableRef}
        `);
        const pendingN = Number(check?.[0]?.pending || 0);
        const processingN = Number(check?.[0]?.processing || 0);
        
        if (pendingN === 0 && processingN === 0) {
          // ✅ Thực sự hết việc: cả PENDING và PROCESSING đều = 0
          logger.info(`[${label}] [FINALIZE] No more records (Pending=0, Processing=0). Ending job.`);
          await this.finalizeProcessingCursor(syncJobId);
          return { syncJobId, processed: false, done: true };
        } else {
          // ⚠️ Vẫn còn records đang được xử lý bởi worker khác — KHÔNG return done=true
          // Nếu return done=true ở đây, SyncManagerService sẽ break vòng lặp outer và kết thúc job sớm
          // dù còn pendingN/processingN records chưa xử lý xong.
          logger.info(`[${label}] [STANDBY] No record to claim right now (pending=${pendingN}, processing=${processingN}). Waiting briefly for other workers...`);
          await new Promise(r => setTimeout(r, 150)); // chờ 150ms để workers khác xử lý xong
          return { syncJobId, processed: false, done: false }; // ← QUAN TRỌNG: done=false để outer loop tiếp tục
        }
      }

      const rowId = rowData.ID;
      const recordCode = rowData.nvarchar1 || `ID:${rowId}`;
      const startTime = Date.now();

      logger.info(`[${label}] [START_PROCESS] ID=${rowId} | Code=${recordCode}`);

      // 2. Start Heartbeat
      stopHeartbeat = startHeartbeatLoop(
        () => this.updateHeartbeat(rowId),
        this.heartbeatIntervalMs,
      );

      // 3. Process with Transaction & Retry
      const result = await dbUtils.withTransactionRetry(this.newPool, async (transaction) => {
        // Core Logic
        const res = await this.processRowData(rowData, { transaction });

        // Cập nhật Dashboard Counters
        await this.queryNewDbTx(
          `UPDATE sync_jobs
           SET total_processed = ISNULL(total_processed, 0) + 1,
               total_success   = ISNULL(total_success, 0) + 1,
               updated_at      = GETDATE()
           WHERE job_id = @syncJobId`,
          { syncJobId },
          transaction
        );

        // Giải phóng lock: MigrateFlg=1
        await markRowSuccess(this, {
          tableRef: this.getStagingTableRef(),
          keyWhere: 'ID = @ID',
          params: { ID: rowId },
          transaction,
          rowToken: `ID=${rowId}|Code=${recordCode}`,
          label,
        });

        return res;
      }, { maxRetries: 3 });

      if (stopHeartbeat) { stopHeartbeat(); stopHeartbeat = null; }
      
      const duration = Date.now() - startTime;
      logger.info(`[${label}] [SUCCESS] ID=${rowId} | Code=${recordCode} | Duration=${duration}ms`);

      return {
        syncJobId,
        processed: true,
        done: false,
        rowId,
        result
      };
    } catch (error) {
      if (stopHeartbeat) { stopHeartbeat(); stopHeartbeat = null; }

      const errMsg = error.message;
      const stack = error.stack;
      logger.error(`[${label}] [FAILED] ID=${rowData?.ID || 'Unknown'}: ${errMsg}`, stack);

      if (rowData && rowData.ID) {
        try {
          await markRowFailed(this, {
            tableRef: this.getStagingTableRef(),
            keyWhere: 'ID = @ID',
            params: { ID: rowData.ID },
            rowToken: `ID=${rowData.ID}`,
            errorMessage: `${errMsg}\n${stack}`,
            label,
          });
          
          // Increment error counter in sync_jobs
          await this.queryNewDb(`
            UPDATE sync_jobs 
            SET total_errors = ISNULL(total_errors, 0) + 1,
                total_processed = ISNULL(total_processed, 0) + 1
            WHERE job_id = @syncJobId
          `, { syncJobId });
        } catch (updateErr) {
          logger.error(`[${label}] [CRITICAL] Failed to mark record as FAILED: ${updateErr.message}`);
        }
      }
      throw error;
    }
  }

  /**
   * ★ Cập nhật cursor (last_sync_time, last_sync_id) từ MAX records đã xử lý thành công.
   */
  async finalizeProcessingCursor(syncJobId) {
    try {
      const stagingTableRef = this.getStagingTableRef();
      
      // Kiểm tra xem có records nào đang PROCESSING không
      const checkProcessing = await this.queryNewDb(`SELECT COUNT(1) as cnt FROM ${stagingTableRef} WHERE MigrateFlg = 2`);
      if (Number(checkProcessing?.[0]?.cnt || 0) > 0) {
        logger.info(`[StreamPassportMigrationModel] finalizeProcessingCursor delayed: ${checkProcessing[0].cnt} records still PROCESSING.`);
        return;
      }

      const res = await this.queryNewDb(`
        SELECT
          MAX([__sync_time]) AS maxTime,
          MAX([ID]) AS maxId
        FROM ${stagingTableRef}
        WHERE ISNULL(MigrateFlg, 0) = 1
      `);
      
      if (res?.[0]?.maxTime) {
        const finalTime = new Date(res[0].maxTime).toISOString();
        const finalId = Number(res[0].maxId || 0);
        await this.queryNewDb(
          `UPDATE sync_jobs
           SET last_sync_time = @t,
               last_sync_id   = @id,
               status = 'COMPLETED',
               ended_at = GETDATE()
           WHERE job_id = @jobId`,
          { t: finalTime, id: finalId, jobId: syncJobId }
        );
        logger.info(`[StreamPassportMigrationModel] Cursor finalized & Job marked COMPLETED: ${finalTime} / ${finalId}`);
      }
    } catch (err) {
      logger.warn(`[StreamPassportMigrationModel.finalizeProcessingCursor] Lỗi: ${err.message}`);
    }
  }

  /**
   * Trích xuất mnemonic ngắn gọn từ tên database (ví dụ: WSS_Content_eoffice_khkd -> KHKD).
   */
  getSourceMnemonic(sourceDb) {
    if (!sourceDb) return 'MAIN';
    const parts = sourceDb.split('_');
    const lastPart = parts[parts.length - 1];

    // Nếu db là 'WSS_Content_eoffice' thì coi là MAIN
    if (lastPart.toLowerCase() === 'eoffice') return 'MAIN';

    return lastPart.toUpperCase();
  }

  /**
   * Xử lý một row dữ liệu từ old DB và upsert vào bảng passport_borrow_requests.
   */
  async processRowData(rowData, { transaction } = {}) {
    if (!rowData?.ID) throw new Error('ID is required');
    const recordId = String(rowData.ID);
    const { externalKey } = this.oldConfig;

    try {
      // 1. Resolve Requester
      let requesterId = null;
      try {
        requesterId = await this.helper.passportUserResolver(rowData, transaction);
      } catch (e) {
        logger.warn(`[StreamPassportMigrationModel] [ID=${recordId}] Error resolving requester: ${e.message}`);
      }

      if (!requesterId) {
        const defaultVanthuId = process.env.VANTHU_USER_ID || 'b23406e3-5c75-41d3-91e0-1654293ae6b2';
        logger.warn(`[StreamPassportMigrationModel] [ID=${recordId}] Unresolved requester (${rowData.AuthorName || 'Unknown'}). Falling back to ${defaultVanthuId}`);
        requesterId = defaultVanthuId;
      }

      // 2. Resolve Passport ID & Number
      let passportId = null;
      let passportNumber = null;
      let delegationLeader = null;
      
      const nameFromRequest = rowData.AuthorFullName || rowData.AuthorName || '';
      const cleanName = nameFromRequest.split(' - ')[0].trim();

      try {
        let passportRow = null;
        
        // Ưu tiên 1: Tìm theo user_id đã được resolve
        if (requesterId) {
          const rows = await this.queryNewDbTx(
            `SELECT TOP 1 id, passport_number, user_id FROM passports WHERE user_id = @userId AND is_deleted = 0`,
            { userId: requesterId },
            transaction
          );
          if (rows?.length) passportRow = rows[0];
        }

        // Ưu tiên 2: Tìm theo tên rút gọn (Vũ Việt Hải - VP -> Vũ Việt Hải)
        if (!passportRow && cleanName) {
          const rowsByName = await this.queryNewDbTx(
            `SELECT TOP 1 id, passport_number, user_id FROM passports WHERE full_name = @name AND is_deleted = 0`,
            { name: cleanName },
            transaction
          );
          if (rowsByName?.length) passportRow = rowsByName[0];
        }

        if (passportRow) {
          passportId = passportRow.id;
          passportNumber = passportRow.passport_number;
          delegationLeader = passportRow.user_id;
        }
      } catch (e) {
        logger.warn(`[StreamPassportMigrationModel] [ID=${recordId}] Error resolving passport info: ${e.message}`);
      }

      // 3. Map Status & Metadata
      // Thử map status từ nvarchar4 (chuẩn), nếu không được thử nvarchar2/nvarchar3 (fallback cho một số list biến thể)
      let rawStatus = rowData.nvarchar4;
      if (!rawStatus || rawStatus.trim() === '') {
        rawStatus = rowData.nvarchar2 || rowData.nvarchar3 || null;
      }
      const mappedStatus = mapStatus(rawStatus);
      const mnemonic = this.getSourceMnemonic(rowData.source_db);
      const rawCode = rowData.nvarchar1 || `HC-SYNC-${recordId}`;

      // Parse ntext2 JSON: [{UserId, LoginName, FullName, Email, Created, Value}]
      // Value = lý do/ghi chú chuyến đi (note + trip_note)
      let ntext2Value = null;
      try {
        if (rowData.ntext2) {
          const ntext2Arr = JSON.parse(rowData.ntext2);
          if (Array.isArray(ntext2Arr) && ntext2Arr.length > 0) {
            ntext2Value = ntext2Arr[0]?.Value || null;
          }
        }
      } catch (parseErr) {
        logger.warn(`[StreamPassportMigrationModel] [ID=${recordId}] Failed to parse ntext2: ${parseErr.message}`);
      }
      
      // Tính ngày dự trả = datetime6 + 1 ngày
      let expectedReturnDate = parseDate(rowData.datetime6);
      if (expectedReturnDate) {
        expectedReturnDate.setDate(expectedReturnDate.getDate() + 1);
      }

      const dataToUpsert = {
        ...rowData,
        requester_id: requesterId,
        created_by: requesterId,
        status: mappedStatus || 'PENDING',
        request_code: `${rawCode}/${mnemonic}`,
        name_passport_request: rowData.AuthorFullName || rowData.AuthorName || 'Unknown (Migrated)',
        type_request: 'user',
        // return_date = datetime6 + 1 ngày, borrow_date lấy từ tp_Created
        borrow_date: parseDate(rowData.tp_Created) || new Date(),
        return_date: expectedReturnDate || null,
        departure_date: parseDate(rowData.datetime4) || null,
        arrival_date: parseDate(rowData.datetime8) || null,
        note: ntext2Value || rowData.ntext1 || null,   // ntext2[0].Value là lý do chính
        trip_content: ntext2Value || null,             // lưu riêng vào trip_content
        passport_type: 'ORDINARY',                     // fix cứng khi migrate
        passport_id: passportId,                       // gắn ID hộ chiếu tìm được
        passport_number: passportNumber,               // Số hộ chiếu
        delegation_leader: delegationLeader,           // Người dẫn đoàn (chủ hộ chiếu)
      };

      // Reason logic
      const actionReason = rowData.nvarchar5 || null;
      if (dataToUpsert.status === 'REJECTED') dataToUpsert.reject_reason = actionReason;
      else if (dataToUpsert.status === 'CANCELLED') dataToUpsert.cancel_reason = actionReason;
      else if (dataToUpsert.status === 'COMPLETED') dataToUpsert.approval_reason = actionReason;

      // 3. Upsert Main Record
      const result = await this.upsertPassportBorrowRequest(dataToUpsert, externalKey, recordId, transaction);

      // 4. Audit Trail
      if (result.id) {
        try {
          await this.createDefaultAuditForPassport(result.id, requesterId, dataToUpsert.status, rowData.ntext2, transaction, rowData.tp_Title, rawStatus);
        } catch (auditErr) {
          logger.error(`[StreamPassportMigrationModel] [ID=${recordId}] Audit generation failed: ${auditErr.message}`);
        }
      }

      return {
        backupId: recordId,
        affected: result.affected,
        action: result.action
      };
    } catch (err) {
      logger.error(`[StreamPassportMigrationModel] [ID=${recordId}] processRowData ERROR: ${err.message}`);
      throw err;
    }
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
    logger.info(`[StreamPassportMigrationModel] upsertPassportBorrowRequest: table=passport_borrow_requests, externalKeyValue=${externalKeyValue}`);

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
      trip_content:           rawData.trip_content || null, // ntext2[0].Value — lý do/ghi chú chuyến đi
      passport_type:          rawData.passport_type || 'ORDINARY', // fix cứng ORDINARY khi migrate
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
      source_db:              rawData.source_db || null,
      passport_id:            rawData.passport_id || null,
      passport_number:        rawData.passport_number || null,
      delegation_leader:      rawData.delegation_leader || null,
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

    // Đảm bảo updated_by luôn matching với created_by khi update
    if (existingCols.has('updated_by') && fieldValues.created_by) {
      if (!updateSet.some(s => s.includes('updated_by'))) {
         params['updated_by'] = fieldValues.created_by;
         updateSet.push(`[updated_by] = @updated_by`);
      }
    }

      params._externalKeyValue = externalKeyValue;
      params._sourceDb = rawData.source_db;

      const query = `
      DECLARE @OutputTable TABLE (id NVARCHAR(255));
      DECLARE @affected INT;

      IF EXISTS (SELECT 1 FROM ${tableRef} WHERE [${externalKeyField}] = @_externalKeyValue AND [source_db] = @_sourceDb)
      BEGIN
          UPDATE ${tableRef} SET ${updateSet.length ? updateSet.join(', ') : `${externalKeyField} = ${externalKeyField}`}
          OUTPUT INSERTED.id INTO @OutputTable
          WHERE [${externalKeyField}] = @_externalKeyValue AND [source_db] = @_sourceDb;

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
      const result = await this.queryNewDbTx(query, params, transaction);
      const row = Array.isArray(result) ? result[0] : result;
      return { id: row?.id || null, action: row?.action || 'none', affected: Number(row?.affected || 0) };
    } catch (upsertErr) {
      logger.error(`[StreamPassportMigrationModel] upsertPassportBorrowRequest FAIL [ID=${externalKeyValue}]: ${upsertErr.message}`);
      throw upsertErr;
    }
  }

  /**
   * Tạo audit trail cho phiếu mượn hộ chiếu sau khi migrate, bao gồm audit mặc định và audit từ ntext2.
   */
  async createDefaultAuditForPassport(requestId, requesterId, status, ntext2Str = null, transaction = null, tpTitle = null, originalStatus = null) {
    const db = this.newDbName || 'app_tancang';
    const auditTable = `[${db}].[dbo].[audit]`;
    const creatorId = requesterId || null;
    const receiverId = process.env.DEFAULT_RECEIVER_UNIT_ID || 'TCT_LOGIST';
    const typeDoc = 'PASSPORT_REQUEST';

    logger.info(`[Audit-Passport] === START AUDIT GENERATION FOR REQUEST: ${requestId} ===`);

    // 1. Bước CREATE (Dựa trên Author/Requester)
    const createActionLabel = N('Tạo phiếu mượn hộ chiếu');
    const stageStatus = (status === 'COMPLETED' || status === 'IN_USE') ? 'DA_XU_LY' : 'CHUA_XU_LY';

    logger.info(`[Audit-Passport] [Step: CREATE] RequesterID: ${creatorId || 'NOT_FOUND'}`);

    try {
      // 1. Bước CREATE
      const insertCreateQuery = `
        IF NOT EXISTS (SELECT 1 FROM ${auditTable} WHERE document_id = @requestId AND action_code = 'CREATE' AND origin_id = 'migration_origin')
        BEGIN
            INSERT INTO ${auditTable} (
              document_id, [time], user_id, display_name, [role], action_code, from_node_id, to_node_id, details, origin_id, created_by,
              receiver, roleProcess, [action], stage_status, curStatusCode, type_document, bpmn_version, created_at, updated_at
            ) VALUES (
              @requestId, SYSUTCDATETIME(), @creatorId, N'Người tạo phiếu', 'NGUOI_TAO_PHIEU', 'CREATE', 'StartEvent_1', 'Gateway_0rbwxs6',
              N'{"transferType": "migration", "source": "sharepoint"}', 'migration_origin',
              @creatorId, @receiverId, 'NGUOI_TAO_PHIEU', @createActionLabel, @stageStatus, '1', @typeDoc, 'QT_MTHC', SYSUTCDATETIME(), SYSUTCDATETIME()
            );
        END
      `;
      await this.queryNewDbTx(insertCreateQuery, { requestId, creatorId, createActionLabel, stageStatus, typeDoc, receiverId }, transaction);

      // 2. Bước kết quả (Nếu đã kết thúc)
      const finalStates = ['COMPLETED', 'IN_USE', 'REJECTED', 'CANCELLED'];
      if (finalStates.includes(status)) {
        let actionCode = 'APPROVE';
        let actionLabel = N('Phê duyệt');
        let fromNode = 'Gateway_0rbwxs6';
        let toNode = 'Gateway_0fkk071';

        if (status === 'REJECTED') { actionCode = 'REJECT'; actionLabel = N('Từ chối'); toNode = 'Gateway_0rbwxs6'; }
        else if (status === 'CANCELLED') { 
            actionCode = 'CANCEL'; 
            actionLabel = (String(originalStatus || '').includes('Thu hồi') || (tpTitle && tpTitle.includes('Thu hồi'))) ? N('Thu hồi') : N('Hủy phiếu'); 
            toNode = 'EndEvent_1'; 
        }

        const insertFinalQuery = `
          IF NOT EXISTS (SELECT 1 FROM ${auditTable} WHERE document_id = @requestId AND action_code = @actionCode AND origin_id = 'migration_final_result')
          BEGIN
              INSERT INTO ${auditTable} (
                document_id, [time], user_id, display_name, [role], action_code, from_node_id, to_node_id, details, origin_id, created_by,
                receiver, roleProcess, [action], stage_status, curStatusCode, type_document, bpmn_version, created_at, updated_at
              ) VALUES (
                @requestId, DATEADD(SECOND, 10, SYSUTCDATETIME()), @creatorId, N'Kết quả', 'CHI_HUY_DON_VI', @actionCode,
                @fromNode, @toNode, null, 'migration_final_result', @creatorId, @receiverId, 'CHI_HUY_DON_VI', @actionLabel,
                'DA_XU_LY', @actionCode, @typeDoc, 'QT_MTHC', DATEADD(SECOND, 10, SYSUTCDATETIME()), DATEADD(SECOND, 10, SYSUTCDATETIME())
              );
          END
        `;
        await this.queryNewDbTx(insertFinalQuery, { requestId, creatorId, actionLabel, actionCode, fromNode, toNode, typeDoc, receiverId }, transaction);
      }

      // 3. Xử lý log từ ntext2
      if (ntext2Str && typeof ntext2Str === 'string' && ntext2Str.trim().startsWith('[')) {
        let auditItems = [];
        try { auditItems = JSON.parse(ntext2Str); } catch (e) { logger.warn(`[Audit-Passport] JSON parse failed for ntext2: ${e.message}`); }

        if (Array.isArray(auditItems)) {
          for (let i = 0; i < auditItems.length; i++) {
            const item = auditItems[i];
            if (!item?.Created) continue;

            const actor = await this.helper.resolvePassportAuditActor(item, transaction);
            const auditMeta = this.helper.buildPassportAuditMetaFromNtext2(item);
            const itemTime = parseDate(item.Created) || new Date();
            const originIdMsg = `migration_ntext2_${i}_${requestId}`;
            const resolvedId = actor.id || process.env.VANTHU_USER_ID || 'b23406e3-5c75-41d3-91e0-1654293ae6b2';

            const insertItemQuery = `
              IF NOT EXISTS (SELECT 1 FROM ${auditTable} WHERE document_id = @requestId AND origin_id = @originId)
              BEGIN
                  INSERT INTO ${auditTable} (
                    document_id, [time], user_id, display_name, [role], action_code, from_node_id, to_node_id, details, origin_id, created_by,
                    receiver, roleProcess, [action], stage_status, curStatusCode, type_document, bpmn_version, created_at, updated_at, processed_by
                  ) VALUES (
                    @requestId, @itemTime, @auditUserId, @displayName, @role, @actionCode, @fromNodeId, @toNodeId, @details, @originId, @auditUserId, @receiverId,
                    @roleProcess, @itemActionLabel, @stageStatus, @curStatusCode, @typeDoc, 'QT_MTHC', @itemTime, @itemTime, @auditUserId
                  );
              END
            `;

            await this.queryNewDbTx(insertItemQuery, {
              requestId, itemTime, auditUserId: resolvedId, displayName: actor.displayName || 'Unknown', role: auditMeta.role, actionCode: auditMeta.actionCode,
              fromNodeId: auditMeta.fromNodeId, toNodeId: auditMeta.toNodeId, originId: originIdMsg, details: auditMeta.details, roleProcess: auditMeta.roleProcess,
              itemActionLabel: auditMeta.actionLabel, stageStatus: auditMeta.stageStatus, curStatusCode: auditMeta.curStatusCode, typeDoc, receiverId
            }, transaction);

            // History table
            const historyTable = `[${db}].[dbo].[passport_histories]`;
            await this.queryNewDbTx(`
              INSERT INTO ${historyTable} (request_id, [action], note, performer_id, performed_at)
              SELECT @requestId, @action, @note, @performerId, @performedAt
              WHERE NOT EXISTS (SELECT 1 FROM ${historyTable} WHERE request_id = @requestId AND note = @note AND performer_id = @performerId AND performed_at = @performedAt)
            `, { requestId, action: auditMeta.actionCode || 'COMMENT', note: item.Value || '', performerId: resolvedId, performedAt: itemTime }, transaction);
          }
        }
      }
      logger.info(`[Audit-Passport] Finished audit generation for: ${requestId}`);
    } catch (err) {
      logger.error(`[Audit-Passport] FATAL ERROR for Request ${requestId}: ${err.message}`, err.stack);
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
        logger.info(`[StreamPassportMigrationModel] Cấp mới roles_by_process cho userId=${userId}`);
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
        logger.info(`[StreamPassportMigrationModel] Đã merge bổ sung roles_by_process cho userId=${userId}`);
      }
    } catch (e) {
      logger.error(`[StreamPassportMigrationModel] Lỗi khi merge roles_by_process cho userId=${userId}: ${e.message}`);
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
        logger.info(`[StreamPassportMigrationModel] Assigned userId=${userId} to group=${groupUserId}`);
      }
    } catch (err) {
      logger.error(`[StreamPassportMigrationModel] _ensureUserInGroup ERROR: ${err.message}`);
    }
  }
  /**
   * Đếm tổng số records còn cần xử lý trong staging (PENDING + PROCESSING).
   * Dùng bởi SyncHandlerModel để recheck khi virtual items hết trước khi staging thực sự xong.
   */
  async getStagingRemainingCount() {
    try {
      const tableRef = this.getStagingTableRef();
      const res = await this.queryNewDb(`
        SELECT
          SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 0 THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN MigrateFlg = 2 THEN 1 ELSE 0 END) AS processing
        FROM ${tableRef}
      `);
      const pending = Number(res?.[0]?.pending || 0);
      const processing = Number(res?.[0]?.processing || 0);
      return pending + processing;
    } catch (err) {
      logger.warn(`[${this.modelName}] getStagingRemainingCount ERROR: ${err.message}`);
      return 0;
    }
  }
}

// Helper: wrap string in N'' for nvarchar (only used in template literals)
function N(str) { return str; }

module.exports = StreamPassportMigrationModel;
