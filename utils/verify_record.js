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
            SELECT title, images FROM dbo.news_aspx_new_sync 
            WHERE slug = 'tong-cong-ty-trao-quyet-dinh-phung-duong-me-vnah-than-nhan-liet-sy'
        `);
        console.log('Target record:');
        console.dir(result.recordset, { depth: null });

        await pool.close();
    } catch (err) {
        console.error('Error:', err);
    }
}

check();
