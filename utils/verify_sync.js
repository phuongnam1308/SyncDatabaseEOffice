const sql = require('mssql');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { newDbConfig } = require('../config/database');

async function check() {
    try {
        console.log('Connecting to new DB...');
        let pool = await sql.connect(newDbConfig);
        console.log('Connected.');

        const result = await pool.request().query(`
            SELECT TOP 1 title, slug, images FROM dbo.news_aspx_new_sync
        `);
        console.log('First record:');
        console.dir(result.recordset, { depth: null });

        const columns = await pool.request().query(`
            SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news_aspx_new_sync'
        `);
        console.log('\nColumns:');
        console.table(columns.recordset);

        await pool.close();
    } catch (err) {
        console.error('Error:', err);
    }
}

check();
