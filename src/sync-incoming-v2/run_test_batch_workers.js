const dbConnection = require('../../db/connection');
const Extractor = require('./models/Extractor');
const Loader = require('./models/Loader');

// Đọc cấu hình từ environment variables (được set từ .bat file)
// Fallback: từ command line arguments
// Default: hard-coded values
const args = process.argv.slice(2);

let WORKER_COUNT = parseInt(process.env.WORKER_COUNT, 10) || 8;
let maxRecordsPerWorker = 0; // 0 = unlimited
let rangeSize = parseInt(process.env.RANGE_SIZE, 10) || null;

for (const arg of args) {
  if (arg.startsWith('--max=')) {
    maxRecordsPerWorker = parseInt(arg.split('=')[1], 10) || 0;
  }
  if (arg.startsWith('--workers=')) {
    WORKER_COUNT = parseInt(arg.split('=')[1], 10) || 8;
  }
  if (arg.startsWith('--range=')) {
    rangeSize = parseInt(arg.split('=')[1], 10) || null;
  }
}

if (maxRecordsPerWorker > 0) {
  rangeSize = maxRecordsPerWorker;
}

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
  const loader = new Loader(newPool, oldPool, WORKER_COUNT, rangeSize);

  await loader.initialize();

  const instanceId = `batch_${process.pid}`;
  const syncStartTime = Date.now();

  console.log(`[SYNC] Start time: ${new Date(syncStartTime).toISOString()}`);
  console.log(`[CAU HINH] Workers: ${WORKER_COUNT} | RangeSize: ${loader.rangeSize} | MaxPerWorker: ${maxRecordsPerWorker || 'unlimited'}`);
  console.log('');

  let globalProcessedCount = 0;
  let successCount = 0;
  let failCount = 0;

  const workerStats = Array(WORKER_COUNT + 1).fill(null).map(() => ({
    processed: 0,
    success: 0,
    fail: 0,
    startTime: null,
    emptyFetchCount: 0
  }));

  async function runWorker(workerId) {
    let roundIndex = 0;
    let emptyRounds = 0;

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    while (true) {
      if (maxRecordsPerWorker > 0 && workerStats[workerId].processed >= maxRecordsPerWorker) {
        break;
      }

      const { idMin, idMax } = loader.getWorkerIdRange(workerId, roundIndex);
      const initialRangeCount = await loader.countPendingInRange(instanceId, idMin, idMax);
      console.log(`[Worker ${workerId}] Round ${roundIndex + 1}. Range ${idMin}→${idMax}. Pending start: ${initialRangeCount}`);

      let consecutiveEmpty = 0;
      let processedThisRound = 0;
      let roundSuccessCount = 0;
      let roundFailCount = 0;

      while (true) {
        if (maxRecordsPerWorker > 0 && workerStats[workerId].processed >= maxRecordsPerWorker) break;

        let stagingRow = null;
        try {
          stagingRow = await loader.fetchOneFromStaging(instanceId, workerId, roundIndex);
        } catch (err) {
          console.error(`Fetch staging error: ${err.message}`);
          await sleep(1000);
          continue;
        }

        if (!stagingRow) {
          consecutiveEmpty++;
          workerStats[workerId].emptyFetchCount++;

          if (consecutiveEmpty >= 3) {
            break;
          }

          await sleep(500);
          continue;
        }

        consecutiveEmpty = 0;
        processedThisRound++;
        globalProcessedCount++;
        workerStats[workerId].processed++;

        try {
          const recordStartTime = Date.now();
          const result = await loader.processRecord(stagingRow);
          const duration = Date.now() - recordStartTime;

          if (result.success) {
            await loader.markSuccess(instanceId, stagingRow.ID);
            successCount++;
            roundSuccessCount++;
            workerStats[workerId].success++;

            if (successCount > 0 && successCount % 10 === 0) {
              const elapsed = Math.floor((Date.now() - syncStartTime) / 1000);
              console.log(`[SYNC] ${successCount} records successfully synced. Elapsed: ${elapsed}s`);
            }
          } else {
            await loader.markFailed(instanceId, stagingRow.ID, result.error);
            console.log(`THAT BAI ID=${stagingRow.ID}: ${result.error} (${duration}ms)`);
            failCount++;
            roundFailCount++;
            workerStats[workerId].fail++;
          }
        } catch (err) {
          await loader.markFailed(instanceId, stagingRow.ID, err.message);
          console.error(`LOI ID=${stagingRow.ID}: ${err.message}`);
          failCount++;
          roundFailCount++;
          workerStats[workerId].fail++;
        }
      }

      if (processedThisRound === 0) {
        emptyRounds++;
        if (emptyRounds >= 3) {
          break;
        }
      } else {
        emptyRounds = 0;
      }

      console.log(`[Worker ${workerId}] Round ${roundIndex + 1} ended. initial=${initialRangeCount}, success=${roundSuccessCount}, processed=${processedThisRound}, failed=${roundFailCount}`);

      roundIndex++;
      await sleep(200);
    }
  }
  // Khởi chạy đúng WORKER_COUNT workers song song
  const workers = [];
  for (let i = 1; i <= WORKER_COUNT; i++) {
    workers.push(runWorker(i));
  }

  await Promise.all(workers);

  // ── Tổng kết ──
  console.log(`\n=== TONG KET ===`);
  console.log(`- Tong ban ghi da xu ly: ${globalProcessedCount}`);
  console.log(`- Thanh cong: ${successCount}`);
  console.log(`- That bai: ${failCount}`);
  if (globalProcessedCount > 0) {
    console.log(`- Ty le thanh cong: ${((successCount / globalProcessedCount) * 100).toFixed(2)}%`);
  }

  if (globalProcessedCount === 0) {
    console.log(`\n[INFO] Khong co ban ghi nao duoc xu ly. Co the da dong bo het data!`);
    process.exit(2);
  }

  process.exit(0);
}

main();