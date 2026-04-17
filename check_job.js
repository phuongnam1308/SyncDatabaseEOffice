const sql = require('mssql');
require('dotenv').config();

async function check() {
    try {
        console.log('Connecting to:', process.env.NEW_DB_SERVER);
        const pool = await sql.connect({
            user: process.env.NEW_DB_USER,
            password: process.env.NEW_DB_PASSWORD,
            server: process.env.NEW_DB_SERVER,
            database: process.env.NEW_DB_NAME,
            options: {
                encrypt: false,
                trustServerCertificate: true
            }
        });

        const res = await pool.request().query("SELECT job_id, last_sync_time, last_sync_id, total_processed FROM sync_jobs WHERE job_id = '3_incoming'");
        console.log('Current Job State:');
        console.log(JSON.stringify(res.recordset, null, 2));

        const countRes = await pool.request().query("SELECT COUNT(*) as count FROM incomming_documents_sync");
        console.log('Staging Records Count:', countRes.recordset[0].count);

        process.exit(0);
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
}

check();
