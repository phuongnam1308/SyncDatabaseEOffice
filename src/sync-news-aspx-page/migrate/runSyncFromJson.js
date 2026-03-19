const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const fs = require('fs');
const HtmlFileMigrationModel = require('./HtmlFileMigrationModel');
const dbConnection = require('../../../db/connection');

const sql = require('mssql');
const { newDbConfig } = require('../../../config/database');

async function run() {
    let globalPool = null;
    let dbConnected = false;
    
    const migrator = new HtmlFileMigrationModel();
    
    try {
        console.log('--- BƯỚC 1: KẾT NỐI DATABASE ---');
        globalPool = await new sql.ConnectionPool(newDbConfig).connect();
        dbConnection.newPool = globalPool;
        migrator.newPool = globalPool;
        dbConnected = true;
        console.log('✅ Kết nối NEW_DB thành công');
        
        // Ensure table exists
        await migrator.ensureSyncTableExists();
    } catch(err) {
        console.error('❌ LỖI KẾT NỐI DATABASE:', err.message);
        return;
    }

    try {
        console.log('\n--- BƯỚC 2: ĐỒNG BỘ TỪ JSON ---');
        const jsonOutDir = path.resolve(__dirname, '../../../tintucraw/tintuc/json_output');
        if (!fs.existsSync(jsonOutDir)) {
            console.error('Không tìm thấy thư mục JSON:', jsonOutDir);
            return;
        }

        const files = fs.readdirSync(jsonOutDir).filter(f => f.endsWith('.json'));
        console.log(`Tìm thấy ${files.length} file JSON cần đồng bộ.`);

        for (const file of files) {
            const filePath = path.join(jsonOutDir, file);
            try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                console.log(`▶ Đang đồng bộ: ${data.slug}`);
                await migrator.insertToSyncTable(data);
            } catch (err) {
                console.error(`Lỗi tại file ${file}:`, err.message);
            }
        }
        
        console.log('\n===============\n🎉 HOÀN TẤT ĐỒNG BỘ TỪ JSON \n===============');
    } catch (error) {
        console.error('Lỗi khi chạy đồng bộ:', error);
    } finally {
        if(globalPool) await globalPool.close();
        process.exit(0);
    }
}

run();
