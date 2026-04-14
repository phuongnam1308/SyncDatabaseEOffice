const StreamNewsAspxPageIncrementalModel = require('./src/sync-news-aspx-page/models/StreamNewsAspxPageIncrementalModel');
const dotenv = require('dotenv');
dotenv.config();

async function verify() {
    const model = new StreamNewsAspxPageIncrementalModel();
    await model.initialize();
    
    console.log('--- Kiểm tra module Tin tức ---');
    const total = await model.getCount('2100-01-01T00:00:00.000Z', 0);
    console.log('Tổng số bản ghi Tin tức tìm thấy:', total);
    
    if (total > 1000) {
        console.log('SUCCESS: Giới hạn 1000 đã được loại bỏ.');
    } else {
        console.log('INFO: Tổng số bản ghi <= 1000, có thể do data thực tế ít hoặc giới hạn vẫn còn.');
    }
    
    process.exit(0);
}

verify().catch(err => {
    console.error(err);
    process.exit(1);
});
