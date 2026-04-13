require('dotenv').config({ path: '../.env' });
const sql = require('mssql');

async function run() {
  const config = {
    server: process.env.NEW_DB_SERVER,
    port: parseInt(process.env.NEW_DB_PORT),
    user: process.env.NEW_DB_USER,
    password: process.env.NEW_DB_PASSWORD,
    database: process.env.NEW_DB_NAME,
    options: {
      encrypt: false,
      trustServerCertificate: true,
    },
  };

  try {
    const pool = await sql.connect(config);
    
    console.log('--- Lấy 5 bài viết thành công gần nhất ---');
    const okRows = await pool.request().query("SELECT TOP 5 FullPageUrl, DownloadStatus FROM news_aspx_pages_temp WHERE DownloadStatus = 'OK' ORDER BY TimeLastModified DESC");
    console.log(JSON.stringify(okRows.recordset, null, 2));

    console.log('\n--- Kiểm tra bản ghi tan-cang-2.aspx chi tiết ---');
    const targetRow = await pool.request().query("SELECT DocId, DirName, LeafName, FullPageUrl, DownloadStatus, DownloadError FROM news_aspx_pages_temp WHERE FullPageUrl LIKE '%tan-cang-2.aspx%'");
    console.log(JSON.stringify(targetRow.recordset, null, 2));

    await pool.close();
  } catch (err) {
    console.error(err);
  }
}

run();
