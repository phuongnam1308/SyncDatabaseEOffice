const sql = require('mssql');
const { newDbConfig } = require('../config/database');

async function check() {
  try {
    const pool = await sql.connect(newDbConfig);
    const result = await pool.request().query("SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.sync_jobs')");
    console.log('Columns in sync_jobs:', result.recordset.map(c => c.name).join(', '));
    await pool.close();
  } catch (err) {
    console.error('Error:', err);
  }
}
check();
