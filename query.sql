-- =============================================================================
-- SCRIPT KHỞI TẠO CÁC BẢNG HỆ THỐNG VÀ CẬP NHẬT SCHEMA CHO TOOL ĐỒNG BỘ
-- Chạy trực tiếp script này trong SQL Server (SSMS, Azure Data Studio, v.v.)
-- =============================================================================

-- 1. Đảm bảo schema dbo tồn tại
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'dbo')
BEGIN
    EXEC('CREATE SCHEMA dbo');
END
GO

-- 2. Tạo bảng cấu hình các model đồng bộ (sync_models)
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
GO

-- 3. Tạo bảng quản lý tiến trình các jobs đồng bộ (sync_jobs)
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
GO

-- 4. Tạo bảng lưu chi tiết lỗi đồng bộ (sync_job_errors)
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
GO

-- 5. Tạo bảng buffer xử lý đồng bộ (sync_job_buffers)
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
GO

-- 6. Tạo bảng lưu cấu hình thiết lập môi trường (sync_settings)
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'sync_settings')
BEGIN
  CREATE TABLE sync_settings (
    setting_key NVARCHAR(100) NOT NULL,
    instance_id NVARCHAR(50) NOT NULL DEFAULT 'default',
    setting_value NVARCHAR(500),
    updated_at DATETIME2 DEFAULT SYSDATETIME(),
    CONSTRAINT PK_sync_settings PRIMARY KEY (setting_key, instance_id)
  );
  
  -- Bật mặc định: Không skip
  INSERT INTO sync_settings (setting_key, instance_id, setting_value) 
  VALUES ('SKIP_PULL_FROM_OLD', 'default', 'false');
END
GO

-- 7. Tạo bảng cấu hình lập lịch đồng bộ (cron_sync_config)
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
GO

-- 8. Tự động thêm cột instance_id vào sync_models và sync_jobs (nếu chưa có)
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'sync_models' AND COLUMN_NAME = 'instance_id')
BEGIN
  ALTER TABLE sync_models ADD instance_id NVARCHAR(50) DEFAULT 'default';
END
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'sync_jobs' AND COLUMN_NAME = 'instance_id')
BEGIN
  ALTER TABLE sync_jobs ADD instance_id NVARCHAR(50) DEFAULT 'default';
END
GO

-- 9. Kiểm tra và cập nhật schema bảng passports (từ tool import_passport)
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'passports' AND COLUMN_NAME = 'borrow_status')
BEGIN
  ALTER TABLE passports ADD borrow_status nvarchar(50) NOT NULL DEFAULT 'NOT_BORROWED';
END
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'passports' AND COLUMN_NAME = 'source_system')
BEGIN
  ALTER TABLE passports ADD source_system nvarchar(50) NULL DEFAULT 'APP';
END
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'passports' AND COLUMN_NAME = 'imported_at')
BEGIN
  ALTER TABLE passports ADD imported_at datetime2 NULL DEFAULT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'passports' AND COLUMN_NAME = 'tb_bak')
BEGIN
  ALTER TABLE passports ADD tb_bak int NULL DEFAULT 1;
END
GO

-- 10. Tạo bảng lưu trạng thái xác thực file copy (sync_auth_state)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'sync_auth_state' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.sync_auth_state (
        id int IDENTITY(1,1) PRIMARY KEY,
        auth_cookies nvarchar(MAX) NOT NULL,
        updated_at datetime2 DEFAULT sysdatetime() NOT NULL
    );
END
GO

-- =============================================================================

-- =============================================================================

-- =============================================================================

