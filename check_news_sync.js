const sql = require('mssql');
require('dotenv').config();

async function check() {
    try {
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

        console.log('--- SYNC JOBS STATUS ---');
        const jobs = await pool.request().query("SELECT job_id, model_name, last_sync_time, last_sync_id, total_to_sync, total_processed, total_success, status FROM sync_jobs WHERE model_name LIKE '%NEWS%'");
        console.table(jobs.recordset);

        console.log('\n--- STAGING TABLES COUNT ---');
        // Check staging table for ASPX files
        try {
            const stagingCount = await pool.request().query("SELECT COUNT(*) as count FROM news_aspx_pages_temp");
            console.log('news_aspx_pages_temp (Total ASPX discovered):', stagingCount.recordset[0].count);
        } catch (e) {
            console.log('news_aspx_pages_temp: Table not found or error:', e.message);
        }

        // Check the intermediate table for parsed data
        try {
            const intermediateCount = await pool.request().query("SELECT COUNT(*) as count FROM news_aspx_new_sync");
            console.log('news_aspx_new_sync (Parsed articles):', intermediateCount.recordset[0].count);
        } catch (e) {
            console.log('news_aspx_new_sync: Table not found or error:', e.message);
        }

        // Check the final production table
        try {
            const prodCount = await pool.request().query("SELECT COUNT(*) as count FROM news WHERE isBak = 1");
            console.log('news (Final articles marked as Bak):', prodCount.recordset[0].count);
        } catch (e) {
            console.log('news table error:', e.message);
        }

        process.exit(0);
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
}

check();
