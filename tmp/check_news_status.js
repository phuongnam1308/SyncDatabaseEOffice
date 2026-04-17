const sql = require('mssql');
require('dotenv').config();

const config = {
    user: process.env.NEW_DB_USER,
    password: process.env.NEW_DB_PASSWORD,
    server: process.env.NEW_DB_SERVER,
    port: parseInt(process.env.NEW_DB_PORT) || 1433,
    database: process.env.NEW_DB_NAME,
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

async function checkStatus() {
    try {
        const pool = await sql.connect(config);
        
        console.log('--- SYNC JOBS STATUS ---');
        const jobs = await pool.request().query("SELECT TOP 5 * FROM sync_jobs ORDER BY created_at DESC");
        console.table(jobs.recordset);

        console.log('\n--- SYNC MODELS CURSOR ---');
        const models = await pool.request().query("SELECT * FROM sync_models WHERE model_name = 'STREAM_NEWS_ASPX_PAGE_INCREMENTAL'");
        console.table(models.recordset);

        console.log('\n--- STAGING TABLE COUNT ---');
        const count = await pool.request().query("SELECT COUNT(*) as count FROM news_aspx_pages_temp");
        console.log('news_aspx_pages_temp count:', count.recordset[0].count);

        console.log('\n--- STAGING TABLE SAMPLE ---');
        const sample = await pool.request().query("SELECT TOP 5 DocId, LeafName, TimeLastModified, DownloadStatus FROM news_aspx_pages_temp ORDER BY TimeLastModified DESC");
        console.table(sample.recordset);

        await pool.close();
    } catch (err) {
        console.error('Error:', err.message);
    }
}

checkStatus();
