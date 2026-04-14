const sql = require('mssql');
require('dotenv').config({ path: 'c:\\Users\\DELL\\Documents\\SyncDatabaseEOffice_chayduocluongphantichtin\\.env' });
const { newDbConfig } = require('c:\\Users\\DELL\\Documents\\SyncDatabaseEOffice_chayduocluongphantichtin\\config\\database');

async function check() {
    try {
        console.log('Connecting to new DB...');
        let pool = await sql.connect(newDbConfig);
        console.log('Connected.');

        const tables = ['news', 'audit', 'topics'];
        for (const table of tables) {
            console.log(`\n--- Checking table: ${table} ---`);
            const result = await pool.request().query(`
                SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}'
            `);
            console.table(result.recordset);
        }

        await pool.close();
    } catch (err) {
        console.error('Error:', err);
    }
}

check();
