const sql = require('mssql');
require('dotenv').config();

async function run() {
    const config = {
        server: process.env.NEW_DB_SERVER,
        port: parseInt(process.env.NEW_DB_PORT, 10),
        user: process.env.NEW_DB_USER,
        password: process.env.NEW_DB_PASSWORD,
        database: 'app_tancang',
        options: {
            encrypt: false,
            trustServerCertificate: true
        }
    };

    try {
        const pool = await sql.connect(config);
        console.log('--- Checking vehicle_registrations ---');
        const r1 = await pool.request()
            .input('id_sp_bak', sql.NVarChar, '635')
            .query('SELECT * FROM dbo.vehicle_registrations WHERE id_sp_bak = @id_sp_bak');
        console.log('Found in vehicle_registrations:', r1.recordset.length);
        if (r1.recordset.length > 0) {
            const master = r1.recordset[0];
            console.log('Master Record:', JSON.stringify(master, null, 2));
            const masterId = master.id;

            console.log('\n--- Checking vehicle_registration_assignments ---');
            const r2 = await pool.request()
                .input('reg_id', sql.UniqueIdentifier, masterId)
                .query('SELECT * FROM dbo.vehicle_registration_assignments WHERE registration_id = @reg_id');
            console.log('Found in assignments:', r2.recordset.length);
            console.log('Assignments:', JSON.stringify(r2.recordset, null, 2));

            console.log('\n--- Checking audit ---');
            const r3 = await pool.request()
                .input('doc_id', sql.NVarChar, masterId.toString())
                .query('SELECT * FROM dbo.audit WHERE document_id = @doc_id');
            console.log('Found in audit:', r3.recordset.length);
            console.log('Audit steps:', r3.recordset.map(s => s.action_code));
        }

        await pool.close();
    } catch (err) {
        console.error('Error:', err.message);
    }
}

run();
