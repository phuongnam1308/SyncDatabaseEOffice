-- ====================================================================================
-- SQL FIX: Khôi phục các bảng staging bị lỗi và thêm cấu hình cron cho các model
-- ====================================================================================
-- Chạy lệnh này để khắc phục:
-- 1. Sửa lỗi index của meeting_sync_staging
-- 2. Tạo lại event_sync_staging
-- 3. Tạo task_sync_staging cho công việc đến (van-ban-den)
-- 4. Tạo task_outgoing_sync_staging cho công việc đi (van-ban-di)
-- 5. Cấu hình cron scheduler cho các model đó

-- ====================================================================================
-- PHẦN 1: SỬA LỖI meeting_sync_staging
-- ====================================================================================
PRINT '========== FIXING meeting_sync_staging ============';

-- Step 1: Xóa index cũ nếu có tên sai
IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE
        name LIKE 'IX_meeting_sync_staging%'
) BEGIN DECLARE @indexName NVARCHAR (255);

DECLARE @sqlDrop NVARCHAR(MAX);

    DECLARE index_cursor CURSOR FOR
    SELECT name FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.meeting_sync_staging')
    AND name LIKE 'IX_meeting_sync_staging%'
    AND name NOT IN ('IX_meeting_sync_staging_ID_Source');

    OPEN index_cursor;
    FETCH NEXT FROM index_cursor INTO @indexName;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @sqlDrop = 'DROP INDEX [' + @indexName + '] ON dbo.meeting_sync_staging';
        EXEC sp_executesql @sqlDrop;
        PRINT '  ✓ Dropped old index: ' + @indexName;
        FETCH NEXT FROM index_cursor INTO @indexName;
    END

CLOSE index_cursor;

DEALLOCATE index_cursor;

END

-- Step 2: Xóa bảng nếu tồn tại để tạo lại từ đầu (TÙYHỌN - chỉ làm khi cần reset)
-- Bỏ comment nếu muốn reset hoàn toàn
-- DROP TABLE IF EXISTS dbo.meeting_sync_staging;

-- Step 3: Tạo lại bảng nếu chưa tồn tại hoặc sửa index nếu đã tồn tại


IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'meeting_sync_staging')
BEGIN
    CREATE TABLE dbo.[meeting_sync_staging] (
        [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
        [__sync_time] DATETIME2 NULL,
        [__sync_id_num] BIGINT NULL,

        [ID] BIGINT NOT NULL,
        [TieuDe] NVARCHAR(1000) NULL,
        [BatDau] DATETIME NULL,
        [KetThuc] DATETIME NULL,
        [DiaDiem] NVARCHAR(1000) NULL,
        [LoaiHop] NVARCHAR(500) NULL,
        [NoiDung] NVARCHAR(MAX) NULL,
        [ThoiLuongGiay] INT NULL,
        [ChuTri] NVARCHAR(500) NULL,
        [ThuKy] NVARCHAR(500) NULL,
        [tp_Created] DATETIME NULL,
        [tp_Modified] DATETIME NULL,
        [tp_Version] INT NULL,

        [source_db] NVARCHAR(255) NULL,
        [MigrateFlg] INT DEFAULT 0 NULL,
        [MigrateErrFlg] INT DEFAULT 0 NULL,
        [MigrateErrMess] NVARCHAR(MAX) NULL
    );

-- Tạo index chính
CREATE UNIQUE INDEX [IX_meeting_sync_staging_ID_Source] ON dbo.[meeting_sync_staging]([ID], [source_db]);

PRINT '  ✓ Created table meeting_sync_staging with index IX_meeting_sync_staging_ID_Source';

END
ELSE
BEGIN
    -- Đảm bảo các cột cần thiết tồn tại
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'meeting_sync_staging' AND COLUMN_NAME = 'source_db')
    BEGIN
        ALTER TABLE dbo.meeting_sync_staging ADD [source_db] NVARCHAR(255) NULL;

PRINT ' ✓ Added column source_db';


END

    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'meeting_sync_staging' AND COLUMN_NAME = 'MigrateFlg')
    BEGIN
        ALTER TABLE dbo.meeting_sync_staging ADD [MigrateFlg] INT DEFAULT 0 NOT NULL;

