const sql = require('mssql');
require('dotenv').config();

const config = {
    server: process.env.NEW_DB_SERVER,
    port: parseInt(process.env.NEW_DB_PORT, 10),
    user: process.env.NEW_DB_USER,
    password: process.env.NEW_DB_PASSWORD,
    database: process.env.NEW_DB_NAME,
    options: { encrypt: false, trustServerCertificate: true }
};

async function run() {
    try {
        console.log('--- RESET SYNC MEETING TO PAST (1970) ---');
        const pool = await sql.connect(config);
        console.log('Connected to New DB:', process.env.NEW_DB_NAME);

        const modelName = 'STREAM_MEETING_COPY_MIGRATION';
        const query = `
            UPDATE sync_jobs
            SET last_sync_time = '1970-01-01 00:00:00.000',
                last_sync_id = 0,
                total_to_sync = NULL,
                total_processed = 0,
                total_success = 0,
                total_errors = 0,
                error_message = NULL
            WHERE model_name = @modelName;

            UPDATE sync_models
            SET last_sync_time = '1970-01-01 00:00:00.000',
                last_sync_id = 0,
                total_synced = 0,
                status = 'IDLE',
                active_job_id = NULL,
                last_error = NULL
            WHERE model_name = @modelName;
        `;

        const request = pool.request();
        request.input('modelName', sql.NVarChar, modelName);
        const result = await request.query(query);
        const affected = (result.rowsAffected || []).reduce((sum, count) => sum + count, 0);

        if (affected > 0) {
            console.log(`SUCCESS: reset model ${modelName} ve moc 1970-01-01.`);
            console.log('Lan chay tiep theo se rebuild snapshot moi cho module lich hop.');
        } else {
            console.log(`FAILED: Khong tim thay model_name [${modelName}] trong sync_jobs/sync_models.`);
        }

        await pool.close();
    } catch (err) {
        console.error('CRITICAL ERROR:', err.message);
    }
}

run();
