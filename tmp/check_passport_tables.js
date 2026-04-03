const sql = require('mssql');
require('dotenv').config();

async function checkTables() {
    try {
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
        await sql.connect(config);
        const result = await sql.query("SELECT name FROM sys.tables WHERE name LIKE '%passport%'");
        console.log(JSON.stringify(result.recordset, null, 2));
        await sql.close();
    } catch (err) {
        console.error(err);
    }
}

checkTables();
