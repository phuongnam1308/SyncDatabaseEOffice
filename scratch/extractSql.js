const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
  });
}

const sqlQueries = [];

walkDir(path.join(__dirname, '../src'), (filePath) => {
  if (!filePath.endsWith('.js')) return;
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Extract content inside backticks that contain CREATE TABLE
  const backtickRegex = /`([^`]*CREATE TABLE[^`]*)`/gi;
  let match;
  while ((match = backtickRegex.exec(content)) !== null) {
    let query = match[1];
    
    // Attempt to replace common variables with placeholder
    query = query.replace(/\$\{.*table.*\}/gi, '[dbo].[Tên_Bảng_Staging]');
    query = query.replace(/\$\{.*stagingTable.*\}/gi, '[dbo].[Tên_Bảng_Staging]');
    query = query.replace(/\$\{.*stagingTableRef.*\}/gi, '[dbo].[Tên_Bảng_Staging]');
    query = query.replace(/\$\{.*tableRef.*\}/gi, '[dbo].[Tên_Bảng]');
    query = query.replace(/\$\{.*db.*\}/gi, 'DiOffice');
    query = query.replace(/\$\{.*schema.*\}/gi, 'dbo');
    query = query.replace(/\$\{.*this\.newTableSync.*\}/gi, 'sync_staging_table');
    query = query.replace(/\$\{.*this\.mainTable.*\}/gi, 'main_table');
    query = query.replace(/\$\{.*\}/g, 'VAR');
    
    sqlQueries.push(`-- Source: ${path.basename(filePath)}\n${query.trim()}\nGO\n`);
  }
});

const outPath = path.join(__dirname, '../query_staging.sql');
fs.writeFileSync(outPath, sqlQueries.join('\n'));
console.log('Extracted ' + sqlQueries.length + ' queries to ' + outPath);
