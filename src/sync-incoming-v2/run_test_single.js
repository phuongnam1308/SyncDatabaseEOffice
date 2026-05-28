const dbConnection = require('../../db/connection');
const Extractor = require('./models/Extractor');
const Loader = require('./models/Loader');

// Để không log bừa bãi, ta có thể ghi đè logger trong module này
// Hoặc chỉ in ra console những thông tin quan trọng nhất.
const originalConsoleLog = console.log;

async function main() {
  const args = process.argv.slice(2);
  let targetId = null;
  for (const arg of args) {
    if (arg.startsWith('--id=')) {
      targetId = arg.split('=')[1];
    }
  }

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
  // Tạm tắt log bừa của loader/upsert handler nếu cần, 
  // nhưng mặc định UpsertHandler đã comment các log thừa.
  await loader.initialize();

  const instanceId = 'test_single_record';
  let row = null;

  if (targetId) {
    console.log(`Đang tìm bản ghi ID = ${targetId} trong staging (incomming_document_sync_2)...`);
    const stagingTable = loader.getStagingTableName(instanceId);
    
    // Ép lấy 1 bản ghi cụ thể bằng CTE Update (tương tự Loader)
    const claimQuery = `
      WITH CTE AS (
        SELECT TOP (1) *
        FROM ${stagingTable}
        WHERE ID = @id
      )
      UPDATE CTE
      SET MigrateFlg          = 2,
          MigrateErrMess      = 'Testing single record...',
          processing_owner    = @owner,
          processing_started_at   = SYSUTCDATETIME(),
          processing_heartbeat_at = SYSUTCDATETIME()
      OUTPUT inserted.*
    `;
    
    const req = newPool.request();
    req.input('id', targetId);
    req.input('owner', `pid_${process.pid}_test`);
    const res = await req.query(claimQuery);
    
    if (res.recordset && res.recordset.length > 0) {
      row = res.recordset[0];
    }
    // If row not found in staging, fetch from old DB and upsert to staging
    if (!row && targetId) {
      console.log(`Bản ghi không có trong staging, đang lấy từ OLDB...`);
      const oldReq = oldPool.request();
      oldReq.input('id', targetId);
      const oldRes = await oldReq.query(`SELECT TOP (1) * FROM VanBanDen WHERE ID = @id`);
      if (oldRes.recordset && oldRes.recordset.length > 0) {
        const oldRow = oldRes.recordset[0];
        // Upsert to staging using loader
        await extractor.syncBatchToStaging([oldRow], instanceId);
        row = oldRow;
        console.log(`Đã chèn bản ghi vào staging.`, row);
      } else {
        console.log(`Không tìm thấy bản ghi ID=${targetId} trong OLDB`);
      }
    }
  } else {
    console.log(`Không chỉ định --id. Đang tự động lấy 1 bản ghi đang chờ từ staging...`);
    row = await loader.fetchOneFromStaging(instanceId);
  }

  if (!row) {
    console.log('Không tìm thấy bản ghi nào hợp lệ để xử lý trong staging.');
    process.exit(0);
  }

  console.log(`[BẮT ĐẦU] Tiến hành xử lý đồng bộ bản ghi ID = ${row.ID}...`);
  console.log(`- Tiêu đề: ${row.Title || row.TrichYeu || 'Không có tiêu đề'}`);
  
  const startTime = Date.now();
  
  try {
    const result = await loader.processRecord(row);
    const duration = Date.now() - startTime;

    if (result.success) {
      await loader.markSuccess(instanceId, row.ID);
      console.log(`[THÀNH CÔNG] Đã đồng bộ hoàn chỉnh.`);
      console.log(`- Document ID (Mới): ${result.documentId}`);
      console.log(`- Action: ${result.action}`);
      console.log(`- Thời gian xử lý: ${duration}ms`);
    } else {
      await loader.markFailed(instanceId, row.ID, result.error);
      console.log(`[THẤT BẠI] Lỗi: ${result.error}`);
      console.log(`- Thời gian xử lý: ${duration}ms`);
    }
  } catch (err) {
    await loader.markFailed(instanceId, row.ID, err.message);
    console.error(`[LỖI NGHIÊM TRỌNG] ${err.message}`);
    console.error(err.stack);
  }

  process.exit(0);
}

main();
