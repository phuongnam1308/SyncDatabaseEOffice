const sql = require('mssql');
const path = require('path');
const fs = require('fs');

// [1] NẠP BIẾN MÔI TRƯỜNG TỪ .ENV
const exeDir = process.cwd();
require('dotenv').config({ path: path.join(exeDir, '.env') });

const config = {
  user: process.env.NEW_DB_USER,
  password: process.env.NEW_DB_PASSWORD,
  server: process.env.NEW_DB_SERVER,
  port: parseInt(process.env.NEW_DB_PORT) || 1433,
  database: process.env.NEW_DB_NAME || 'DiOffice',
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

/**
 * QUY TRÌNH THIẾT LẬP LỊCH TRÌNH CHẠY TỰ ĐỘNG
 */
async function setupCron() {
  console.log('🚀 Đang kết nối cơ sở dữ liệu để cấu hình lịch đồng bộ...');
  let pool;
  try {
    pool = await sql.connect(config);

    // [2] ĐẢM BẢO BẢNG CẤU HÌNH TỒN TẠI
    await pool.request().query(`
      IF OBJECT_ID('dbo.cron_sync_config', 'U') IS NULL
      BEGIN
        CREATE TABLE dbo.cron_sync_config (
          id INT IDENTITY(1,1) PRIMARY KEY,
          module_name NVARCHAR(255) NOT NULL,
          cron_time NVARCHAR(50) NOT NULL,
          is_active BIT DEFAULT 1,
          updated_at DATETIME DEFAULT GETDATE()
        );
        console.log('✅ Đã tạo bảng dbo.cron_sync_config');
      END
    `);

    // [3] UPSERT CẤU HÌNH CHO MODULE SỰ KIỆN (STREAM_EVENT_MIGRATION)
    // Thiết lập mặc định: 08:00
    const moduleKey = 'STREAM_EVENT_MIGRATION';
    const cronTime = '08:00'; 

    await pool.request()
      .input('moduleKey', sql.NVarChar, moduleKey)
      .input('cronTime', sql.NVarChar, cronTime)
      .query(`
        IF EXISTS (SELECT 1 FROM dbo.cron_sync_config WHERE module_name = @moduleKey)
        BEGIN
          UPDATE dbo.cron_sync_config 
          SET cron_time = @cronTime, updated_at = GETDATE()
          WHERE module_name = @moduleKey;
          PRINT '🔄 Đã cập nhật giờ chạy cho ' + @moduleKey + ' thành ' + @cronTime;
        END
        ELSE
        BEGIN
          INSERT INTO dbo.cron_sync_config (module_name, cron_time)
          VALUES (@moduleKey, @cronTime);
          PRINT '✨ Đã thêm mới lịch chạy cho ' + @moduleKey + ' vào lúc ' + @cronTime;
        END
      `);

    console.log('\n🎉 HOÀN TẤT CẤU HÌNH!');
    console.log('------------------------------------------------------');
    console.log('HƯỚNG DẪN TIẾP THEO:');
    console.log('1. Khởi động lại hệ thống: npm start');
    console.log('2. Dashboard sẽ tự động quét và đưa Sự Kiện vào hàng đợi khi đến 08:00.');
    console.log('------------------------------------------------------');

  } catch (err) {
    console.error('\n❌ LỖI KHI CẤU HÌNH:', err.message);
  } finally {
    if (pool) await pool.close();
  }
}

setupCron();
