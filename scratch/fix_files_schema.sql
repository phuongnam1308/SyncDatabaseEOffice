-- ====================================================================================
-- SQL FIX: Thêm các cột còn thiếu vào bảng files trong database DiOffice (NEW_DB)
-- ====================================================================================
USE DiOffice;
GO

PRINT '========== CHECKING & FIXING files TABLE SCHEMA ============';

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'nguoikyvanban')
BEGIN
    ALTER TABLE dbo.files ADD nguoikyvanban NVARCHAR(MAX) NULL;
    PRINT '  ✓ Added column: nguoikyvanban';
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'id_bak')
BEGIN
    ALTER TABLE dbo.files ADD id_bak NVARCHAR(MAX) NULL;
    PRINT '  ✓ Added column: id_bak';
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'table_bak')
BEGIN
    ALTER TABLE dbo.files ADD table_bak NVARCHAR(MAX) NULL;
    PRINT '  ✓ Added column: table_bak';
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'type_doc')
BEGIN
    ALTER TABLE dbo.files ADD type_doc NVARCHAR(MAX) NULL;
    PRINT '  ✓ Added column: type_doc';
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'isBak')
BEGIN
    ALTER TABLE dbo.files ADD isBak NVARCHAR(MAX) NULL;
    PRINT '  ✓ Added column: isBak';
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'isNumbered')
BEGIN
    ALTER TABLE dbo.files ADD isNumbered TINYINT DEFAULT 0 NOT NULL;
    PRINT '  ✓ Added column: isNumbered';
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'typeSize')
BEGIN
    ALTER TABLE dbo.files ADD typeSize NVARCHAR(100) NULL;
    PRINT '  ✓ Added column: typeSize';
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'is_important')
BEGIN
    ALTER TABLE dbo.files ADD is_important BIT DEFAULT 0 NOT NULL;
    PRINT '  ✓ Added column: is_important';
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'file_type')
BEGIN
    ALTER TABLE dbo.files ADD file_type NVARCHAR(100) NULL;
    PRINT '  ✓ Added column: file_type';
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'version')
BEGIN
    ALTER TABLE dbo.files ADD version VARCHAR(100) NULL;
    PRINT '  ✓ Added column: version';
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'is_signed_file')
BEGIN
    ALTER TABLE dbo.files ADD is_signed_file BIGINT NULL;
    PRINT '  ✓ Added column: is_signed_file';
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'number_of_signed_file')
BEGIN
    ALTER TABLE dbo.files ADD number_of_signed_file BIGINT NULL;
    PRINT '  ✓ Added column: number_of_signed_file';
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'storage_path')
BEGIN
    ALTER TABLE dbo.files ADD storage_path NVARCHAR(255) NULL;
    PRINT '  ✓ Added column: storage_path';
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'storage_type')
BEGIN
    ALTER TABLE dbo.files ADD storage_type VARCHAR(100) NULL;
    PRINT '  ✓ Added column: storage_type';
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'status')
BEGIN
    ALTER TABLE dbo.files ADD status INT NULL;
    PRINT '  ✓ Added column: status';
END

PRINT '========== COMPLETED CHECKING & FIXING files TABLE SCHEMA ============';
GO
