const dbConnection = require('../../db/connection');
const Extractor = require('./models/Extractor');
const Loader = require('./models/Loader');

async function main() {
  console.log(`Dang ket noi database...`);
  await dbConnection.connectAll();
  const newPool = dbConnection.getNewPool();
  const oldPool = dbConnection.getOldPool();

  if (!newPool || !oldPool) {
    console.error('Loi ket noi DB. Vui long kiem tra lai cau hinh.');
    process.exit(1);
  }

  const extractor = new Extractor(newPool, oldPool);
  const loader = new Loader(newPool, oldPool);
  
  // Khoi tao loader (UpsertHandler)
  await loader.initialize();

  const instanceId = 'test_batch_1000';
  
  // Dam bao bang staging ton tai
  await extractor.ensureStagingTableExists(instanceId);

  // Lay cursor cuoi cung tu staging de tiep tuc lay du lieu
  let cursor = await extractor.getLastSyncCursor(instanceId);
  let lastSyncTime = cursor.time || extractor.getInitialSyncTime();
  let lastSyncId = cursor.id || 0;

  console.log(`Bat dau chay 1000 ban ghi tuan tu. Cursor ban dau: Time=${lastSyncTime}, ID=${lastSyncId}`);

  const maxRecords = 1000;
  let successCount = 0;
  let failCount = 0;

  for (let i = 1; i <= maxRecords; i++) {
    console.log(`\n--- [Ban ghi ${i}/${maxRecords}] ---`);
    
    // 1. Get tuan tu tung ban ghi mot tu OLDB (VanBanDen)
    const rows = await extractor.fetchBatchFromOldDb(lastSyncTime, lastSyncId, 1, 0);
    
    if (!rows || rows.length === 0) {
      console.log(`Khong con ban ghi nao trong OLDB de dong bo. Ket thuc som o vong lap ${i}.`);
      break;
    }

    const oldRow = rows[0];
    
    // Cap nhat cursor cho vong lap tiep theo
    lastSyncTime = oldRow.__sync_time ? new Date(oldRow.__sync_time).toISOString() : lastSyncTime;
    lastSyncId = oldRow.__sync_id || 0;

    console.log(`> Lay thanh cong ID = ${oldRow.ID} tu OLDB (Title: ${oldRow.Title || oldRow.TrichYeu || 'Khong co tieu de'})`);

    // 2. Dua qua incomming_documents_sync (Staging)
    await extractor.syncBatchToStaging([oldRow], instanceId);
    console.log(`> Da chen/cap nhat ban ghi vao staging.`);

    // 3. Claim ban ghi trong staging de xu ly
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
      console.log(`> [LOI] Khong claim duoc ID=${oldRow.ID} trong staging, bo qua ban ghi nay...`);
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
        console.log(`> [THANH CONG] Da dong bo vao incomming_documents.`);
        console.log(`  - Document ID (Moi): ${result.documentId}`);
        console.log(`  - Action: ${result.action}`);
        console.log(`  - Thoi gian xu ly: ${duration}ms`);
        successCount++;
      } else {
        await loader.markFailed(instanceId, stagingRow.ID, result.error);
        console.log(`> [THAT BAI] Loi: ${result.error}`);
        console.log(`  - Thoi gian xu ly: ${duration}ms`);
        failCount++;
      }
    } catch (err) {
      await loader.markFailed(instanceId, stagingRow.ID, err.message);
      console.error(`> [LOI NGHIEM TRONG] ${err.message}`);
      failCount++;
    }
  }

  console.log(`\n=== TONG KET ===`);
  console.log(`- So luong yeu cau: ${maxRecords}`);
  console.log(`- Thanh cong: ${successCount}`);
  console.log(`- That bai: ${failCount}`);
  
  process.exit(0);
}

main();
