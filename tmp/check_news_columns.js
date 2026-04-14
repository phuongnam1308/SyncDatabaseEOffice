const sql = require('mssql');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { newDbConfig } = require('../config/database');

async function checkColumns() {
    let pool = null;
    try {
        pool = await sql.connect(newDbConfig);
        const result = await pool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news'");
        console.log('Columns in dbo.news:');
        console.log(result.recordset.map(r => r.COLUMN_NAME).join(', '));
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        if (pool) await pool.close();
    }
}

checkColumns();
