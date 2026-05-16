-- =========================================================================
-- SQL SCRIPT TO SETUP MISSING STAGING AND BUSINESS TABLES
-- Database: DiOffice
-- =========================================================================

USE [DiOffice];
GO

-- 1. Create task_sync (Incoming Tasks)
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'task_sync')
BEGIN
    CREATE TABLE [dbo].[task_sync] (
        ID                     NVARCHAR(255)   NOT NULL PRIMARY KEY,
        VBId                   NVARCHAR(MAX)   NULL,
        DepartmentId           NVARCHAR(MAX)   NULL,
        ParentId               NVARCHAR(MAX)   NULL,
        Title                  NVARCHAR(MAX)   NULL,
        DanhGia                NVARCHAR(MAX)   NULL,
        DeBaoCao               NVARCHAR(MAX)   NULL,
        DeBiet                 NVARCHAR(MAX)   NULL,
        DeThucHien             NVARCHAR(MAX)   NULL,
        DuocHuy                NVARCHAR(MAX)   NULL,
        DiemChatLuong          NVARCHAR(MAX)   NULL,
        DiemThoiGian           NVARCHAR(MAX)   NULL,
        DiemDanhGia            NVARCHAR(MAX)   NULL,
        StartDate              NVARCHAR(MAX)   NULL,
        DueDate                NVARCHAR(MAX)   NULL,
        CompletedDate          NVARCHAR(MAX)   NULL,
        HoanTatTuDong          NVARCHAR(MAX)   NULL,
        HoSoDuThaoId           NVARCHAR(MAX)   NULL,
        HoSoDuThaoUrl          NVARCHAR(MAX)   NULL,
        HoSoXuLyUrl            NVARCHAR(MAX)   NULL,
        [Percent]              NVARCHAR(MAX)   NULL,
        TrangThai              NVARCHAR(MAX)   NULL,
        Priority               NVARCHAR(MAX)   NULL,
        YKienCuaNguoiGiaiQuyet NVARCHAR(MAX)   NULL,
        YKienChiDao            NVARCHAR(MAX)   NULL,
        ModuleId               NVARCHAR(MAX)   NULL,
        SiteName               NVARCHAR(MAX)   NULL,
        ListName               NVARCHAR(MAX)   NULL,
        ItemId                 NVARCHAR(MAX)   NULL,
        Modified               NVARCHAR(MAX)   NULL,
        Created                NVARCHAR(MAX)   NULL,
        ModifiedBy             NVARCHAR(MAX)   NULL,
        CreatedBy              NVARCHAR(MAX)   NULL,
        MigrateFlg             INT DEFAULT 0,
        MigrateErrFlg          INT DEFAULT 0,
        MigrateErrMess         NVARCHAR(MAX)   NULL,
        ParentTaskID           NVARCHAR(MAX)   NULL,
        id_task_bak            NVARCHAR(MAX)   NULL,
        processing_owner       NVARCHAR(255)   NULL,
        processing_started_at  DATETIME2       NULL,
        processing_heartbeat_at DATETIME2      NULL,
        __sync_time            DATETIME2       NULL,
        __sync_id              BIGINT          NULL
    );
    PRINT 'Table task_sync created.';
END
GO

-- 2. Create task_sync_out (Outgoing Tasks)
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'task_sync_out')
BEGIN
    CREATE TABLE [dbo].[task_sync_out] (
        ID                     NVARCHAR(255)   NOT NULL PRIMARY KEY,
        VBId                   NVARCHAR(MAX)   NULL,
        DepartmentId           NVARCHAR(MAX)   NULL,
        ParentId               NVARCHAR(MAX)   NULL,
        Title                  NVARCHAR(MAX)   NULL,
        DanhGia                NVARCHAR(MAX)   NULL,
        DeBaoCao               NVARCHAR(MAX)   NULL,
        DeBiet                 NVARCHAR(MAX)   NULL,
        DeThucHien             NVARCHAR(MAX)   NULL,
        DuocHuy                NVARCHAR(MAX)   NULL,
        DiemChatLuong          NVARCHAR(MAX)   NULL,
        DiemThoiGian           NVARCHAR(MAX)   NULL,
        DiemDanhGia            NVARCHAR(MAX)   NULL,
        StartDate              NVARCHAR(MAX)   NULL,
        DueDate                NVARCHAR(MAX)   NULL,
        CompletedDate          NVARCHAR(MAX)   NULL,
        HoanTatTuDong          NVARCHAR(MAX)   NULL,
        HoSoDuThaoId           NVARCHAR(MAX)   NULL,
        HoSoDuThaoUrl          NVARCHAR(MAX)   NULL,
        HoSoXuLyUrl            NVARCHAR(MAX)   NULL,
        [Percent]              NVARCHAR(MAX)   NULL,
        TrangThai              NVARCHAR(MAX)   NULL,
        Priority               NVARCHAR(MAX)   NULL,
        YKienCuaNguoiGiaiQuyet NVARCHAR(MAX)   NULL,
        YKienChiDao            NVARCHAR(MAX)   NULL,
        ModuleId               NVARCHAR(MAX)   NULL,
        SiteName               NVARCHAR(MAX)   NULL,
        ListName               NVARCHAR(MAX)   NULL,
        ItemId                 NVARCHAR(MAX)   NULL,
        Modified               NVARCHAR(MAX)   NULL,
        Created                NVARCHAR(MAX)   NULL,
        ModifiedBy             NVARCHAR(MAX)   NULL,
        CreatedBy              NVARCHAR(MAX)   NULL,
        MigrateFlg             INT DEFAULT 0,
        MigrateErrFlg          INT DEFAULT 0,
        MigrateErrMess         NVARCHAR(MAX)   NULL,
        ParentTaskID           NVARCHAR(MAX)   NULL,
        id_task_bak            NVARCHAR(MAX)   NULL,
        processing_owner       NVARCHAR(255)   NULL,
        processing_started_at  DATETIME2       NULL,
        processing_heartbeat_at DATETIME2      NULL,
        __sync_time            DATETIME2       NULL,
        __sync_id              BIGINT          NULL
    );
    PRINT 'Table task_sync_out created.';
