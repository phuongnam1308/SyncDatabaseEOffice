const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const StreamNewsAspxPageMigrationService = require('../src/sync-news-aspx-page/services/StreamNewsAspxPageMigrationService');

async function runTest() {
  try {
    console.log('--- Bắt đầu script đồng bộ tin tức (.aspx) ---');
    const service = new StreamNewsAspxPageMigrationService();
    console.log('1. Đang khởi tạo bảng trung gian...');
    await service.initialize();

    console.log('2. Đang kiểm tra và lấy dữ liệu metadata từ DB cũ vào bảng staging...');
    // testGetList will query from SHAREPOINT_DB_NAME and insert into news_aspx_pages_temp
    const listResult = await service.testGetList();
    console.log('   Kết quả lấy danh sách:');
    console.log(`   - Tống số cần xử lý: ${listResult.totalCount}`);
    console.log(`   - Số dòng đã đẩy vào staging: ${listResult.stagedCount}`);

    const syncJobId = listResult.syncJobId;
    let processed = 0;
    
    console.log(`\n3. Bắt đầu download ${listResult.totalCount} file vào thư mục tintucraw...`);
    while (true) {
      // get options manually to ensure it processes incrementally
      const result = await service.testProcessOne(syncJobId, { itemIndex: processed });
      if (result.done || !result.processed) {
        console.log('Hoàn thành quá trình download!');
        break;
      }
      processed++;
      console.log(`   Đã xử lý item ${processed}: DocId=${result.rowId}`);
      if (result.result && result.result.localPath) {
        console.log(`   => Thành công, đã lưu tại: ${result.result.localPath}`);
      } else if (result.result && result.result.error) {
        console.log(`   => Bỏ qua do lỗi tải file: ${result.result.error}`);
      }
    }
    
    console.log('--- Đã chạy xong hoàn tất ---');
    process.exit(0);
  } catch (error) {
    console.error('Lỗi xảy ra trong quá trình chạy script:', error);
    process.exit(1);
  }
}

runTest();