PRINT ' ✓ Added column MigrateFlg';


END

    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'meeting_sync_staging' AND COLUMN_NAME = 'MigrateErrFlg')
    BEGIN
        ALTER TABLE dbo.meeting_sync_staging ADD [MigrateErrFlg] INT DEFAULT 0 NOT NULL;

PRINT ' ✓ Added column MigrateErrFlg';

END

-- Xóa duplicate keys trước khi tạo unique index
-- Giữ lại record đầu tiên của mỗi (ID, source_db) combination
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_meeting_sync_staging_ID_Source' AND object_id = OBJECT_ID('dbo.meeting_sync_staging'))
    BEGIN
        -- Xóa duplicates
        DELETE FROM dbo.meeting_sync_staging
        WHERE SY_SyncId NOT IN (
            SELECT MIN(SY_SyncId)
            FROM dbo.meeting_sync_staging
            GROUP BY [ID], [source_db]
        );

PRINT ' ✓ Removed duplicate records';

-- Tạo unique index
CREATE UNIQUE INDEX [IX_meeting_sync_staging_ID_Source] ON dbo.[meeting_sync_staging]([ID], [source_db]);

PRINT ' ✓ Created index IX_meeting_sync_staging_ID_Source';

END

PRINT '  ✓ Table meeting_sync_staging already exists and is properly configured';

END

-- ====================================================================================
-- PHẦN 2: TẠO/SỬA event_sync_staging
-- ====================================================================================
PRINT '========== FIXING event_sync_staging ============';

-- Tạo bảng staging cho sự kiện


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

-- Tạo index chính
CREATE UNIQUE INDEX [IX_event_sync_staging_ID_Source] ON dbo.[event_sync_staging]([ID], [source_db]);

PRINT ' ✓ Created table event_sync_staging';

END ELSE BEGIN PRINT ' ✓ Table event_sync_staging already exists';

-- Đảm bảo source_db column tồn tại trước khi tạo index
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'event_sync_staging' AND COLUMN_NAME = 'source_db')
    BEGIN
        ALTER TABLE dbo.event_sync_staging ADD [source_db] NVARCHAR(255) NULL;

PRINT ' ✓ Added column source_db to event_sync_staging';

END

-- Đảm bảo các columns tracking tồn tại
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'event_sync_staging' AND COLUMN_NAME = 'MigrateFlg')
    BEGIN
        ALTER TABLE dbo.event_sync_staging ADD [MigrateFlg] INT DEFAULT 0;

PRINT ' ✓ Added column MigrateFlg';


END

    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'event_sync_staging' AND COLUMN_NAME = 'MigrateErrFlg')
    BEGIN
        ALTER TABLE dbo.event_sync_staging ADD [MigrateErrFlg] INT DEFAULT 0;

PRINT ' ✓ Added column MigrateErrFlg';

END

-- Thêm delay nhỏ để đảm bảo columns được thêm
WAITFOR DELAY '00:00:00.500';

-- Xóa duplicate keys trước khi tạo unique index
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_event_sync_staging_ID_Source' AND object_id = OBJECT_ID('dbo.event_sync_staging'))
    BEGIN
        -- Xóa duplicates nếu có
        DELETE FROM dbo.event_sync_staging
        WHERE SY_SyncId NOT IN (
            SELECT MIN(SY_SyncId)
            FROM dbo.event_sync_staging
            GROUP BY [ID], ISNULL([source_db], '')
        );

PRINT ' ✓ Removed duplicate records from event_sync_staging';

-- Tạo unique index
CREATE UNIQUE INDEX [IX_event_sync_staging_ID_Source] ON dbo.[event_sync_staging]([ID], [source_db]);

PRINT ' ✓ Created index IX_event_sync_staging_ID_Source';

END ELSE BEGIN PRINT '  ✓ Index IX_event_sync_staging_ID_Source already exists';

END END

-- ====================================================================================
-- PHẦN 3: TẠO staging table cho Task sync (công việc đến - van-ban-den)
-- ====================================================================================
PRINT '========== CREATING task_sync_staging (công việc đến) ============';


IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'task_sync_staging')
BEGIN
    CREATE TABLE dbo.[task_sync_staging] (
        [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
        [__sync_time] DATETIME2 NULL,
        [__sync_id_num] BIGINT NULL,

        [ID] BIGINT NOT NULL,
        [source_db] NVARCHAR(255) NULL,
        [MigrateFlg] INT DEFAULT 0,
        [MigrateErrFlg] INT DEFAULT 0,
        [MigrateErrMess] NVARCHAR(MAX) NULL,

        [Title] NVARCHAR(MAX),
        [VBId] BIGINT,
        [StartDate] DATETIME,
        [DueDate] DATETIME,
        [Created] DATETIME,
        [Modified] DATETIME,
        [CreatedBy] NVARCHAR(500),
        [ModifiedBy] NVARCHAR(500),
        [Status] NVARCHAR(100),
        [Priority] INT,
        [Responsible] NVARCHAR(500),
        [Note] NVARCHAR(MAX)
    );

CREATE UNIQUE INDEX [IX_task_sync_staging_ID_Source] ON dbo.[task_sync_staging]([ID], [source_db]);

PRINT ' ✓ Created table task_sync_staging';

END ELSE BEGIN PRINT ' ✓ Table task_sync_staging already exists';

-- Đảm bảo các cột cần thiết tồn tại
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'task_sync_staging' AND COLUMN_NAME = 'source_db')
    BEGIN
        ALTER TABLE dbo.task_sync_staging ADD [source_db] NVARCHAR(255) NULL;

PRINT ' ✓ Added column source_db';


END

    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'task_sync_staging' AND COLUMN_NAME = 'MigrateFlg')
    BEGIN
        ALTER TABLE dbo.task_sync_staging ADD [MigrateFlg] INT DEFAULT 0;

PRINT ' ✓ Added column MigrateFlg';


END

    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'task_sync_staging' AND COLUMN_NAME = 'MigrateErrFlg')
    BEGIN
        ALTER TABLE dbo.task_sync_staging ADD [MigrateErrFlg] INT DEFAULT 0;

PRINT ' ✓ Added column MigrateErrFlg';


END

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_task_sync_staging_ID_Source' AND object_id = OBJECT_ID('dbo.task_sync_staging'))
    BEGIN
        -- Xóa duplicates nếu có
        DELETE FROM dbo.task_sync_staging
        WHERE SY_SyncId NOT IN (
            SELECT MIN(SY_SyncId)
            FROM dbo.task_sync_staging
            GROUP BY [ID], ISNULL([source_db], '')
        );

PRINT ' ✓ Removed duplicate records';

CREATE UNIQUE INDEX [IX_task_sync_staging_ID_Source] ON dbo.[task_sync_staging]([ID], [source_db]);

PRINT ' ✓ Created index IX_task_sync_staging_ID_Source';

END ELSE BEGIN PRINT '  ✓ Index IX_task_sync_staging_ID_Source already exists';

END END

-- ====================================================================================
-- PHẦN 4: TẠO staging table cho Task Outgoing sync (công việc đi - van-ban-di)
-- ====================================================================================
PRINT '========== CREATING task_outgoing_sync_staging (công việc đi) ============';


IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'task_outgoing_sync_staging')
BEGIN
    CREATE TABLE dbo.[task_outgoing_sync_staging] (
        [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
        [__sync_time] DATETIME2 NULL,
        [__sync_id_num] BIGINT NULL,

        [ID] BIGINT NOT NULL,
        [source_db] NVARCHAR(255) NULL,
        [MigrateFlg] INT DEFAULT 0,
        [MigrateErrFlg] INT DEFAULT 0,
        [MigrateErrMess] NVARCHAR(MAX) NULL,

        [Title] NVARCHAR(MAX),
        [VBId] BIGINT,
        [StartDate] DATETIME,
        [DueDate] DATETIME,
        [Created] DATETIME,
        [Modified] DATETIME,
        [CreatedBy] NVARCHAR(500),
        [ModifiedBy] NVARCHAR(500),
        [Status] NVARCHAR(100),
        [Priority] INT,
        [Responsible] NVARCHAR(500),
        [Note] NVARCHAR(MAX)
    );

CREATE UNIQUE INDEX [IX_task_outgoing_sync_staging_ID_Source] ON dbo.[task_outgoing_sync_staging]([ID], [source_db]);

PRINT ' ✓ Created table task_outgoing_sync_staging';

END ELSE BEGIN PRINT '  ✓ Table task_outgoing_sync_staging already exists';

-- Đảm bảo các cột cần thiết tồn tại
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'task_outgoing_sync_staging' AND COLUMN_NAME = 'source_db')
    BEGIN
        ALTER TABLE dbo.task_outgoing_sync_staging ADD [source_db] NVARCHAR(255) NULL;

