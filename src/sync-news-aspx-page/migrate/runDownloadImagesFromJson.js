const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const fs = require('fs');
const HtmlFileMigrationModel = require('./HtmlFileMigrationModel');

async function run() {
    const migrator = new HtmlFileMigrationModel();
    
    // Thư mục chứa các file JSON đã parse
    const jsonOutDir = path.resolve(__dirname, '../../../tintucraw/tintuc/json_output');
    if (!fs.existsSync(jsonOutDir)) {
        console.error('Không tìm thấy thư mục JSON:', jsonOutDir);
        return;
    }

    const files = fs.readdirSync(jsonOutDir).filter(f => f.endsWith('.json'));
    console.log(`Đã tìm thấy ${files.length} file .json cần xử lý lại ảnh.`);

    let totalImages = 0;
    let successCount = 0;
    let currentFile = 1;

    for (const file of files) {
        console.log(`\n[${currentFile}/${files.length}] Đang đọc: ${file}`);
        const jsonPath = path.join(jsonOutDir, file);
        const slug = path.basename(file, '.json');

        try {
            const fileContent = fs.readFileSync(jsonPath, 'utf-8');
            const data = JSON.parse(fileContent);

            if (data.images && data.images.length > 0) {
                console.log(`  -> Tìm thấy ${data.images.length} ảnh trong JSON này.`);
                for (let i = 0; i < data.images.length; i++) {
                    totalImages++;
                    const img = data.images[i];
                    
                    // Lấy URL gốc (đường dẫn tương đối trên thẻ img)
                    const originalUrl = img.originalUrl;
                    
                    if (originalUrl) {
                        // Gọi lại hàm downloadImage của migrator (nó đã có chức năng skip nếu file đã tồn tại)
                        await migrator.downloadImage(originalUrl, slug, i);
                        successCount++;
                    }
                }
            } else {
                console.log('  -> Không có ảnh nào.');
            }
        } catch (err) {
            console.error(`Lỗi tại file ${file}:`, err.message);
        }
        currentFile++;
    }
    
    console.log('\n===============\n🎉 HOÀN TẤT TẢI LẠI ẢNH MÀ KHÔNG PARSE LẠI HTML');
    console.log(`Tổng số ảnh có trong JSON: ${totalImages} | Số luồng xử lý: ${successCount}\n===============`);
    process.exit(0);
}

run();
