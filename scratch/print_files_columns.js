const sql = require('mssql');
require('dotenv').config();

async function run() {
  const config = {
    server: process.env.NEW_DB_SERVER,
    port: parseInt(process.env.NEW_DB_PORT || '1433', 10),
    database: process.env.NEW_DB_NAME,
    user: process.env.NEW_DB_USER,
    password: process.env.NEW_DB_PASSWORD,
    options: {
      encrypt: false,
      trustServerCertificate: true,
    },
    requestTimeout: 60000,
  };

  console.log(`Connecting to DB: ${config.server}:${config.port}/${config.database}...`);
  let pool;
  try {
    pool = await sql.connect(config);
    console.log('Connected successfully. Querying columns of table [files]...');

    const dbName = process.env.NEW_DB_NAME;
    const query = `
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
      FROM ${dbName}.INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'files'
      ORDER BY COLUMN_NAME;
    `;

    const result = await pool.request().query(query);
    console.log('\n--- Columns in [files] table ---');
    if (result.recordset.length === 0) {
      console.log('No columns found (or table does not exist).');
    } else {
      result.recordset.forEach(col => {
        console.log(`- ${col.COLUMN_NAME} (${col.DATA_TYPE}${col.CHARACTER_MAXIMUM_LENGTH ? `[${col.CHARACTER_MAXIMUM_LENGTH}]` : ''})`);
      });
    }
    console.log('--------------------------------\n');

  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (pool) {
      await pool.close();
    }
  }
}

run();
