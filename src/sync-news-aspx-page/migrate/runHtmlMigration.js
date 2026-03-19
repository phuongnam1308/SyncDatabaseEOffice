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
    
    // Khởi tạo Migrator (chưa cần DB vội)
    const migrator = new HtmlFileMigrationModel();
    
    try {
        console.log('--- BƯỚC 1: KẾT NỐI DATABASE ---');
        globalPool = await new sql.ConnectionPool(newDbConfig).connect();
        dbConnection.newPool = globalPool;
        migrator.newPool = globalPool;
        dbConnected = true;
        console.log('✅ Kêt nối NEW_DB thành công');
        
        // Ensure table exists
        await migrator.ensureSyncTableExists();
    } catch(err) {
        console.warn('⚠️ LỖI KẾT NỐI DATABASE:', err.message);
        console.warn('⚠️ Script vẫn sẽ tiếp tục chạy ở chế độ CHỈ XUẤT JSON (Không insert DB).');
    }

    try {
        console.log('\n--- BƯỚC 2: XỬ LÝ QUÉT FILES ---');
        // Get directory of pages
        const pagesDir = path.resolve(__dirname, '../../../tintucraw/tintuc/Pages');
        if (!fs.existsSync(pagesDir)) {
            console.error('Không tìm thấy thư mục:', pagesDir);
            return;
        }

        // Create directory for JSON output
        const jsonOutDir = path.resolve(__dirname, '../../../tintucraw/tintuc/json_output');
        if (!fs.existsSync(jsonOutDir)) {
            fs.mkdirSync(jsonOutDir, { recursive: true });
            console.log('Tạo thư mục JSON output:', jsonOutDir);
        }

        const files = fs.readdirSync(pagesDir).filter(f => f.endsWith('.aspx'));
        console.log(`Đã tìm thấy ${files.length} file .aspx cần xử lý.`);

        for (const file of files) {
            console.log(`\n▶ Đang xử lý: ${file}`);
            const filePath = path.join(pagesDir, file);
            const slug = path.basename(file, '.aspx');
            const jsonFilePath = path.join(jsonOutDir, `${slug}.json`);

            // Kiểm tra xem đã parse chưa, nếu có file JSON rồi thì skip
            if (fs.existsSync(jsonFilePath)) {
                console.log(`  [SKIP] Đã tồn tại file JSON: ${slug}.json`);
                // Vẫn có thể insert vào DB nếu cần từ cục JSON cũ, nhưng hiện tại skip hoàn toàn
                continue; 
            }

            try {
                // 1. Quét HTML, tải ảnh, trả về object data
                const data = await migrator.parseHtmlFile(filePath);
                
                // 2. Lưu ra file JSON
                fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf-8');
                console.log(`[JSON] Đã lưu data ra file: ${jsonFilePath}`);

                // 3. Insert vào database (nếu DB đang sống)
                if(dbConnected) {
                    await migrator.insertToSyncTable(data);
                } else {
                    console.log(`[DB Skip] Bỏ qua chèn DB do mất kết nối.`);
                }
            } catch (err) {
                console.error(`Lỗi tại file ${file}:`, err);
            }
        }
        
        console.log('\n===============\n🎉 HOÀN TẤT QUÁ TRÌNH XỬ LÝ \n===============');
    } catch (error) {
        console.error('Migrate lỗi:', error);
    } finally {
        if(globalPool) await globalPool.close();
        process.exit(0);
    }
}

run();
