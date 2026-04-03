const sql = require('mssql');
require('dotenv').config();

const config = {
    server: process.env.NEW_DB_SERVER,
    port: parseInt(process.env.NEW_DB_PORT, 10),
    user: process.env.NEW_DB_USER,
    password: process.env.NEW_DB_PASSWORD,
    database: process.env.NEW_DB_NAME,
    options: { encrypt: false, trustServerCertificate: true }
};

async function run() {
    try {
        const pool = await sql.connect(config);
        const result = await pool.request().query("SELECT id, name, username, code_nd FROM users WHERE username = 'migservice' OR name = 'migservice' OR code_nd = 'migservice'");
        console.log('--- USER CHECK RESULT ---');
        console.log(JSON.stringify(result.recordset, null, 2));
        await pool.close();
    } catch (err) {
        console.error('ERROR:', err.message);
    }
}

run();
