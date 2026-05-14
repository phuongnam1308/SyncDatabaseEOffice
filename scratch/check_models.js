
const sql = require('mssql');
require('dotenv').config();

async function checkModels() {
  const config = {
    user: process.env.NEW_DB_USER,
    password: process.env.NEW_DB_PASSWORD,
    server: process.env.NEW_DB_SERVER,
    database: process.env.NEW_DB_NAME,
    options: {
      encrypt: false,
      trustServerCertificate: true
    }
  };

  try {
    const pool = await sql.connect(config);
    const result = await pool.request().query('SELECT model_name, instance_id FROM sync_models');
    console.log('--- MODELS IN DB ---');
    console.table(result.recordset);
    await sql.close();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

checkModels();