END
GO

-- 3. Create meeting_sync_staging
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'meeting_sync_staging')
BEGIN
    CREATE TABLE [dbo].[meeting_sync_staging] (
        [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
        [__sync_time] DATETIME2 NULL,
        [__sync_id_num] BIGINT NULL,
        [ID] BIGINT NOT NULL,
        [MigrateFlg] INT DEFAULT 0,
        [MigrateErrFlg] INT DEFAULT 0,
        [MigrateErrMess] NVARCHAR(MAX) NULL,
        [processing_owner] NVARCHAR(255) NULL,
        [processing_started_at] DATETIME2 NULL,
        [processing_heartbeat_at] DATETIME2 NULL,
        [__sync_id] BIGINT NULL
    );
    CREATE UNIQUE INDEX IX_meeting_sync_staging_ID ON [dbo].[meeting_sync_staging]([ID]);
    PRINT 'Table meeting_sync_staging created.';
END
GO

-- 4. Create event_sync_staging
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'event_sync_staging')
BEGIN
    CREATE TABLE [dbo].[event_sync_staging] (
        [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
        [__sync_time] DATETIME2 NULL,
        [__sync_id_num] BIGINT NULL,
        [ID] BIGINT NOT NULL,
        [MigrateFlg] INT DEFAULT 0,
        [MigrateErrFlg] INT DEFAULT 0,
        [MigrateErrMess] NVARCHAR(MAX) NULL,
        [processing_owner] NVARCHAR(255) NULL,
        [processing_started_at] DATETIME2 NULL,
        [processing_heartbeat_at] DATETIME2 NULL,
        [__sync_id] BIGINT NULL
    );
    CREATE UNIQUE INDEX IX_event_sync_staging_ID ON [dbo].[event_sync_staging]([ID]);
    PRINT 'Table event_sync_staging created.';
END
GO

-- 5. Create news table (Business table fallback)
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'news')
BEGIN
    CREATE TABLE [dbo].[news] (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        title NVARCHAR(500),
        summary NVARCHAR(MAX),
        content NVARCHAR(MAX),
        topic NVARCHAR(255),
        authorId NVARCHAR(100),
        authorCode NVARCHAR(255),
        authorDepartment NVARCHAR(255),
        tags NVARCHAR(MAX),
        status INT DEFAULT 1,
        created_at DATETIME2 DEFAULT GETDATE(),
        updated_at DATETIME2 DEFAULT GETDATE(),
        isBak INT DEFAULT 0,
        nameThumbnail NVARCHAR(500),
        DocId NVARCHAR(100),
        created_by NVARCHAR(100),
        reviewerId NVARCHAR(100)
    );
    PRINT 'Table news created.';
END
GO

-- 6. Create topics table (Business table fallback)
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'topics')
BEGIN
    CREATE TABLE [dbo].[topics] (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        name NVARCHAR(255),
        href NVARCHAR(255),
        status INT DEFAULT 1,
        tb_bak INT DEFAULT 0
    );
    PRINT 'Table topics created.';
END
GO

-- 7. Ensure necessary columns in news_aspx_pages_temp (Staging)
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'news_aspx_pages_temp')
BEGIN
    CREATE TABLE [dbo].[news_aspx_pages_temp] (
        DocId              UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
        DirName            NVARCHAR(512) NULL,
        LeafName           NVARCHAR(512) NULL,
        DocType            INT NULL,
        Size               BIGINT NULL,
        TimeCreated        DATETIME2 NULL,
        TimeLastModified   DATETIME2 NULL,
        UIVersionString    NVARCHAR(50) NULL,
        Level              INT NULL,
        WebUrl             NVARCHAR(2048) NULL,
        WebTitle           NVARCHAR(512) NULL,
        Language           INT NULL,
        ListTitle          NVARCHAR(512) NULL,
        tp_ServerTemplate  INT NULL,
        ListDescription    NVARCHAR(MAX) NULL,
        DocPath            NVARCHAR(2048) NULL,
        FullPageUrl        NVARCHAR(2048) NULL,
        LocalFilePath      NVARCHAR(2048) NULL,
        DownloadedAt       DATETIME2 NULL,
        DownloadStatus     NVARCHAR(50) NULL,
        DownloadError      NVARCHAR(MAX) NULL,
        __sync_id          BIGINT NULL,
        source_db          NVARCHAR(255) NULL,
        MigrateFlg         INT DEFAULT 0,
        MigrateErrFlg      INT DEFAULT 0,
        MigrateErrMess     NVARCHAR(MAX) NULL
    );
    PRINT 'Table news_aspx_pages_temp created.';
END
GO

PRINT 'All necessary tables checked/created.';
