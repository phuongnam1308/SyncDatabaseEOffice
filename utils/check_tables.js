const sql = require('mssql');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { newDbConfig } = require('../config/database');

async function check() {
    try {
        console.log('Connecting to new DB...');
        let pool = await sql.connect(newDbConfig);
        console.log('Connected.');

        const tables = ['news', 'file_new_sync', 'news_sync', 'img_file', 'new_sync_aspx'];
        for (const table of tables) {
            console.log(`\n--- Checking table: ${table} ---`);
            const result = await pool.request().query(`
                SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = '${table}'
            `);
            if (result.recordset.length === 0) {
                console.log(`Table ${table} does not exist.`);
            } else {
                console.table(result.recordset);
            }
        }

        await pool.close();
    } catch (err) {
        console.error('Error:', err);
    }
}

check();
