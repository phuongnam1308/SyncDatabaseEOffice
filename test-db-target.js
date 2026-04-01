const sql = require('mssql');
require('dotenv').config();
async function run() {
    const config = {
        server: process.env.NEW_DB_SERVER,
        port: parseInt(process.env.NEW_DB_PORT, 10),
        user: process.env.NEW_DB_USER,
        password: process.env.NEW_DB_PASSWORD,
        options: { encrypt: false, trustServerCertificate: true }
    };
    try {
        const pool = await sql.connect(config);
        
        console.log('Querying app_tancang...');
        try {
            const r1 = await pool.request().query('SELECT COUNT(*) as c FROM app_tancang.dbo.vehicle_registrations');
            console.log('app_tancang count:', r1.recordset[0].c);
        } catch (e) { console.log('app_tancang error', e.message); }

        console.log('Querying DiOffice...');
        try {
            const r2 = await pool.request().query('SELECT COUNT(*) as c FROM DiOffice.dbo.vehicle_registrations');
            console.log('DiOffice count:', r2.recordset[0].c);
        } catch (e) { console.log('DiOffice error', e.message); }
        
        pool.close();
    } catch (e) { console.error(e); }
}
run();
