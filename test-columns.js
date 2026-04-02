const sql = require('mssql');
require('dotenv').config();

async function run() {
    const config = {
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        server: process.env.DB_SERVER || 'localhost',
        database: process.env.NEW_DB_NAME || 'DiOffice',
        options: { encrypt: false, trustServerCertificate: true }
    };

    try {
        await sql.connect(config);
        const result = await sql.query(`
            SELECT COLUMN_NAME, DATA_TYPE 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'leadership_duty_details'
        `);
        console.table(result.recordset);
        
        const result2 = await sql.query(`
            SELECT TOP 1 * FROM leadership_duty_details ORDER BY created_at DESC
        `);
        console.log("SAMPLE RECORD:", result2.recordset[0]);
        
    } catch (err) {
        console.error(err);
    } finally {
        sql.close();
    }
}

run();
