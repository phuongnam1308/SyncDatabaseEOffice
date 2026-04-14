const sql = require('mssql');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { newDbConfig } = require('../config/database');

async function setupAndCheck() {
    try {
        console.log('Connecting to:', newDbConfig.server, newDbConfig.database);
        const pool = await sql.connect(newDbConfig);
        
        // 1. Add tb_bak column
        console.log('Adding tb_bak column to topics...');
        try {
            await pool.request().query("IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.topics') AND name = 'tb_bak') ALTER TABLE dbo.topics ADD tb_bak INT DEFAULT 0;");
            console.log('Column tb_bak ensured.');
        } catch (e) {
            console.error('Error adding column:', e.message);
        }

        // 2. Refresh topics list
        const result = await sql.query("SELECT id, name, tb_bak FROM dbo.topics");
        console.log('Topics List:');
        console.log(JSON.stringify(result.recordset, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
setupAndCheck();