PRINT ' ✓ Added column source_db';


END

    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'task_outgoing_sync_staging' AND COLUMN_NAME = 'MigrateFlg')
    BEGIN
        ALTER TABLE dbo.task_outgoing_sync_staging ADD [MigrateFlg] INT DEFAULT 0;

PRINT ' ✓ Added column MigrateFlg';


END

    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'task_outgoing_sync_staging' AND COLUMN_NAME = 'MigrateErrFlg')
    BEGIN
        ALTER TABLE dbo.task_outgoing_sync_staging ADD [MigrateErrFlg] INT DEFAULT 0;

PRINT ' ✓ Added column MigrateErrFlg';


END

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_task_outgoing_sync_staging_ID_Source' AND object_id = OBJECT_ID('dbo.task_outgoing_sync_staging'))
    BEGIN
        -- Xóa duplicates nếu có
        DELETE FROM dbo.task_outgoing_sync_staging
        WHERE SY_SyncId NOT IN (
            SELECT MIN(SY_SyncId)
            FROM dbo.task_outgoing_sync_staging
            GROUP BY [ID], ISNULL([source_db], '')
        );

PRINT ' ✓ Removed duplicate records';

CREATE UNIQUE INDEX [IX_task_outgoing_sync_staging_ID_Source] ON dbo.[task_outgoing_sync_staging]([ID], [source_db]);

PRINT ' ✓ Created index IX_task_outgoing_sync_staging_ID_Source';

END ELSE BEGIN PRINT '  ✓ Index IX_task_outgoing_sync_staging_ID_Source already exists';

END END

-- ====================================================================================
-- PHẦN 5: CẬP NHẬT cron_sync_config để đăng ký các model
-- ====================================================================================
PRINT '========== UPDATING cron_sync_config for model scheduling ============';

-- Tạo bảng nếu chưa tồn tại
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'cron_sync_config')
BEGIN
    CREATE TABLE dbo.[cron_sync_config] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [module_name] NVARCHAR(255) NOT NULL UNIQUE,
        [cron_time] NVARCHAR(50) NOT NULL,
        [is_active] BIT DEFAULT 1,
        [updated_at] DATETIME DEFAULT GETDATE()
    );

PRINT ' ✓ Created table cron_sync_config';

END
ELSE
BEGIN
    -- Đảm bảo các columns cần thiết tồn tại
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'cron_sync_config' AND COLUMN_NAME = 'is_active')
    BEGIN
        ALTER TABLE dbo.cron_sync_config ADD [is_active] BIT DEFAULT 1;

PRINT ' ✓ Added column is_active';


END

    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'cron_sync_config' AND COLUMN_NAME = 'updated_at')
    BEGIN
        ALTER TABLE dbo.cron_sync_config ADD [updated_at] DATETIME DEFAULT GETDATE();

PRINT ' ✓ Added column updated_at';

END

PRINT ' ✓ cron_sync_config table structure verified';

END

-- Thêm hoặc cập nhật cấu hình cho Meeting sync (Đồng bộ lịch họp)
IF EXISTS (
    SELECT 1
    FROM dbo.cron_sync_config
    WHERE
        module_name = N'Đồng bộ lịch họp'
) BEGIN
UPDATE dbo.cron_sync_config
SET
    cron_time = '09:00',
    is_active = 1,
    updated_at = GETDATE ()
WHERE
    module_name = N'Đồng bộ lịch họp';

PRINT ' ✓ Updated cron config for: Đồng bộ lịch họp (09:00)';

END ELSE BEGIN
INSERT INTO
    dbo.cron_sync_config (
        module_name,
        cron_time,
        is_active
    )
