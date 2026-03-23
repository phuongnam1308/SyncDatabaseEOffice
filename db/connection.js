const sql = require('mssql');
const { oldDbConfig, newDbConfig } = require('../config/database');
const logger = require('../utils/logger');

class DatabaseConnection {
  constructor() {
    this.oldPool = null;
    this.newPool = null;
  }

  // Kết nối đến database cũ
  async connectOldDb() {
    try {
      if (this.oldPool && this.oldPool.connected) {
        return this.oldPool;
      }

      logger.info('Đang kết nối đến database cũ...');
      this.oldPool = await sql.connect(oldDbConfig);
      logger.info('Kết nối database cũ thành công!');
      return this.oldPool;
    } catch (error) {
      logger.error('Lỗi kết nối database cũ:', error);
      throw error;
    }
  }

  // Kết nối đến database mới
  async connectNewDb() {
    try {
      if (this.newPool && this.newPool.connected) {
        return this.newPool;
      }

      logger.info('Đang kết nối đến database mới...');
      this.newPool = await new sql.ConnectionPool(newDbConfig).connect();
      logger.info('Kết nối database mới thành công!');
      // ensure required sync tables exist after connection is made
      await this.ensureSyncTables();
      return this.newPool;
    } catch (error) {
      logger.error('Lỗi kết nối database mới:', error);
      throw error;
    }
  }

  // Kết nối cả 2 database
  async connectAll() {
    try {
      await this.connectOldDb();
      await this.connectNewDb();
      // logger.info('Kết nối tất cả database thành công!');
    } catch (error) {
      logger.error('Lỗi kết nối database:', error);
      throw error;
    }
  }

  // Đóng kết nối database cũ
  async closeOldDb() {
    try {
      if (this.oldPool) {
        await this.oldPool.close();
        this.oldPool = null;
        logger.info('Đã đóng kết nối database cũ');
      }
    } catch (error) {
      logger.error('Lỗi đóng kết nối database cũ:', error);
    }
  }

  // Đóng kết nối database mới
  async closeNewDb() {
    try {
      if (this.newPool) {
        await this.newPool.close();
        this.newPool = null;
        logger.info('Đã đóng kết nối database mới');
      }
    } catch (error) {
      logger.error('Lỗi đóng kết nối database mới:', error);
    }
  }

  // Đóng tất cả kết nối
  async closeAll() {
    await this.closeOldDb();
    await this.closeNewDb();
    logger.info('Đã đóng tất cả kết nối database');
  }

  // Lấy pool connection cũ
  getOldPool() {
    return this.oldPool;
  }

  // Lấy pool connection mới
  getNewPool() {
    return this.newPool;
  }

