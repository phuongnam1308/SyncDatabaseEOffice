const sql = require('mssql');
require('dotenv').config();

const config = {
    user: process.env.NEW_DB_USER,
    password: process.env.NEW_DB_PASSWORD,
    server: process.env.NEW_DB_SERVER,
    database: process.env.NEW_DB_NAME,
    options: {
        encrypt: false,
        trustServerCertificate: true,
        port: parseInt(process.env.NEW_DB_PORT) || 1433
    }
};

async function checkTables() {
    try {
        console.log('Connecting to NEW_DB...');
        const pool = await sql.connect(config);
        console.log('Querying tables...');
        const result = await pool.request().query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'");
        console.log('Tables in DB:');
        console.log(result.recordset.map(r => r.TABLE_NAME).sort());
        await pool.close();
    } catch (err) {
        console.error('Error:', err);
    }
}

checkTables();
