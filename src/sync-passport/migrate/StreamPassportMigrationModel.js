const { v4: uuidv4 } = require('uuid');
const MigrationHelper = require('../../helpers/MigrationHelper');
const logger = require('../../../utils/logger');
const dbUtils = require('../../../utils/dbUtils');

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
    logger.info(`[StreamPassportMigrationModel] Initializing...`);
    await super.initialize();
    await this.ensureStagingTableExists();
    await this.ensurePassportsColumnsExist();
    await this.ensurePassportBorrowRequestsColumnsExist();
    await this.ensurePassportVouchersTableExists();
    await this.ensurePassportVoucherItemsTableExists();
    await this.ensureAuditTableExists();

    // Seed dữ liệu mẫu cho test
    await this.seedPassportMockData();
    await this.seedAuditMockData();

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
    logger.info(`[StreamPassportMigrationModel] Staging ${rows.length} rows to ${this.newTableSync}...`);
    const internalColumns = new Set(['__sync_time', '__sync_id_num']);
    const keyColumn = 'ID';
    const stagingTableRef = this.getStagingTableRef();

    for (const row of rows) {
      // Inject tb_bak = 1 để đánh dấu record đến từ SharePoint
      row.tb_bak = 1;

      const columns = Object.keys(row || {}).filter(
        (c) => !String(c).startsWith('__') && !internalColumns.has(c)
      );
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
          UPDATE ${stagingTableRef} SET ${updateSet}, __sync_time = @__sync_time, __sync_id_num = @__sync_id_num, MigrateFlg = 0, MigrateErrFlg = 0, MigrateErrMess = NULL WHERE [${keyColumn}] = @${keyColumn}
      END
      ELSE
      BEGIN
          INSERT INTO ${stagingTableRef} (${columns.map(c => `[${c}]`).join(',')}, __sync_time, __sync_id_num, MigrateFlg, MigrateErrFlg)
          VALUES (${columns.map(c => `@${c}`).join(',')}, @__sync_time, @__sync_id_num, 0, 0)
      END
      `;
      await this.queryNewDbTx(query, params, transaction);
    }
    logger.info(`[StreamPassportMigrationModel] Staging complete for ${rows.length} rows`);
    return { stagedCount: rows.length };
  }

  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    if (!syncJobId) throw new Error('syncJobId is required');
    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);
    const stagingTableRef = this.getStagingTableRef();

    // ★ Cleanup stale records (MigrateFlg=2) trước khi hút mới
    try {
      await this.queryNewDb(`
        UPDATE ${stagingTableRef}
        SET MigrateFlg = 0, MigrateErrMess = 'Reset from stale processing'
        WHERE MigrateFlg = 2
      `);
    } catch (cleanupErr) {
      logger.warn(`[StreamPassportMigrationModel] Cleanup stale records failed: ${cleanupErr.message}`);
    }

    const totalCount = await this.getCount(normalizedLastSyncTime, normalizedLastSyncId);
    logger.info(`[StreamPassportMigrationModel] Total records to sync: ${totalCount}`);

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

        // Cập nhật cursor
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
        logger.info(`🔥 [StreamPassportMigrationModel] Batch ${i + 1}/${numIterations} staged: ${totalStagedCount}/${totalCount}. LastSyncTime: ${nextSyncTime}, LastSyncId: ${nextSyncId}`);
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
   * ★ Atomic claim: Lấy 1 bản ghi từ staging bằng CTE + UPDLOCK, ROWLOCK.
   * Set MigrateFlg=2 (đang xử lý) ngay lúc SELECT để tránh multi-terminal trùng lặp.
   */
  async fetchOneFromStaging() {
    try {
      const tableRef = this.getStagingTableRef();

      // Debug: đếm records sẵn sàng
      const countResult = await this.queryNewDb(`
        SELECT COUNT(1) AS cnt FROM ${tableRef}
        WHERE ISNULL(MigrateFlg, 0) = 0
          AND ISNULL(MigrateErrFlg, 0) = 0
      `);
      const availableCount = Number(countResult?.[0]?.cnt || 0);
      logger.info(`[StreamPassportMigrationModel.fetchOneFromStaging] Available: ${availableCount}`);

      if (availableCount === 0) return null;

      // ★ Atomic claim pattern: CTE + UPDLOCK, ROWLOCK
      const query = `
      WITH CTE AS (
        SELECT TOP (1) *
        FROM ${tableRef} WITH (UPDLOCK, ROWLOCK)
        WHERE ISNULL(MigrateFlg, 0) = 0
          AND ISNULL(MigrateErrFlg, 0) = 0
        ORDER BY [__sync_time] DESC, [ID] DESC
      )
      UPDATE CTE
      SET MigrateFlg = 2,
          MigrateErrMess = 'Processing...'
      OUTPUT inserted.*
      `;

      const rows = await this.queryNewDb(query);
      return rows?.length ? rows[0] : null;
    } catch (error) {
      logger.error(`[StreamPassportMigrationModel.fetchOneFromStaging] Failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * ★ Xử lý 1 bản ghi staging trong transaction với retry.
   * MigrateFlg: 0 → 2 (claimed) → 1 (thành công) hoặc 0+ErrFlg (lỗi).
   */
  async processOne(syncJobId) {
    if (!syncJobId) throw new Error('syncJobId is required');

    const jobState = await this.getSyncJobState(syncJobId);
    const stagingTableRef = this.getStagingTableRef();
    let rowData = null;

    try {
      // ★ Claim 1 record bằng atomic fetch (MigrateFlg=0→2)
      rowData = await this.fetchOneFromStaging();

      if (!rowData) {
        logger.info(`[StreamPassportMigrationModel] Không còn dữ liệu trong staging cho job ${syncJobId}`);
        await this.finalizeProcessingCursor(syncJobId);
        return { syncJobId, processed: false, done: true };
      }

      const rowId = rowData.ID || null;
      const current = Number(jobState?.total_processed || 0) + 1;
      logger.info(`[StreamPassportMigrationModel] Process ${current}: record ID=${rowId}`);

      // ★ Wrap trong transaction với retry
      const result = await dbUtils.withTransactionRetry(this.newPool, async (transaction) => {
        const res = await this.processRowData(rowData, { transaction });

        // Cập nhật counters trong sync_jobs
        await this.queryNewDbTx(
          `UPDATE sync_jobs
           SET total_processed = ISNULL(total_processed, 0) + 1,
               total_success   = ISNULL(total_success, 0) + 1
           WHERE job_id = @syncJobId`,
          { syncJobId },
          transaction
        );

        // ★ Đánh dấu staging row thành công: MigrateFlg=1
        await this.queryNewDbTx(
          `UPDATE ${stagingTableRef} WITH (ROWLOCK) SET MigrateFlg = 1, MigrateErrFlg = 0, MigrateErrMess = NULL WHERE ID = @ID`,
          { ID: rowId },
          transaction
        );

        return res;
      }, { maxRetries: 5 });

      return {
        syncJobId,
        processed: true,
        done: false,
        rowId,
        result
      };
    } catch (error) {
      // ★ Rollback staging: MigrateFlg=0, MigrateErrFlg=1, lưu lỗi
      if (rowData && rowData.ID) {
        try {
          await this.queryNewDb(
            `UPDATE ${stagingTableRef} SET MigrateFlg = 0, MigrateErrFlg = 1, MigrateErrMess = @Err WHERE ID = @ID`,
            { ID: rowData.ID, Err: String(error.message).slice(0, 1000) }
          );
        } catch (updateErr) { /* ignore */ }
      }

      logger.error(`[StreamPassportMigrationModel.processOne] Failed row ID=${rowData?.ID}: ${error.message}`);
      throw error;
    }
  }

  /**
   * ★ Cập nhật cursor (last_sync_time, last_sync_id) từ MAX records đã xử lý thành công.
   */
  async finalizeProcessingCursor(syncJobId) {
    try {
      const stagingTableRef = this.getStagingTableRef();
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
               last_sync_id   = @id
           WHERE job_id = @jobId`,
          { t: finalTime, id: finalId, jobId: syncJobId }
        );
        logger.info(`[StreamPassportMigrationModel] Cursor finalized: last_sync_time=${finalTime}, last_sync_id=${finalId}`);
      } else {
        logger.info(`[StreamPassportMigrationModel] finalizeProcessingCursor: không có bản ghi đã xử lý, cursor giữ nguyên.`);
      }
    } catch (err) {
      logger.warn(`[StreamPassportMigrationModel.finalizeProcessingCursor] Lỗi: ${err.message}`);
    }
  }

  /**
   * Xử lý một row dữ liệu từ old DB và upsert vào bảng passport_borrow_requests.
   */
  async processRowData(rowData, { transaction } = {}) {
    if (!rowData?.ID) throw new Error('ID is required');

    const recordId = String(rowData.ID);
    logger.info(`[StreamPassportMigrationModel] processRowData: recordId=${recordId}`);
    const { externalKey } = this.oldConfig;

    // 1. Resolve người tạo phiếu (requester) từ thông tin Author
    let requesterId = await this.helper.strictUserResolver(rowData, transaction);
    logger.info(`[StreamPassportMigrationModel] [recordId=${recordId}] Resolved Requester: ${requesterId || 'NULL'}`);

    // Update roles_by_process & Group for the requester
    if (requesterId) {
      await this._ensureUserHasRoles(requesterId, transaction);
      await this._ensureUserInGroup(requesterId, transaction);
    }

    // 2. Map trạng thái từ hệ thống cũ sang hệ thống mới
    const mappedStatus = mapStatus(rowData.nvarchar4);

    // 3. Chuẩn bị dữ liệu - nếu không có requesterId, để null
    rowData.requester_id = requesterId || null;
    rowData.created_by   = requesterId || null;
    rowData.status       = mappedStatus || 'Chờ phê duyệt';
    rowData.request_code = rowData.nvarchar1 || `HC-SYNC-${recordId}`;
    rowData.name_passport_request = rowData.AuthorFullName || rowData.AuthorName || 'Chưa xác định (Sync)';
    rowData.type_request = 'user';

    // 4. Xử lý ngày tháng — fallback về today nếu không có ngày mượn
    rowData.borrow_date    = parseDate(rowData.datetime6) || parseDate(rowData.tp_Created) || new Date();
    rowData.return_date    = parseDate(rowData.datetime7) || null;
    rowData.departure_date = parseDate(rowData.datetime4) || null;
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

    logger.info(`[StreamPassportMigrationModel] [recordId=${recordId}] Data Prepared: Code=${rowData.request_code}, Status=${rowData.status}, BorrowDate=${rowData.borrow_date.toISOString()}`);

    // 7. Upsert vào bảng mới
    const result = await this.upsertPassportBorrowRequest(rowData, externalKey, recordId, transaction);

    // 8. Tạo audit trail mặc định và audit từ ntext2
    if (result.id) {
      await this.createDefaultAuditForPassport(result.id, requesterId, mappedStatus, rowData.ntext2, transaction);
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
    logger.info(`[StreamPassportMigrationModel] upsertPassportBorrowRequest result: action=${row?.action}, affected=${row?.affected}`);
    return { id: row?.id || null, action: row?.action || 'none', affected: Number(row?.affected || 0) };
  }

  /**
   * Tạo audit trail cho phiếu mượn hộ chiếu sau khi migrate, bao gồm audit mặc định và audit từ ntext2.
   */
  async createDefaultAuditForPassport(requestId, requesterId, status, ntext2Str = null, transaction = null) {
    const db = this.newDbName || 'app_tancang';
    const auditTable = `[${db}].[dbo].[audit]`;
    const creatorId = requesterId || null;
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
          toNode = 'Gateway_0rbwxs6';
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

      // 3. Xử lý log từ ntext2 nếu có (JSON Array)
      if (ntext2Str && typeof ntext2Str === 'string' && ntext2Str.trim().startsWith('[')) {
        try {
          const auditItems = JSON.parse(ntext2Str);
          if (Array.isArray(auditItems)) {
            for (let i = 0; i < auditItems.length; i++) {
              const item = auditItems[i];
              if (!item.Value || !item.Created) continue;

              const loginName = item.LoginName || '';
              const extractedAccount = this.helper.extractAccountOnly(loginName);

              let auditUserId = null;
              if (extractedAccount) {
                auditUserId = await this.helper.strictUserResolver({ AuthorAccount: extractedAccount }, transaction);
              }

              const itemActionLabel = item.Value.length > 255 ? item.Value.substring(0, 255) : item.Value;
              const itemTime = parseDate(item.Created) || new Date();
              const originIdMsg = `migration_ntext2_${i}_${requestId}`;

              const insertItemQuery = `
                IF NOT EXISTS (SELECT 1 FROM ${auditTable} WHERE document_id = @requestId AND origin_id = @originId)
                BEGIN
                    INSERT INTO ${auditTable} (
                      document_id, [time], user_id, display_name, [role], action_code,
                      from_node_id, to_node_id, details, origin_id, created_by,
                      receiver, roleProcess, [action], stage_status,
                      curStatusCode, type_document, bpmn_version, created_at, updated_at
                    ) VALUES (
                      @requestId, @itemTime, @auditUserId, @displayName,
                      'NGUOI_XU_LY', 'COMMENT', null, null,
                      @details, @originId, @auditUserId, @auditUserId, 'NGUOI_XU_LY',
                      @itemActionLabel, 'DA_XU_LY', 'COMMENT', @typeDoc, 'QT_MTHC',
                      @itemTime, @itemTime
                    );
                END
              `;

              await this.queryNewDbTx(insertItemQuery, {
                requestId, itemTime, auditUserId: auditUserId || null,
                displayName: item.FullName || 'Unknown',
                originId: originIdMsg, details: item.Value,
                itemActionLabel, typeDoc
              }, transaction);
            }
          }
        } catch (parseErr) {
          logger.warn(`[StreamPassportMigrationModel] Failed to parse ntext2 for requestId=${requestId}: ${parseErr.message}`);
        }
      }
    } catch (err) {
      logger.error(`[StreamPassportMigrationModel] createDefaultAuditForPassport ERROR: ${err.message}`);
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
}

// Helper: wrap string in N'' for nvarchar (only used in template literals)
function N(str) { return str; }

module.exports = StreamPassportMigrationModel;
