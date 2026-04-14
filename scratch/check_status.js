const sql = require('mssql');
require('dotenv').config();

const config = {
  user: process.env.NEW_DB_USER,
  password: process.env.NEW_DB_PASSWORD,
  server: process.env.NEW_DB_SERVER,
  database: process.env.NEW_DB_NAME,
  port: parseInt(process.env.NEW_DB_PORT),
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

async function check() {
  try {
    const pool = await sql.connect(config);
    
    console.log('--- User Parent Distribution ---');
    const userRes = await pool.request().query('SELECT parent, COUNT(*) as count FROM users GROUP BY parent');
    console.table(userRes.recordset);
    
    console.log('\n--- Audit Receiver Unit Sample ---');
    const auditRes = await pool.request().query('SELECT TOP 10 receiver_unit, COUNT(*) as count FROM audit GROUP BY receiver_unit');
    console.table(auditRes.recordset);
    
    await pool.close();
  } catch (err) {
    console.error(err);
  }
}

check();
