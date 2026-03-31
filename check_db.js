const sql = require('mssql');
require('dotenv').config({ path: '.env copy 2' });

async function check() {
    const config = {
        server: process.env.DB_SERVER,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.NEW_DB_NAME,
        port: parseInt(process.env.DB_PORT),
        options: {
            encrypt: false,
            trustServerCertificate: true
        }
    };
    try {
        await sql.connect(config);
        const result = await sql.query(`
            SELECT COLUMN_NAME, DATA_TYPE, COLUMNPROPERTY(OBJECT_ID(TABLE_SCHEMA + '.' + TABLE_NAME), COLUMN_NAME, 'IsIdentity') AS IsIdentity 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'news_calendar' AND COLUMN_NAME = 'id'
        `);
        console.log('Result:', JSON.stringify(result.recordset, null, 2));
        await sql.close();
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
}
check();
