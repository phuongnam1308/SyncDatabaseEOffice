const sql = require('mssql');
require('dotenv').config();

const newDbConfig = {
    user: process.env.NEW_DB_USER,
    password: process.env.NEW_DB_PASSWORD,
    server: process.env.NEW_DB_SERVER,
    database: process.env.NEW_DB_NAME,
    port: parseInt(process.env.NEW_DB_PORT),
    options: {
        encrypt: false,
        trustServerCertificate: true,
    }
};

async function check() {
    try {
        await sql.connect(newDbConfig);
        const result = await sql.query("SELECT id, name FROM dbo.topics");
        console.log(JSON.stringify(result.recordset, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
check();