-- =============================================================================
-- 11. TẠO TẤT CẢ CÁC BẢNG TRUNG GIAN (STAGING TABLES) KÈM CÁC TRƯỜNG ĐẶC THÙ
-- (Script này chứa đầy đủ danh sách 19 bảng và đảm bảo KHÔNG TRÙNG LẶP CỘT)
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'user_sync')
BEGIN
    CREATE TABLE dbo.[user_sync] (
    [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
    [__sync_time] DATETIME2 NULL,
    [__sync_id_num] BIGINT NULL,
    [ID] BIGINT NOT NULL,
    [source_db] NVARCHAR(255) NULL,
    [MigrateFlg] INT DEFAULT 0,
    [MigrateErrFlg] INT DEFAULT 0,
    [MigrateErrMess] NVARCHAR(MAX) NULL,
        [id_user_del_bak] nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
        [tb_bak] INT DEFAULT 0,
        [contentSignImage] int NULL,
        [paraphSignImage] int NULL,
        [paraphSignTransparentImage] int NULL,
        [contentSignTransparentImage] int NULL,
        [stampSignImage] int NULL,
        [table_backups] nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NULL
    );
    CREATE UNIQUE INDEX [IX_user_sync_ID_Source] ON dbo.[user_sync]([ID], [source_db]);
    PRINT 'Created staging table: dbo.user_sync';
END
ELSE
BEGIN
    PRINT 'Staging table dbo.user_sync already exists.';
END
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'tgd_schedule_sync_staging')
BEGIN
    CREATE TABLE dbo.[tgd_schedule_sync_staging] (
    [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
    [__sync_time] DATETIME2 NULL,
    [__sync_id_num] BIGINT NULL,
    [ID] BIGINT NOT NULL,
    [source_db] NVARCHAR(255) NULL,
    [MigrateFlg] INT DEFAULT 0,
    [MigrateErrFlg] INT DEFAULT 0,
    [MigrateErrMess] NVARCHAR(MAX) NULL,
        [ListName] NVARCHAR(500),
        [ItemID] BIGINT,
        [tp_Created] NVARCHAR(500),
        [tp_Modified] NVARCHAR(500),
        [AuthorName] NVARCHAR(500),
        [AuthorAccount] NVARCHAR(500),
        [AuthorEmail] NVARCHAR(500),
        [EditorName] NVARCHAR(500),
        [EditorAccount] NVARCHAR(500),
        [Title] NVARCHAR(MAX),
        [StartDate] NVARCHAR(500),
        [EndDate] NVARCHAR(500),
        [Location] NVARCHAR(MAX),
        [Description] NVARCHAR(MAX),
        [Organizer] NVARCHAR(500),
        [DocumentID] BIGINT,
        [DocumentTitle] NVARCHAR(MAX),
        [DocumentSubject] NVARCHAR(MAX),
        [LoaiVanBan] NVARCHAR(500),
        [DepartmentId] NVARCHAR(500),
        [DocumentStatus] NVARCHAR(500),
        [DocumentStatusText] NVARCHAR(MAX),
        [DocumentCreatedDate] NVARCHAR(500),
        [DocumentModified] NVARCHAR(500),
        [Content] NVARCHAR(MAX),
        [DonViChuTri] NVARCHAR(1000),
        [SoVanBanDi] NVARCHAR(500),
        [IssuedDate] NVARCHAR(500),
        [Updating] INT,
        [IsNAS] NVARCHAR(50),
        [NAS_MESS] NVARCHAR(MAX),
        [Status] NVARCHAR(255),
        [StatusText] NVARCHAR(MAX),
        [WorkflowId] NVARCHAR(500),
        [Step] NVARCHAR(500),
        [DocumentCreatedBy] NVARCHAR(500),
        [DocumentModifiedBy] NVARCHAR(500),
        [LinkedItemID] BIGINT,
        [DocumentSiteName] NVARCHAR(500),
        [GoiDuAn1] NVARCHAR(MAX),
        [GoiDuAn] NVARCHAR(MAX),
        [GoiDauTu] NVARCHAR(MAX),
        [DonViSoanThao] NVARCHAR(MAX),
        [SoKH] NVARCHAR(500),
        [NgayKyKH] NVARCHAR(500),
        [HubPackageId] NVARCHAR(500),
        [IsHubSendOut] NVARCHAR(50),
        [Name] NVARCHAR(MAX),
        [StampWithKey] NVARCHAR(MAX),
        [ChildId] NVARCHAR(500),
        [IsDaKy] NVARCHAR(50),
        [IsDaIn] NVARCHAR(50),
        [ResourceFormId] NVARCHAR(500),
        [AssignedToText] NVARCHAR(MAX),
        [SPListName] NVARCHAR(500),
        [ApproverByStep] NVARCHAR(MAX),
        [YKien] NVARCHAR(MAX),
        [VBBiThayThe] NVARCHAR(MAX),
        [ThamQuyen] NVARCHAR(500),
        [SoVanBanNum] NVARCHAR(500),
        [Price] NVARCHAR(500),
        [PreviousStep] NVARCHAR(500),
        [ParentId] NVARCHAR(500),
        [NgayDanTau] NVARCHAR(500),
        [LoaiMoc] NVARCHAR(500),
        [LoaiBanHanh] NVARCHAR(500),
        [ReccurencyType] NVARCHAR(500),
        [KyHaiLien] NVARCHAR(500),
        [EndLoop] NVARCHAR(500),
        [DongMoc] NVARCHAR(500),
        [ChenSo] NVARCHAR(500),
        [ActionStatus] NVARCHAR(500),
        [ConvertedDate] NVARCHAR(500),
        [IsConverting] NVARCHAR(50),
        [IsArchived] NVARCHAR(50),
        [TaskId] NVARCHAR(500),
        [Locker] NVARCHAR(500),
        [SubmitDate] NVARCHAR(500),
        [ApprovedDate] NVARCHAR(500),
        [Approver] NVARCHAR(500),
        [IsKyQuyChe] NVARCHAR(50),
        [CBNV] NVARCHAR(MAX),
        [SPListId] NVARCHAR(500)
    );
    CREATE UNIQUE INDEX [IX_tgd_schedule_sync_staging_ID_Source] ON dbo.[tgd_schedule_sync_staging]([ID], [source_db]);
    PRINT 'Created staging table: dbo.tgd_schedule_sync_staging';
END
ELSE
BEGIN
    PRINT 'Staging table dbo.tgd_schedule_sync_staging already exists.';
END
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'task_sync_out')
BEGIN
    CREATE TABLE dbo.[task_sync_out] (
    [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
    [__sync_time] DATETIME2 NULL,
    [__sync_id_num] BIGINT NULL,
    [ID] BIGINT NOT NULL,
    [source_db] NVARCHAR(255) NULL,
    [MigrateFlg] INT DEFAULT 0,
    [MigrateErrFlg] INT DEFAULT 0,
    [MigrateErrMess] NVARCHAR(MAX) NULL,
        [id_task_bak] NVARCHAR(255),
        [code] NVARCHAR(255),
        [name] NVARCHAR(MAX),
        [start_date] DATETIME2,
        [end_date] DATETIME2,
        [bpmn_id] NVARCHAR(255),
        [priority] NVARCHAR(50),
        [reminder_time] INT,
        [topic] NVARCHAR(MAX),
        [note] NVARCHAR(MAX),
        [repetitive_task] BIT,
        [month] INT,
        [repetitive_start] DATETIME2,
        [repetitive_end] DATETIME2,
        [parent] NVARCHAR(255),
        [path] NVARCHAR(MAX),
        [progress] INT,
        [process_status] NVARCHAR(50),
        [status] INT,
        [approval_status] NVARCHAR(50),
        [created_by] NVARCHAR(255),
        [updated_by] NVARCHAR(255),
        [recurring_from_id] INT,
        [type_task] NVARCHAR(50),
        [doc_id] INT,
        [meeting_id] INT,
        [meeting_conclusion_id] INT,
        [week_days] NVARCHAR(255),
        [project_id] INT,
        [type_task_meeting] NVARCHAR(50),
        [template_id] INT,
        [dependent_task_id] INT,
        [is_confidential] BIT,
        [VBId] NVARCHAR(MAX),
        [DepartmentId] NVARCHAR(MAX),
        [ParentId] NVARCHAR(MAX),
        [Title] NVARCHAR(MAX),
        [DanhGia] NVARCHAR(MAX),
        [DeBaoCao] NVARCHAR(MAX),
        [DeBiet] NVARCHAR(MAX),
        [DeThucHien] NVARCHAR(MAX),
        [DuocHuy] NVARCHAR(MAX),
        [DiemChatLuong] NVARCHAR(MAX),
        [DiemThoiGian] NVARCHAR(MAX),
        [DiemDanhGia] NVARCHAR(MAX),
        [StartDate] NVARCHAR(MAX),
        [DueDate] NVARCHAR(MAX),
        [CompletedDate] NVARCHAR(MAX),
        [HoanTatTuDong] NVARCHAR(MAX),
        [HoSoDuThaoId] NVARCHAR(MAX),
        [HoSoDuThaoUrl] NVARCHAR(MAX),
        [HoSoXuLyUrl] NVARCHAR(MAX),
        [Percent] NVARCHAR(MAX),
        [TrangThai] NVARCHAR(MAX),
        [YKienCuaNguoiGiaiQuyet] NVARCHAR(MAX),
        [YKienChiDao] NVARCHAR(MAX),
        [ModuleId] NVARCHAR(MAX),
        [SiteName] NVARCHAR(MAX),
        [ListName] NVARCHAR(MAX),
        [ItemId] NVARCHAR(MAX),
        [Modified] NVARCHAR(MAX),
        [Created] NVARCHAR(MAX),
        [ModifiedBy] NVARCHAR(MAX),
        [CreatedBy] NVARCHAR(MAX),
        [ParentTaskID] NVARCHAR(MAX)
    );
    CREATE UNIQUE INDEX [IX_task_sync_out_ID_Source] ON dbo.[task_sync_out]([ID], [source_db]);
    PRINT 'Created staging table: dbo.task_sync_out';
END
ELSE
BEGIN
    PRINT 'Staging table dbo.task_sync_out already exists.';
END
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'task_sync')
BEGIN
    CREATE TABLE dbo.[task_sync] (
    [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
    [__sync_time] DATETIME2 NULL,
    [__sync_id_num] BIGINT NULL,
    [ID] BIGINT NOT NULL,
    [source_db] NVARCHAR(255) NULL,
    [MigrateFlg] INT DEFAULT 0,
    [MigrateErrFlg] INT DEFAULT 0,
    [MigrateErrMess] NVARCHAR(MAX) NULL,
        [VBId] NVARCHAR(MAX),
        [DepartmentId] NVARCHAR(MAX),
        [ParentId] NVARCHAR(MAX),
        [Title] NVARCHAR(MAX),
        [DanhGia] NVARCHAR(MAX),
        [DeBaoCao] NVARCHAR(MAX),
        [DeBiet] NVARCHAR(MAX),
        [DeThucHien] NVARCHAR(MAX),
        [DuocHuy] NVARCHAR(MAX),
        [DiemChatLuong] NVARCHAR(MAX),
        [DiemThoiGian] NVARCHAR(MAX),
        [DiemDanhGia] NVARCHAR(MAX),
        [StartDate] NVARCHAR(MAX),
        [DueDate] NVARCHAR(MAX),
        [CompletedDate] NVARCHAR(MAX),
        [HoanTatTuDong] NVARCHAR(MAX),
        [HoSoDuThaoId] NVARCHAR(MAX),
        [HoSoDuThaoUrl] NVARCHAR(MAX),
        [HoSoXuLyUrl] NVARCHAR(MAX),
        [Percent] NVARCHAR(MAX),
        [TrangThai] NVARCHAR(MAX),
        [Priority] NVARCHAR(MAX),
        [YKienCuaNguoiGiaiQuyet] NVARCHAR(MAX),
        [YKienChiDao] NVARCHAR(MAX),
        [ModuleId] NVARCHAR(MAX),
        [SiteName] NVARCHAR(MAX),
        [ListName] NVARCHAR(MAX),
        [ItemId] NVARCHAR(MAX),
        [Modified] NVARCHAR(MAX),
        [Created] NVARCHAR(MAX),
        [ModifiedBy] NVARCHAR(MAX),
        [CreatedBy] NVARCHAR(MAX),
        [ParentTaskID] NVARCHAR(MAX),
        [id_task_bak] NVARCHAR(MAX),
        [code] NVARCHAR(255),
        [name] NVARCHAR(MAX),
        [start_date] DATETIME2,
        [end_date] DATETIME2,
        [bpmn_id] NVARCHAR(255),
        [reminder_time] INT,
        [topic] NVARCHAR(MAX),
        [note] NVARCHAR(MAX),
        [repetitive_task] BIT,
        [month] INT,
        [repetitive_start] DATETIME2,
        [repetitive_end] DATETIME2,
        [parent] NVARCHAR(255),
        [path] NVARCHAR(MAX),
        [progress] INT,
        [process_status] NVARCHAR(50),
        [status] INT,
        [approval_status] NVARCHAR(50),
        [created_by] NVARCHAR(255),
        [updated_by] NVARCHAR(255),
        [recurring_from_id] INT,
        [type_task] NVARCHAR(50),
        [doc_id] INT,
        [meeting_id] INT,
        [meeting_conclusion_id] INT,
        [week_days] NVARCHAR(255),
        [project_id] INT,
        [type_task_meeting] NVARCHAR(50),
        [template_id] INT,
        [dependent_task_id] INT,
        [is_confidential] BIT
    );
    CREATE UNIQUE INDEX [IX_task_sync_ID_Source] ON dbo.[task_sync]([ID], [source_db]);
    PRINT 'Created staging table: dbo.task_sync';
END
ELSE
BEGIN
    PRINT 'Staging table dbo.task_sync already exists.';
END
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'social_resource_sync')
BEGIN
    CREATE TABLE dbo.[social_resource_sync] (
    [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
    [__sync_time] DATETIME2 NULL,
    [__sync_id_num] BIGINT NULL,
    [ID] BIGINT NOT NULL,
    [source_db] NVARCHAR(255) NULL,
    [MigrateFlg] INT DEFAULT 0,
    [MigrateErrFlg] INT DEFAULT 0,
    [MigrateErrMess] NVARCHAR(MAX) NULL
    );
    CREATE UNIQUE INDEX [IX_social_resource_sync_ID_Source] ON dbo.[social_resource_sync]([ID], [source_db]);
    PRINT 'Created staging table: dbo.social_resource_sync';
END
ELSE
BEGIN
    PRINT 'Staging table dbo.social_resource_sync already exists.';
END
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'passport_borrow_request_sync_staging')
BEGIN
    CREATE TABLE dbo.[passport_borrow_request_sync_staging] (
    [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
    [__sync_time] DATETIME2 NULL,
    [__sync_id_num] BIGINT NULL,
    [ID] BIGINT NOT NULL,
    [source_db] NVARCHAR(255) NULL,
    [MigrateFlg] INT DEFAULT 0,
    [MigrateErrFlg] INT DEFAULT 0,
    [MigrateErrMess] NVARCHAR(MAX) NULL,
        [tp_Created] NVARCHAR(500),
        [tp_Modified] NVARCHAR(500),
        [tp_Author] INT,
        [tp_Editor] INT,
        [tp_IsCurrent] BIT,
        [tp_ListId] NVARCHAR(255),
        [tp_Title] NVARCHAR(MAX),
        [AuthorName] NVARCHAR(500),
        [AuthorFullName] NVARCHAR(500),
        [AuthorAccount] NVARCHAR(500),
        [AuthorEmail] NVARCHAR(500),
        [EditorName] NVARCHAR(500),
        [EditorAccount] NVARCHAR(500),
        [nvarchar1] NVARCHAR(MAX),
        [nvarchar2] NVARCHAR(MAX),
        [nvarchar3] NVARCHAR(MAX),
        [nvarchar4] NVARCHAR(MAX),
        [nvarchar5] NVARCHAR(MAX),
        [datetime1] DATETIME2,
        [datetime2] DATETIME2,
        [datetime3] DATETIME2,
        [datetime4] DATETIME2,
        [datetime5] DATETIME2,
        [datetime6] DATETIME2,
        [datetime7] DATETIME2,
        [datetime8] DATETIME2,
        [ntext1] NVARCHAR(MAX),
        [ntext2] NVARCHAR(MAX),
        [float1] FLOAT,
        [float2] FLOAT,
        [float3] FLOAT,
        [int1] INT,
        [int2] INT,
        [tb_bak] INT
    );
    CREATE UNIQUE INDEX [IX_passport_borrow_request_sync_staging_ID_Source] ON dbo.[passport_borrow_request_sync_staging]([ID], [source_db]);
    PRINT 'Created staging table: dbo.passport_borrow_request_sync_staging';
END
ELSE
BEGIN
    PRINT 'Staging table dbo.passport_borrow_request_sync_staging already exists.';
END
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'outgoing_documents_sync')
BEGIN
    CREATE TABLE dbo.[outgoing_documents_sync] (
    [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
    [__sync_time] DATETIME2 NULL,
    [__sync_id_num] BIGINT NULL,
    [ID] BIGINT NOT NULL,
    [source_db] NVARCHAR(255) NULL,
    [MigrateFlg] INT DEFAULT 0,
    [MigrateErrFlg] INT DEFAULT 0,
    [MigrateErrMess] NVARCHAR(MAX) NULL
    );
    CREATE UNIQUE INDEX [IX_outgoing_documents_sync_ID_Source] ON dbo.[outgoing_documents_sync]([ID], [source_db]);
    PRINT 'Created staging table: dbo.outgoing_documents_sync';
END
ELSE
BEGIN
    PRINT 'Staging table dbo.outgoing_documents_sync already exists.';
END
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'news_aspx_pages_temp')
BEGIN
    CREATE TABLE dbo.[news_aspx_pages_temp] (
    [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
    [__sync_time] DATETIME2 NULL,
    [__sync_id_num] BIGINT NULL,
    [ID] BIGINT NOT NULL,
    [source_db] NVARCHAR(255) NULL,
    [MigrateFlg] INT DEFAULT 0,
    [MigrateErrFlg] INT DEFAULT 0,
    [MigrateErrMess] NVARCHAR(MAX) NULL
    );
    CREATE UNIQUE INDEX [IX_news_aspx_pages_temp_ID_Source] ON dbo.[news_aspx_pages_temp]([ID], [source_db]);
    PRINT 'Created staging table: dbo.news_aspx_pages_temp';
END
ELSE
BEGIN
    PRINT 'Staging table dbo.news_aspx_pages_temp already exists.';
END
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'news_aspx_new_sync')
BEGIN
    CREATE TABLE dbo.[news_aspx_new_sync] (
    [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
    [__sync_time] DATETIME2 NULL,
    [__sync_id_num] BIGINT NULL,
    [ID] BIGINT NOT NULL,
    [source_db] NVARCHAR(255) NULL,
    [MigrateFlg] INT DEFAULT 0,
    [MigrateErrFlg] INT DEFAULT 0,
    [MigrateErrMess] NVARCHAR(MAX) NULL
    );
    CREATE UNIQUE INDEX [IX_news_aspx_new_sync_ID_Source] ON dbo.[news_aspx_new_sync]([ID], [source_db]);
    PRINT 'Created staging table: dbo.news_aspx_new_sync';
END
ELSE
BEGIN
    PRINT 'Staging table dbo.news_aspx_new_sync already exists.';
END
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'file_new_sync')
BEGIN
    CREATE TABLE dbo.[file_new_sync] (
    [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
    [__sync_time] DATETIME2 NULL,
    [__sync_id_num] BIGINT NULL,
    [ID] BIGINT NOT NULL,
    [source_db] NVARCHAR(255) NULL,
    [MigrateFlg] INT DEFAULT 0,
    [MigrateErrFlg] INT DEFAULT 0,
    [MigrateErrMess] NVARCHAR(MAX) NULL
    );
    CREATE UNIQUE INDEX [IX_file_new_sync_ID_Source] ON dbo.[file_new_sync]([ID], [source_db]);
    PRINT 'Created staging table: dbo.file_new_sync';
END
ELSE
BEGIN
    PRINT 'Staging table dbo.file_new_sync already exists.';
END
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'html_file_sync_staging')
BEGIN
    CREATE TABLE dbo.[html_file_sync_staging] (
    [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
    [__sync_time] DATETIME2 NULL,
    [__sync_id_num] BIGINT NULL,
    [ID] BIGINT NOT NULL,
    [source_db] NVARCHAR(255) NULL,
    [MigrateFlg] INT DEFAULT 0,
    [MigrateErrFlg] INT DEFAULT 0,
    [MigrateErrMess] NVARCHAR(MAX) NULL
    );
    CREATE UNIQUE INDEX [IX_html_file_sync_staging_ID_Source] ON dbo.[html_file_sync_staging]([ID], [source_db]);
    PRINT 'Created staging table: dbo.html_file_sync_staging';
END
ELSE
BEGIN
    PRINT 'Staging table dbo.html_file_sync_staging already exists.';
END
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'mission_schedule_sync_staging')
BEGIN
    CREATE TABLE dbo.[mission_schedule_sync_staging] (
    [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
    [__sync_time] DATETIME2 NULL,
    [__sync_id_num] BIGINT NULL,
    [ID] BIGINT NOT NULL,
    [source_db] NVARCHAR(255) NULL,
    [MigrateFlg] INT DEFAULT 0,
    [MigrateErrFlg] INT DEFAULT 0,
    [MigrateErrMess] NVARCHAR(MAX) NULL,
        [ListName] NVARCHAR(MAX),
        [ItemID] BIGINT,
        [CreatedDate] NVARCHAR(500),
        [ModifiedDate] NVARCHAR(500),
        [tp_Created] NVARCHAR(500),
        [tp_Modified] NVARCHAR(500),
        [AuthorName] NVARCHAR(500),
        [AuthorAccount] NVARCHAR(500),
        [AuthorEmail] NVARCHAR(500),
        [EditorName] NVARCHAR(500),
        [EditorAccount] NVARCHAR(500),
        [Title] NVARCHAR(MAX),
        [StartDate] NVARCHAR(500),
        [EndDate] NVARCHAR(500),
        [Location] NVARCHAR(MAX),
        [Description] NVARCHAR(MAX),
        [Organizer] NVARCHAR(MAX),
        [DocumentID] BIGINT,
        [DocumentTitle] NVARCHAR(MAX),
        [DocumentSubject] NVARCHAR(MAX),
        [LoaiVanBan] NVARCHAR(MAX),
        [DepartmentId] NVARCHAR(500),
        [DocumentStatus] NVARCHAR(500),
        [DocumentStatusText] NVARCHAR(MAX),
        [DocumentWorkflowId] NVARCHAR(500),
        [DocumentApprover] NVARCHAR(MAX),
        [DocumentApprovedDate] NVARCHAR(500),
        [DocumentCreatedDate] NVARCHAR(500),
        [DocumentCreatedBy] NVARCHAR(500),
        [DocumentModified] NVARCHAR(500),
        [DocumentModifiedBy] NVARCHAR(500),
        [LinkedItemID] BIGINT,
        [SPListId] NVARCHAR(500),
        [DocumentSubmitDate] NVARCHAR(500),
        [DocumentStep] NVARCHAR(500),
        [DocumentDocumentId] NVARCHAR(MAX),
        [DocumentTitle2] NVARCHAR(MAX),
        [DocumentUpdating] NVARCHAR(500),
        [Locker] NVARCHAR(500),
        [TaskId] NVARCHAR(500),
        [IsArchived] BIT,
        [IsConverting] BIT,
        [ConvertedDate] NVARCHAR(500),
        [ActionStatus] NVARCHAR(500),
        [CBNV] NVARCHAR(MAX),
        [Content] NVARCHAR(MAX),
        [ChenSo] BIT,
        [DongMoc] BIT,
        [EndLoop] BIT,
        [IsKyQuyChe] BIT,
        [IssuedDate] NVARCHAR(500),
        [KyHaiLien] BIT,
        [ReccurencyType] NVARCHAR(500),
        [LoaiBanHanh] NVARCHAR(500),
        [LoaiMoc] NVARCHAR(500),
        [NgayDanTau] NVARCHAR(500),
        [ParentId] NVARCHAR(500),
        [PreviousStep] INT,
        [Price] DECIMAL(18,2),
        [SoVanBanDi] NVARCHAR(MAX),
        [SoVanBanNum] NVARCHAR(500),
        [ThamQuyen] NVARCHAR(MAX),
        [VBBiThayThe] NVARCHAR(MAX),
        [YKien] NVARCHAR(MAX),
        [ApproverByStep] NVARCHAR(MAX),
        [SPListName] NVARCHAR(500),
        [AssignedToText] NVARCHAR(MAX),
        [ResourceFormId] NVARCHAR(500),
        [DocumentSiteName] NVARCHAR(MAX),
        [IsDaIn] BIT,
        [IsDaKy] BIT,
        [ChildId] NVARCHAR(500),
        [StampWithKey] NVARCHAR(MAX),
        [Name] NVARCHAR(MAX),
        [IsHubSendOut] BIT,
        [HubPackageId] NVARCHAR(500),
        [GoiDauTu] NVARCHAR(MAX),
        [GoiDuAn] NVARCHAR(MAX),
        [DonViChuTri] NVARCHAR(MAX),
        [NgayKyKH] NVARCHAR(500),
        [SoKH] NVARCHAR(500),
        [DonViSoanThao] NVARCHAR(MAX),
        [GoiDuAn1] NVARCHAR(MAX),
        [IsNAS] BIT,
        [NAS_MESS] NVARCHAR(MAX)
    );
    CREATE UNIQUE INDEX [IX_mission_schedule_sync_staging_ID_Source] ON dbo.[mission_schedule_sync_staging]([ID], [source_db]);
    PRINT 'Created staging table: dbo.mission_schedule_sync_staging';
END
ELSE
BEGIN
    PRINT 'Staging table dbo.mission_schedule_sync_staging already exists.';
END
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'meeting_sync_staging')
BEGIN
    CREATE TABLE dbo.[meeting_sync_staging] (
    [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
    [__sync_time] DATETIME2 NULL,
    [__sync_id_num] BIGINT NULL,
    [ID] BIGINT NOT NULL,
    [source_db] NVARCHAR(255) NULL,
    [MigrateFlg] INT DEFAULT 0,
    [MigrateErrFlg] INT DEFAULT 0,
    [MigrateErrMess] NVARCHAR(MAX) NULL
    );
    CREATE UNIQUE INDEX [IX_meeting_sync_staging_ID_Source] ON dbo.[meeting_sync_staging]([ID], [source_db]);
    PRINT 'Created staging table: dbo.meeting_sync_staging';
END
ELSE
BEGIN
    PRINT 'Staging table dbo.meeting_sync_staging already exists.';
END
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'incoming_documents_sync')
BEGIN
    CREATE TABLE dbo.[incoming_documents_sync] (
    [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
    [__sync_time] DATETIME2 NULL,
    [__sync_id_num] BIGINT NULL,
    [ID] BIGINT NOT NULL,
    [source_db] NVARCHAR(255) NULL,
    [MigrateFlg] INT DEFAULT 0,
    [MigrateErrFlg] INT DEFAULT 0,
    [MigrateErrMess] NVARCHAR(MAX) NULL
    );
    CREATE UNIQUE INDEX [IX_incoming_documents_sync_ID_Source] ON dbo.[incoming_documents_sync]([ID], [source_db]);
    PRINT 'Created staging table: dbo.incoming_documents_sync';
END
ELSE
BEGIN
    PRINT 'Staging table dbo.incoming_documents_sync already exists.';
END
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'event_sync_staging')
BEGIN
    CREATE TABLE dbo.[event_sync_staging] (
    [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
    [__sync_time] DATETIME2 NULL,
    [__sync_id_num] BIGINT NULL,
    [ID] BIGINT NOT NULL,
    [source_db] NVARCHAR(255) NULL,
    [MigrateFlg] INT DEFAULT 0,
    [MigrateErrFlg] INT DEFAULT 0,
    [MigrateErrMess] NVARCHAR(MAX) NULL,
        [ListName] NVARCHAR(500),
        [tp_Created] NVARCHAR(500),
        [tp_Modified] NVARCHAR(500),
        [AuthorName] NVARCHAR(500),
        [AuthorAccount] NVARCHAR(500),
        [AuthorEmail] NVARCHAR(500),
        [EditorName] NVARCHAR(500),
        [EditorAccount] NVARCHAR(500),
        [Title] NVARCHAR(MAX),
        [StartDate] NVARCHAR(500),
        [EndDate] NVARCHAR(500),
        [Location] NVARCHAR(MAX),
        [Description] NVARCHAR(MAX),
        [Organizer] NVARCHAR(500),
        [CreatedDate] NVARCHAR(500),
        [ModifiedDate] NVARCHAR(500),
        [DocumentID] BIGINT,
        [DocumentTitle] NVARCHAR(MAX),
        [DocumentSubject] NVARCHAR(MAX),
        [LoaiVanBan] NVARCHAR(500),
        [DepartmentId] NVARCHAR(500),
        [DocumentStatus] NVARCHAR(500),
        [DocumentStatusText] NVARCHAR(MAX),
        [DocumentWorkflowId] NVARCHAR(500),
        [DocumentApprover] NVARCHAR(500),
        [DocumentApprovedDate] NVARCHAR(500),
        [DocumentSubmitDate] NVARCHAR(500),
        [DocumentStep] NVARCHAR(500),
        [DocumentDocumentId] NVARCHAR(500),
        [DocumentUpdating] NVARCHAR(500),
        [DocumentCreatedDate] NVARCHAR(500),
        [DocumentCreatedBy] NVARCHAR(500),
        [DocumentModified] NVARCHAR(500),
        [DocumentModifiedBy] NVARCHAR(500),
        [LinkedItemID] NVARCHAR(500),
        [DocumentSiteName] NVARCHAR(500),
        [Content] NVARCHAR(MAX),
        [DonViChuTri] NVARCHAR(1000),
        [SoVanBanDi] NVARCHAR(500),
        [IssuedDate] NVARCHAR(500),
        [IsNAS] BIT,
        [NAS_MESS] NVARCHAR(MAX),
        [SoKH] NVARCHAR(500),
        [DonViSoanThao] NVARCHAR(1000),
        [NgayKyKH] NVARCHAR(500),
        [GoiDuAn] NVARCHAR(MAX),
        [GoiDuAn1] NVARCHAR(MAX),
        [GoiDauTu] NVARCHAR(MAX),
        [HubPackageId] NVARCHAR(500),
        [IsHubSendOut] BIT,
        [ChildId] NVARCHAR(500),
        [IsDaKy] BIT,
        [IsDaIn] BIT,
        [StampWithKey] NVARCHAR(500),
        [Locker] NVARCHAR(500),
        [TaskId] NVARCHAR(500),
        [CBNV] NVARCHAR(1000),
        [ChenSo] NVARCHAR(500),
        [DongMoc] NVARCHAR(500),
        [IsArchived] BIT,
        [IsConverting] BIT,
        [ConvertedDate] NVARCHAR(500),
        [ActionStatus] NVARCHAR(500),
        [EndLoop] BIT,
        [IsKyQuyChe] BIT,
        [KyHaiLien] BIT,
        [ReccurencyType] NVARCHAR(500),
        [LoaiBanHanh] NVARCHAR(500),
        [LoaiMoc] NVARCHAR(500),
        [NgayDanTau] NVARCHAR(500),
        [ParentId] NVARCHAR(500),
        [PreviousStep] NVARCHAR(500),
        [Price] NVARCHAR(500),
        [SoVanBanNum] NVARCHAR(500),
        [ThamQuyen] NVARCHAR(MAX),
        [VBBiThayThe] NVARCHAR(MAX),
        [YKien] NVARCHAR(MAX),
        [SPListId] NVARCHAR(500),
        [SPListName] NVARCHAR(500),
        [ResourceFormId] NVARCHAR(500),
        [AssignedToText] NVARCHAR(MAX),
        [ApproverByStep] NVARCHAR(MAX),
        [Name] NVARCHAR(MAX)
    );
    CREATE UNIQUE INDEX [IX_event_sync_staging_ID_Source] ON dbo.[event_sync_staging]([ID], [source_db]);
    PRINT 'Created staging table: dbo.event_sync_staging';
END
ELSE
BEGIN
    PRINT 'Staging table dbo.event_sync_staging already exists.';
END
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'car_booking_sync_staging')
BEGIN
    CREATE TABLE dbo.[car_booking_sync_staging] (
    [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
    [__sync_time] DATETIME2 NULL,
    [__sync_id_num] BIGINT NULL,
    [ID] BIGINT NOT NULL,
    [source_db] NVARCHAR(255) NULL,
    [MigrateFlg] INT DEFAULT 0,
    [MigrateErrFlg] INT DEFAULT 0,
    [MigrateErrMess] NVARCHAR(MAX) NULL,
        [ListName] NVARCHAR(MAX),
        [ItemID] BIGINT,
        [CreatedDate] NVARCHAR(500),
        [ModifiedDate] NVARCHAR(500),
        [tp_Created] NVARCHAR(500),
        [tp_Modified] NVARCHAR(500),
        [AuthorName] NVARCHAR(500),
        [AuthorAccount] NVARCHAR(500),
        [AuthorEmail] NVARCHAR(500),
        [EditorName] NVARCHAR(500),
        [EditorAccount] NVARCHAR(500),
        [Title] NVARCHAR(MAX),
        [StartDate] NVARCHAR(500),
        [EndDate] NVARCHAR(500),
        [Location] NVARCHAR(MAX),
        [Description] NVARCHAR(MAX),
        [Organizer] NVARCHAR(MAX),
        [DocumentID] BIGINT,
        [DocumentTitle] NVARCHAR(MAX),
        [DocumentSubject] NVARCHAR(MAX),
        [LoaiVanBan] NVARCHAR(MAX),
        [DepartmentId] NVARCHAR(500),
        [DocumentStatus] NVARCHAR(500),
        [DocumentStatusText] NVARCHAR(MAX),
        [WorkflowId] NVARCHAR(500),
        [Approver] NVARCHAR(MAX),
        [ApprovedDate] NVARCHAR(500),
        [DocumentCreatedDate] NVARCHAR(500),
        [DocumentCreatedBy] NVARCHAR(500),
        [DocumentModified] NVARCHAR(500),
        [DocumentModifiedBy] NVARCHAR(500),
        [LinkedItemID] BIGINT,
        [SPListId] NVARCHAR(500),
        [SubmitDate] NVARCHAR(500),
        [Step] NVARCHAR(500),
        [DocumentTitle2] NVARCHAR(MAX),
        [Updating] INT,
        [Locker] NVARCHAR(500),
        [TaskId] NVARCHAR(500),
        [IsArchived] INT,
        [IsConverting] INT,
        [ConvertedDate] NVARCHAR(500),
        [ActionStatus] NVARCHAR(500),
        [CBNV] NVARCHAR(MAX),
        [Content] NVARCHAR(MAX),
        [ChenSo] INT,
        [DongMoc] INT,
        [EndLoop] INT,
        [IsKyQuyChe] INT,
        [IssuedDate] NVARCHAR(500),
        [KyHaiLien] INT,
        [ReccurencyType] NVARCHAR(500),
        [LoaiBanHanh] NVARCHAR(500),
        [LoaiMoc] NVARCHAR(500),
        [NgayDanTau] NVARCHAR(500),
        [ParentId] NVARCHAR(500),
        [PreviousStep] INT,
        [Price] DECIMAL(18,2),
        [SoVanBanDi] NVARCHAR(MAX),
        [SoVanBanNum] NVARCHAR(500),
        [ThamQuyen] NVARCHAR(MAX),
        [VBBiThayThe] NVARCHAR(MAX),
        [YKien] NVARCHAR(MAX),
        [ApproverByStep] NVARCHAR(MAX),
        [SPListName] NVARCHAR(500),
        [AssignedToText] NVARCHAR(MAX),
        [ResourceFormId] NVARCHAR(500),
        [DocumentSiteName] NVARCHAR(MAX),
        [IsDaIn] INT,
        [IsDaKy] INT,
        [ChildId] NVARCHAR(500),
        [StampWithKey] NVARCHAR(MAX),
        [Name] NVARCHAR(MAX),
        [IsHubSendOut] INT,
        [HubPackageId] NVARCHAR(500),
        [GoiDauTu] NVARCHAR(MAX),
        [GoiDuAn] NVARCHAR(MAX),
        [DonViChuTri] NVARCHAR(MAX),
        [NgayKyKH] NVARCHAR(500),
        [SoKH] NVARCHAR(500),
        [DonViSoanThao] NVARCHAR(MAX),
        [GoiDuAn1] NVARCHAR(MAX),
        [IsNAS] INT,
        [NAS_MESS] NVARCHAR(MAX),
        [DepartmentName] NVARCHAR(MAX)
    );
    CREATE UNIQUE INDEX [IX_car_booking_sync_staging_ID_Source] ON dbo.[car_booking_sync_staging]([ID], [source_db]);
    PRINT 'Created staging table: dbo.car_booking_sync_staging';
END
ELSE
BEGIN
    PRINT 'Staging table dbo.car_booking_sync_staging already exists.';
END
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'department_sync')
BEGIN
    CREATE TABLE dbo.[department_sync] (
    [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
    [__sync_time] DATETIME2 NULL,
    [__sync_id_num] BIGINT NULL,
    [ID] BIGINT NOT NULL,
    [source_db] NVARCHAR(255) NULL,
    [MigrateFlg] INT DEFAULT 0,
    [MigrateErrFlg] INT DEFAULT 0,
    [MigrateErrMess] NVARCHAR(MAX) NULL
    );
    CREATE UNIQUE INDEX [IX_department_sync_ID_Source] ON dbo.[department_sync]([ID], [source_db]);
    PRINT 'Created staging table: dbo.department_sync';
END
ELSE
BEGIN
    PRINT 'Staging table dbo.department_sync already exists.';
END
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'draft_document_sync_staging')
BEGIN
    CREATE TABLE dbo.[draft_document_sync_staging] (
    [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
    [__sync_time] DATETIME2 NULL,
    [__sync_id_num] BIGINT NULL,
    [ID] BIGINT NOT NULL,
    [source_db] NVARCHAR(255) NULL,
    [MigrateFlg] INT DEFAULT 0,
    [MigrateErrFlg] INT DEFAULT 0,
    [MigrateErrMess] NVARCHAR(MAX) NULL
    );
    CREATE UNIQUE INDEX [IX_draft_document_sync_staging_ID_Source] ON dbo.[draft_document_sync_staging]([ID], [source_db]);
    PRINT 'Created staging table: dbo.draft_document_sync_staging';
END
ELSE
BEGIN
    PRINT 'Staging table dbo.draft_document_sync_staging already exists.';
END
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'unit_draft_sync_staging')
BEGIN
    CREATE TABLE dbo.[unit_draft_sync_staging] (
    [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
    [__sync_time] DATETIME2 NULL,
    [__sync_id_num] BIGINT NULL,
    [ID] BIGINT NOT NULL,
    [source_db] NVARCHAR(255) NULL,
    [MigrateFlg] INT DEFAULT 0,
    [MigrateErrFlg] INT DEFAULT 0,
    [MigrateErrMess] NVARCHAR(MAX) NULL
    );
    CREATE UNIQUE INDEX [IX_unit_draft_sync_staging_ID_Source] ON dbo.[unit_draft_sync_staging]([ID], [source_db]);
    PRINT 'Created staging table: dbo.unit_draft_sync_staging';
END
ELSE
BEGIN
    PRINT 'Staging table dbo.unit_draft_sync_staging already exists.';
END
GO
