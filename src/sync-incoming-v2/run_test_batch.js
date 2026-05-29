const dbConnection = require('../../db/connection');
const Extractor = require('./models/Extractor');
const Loader = require('./models/Loader');

async function main() {
  console.log(`Đang kết nối database...`);
  await dbConnection.connectAll();
  const newPool = dbConnection.getNewPool();
  const oldPool = dbConnection.getOldPool();

  if (!newPool || !oldPool) {
    console.error('Lỗi kết nối DB. Vui lòng kiểm tra lại cấu hình.');
    process.exit(1);
  }

  const extractor = new Extractor(newPool, oldPool);
  const loader = new Loader(newPool, oldPool);
  
  // Khởi tạo loader (UpsertHandler)
  await loader.initialize();

  const instanceId = 'test_batch_1000';
  
  // Đảm bảo bảng staging tồn tại
  await extractor.ensureStagingTableExists(instanceId);

  // Lấy cursor cuối cùng từ staging để tiếp tục lấy dữ liệu
  let cursor = await extractor.getLastSyncCursor(instanceId);
  let lastSyncTime = cursor.time || extractor.getInitialSyncTime();
  let lastSyncId = cursor.id || 0;

  console.log(`Bắt đầu chạy 1000 bản ghi tuần tự. Cursor ban đầu: Time=${lastSyncTime}, ID=${lastSyncId}`);

  const maxRecords = 1000;
  let successCount = 0;
  let failCount = 0;

  for (let i = 1; i <= maxRecords; i++) {
    console.log(`\n--- [Bản ghi ${i}/${maxRecords}] ---`);
    
    // 1. Get tuần tự từng bản ghi một từ OLDB (VanBanDen)
    const rows = await extractor.fetchBatchFromOldDb(lastSyncTime, lastSyncId, 1, 0);
    
    if (!rows || rows.length === 0) {
      console.log(`Không còn bản ghi nào trong OLDB để đồng bộ. Kết thúc sớm ở vòng lặp ${i}.`);
      break;
    }

    const oldRow = rows[0];
    
    // Cập nhật cursor cho vòng lặp tiếp theo
    lastSyncTime = oldRow.__sync_time ? new Date(oldRow.__sync_time).toISOString() : lastSyncTime;
    lastSyncId = oldRow.__sync_id || 0;

    console.log(`> Lấy thành công ID = ${oldRow.ID} từ OLDB (Title: ${oldRow.Title || oldRow.TrichYeu || 'Không có tiêu đề'})`);

    // 2. Đưa qua incomming_documents_sync (Staging)
    await extractor.syncBatchToStaging([oldRow], instanceId);
    console.log(`> Đã chèn/cập nhật bản ghi vào staging.`);

    // 3. Claim bản ghi trong staging để xử lý
    const stagingTable = loader.getStagingTableName(instanceId);
    const claimQuery = `
      WITH CTE AS (
        SELECT TOP (1) *
        FROM ${stagingTable}
        WHERE ID = @id
      )
      UPDATE CTE
      SET MigrateFlg          = 2,
          MigrateErrMess      = 'Testing batch records...',
          processing_owner    = @owner,
          processing_started_at   = SYSUTCDATETIME(),
          processing_heartbeat_at = SYSUTCDATETIME()
      OUTPUT inserted.*
    `;
    
    const req = newPool.request();
    req.input('id', oldRow.ID);
    req.input('owner', `pid_${process.pid}_batch_test`);
    const res = await req.query(claimQuery);

    let stagingRow = null;
    if (res.recordset && res.recordset.length > 0) {
      stagingRow = res.recordset[0];
    }

    if (!stagingRow) {
      console.log(`> [LỖI] Không claim được ID=${oldRow.ID} trong staging, bỏ qua bản ghi này...`);
      failCount++;
      continue;
    }

    // 4. Process qua incomming_documents
    const startTime = Date.now();
    try {
      const result = await loader.processRecord(stagingRow);
      const duration = Date.now() - startTime;

      if (result.success) {
        await loader.markSuccess(instanceId, stagingRow.ID);
        console.log(`> [THÀNH CÔNG] Đã đồng bộ vào incomming_documents.`);
        console.log(`  - Document ID (Mới): ${result.documentId}`);
        console.log(`  - Action: ${result.action}`);
        console.log(`  - Thời gian xử lý: ${duration}ms`);
        successCount++;
      } else {
        await loader.markFailed(instanceId, stagingRow.ID, result.error);
        console.log(`> [THẤT BẠI] Lỗi: ${result.error}`);
        console.log(`  - Thời gian xử lý: ${duration}ms`);
        failCount++;
      }
    } catch (err) {
      await loader.markFailed(instanceId, stagingRow.ID, err.message);
      console.error(`> [LỖI NGHIÊM TRỌNG] ${err.message}`);
      failCount++;
    }
  }

  console.log(`\n=== TỔNG KẾT ===`);
  console.log(`- Số lượng yêu cầu: ${maxRecords}`);
  console.log(`- Thành công: ${successCount}`);
  console.log(`- Thất bại: ${failCount}`);
  
  process.exit(0);
}

main();
