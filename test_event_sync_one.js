const StreamEventMigrationModel = require('./src/sync-event/migrate/StreamEventMigrationModel');
const dotenv = require('dotenv');
dotenv.config();

async function runTest() {
    console.log('--- STARTING TEST SYNC FOR ONE EVENT ---');
    const model = new StreamEventMigrationModel();
    
    try {
        // 1. Khởi tạo (Tạo bảng staging, thêm cột nếu thiếu)
        await model.initialize();
        
        // 2. Lấy 1 bản ghi từ nguồn (SharePoint)
        console.log('Step 2: Fetching one row from source...');
        const row = await model.fetchOneFromSource({
            lastSyncTime: '1970-01-01T00:00:00.000Z',
            lastSyncId: 0
        });

        if (!row) {
            console.log('No data found in source for the given List ID.');
            return;
        }

        console.log('Fetched Row:', {
            ID: row.ID,
            Title: row.Title,
            Location: row.Location,
            Organizer: row.Organizer,
            Author: row.AuthorAccount
        });

        // 3. Xử lý bản ghi (Tra cứu ID người dùng, Bóc tách đơn vị cho địa điểm)
        console.log('Step 3: Processing row data (Mapping & Resolving)...');
        const result = await model.processRowData(row);

        console.log('\n--- SYNC RESULT ---');
        console.log('Action:', result.logs[0].action);
        console.log('Target Table:', result.logs[0].table);
        console.log('Backup ID (SP):', result.backupId);
        console.log('Status: SUCCESS');
        console.log('---------------------------------------');

    } catch (err) {
        console.error('--- TEST FAILED ---');
        console.error(err);
    } finally {
        process.exit();
    }
}

runTest();
