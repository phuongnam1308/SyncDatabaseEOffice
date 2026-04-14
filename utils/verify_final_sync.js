const sql = require('mssql');
require('dotenv').config({ path: 'c:\\Users\\DELL\\Documents\\SyncDatabaseEOffice_chayduocluongphantichtin\\.env' });
const { newDbConfig } = require('c:\\Users\\DELL\\Documents\\SyncDatabaseEOffice_chayduocluongphantichtin\\config\\database');

async function check() {
    try {
        console.log('Connecting to new DB...');
        let pool = await sql.connect(newDbConfig);
        console.log('Connected.');

        const newsCount = await pool.request().query('SELECT COUNT(*) AS total FROM dbo.news');
        console.log(`Total records in news table: ${newsCount.recordset[0].total}`);

        const auditCount = await pool.request().query("SELECT COUNT(*) AS total FROM dbo.audit WHERE action_code = 'DUYET'");
        console.log(`Total records in audit table (DUYET): ${auditCount.recordset[0].total}`);

        const sample = await pool.request().query('SELECT TOP 1 id, title, slug, status, authorName FROM dbo.news ORDER BY id DESC');
        console.log('Sample record:');
        console.dir(sample.recordset, { depth: null });

        await pool.close();
    } catch (err) {
        console.error('Error:', err);
    }
}

check();
