const sql = require('mssql');
require('dotenv').config();

async function checkCronConfig() {
    const config = {
        user: process.env.NEW_DB_USER,
        password: process.env.NEW_DB_PASSWORD,
        server: process.env.NEW_DB_SERVER,
        port: parseInt(process.env.NEW_DB_PORT),
        database: process.env.NEW_DB_NAME,
        options: {
            encrypt: false,
            trustServerCertificate: true
        }
    };

    try {
        const pool = await sql.connect(config);
        const result = await pool.request().query(`
            IF OBJECT_ID('dbo.cron_sync_config', 'U') IS NOT NULL
            BEGIN
                SELECT * FROM dbo.cron_sync_config;
            END
            ELSE
            BEGIN
                SELECT 'TABLE_NOT_FOUND' as status;
            END
        `);
        console.log(JSON.stringify(result.recordset, null, 2));
        await pool.close();
    } catch (err) {
        console.error(err);
    }
}

checkCronConfig();
