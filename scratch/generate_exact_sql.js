const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    if (fs.statSync(dirPath).isDirectory()) {
      walkDir(dirPath, callback);
    } else {
      callback(dirPath);
    }
  });
}

// All known staging tables in the system
const allStagingTables = [
    'user_sync',
    'tgd_schedule_sync_staging',
    'task_sync_out',
    'task_sync',
    'social_resource_sync',
    'passport_borrow_request_sync_staging',
    'outgoing_documents_sync',
    'news_aspx_pages_temp',
    'news_aspx_new_sync',
    'file_new_sync',
    'html_file_sync_staging',
    'mission_schedule_sync_staging',
    'meeting_sync_staging',
    'incoming_documents_sync',
    'event_sync_staging',
    'car_booking_sync_staging',
    'department_sync',
    'draft_document_sync_staging',
    'unit_draft_sync_staging'
];

const tableSchemas = {};
// Khởi tạo trước các bảng rỗng
allStagingTables.forEach(t => tableSchemas[t] = []);

// Hardcode some known base columns that are always there
const baseColumns = `
    [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
    [__sync_time] DATETIME2 NULL,
    [__sync_id_num] BIGINT NULL,
    [ID] BIGINT NOT NULL,
    [source_db] NVARCHAR(255) NULL,
    [MigrateFlg] INT DEFAULT 0,
    [MigrateErrFlg] INT DEFAULT 0,
    [MigrateErrMess] NVARCHAR(MAX) NULL`;

// Các cột mặc định
const baseColNames = ['id', '__sync_time', '__sync_id_num', 'source_db', 'sy_syncid', 'migrateflg', 'migrateerrflg', 'migrateerrmess'];

walkDir(path.join(__dirname, '../src'), (filePath) => {
  if (!filePath.endsWith('.js')) return;
  const content = fs.readFileSync(filePath, 'utf8');

  // Tìm tất cả khai báo table
  let matches = [...content.matchAll(/(?:newTableSync|stagingTable|tableSync)\s*=\s*['"`](.*?)['"`]/g)];
  if (!matches.length) return;

  // Lấy tên table cuối cùng match (thường là staging table)
  let tableName = null;
  for (let match of matches) {
      if (!match[1].includes('$')) {
          tableName = match[1];
          break;
      }
  }
  
  if (!tableName) return;

  // Tìm mảng columnsToAdd hoặc requiredColumns
  let columnsMatch = content.match(/(?:columnsToAdd|requiredColumns|getStagingColumnDefinitions|return\s*\[)\s*=?\s*\[([\s\S]*?)\];?/);
  if (columnsMatch) {
      let colsText = columnsMatch[1];
      let colRegex = /name:\s*['"`](.*?)['"`](?:,\s*type:\s*['"`](.*?)['"`])?/g;
      let cMatch;
      let columns = tableSchemas[tableName] || [];
      
      // SQL Server is case-insensitive, we must track lowercase names to avoid duplicate column errors
      let seen = new Set(baseColNames);
      columns.forEach(colSql => {
          // Extract column name from [colName] Type
          let existingNameMatch = colSql.match(/\[(.*?)\]/);
          if (existingNameMatch) seen.add(existingNameMatch[1].toLowerCase());
      });

      while ((cMatch = colRegex.exec(colsText)) !== null) {
          let cName = cMatch[1];
          let cType = cMatch[2] || 'NVARCHAR(MAX)'; // default type
          
          let lowerName = cName.toLowerCase();
          
          // Tránh ghi đè cột đã có hoặc trùng lặp (ví dụ: DocumentID và DocumentId)
          if (seen.has(lowerName)) continue;
          seen.add(lowerName);
          
          columns.push(`[${cName}] ${cType}`);
      }
      
      tableSchemas[tableName] = columns;
  }
});

let sql = `
-- =============================================================================
-- 11. TẠO TẤT CẢ CÁC BẢNG TRUNG GIAN (STAGING TABLES) KÈM CÁC TRƯỜNG ĐẶC THÙ
-- (Script này chứa đầy đủ danh sách 19 bảng và đảm bảo KHÔNG TRÙNG LẶP CỘT)
-- =============================================================================
`;

for (let table of allStagingTables) {
    let cols = tableSchemas[table] || [];
    let extraColsSql = cols.length > 0 ? `,
        ${cols.join(',\n        ')}` : '';

    sql += `
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = '${table}')
BEGIN
    CREATE TABLE dbo.[${table}] (${baseColumns}${extraColsSql}
    );
    CREATE UNIQUE INDEX [IX_${table}_ID_Source] ON dbo.[${table}]([ID], [source_db]);
    PRINT 'Created staging table: dbo.${table}';
END
ELSE
BEGIN
    PRINT 'Staging table dbo.${table} already exists.';
END
GO
`;
}

// Ghi đè vào query.sql (từ vị trí ghi đè cũ)
const targetFile = path.join(__dirname, '../query.sql');
let existingSql = fs.readFileSync(targetFile, 'utf8');

// Cắt bỏ phần script cũ từ vị trí '-- 11.'
const splitIndex = existingSql.indexOf('-- 11. TẠO TẤT CẢ CÁC BẢNG TRUNG GIAN');
if (splitIndex !== -1) {
    existingSql = existingSql.substring(0, splitIndex);
}

fs.writeFileSync(targetFile, existingSql + sql);
console.log('Thành công! Đã sửa lỗi trùng lặp cột và cập nhật ĐẦY ĐỦ TẤT CẢ 19 bảng vào query.sql');
