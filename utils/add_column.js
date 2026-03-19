const sql = require('mssql');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { newDbConfig } = require('../config/database');

async function update() {
    try {
        console.log('Connecting to new DB...');
        let pool = await sql.connect(newDbConfig);
        console.log('Connected.');

        console.log('Adding column images to news_aspx_new_sync...');
        await pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news_aspx_new_sync' AND COLUMN_NAME = 'images')
            BEGIN
                ALTER TABLE dbo.news_aspx_new_sync ADD images NVARCHAR(MAX) NULL;
                PRINT 'Column images added successfully.';
            END
            ELSE
            BEGIN
                PRINT 'Column images already exists.';
            END
        `);

        // Also truncate to ensure a clean sync with images
        console.log('Truncating tables for fresh sync...');
        await pool.request().query('TRUNCATE TABLE dbo.news_aspx_new_sync');
        await pool.request().query('TRUNCATE TABLE dbo.file_new_sync');
        
        await pool.close();
    } catch (err) {
        console.error('Error:', err);
    }
}

update();