  /**
   * Ensure that the sync-related tables are present in the new database.
   * If any table is missing it will be created automatically using the
   * definitions provided by the user (originally intended for the
   * `camunda` database). This method is idempotent and is invoked
   * immediately after opening a connection to the new DB.
   */
  async ensureSyncTables() {
    if (!this.newPool) return;

    // Run a batch of conditional CREATE statements. We deliberately
    // avoid GO separators because the `mssql` driver does not support
    // them; semicolons are sufficient.
    const script = `
  -- make sure schema exists (most likely dbo already exists, but we
  -- include the check for completeness)
  IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'dbo')
    EXEC('CREATE SCHEMA dbo');

  -- sync_models table
  IF NOT EXISTS (
    SELECT 1 FROM sys.tables
    WHERE name = 'sync_models' AND schema_id = SCHEMA_ID('dbo')
  )
  BEGIN
    CREATE TABLE dbo.sync_models (
      id int IDENTITY(1,1) NOT NULL,
      model_name nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
      last_sync_time datetime2 NULL,
      last_sync_id bigint DEFAULT 0 NULL,
      total_synced bigint DEFAULT 0 NULL,
      status nvarchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT 'IDLE' NOT NULL,
      last_run datetime2 NULL,
      active_job_id nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
      last_error nvarchar(MAX) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
      created_at datetime2 DEFAULT sysdatetime() NULL,
      updated_at datetime2 DEFAULT sysdatetime() NULL,
      CONSTRAINT PK__sync_mod__3213E83F2A160226 PRIMARY KEY (id),
      CONSTRAINT UQ__sync_mod__5DD3F6BB2126B955 UNIQUE (model_name)
    );
  END

  -- sync_jobs table
  IF NOT EXISTS (
    SELECT 1 FROM sys.tables
    WHERE name = 'sync_jobs' AND schema_id = SCHEMA_ID('dbo')
  )
  BEGIN
    CREATE TABLE dbo.sync_jobs (
      job_id nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
      model_name nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
      status nvarchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
      started_at datetime2 NOT NULL,
      updated_at datetime2 NOT NULL,
      ended_at datetime2 NULL,
      heartbeat_at datetime2 NULL,
      pause_requested bit DEFAULT 0 NULL,
      is_reset bit DEFAULT 0 NULL,
      batch_size int DEFAULT 10 NULL,
      last_sync_time datetime2 NULL,
      last_sync_id bigint DEFAULT 0 NULL,
      total_to_sync bigint NULL,
      total_processed bigint DEFAULT 0 NULL,
      total_success bigint DEFAULT 0 NULL,
      total_errors bigint DEFAULT 0 NULL,
      error_message nvarchar(MAX) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
      created_at datetime2 DEFAULT sysdatetime() NULL,
      CONSTRAINT PK__sync_job__6E32B6A5630E324C PRIMARY KEY (job_id),
      CONSTRAINT fk_sync_jobs_model FOREIGN KEY (model_name) REFERENCES dbo.sync_models(model_name)
    );

    CREATE NONCLUSTERED INDEX idx_sync_jobs_model_name ON dbo.sync_jobs (model_name ASC)
      WITH (PAD_INDEX = OFF, FILLFACTOR = 100, SORT_IN_TEMPDB = OFF,
          IGNORE_DUP_KEY = OFF, STATISTICS_NORECOMPUTE = OFF,
          ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON);

    CREATE NONCLUSTERED INDEX idx_sync_jobs_status ON dbo.sync_jobs (status ASC)
      WITH (PAD_INDEX = OFF, FILLFACTOR = 100, SORT_IN_TEMPDB = OFF,
          IGNORE_DUP_KEY = OFF, STATISTICS_NORECOMPUTE = OFF,
          ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON);
  END

  -- sync_job_errors table
  IF NOT EXISTS (
    SELECT 1 FROM sys.tables
    WHERE name = 'sync_job_errors' AND schema_id = SCHEMA_ID('dbo')
  )
  BEGIN
    CREATE TABLE dbo.sync_job_errors (
      id int IDENTITY(1,1) NOT NULL,
      job_id nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
      record_id bigint NULL,
      error_message nvarchar(MAX) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
      occurred_at datetime2 DEFAULT sysdatetime() NULL,
      CONSTRAINT PK__sync_job__3213E83FA7707A30 PRIMARY KEY (id),
      CONSTRAINT fk_sync_job_errors_job FOREIGN KEY (job_id) REFERENCES dbo.sync_jobs(job_id)
    );

    CREATE NONCLUSTERED INDEX idx_sync_job_errors_job_id ON dbo.sync_job_errors (job_id ASC)
      WITH (PAD_INDEX = OFF, FILLFACTOR = 100, SORT_IN_TEMPDB = OFF,
          IGNORE_DUP_KEY = OFF, STATISTICS_NORECOMPUTE = OFF,
          ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON);
  END

  -- sync_job_buffers table
  IF NOT EXISTS (
    SELECT 1 FROM sys.tables
    WHERE name = 'sync_job_buffers' AND schema_id = SCHEMA_ID('dbo')
  )
  BEGIN
    CREATE TABLE dbo.sync_job_buffers (
      sync_job_id nvarchar(200) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
      model_name nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
      last_sync_time datetime2 NULL,
      total_count int DEFAULT 0 NOT NULL,
      processing_item int DEFAULT 0 NOT NULL,
      status nvarchar(30) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT 'READY' NOT NULL,
      created_at datetime2 DEFAULT sysdatetime() NOT NULL,
      updated_at datetime2 DEFAULT sysdatetime() NOT NULL,
      CONSTRAINT PK__sync_job__46A76B0394CFDEBA PRIMARY KEY (sync_job_id)
    );
  END

  -- cron_sync_config table
  IF NOT EXISTS (
    SELECT 1 FROM sys.tables
    WHERE name = 'cron_sync_config' AND schema_id = SCHEMA_ID('dbo')
  )
  BEGIN
    CREATE TABLE dbo.cron_sync_config (
      module_name nvarchar(200) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
      cron_time varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL
    );
  END
  `;

    try {
      await this.newPool.request().batch(script);
      logger.info('Verified existence of sync tables (created if missing)');
    } catch (err) {
      logger.error('Failed to ensure sync tables exist:', err);
      // don't rethrow; startup should continue even if this fails
    }
  }
}

module.exports = new DatabaseConnection();