VALUES (
        N'Đồng bộ lịch họp',
        '09:00',
        1
    );

PRINT ' ✓ Added cron config for: Đồng bộ lịch họp (09:00)';

END

-- Thêm hoặc cập nhật cấu hình cho Event sync (Đồng bộ sự kiện)
IF EXISTS (
    SELECT 1
    FROM dbo.cron_sync_config
    WHERE
        module_name = N'Đồng bộ sự kiện'
) BEGIN
UPDATE dbo.cron_sync_config
SET
    cron_time = '10:00',
    is_active = 1,
    updated_at = GETDATE ()
WHERE
    module_name = N'Đồng bộ sự kiện';

PRINT ' ✓ Updated cron config for: Đồng bộ sự kiện (10:00)';

END ELSE BEGIN
INSERT INTO
    dbo.cron_sync_config (
        module_name,
        cron_time,
        is_active
    )
VALUES (
        N'Đồng bộ sự kiện',
        '10:00',
        1
    );

PRINT ' ✓ Added cron config for: Đồng bộ sự kiện (10:00)';

END

-- Thêm hoặc cập nhật cấu hình cho Task Incoming sync (Đồng bộ công việc đến)
IF EXISTS (
    SELECT 1
    FROM dbo.cron_sync_config
    WHERE
        module_name = N'Đồng bộ công việc đến'
) BEGIN
UPDATE dbo.cron_sync_config
SET
    cron_time = '11:00',
    is_active = 1,
    updated_at = GETDATE ()
WHERE
    module_name = N'Đồng bộ công việc đến';

PRINT ' ✓ Updated cron config for: Đồng bộ công việc đến (11:00)';

END ELSE BEGIN
INSERT INTO
    dbo.cron_sync_config (
        module_name,
        cron_time,
        is_active
    )
VALUES (
        N'Đồng bộ công việc đến',
        '11:00',
        1
    );

PRINT ' ✓ Added cron config for: Đồng bộ công việc đến (11:00)';

END

-- Thêm hoặc cập nhật cấu hình cho Task Outgoing sync (Đồng bộ công việc đi)
IF EXISTS (
    SELECT 1
    FROM dbo.cron_sync_config
    WHERE
        module_name = N'Đồng bộ công việc đi'
) BEGIN
UPDATE dbo.cron_sync_config
SET
    cron_time = '12:00',
    is_active = 1,
    updated_at = GETDATE ()
WHERE
    module_name = N'Đồng bộ công việc đi';

PRINT ' ✓ Updated cron config for: Đồng bộ công việc đi (12:00)';

END ELSE BEGIN
INSERT INTO
    dbo.cron_sync_config (
        module_name,
        cron_time,
        is_active
    )
VALUES (
        N'Đồng bộ công việc đi',
        '12:00',
        1
    );

PRINT ' ✓ Added cron config for: Đồng bộ công việc đi (12:00)';

END

-- ====================================================================================
-- PHẦN 6: HIỂN THỊ CẤU HÌNH CUỐI CÙNG
-- ====================================================================================
PRINT '========== CURRENT CRON CONFIGURATION ============';

SELECT
    module_name,
    cron_time,
    is_active
FROM dbo.cron_sync_config
ORDER BY module_name;
GO

PRINT '========== SUMMARY ============';

PRINT '✅ Tất cả bảng staging và cấu hình cron đã được kiểm tra/cập nhật';

PRINT '';

PRINT 'Các bảng đã tạo/sửa:';

PRINT ' 1. meeting_sync_staging (lịch họp)';

PRINT ' 2. event_sync_staging (sự kiện)';

PRINT ' 3. task_sync_staging (công việc đến)';

PRINT ' 4. task_outgoing_sync_staging (công việc đi)';

PRINT '';

PRINT 'Các lịch trình cron (schedule):';

PRINT ' • Đồng bộ lịch họp @ 09:00';

PRINT ' • Đồng bộ sự kiện @ 10:00';

PRINT ' • Đồng bộ công việc đến @ 11:00';

PRINT ' • Đồng bộ công việc đi @ 12:00';

PRINT '';

PRINT 'BƯỚC TIẾP THEO: Chạy lại ứng dụng (npm start) để đăng ký các model trong SyncManagerController';
GO
