const { newDbConfig } = require('./src/config/database');
const sql = require('mssql');

async function fixStagingTable() {
  try {
    console.log(`Connecting to ${newDbConfig.server} - ${newDbConfig.database}...`);
    const pool = await new sql.ConnectionPool(newDbConfig).connect();
    console.log('Connected!');

    const script = `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'meeting_sync_staging' AND COLUMN_NAME = 'processing_owner')
          ALTER TABLE dbo.meeting_sync_staging ADD processing_owner NVARCHAR(255) NULL;
          
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'meeting_sync_staging' AND COLUMN_NAME = 'processing_started_at')
          ALTER TABLE dbo.meeting_sync_staging ADD processing_started_at DATETIME2 NULL;
          
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'meeting_sync_staging' AND COLUMN_NAME = 'processing_heartbeat_at')
          ALTER TABLE dbo.meeting_sync_staging ADD processing_heartbeat_at DATETIME2 NULL;
          
      -- Clear procedure cache to force SQL Server to recompile the query plan and recognize the new columns
      DBCC FREEPROCCACHE;
    `;

    console.log('Running ALTER TABLE and DBCC FREEPROCCACHE...');
    await pool.request().batch(script);
    console.log('SUCCESS! Columns added and cache cleared.');
    process.exit(0);
  } catch (e) {
    console.error('Error:', e);
    process.exit(1);
  }
}

fixStagingTable();
