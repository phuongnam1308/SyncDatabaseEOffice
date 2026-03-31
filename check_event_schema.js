const sql = require('mssql');
require('dotenv').config();

async function check() {
  const pool = await sql.connect({
    user: process.env.NEW_DB_USER,
    password: process.env.NEW_DB_PASSWORD,
    server: process.env.NEW_DB_SERVER,
    database: process.env.NEW_DB_NAME,
    options: { encrypt: false, trustServerCertificate: true },
    port: parseInt(process.env.NEW_DB_PORT) || 1433
  });
  const res = await pool.request().query("SELECT COLUMN_NAME, DATA_TYPE, COLUMNPROPERTY(object_id(TABLE_SCHEMA+'.'+TABLE_NAME), COLUMN_NAME, 'IsIdentity') as is_identity FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news_calendar'");
  console.log(res.recordset);
  await pool.close();
}
check();
