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

        const query = `
            UPDATE sync_jobs
            SET last_sync_time = '1970-01-01 00:00:00.000',
                last_sync_id = 0
            WHERE job_id = 'STREAM_MEETING_MIGRATION'
        `;

        const result = await pool.request().query(query);
        
        if (result.rowsAffected[0] > 0) {
            console.log('SUCCESS ✅: last_sync_time updated to 1970-01-01.');
            console.log('Bây giờ hệ thống sẽ bắt đầu đồng bộ từ Cũ nhất đến Mới nhất.');
        } else {
            console.log('FAILED ❌: Không tìm thấy job_id [STREAM_MEETING_MIGRATION].');
            console.log('Có thể job này chưa bao giờ được khởi tạo trong bảng sync_jobs.');
        }

        await pool.close();
    } catch (err) {
        console.error('CRITICAL ERROR ❌:', err.message);
    }
}

run();
