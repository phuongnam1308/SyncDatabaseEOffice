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
      encrypt: false, // Set to true if using Azure
      trustServerCertificate: true,
    },
    requestTimeout: 60000,
  };

  console.log(`Connecting to new DB: ${config.server}:${config.port}/${config.database} as ${config.user}...`);
  let pool;
  try {
    pool = await sql.connect(config);
    console.log('Connected successfully.');

    const dbName = process.env.NEW_DB_NAME;
    const tableName = 'files';

    // List of columns we need in `dbo.files`
    const colsToEnsure = [
      { name: 'nguoikyvanban', type: 'NVARCHAR(MAX) NULL' },
      { name: 'id_bak', type: 'NVARCHAR(MAX) NULL' },
      { name: 'table_bak', type: 'NVARCHAR(MAX) NULL' },
      { name: 'type_doc', type: 'NVARCHAR(MAX) NULL' },
      { name: 'isBak', type: 'NVARCHAR(MAX) NULL' }, // note: if already exists as INT or another type, we won't alter
      { name: 'isNumbered', type: 'TINYINT DEFAULT 0 NOT NULL' },
      { name: 'typeSize', type: 'NVARCHAR(100) NULL' },
      { name: 'is_important', type: 'BIT DEFAULT 0 NOT NULL' },
      { name: 'file_type', type: 'NVARCHAR(100) NULL' },
      { name: 'version', type: 'VARCHAR(100) NULL' },
      { name: 'is_signed_file', type: 'BIGINT NULL' },
      { name: 'number_of_signed_file', type: 'BIGINT NULL' },
      { name: 'storage_path', type: 'NVARCHAR(255) NULL' },
      { name: 'storage_type', type: 'VARCHAR(100) NULL' },
      { name: 'status', type: 'INT NULL' }
    ];

    for (const col of colsToEnsure) {
      // Check if column exists
      const checkQuery = `
        SELECT 1 
        FROM ${dbName}.INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = '${tableName}' AND COLUMN_NAME = '${col.name}'
      `;
      const result = await pool.request().query(checkQuery);
      
      if (result.recordset.length === 0) {
        console.log(`Column '${col.name}' is missing in '${tableName}' table. Adding it...`);
        const alterQuery = `ALTER TABLE ${dbName}.dbo.${tableName} ADD ${col.name} ${col.type};`;
        try {
          await pool.request().query(alterQuery);
          console.log(`Executed: ${alterQuery}`);
        } catch (alterErr) {
          console.error(`Failed to add column '${col.name}': ${alterErr.message}`);
        }
      } else {
        console.log(`Column '${col.name}' already exists in '${tableName}' table.`);
      }
    }

    console.log('Finished schema verification/migration.');
  } catch (err) {
    console.error('Database operations failed:', err);
  } finally {
    if (pool) {
      await pool.close();
      console.log('Pool closed.');
    }
  }
}

run();
