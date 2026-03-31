const sql = require('mssql');
require('dotenv').config();

const config = {
    user: process.env.NEW_DB_USER,
    password: process.env.NEW_DB_PASSWORD,
    server: process.env.NEW_DB_SERVER,
    database: process.env.NEW_DB_NAME,
    options: {
        encrypt: true,
        trustServerCertificate: true
    }
};

async function checkCols() {
    try {
        await sql.connect(config);
        const result = await sql.query(`
            SELECT COLUMN_NAME, DATA_TYPE 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'audit' AND TABLE_SCHEMA = 'dbo'
        `);
        console.log(JSON.stringify(result.recordset, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        await sql.close();
    }
}

checkCols();
