const mssql = require('mssql');
require('dotenv').config();

const config = {
    user: process.env.NEW_DB_USER || 'sa',
    password: process.env.NEW_DB_PASSWORD || '12345678',
    server: process.env.NEW_DB_HOST || 'localhost',
    database: 'DiOffice',
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

async function cleanup() {
    try {
        let pool = await mssql.connect(config);
        console.log('Connected to DiOffice');
        
        const result = await pool.request()
            .query("DELETE FROM leadership_duty_details WHERE id = '00000000-0000-0000-0000-000000000000' OR table_bak IS NULL");
            
        console.log(`Deleted ${result.rowsAffected[0]} records.`);
        await pool.close();
    } catch (err) {
        console.error('Error:', err.message);
    }
}

cleanup();
