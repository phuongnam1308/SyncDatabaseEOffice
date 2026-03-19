const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.js') });
const fs = require('fs');
const sql = require('mssql');
const { newDbConfig } = require('../../../config/database');
const HtmlFileMigrationModel = require('./HtmlFileMigrationModel');

async function testSingleJson() {
    // TÊN FILE MUỐN TEST (Thay đổi ở đây)
    const jsonFileName = 'de-cuong-tuyen-truyen-ky-niem-60-nam-hai-quan-viet-nam-anh-hung-07-5-1955-07-5-2015.json';
    const jsonFilePath = path.resolve(__dirname, '../../../tintucraw/tintuc/json_output', jsonFileName);

    if (!fs.existsSync(jsonFilePath)) {
        console.error('❌ File không tồn tại:', jsonFilePath);
        return;
    }

    const migrator = new HtmlFileMigrationModel();
    let pool = null;

    try {
        console.log('--- BƯỚC 1: KẾT NỐI DATABASE ---');
        pool = await sql.connect(newDbConfig);
        migrator.newPool = pool;
        console.log('✅ Kết nối NEW_DB thành công');

        console.log(`\n--- BƯỚC 2: TEST SYNC FILE: ${jsonFileName} ---`);
        const data = JSON.parse(fs.readFileSync(jsonFilePath, 'utf-8'));
        
        // Gọi insertToSyncTable (hàm này đã được cập nhật để xử lý upload ảnh trong content)
        await migrator.insertToSyncTable(data);
        
        console.log('\n--- BƯỚC 3: KIỂM TRA KẾT QUẢ TRONG DB ---');
        const result = await pool.request()
            .input('slug', sql.NVarChar, data.slug)
            .query('SELECT TOP 1 title, content FROM dbo.news_aspx_new_sync WHERE slug = @slug ORDER BY created_at DESC');
        
        if (result.recordset.length > 0) {
            const row = result.recordset[0];
            console.log('✅ Đã tìm thấy bản ghi trong DB.');
            console.log('Title:', row.title);
            
            // Tìm các link ảnh trong content để xem đã được đổi chưa
            const content = row.content;
            const matches = content.match(/src="([^"]+)"/g);
            if (matches) {
                console.log('\nCác URL ảnh trong content (sau xử lý):');
                matches.forEach(m => console.log('  ' + m));
            } else {
                console.log('\n(Không tìm thấy thẻ img trong content)');
            }
        } else {
            console.error('❌ Không tìm thấy bản ghi vừa insert!');
        }

    } catch (err) {
        console.error('❌ Lỗi trong quá trình test:', err);
    } finally {
        if (pool) await pool.close();
        process.exit(0);
    }
}

testSingleJson();
