/*
  Run this script in the target NEW DB context.
  It is idempotent and only adds missing queue/heartbeat tracking columns.
*/

DECLARE @tables TABLE (table_name SYSNAME);

INSERT INTO @tables (table_name)
VALUES
  ('task_sync'),
  ('task_sync_out'),
  ('meeting_sync_staging'),
  ('car_booking_sync_staging'),
  ('passport_borrow_request_sync_staging'),
  ('outgoing_documents_sync'),
  ('incomming_documents_sync'),
  ('user_sync'),
  ('social_resource_sync'),
  ('dept_sync');

DECLARE @tableName SYSNAME;
DECLARE table_cursor CURSOR FAST_FORWARD FOR
SELECT table_name FROM @tables;

OPEN table_cursor;
FETCH NEXT FROM table_cursor INTO @tableName;

WHILE @@FETCH_STATUS = 0
BEGIN
  IF OBJECT_ID(N'dbo.' + @tableName, 'U') IS NOT NULL
  BEGIN
    IF COL_LENGTH(N'dbo.' + @tableName, 'MigrateFlg') IS NULL
      EXEC(N'ALTER TABLE dbo.' + QUOTENAME(@tableName) + ' ADD MigrateFlg INT NULL;');

    IF COL_LENGTH(N'dbo.' + @tableName, 'MigrateErrFlg') IS NULL
      EXEC(N'ALTER TABLE dbo.' + QUOTENAME(@tableName) + ' ADD MigrateErrFlg INT NULL;');

    IF COL_LENGTH(N'dbo.' + @tableName, 'MigrateErrMess') IS NULL
      EXEC(N'ALTER TABLE dbo.' + QUOTENAME(@tableName) + ' ADD MigrateErrMess NVARCHAR(MAX) NULL;');

    IF COL_LENGTH(N'dbo.' + @tableName, 'processing_owner') IS NULL
      EXEC(N'ALTER TABLE dbo.' + QUOTENAME(@tableName) + ' ADD processing_owner NVARCHAR(255) NULL;');

    IF COL_LENGTH(N'dbo.' + @tableName, 'processing_started_at') IS NULL
      EXEC(N'ALTER TABLE dbo.' + QUOTENAME(@tableName) + ' ADD processing_started_at DATETIME2 NULL;');

    IF COL_LENGTH(N'dbo.' + @tableName, 'processing_heartbeat_at') IS NULL
      EXEC(N'ALTER TABLE dbo.' + QUOTENAME(@tableName) + ' ADD processing_heartbeat_at DATETIME2 NULL;');
  END

  FETCH NEXT FROM table_cursor INTO @tableName;
END

CLOSE table_cursor;
DEALLOCATE table_cursor;
