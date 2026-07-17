const dbConnection = require('../../db/connection');
const Extractor = require('./models/Extractor');
const Loader = require('./models/Loader');

// Ð? không log b?a bãi, ta có th? ghi dè logger trong module này
// Ho?c ch? in ra console nh?ng thông tin quan tr?ng nh?t.
const originalConsoleLog = console.log;

async function main() {
  const args = process.argv.slice(2);
  let targetId = null;
  for (const arg of args) {
    if (arg.startsWith('--id=')) {
      targetId = arg.split('=')[1];
    }
  }

  console.log(`Ðang k?t n?i database...`);
  await dbConnection.connectAll();
  const newPool = dbConnection.getNewPool();
  const oldPool = dbConnection.getOldPool();

  if (!newPool || !oldPool) {
    console.error('L?i k?t n?i DB. Vui lòng ki?m tra l?i c?u hình.');
    process.exit(1);
  }
  const extractor = new Extractor(newPool, oldPool);
  const loader = new Loader(newPool, oldPool);
  // T?m t?t log b?a c?a loader/upsert handler n?u c?n, 
  // nhung m?c d?nh UpsertHandler dã comment các log th?a.
  await loader.initialize();

  const instanceId = 'test_single_record';
  let row = null;

  if (targetId) {
    console.log(`Ðang tìm b?n ghi ID = ${targetId} trong staging (incomming_document_sync_2)...`);
    const stagingTable = loader.getStagingTableName(instanceId);
    
    // Ép l?y 1 b?n ghi c? th? b?ng CTE Update (tuong t? Loader)
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
      console.log(`B?n ghi không có trong staging, dang l?y t? OLDB...`);
      const oldReq = oldPool.request();
      oldReq.input('id', targetId);
      const oldRes = await oldReq.query(`SELECT TOP (1) * FROM VanBanDen WHERE ID = @id`);
      if (oldRes.recordset && oldRes.recordset.length > 0) {
        const oldRow = oldRes.recordset[0];
        // Upsert to staging using loader
        await extractor.syncBatchToStaging([oldRow], instanceId);
        row = oldRow;
        console.log(`Ðã chèn b?n ghi vào staging.`, row);
      } else {
        console.log(`Không tìm th?y b?n ghi ID=${targetId} trong OLDB`);
      }
    }
  } else {
    console.log(`Không ch? d?nh --id. Ðang t? d?ng l?y 1 b?n ghi dang ch? t? staging...`);
    row = await loader.fetchOneFromStaging(instanceId);
  }

  if (!row) {
    console.log('Không tìm th?y b?n ghi nào h?p l? d? x? lý trong staging.');
    process.exit(0);
  }

  console.log(`[B?T Ð?U] Ti?n hành x? lý d?ng b? b?n ghi ID = ${row.ID}...`);
  console.log(`- Tiêu d?: ${row.Title || row.TrichYeu || 'Không có tiêu d?'}`);
  
  const startTime = Date.now();
  
  try {
    const result = await loader.processRecord(row);
    const duration = Date.now() - startTime;

    if (result.success) {
      await loader.markSuccess(instanceId, row.ID);
      console.log(`[THÀNH CÔNG] Ðã d?ng b? hoàn ch?nh.`);
      console.log(`- Document ID (M?i): ${result.documentId}`);
      console.log(`- Action: ${result.action}`);
      console.log(`- Th?i gian x? lý: ${duration}ms`);
    } else {
      await loader.markFailed(instanceId, row.ID, result.error);
      console.log(`[TH?T B?I] L?i: ${result.error}`);
      console.log(`- Th?i gian x? lý: ${duration}ms`);
    }
  } catch (err) {
    await loader.markFailed(instanceId, row.ID, err.message);
    console.error(`[L?I NGHIÊM TR?NG] ${err.message}`);
    console.error(err.stack);
  }

  process.exit(0);
}

main();
