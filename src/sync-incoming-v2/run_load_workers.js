const SyncIncomingModel = require('./models/SyncIncomingModel');
const logger = require('../../utils/logger');

const args = process.argv.slice(2);
let workerCount = 2; // Mặc định chạy 2 worker
let instanceId = `pid_${process.pid}`;

for (const arg of args) {
  if (arg.startsWith('--workers=')) {
    workerCount = parseInt(arg.split('=')[1], 10) || 2;
  }
  if (arg.startsWith('--instance=')) {
    instanceId = arg.split('=')[1];
  }
}

function setupGracefulShutdown(syncModel) {
  const shutdown = (signal) => {
    logger.info(`[run_load_workers] Received ${signal}, requesting graceful shutdown...`);
    syncModel.stop();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function main() {
  logger.info(`========================================`);
  logger.info(`[run_load_workers] Starting Incoming Document LOAD ONLY Phase`);
  logger.info(`[run_load_workers] Workers: ${workerCount}`);
  logger.info(`[run_load_workers] Instance ID: ${instanceId}`);
  logger.info(`========================================`);

  const syncModel = new SyncIncomingModel();
  setupGracefulShutdown(syncModel);

  try {
    await syncModel.initialize(instanceId);

    logger.info(`[run_load_workers] Bắt đầu khởi chạy ${workerCount} worker song song đổ data từ staging -> main...`);

    // Chạy song song N hàm runLoad() thay vì gọi syncModel.run() (bỏ qua extract)
    const workers = [];
    for (let i = 0; i < workerCount; i++) {
      workers.push(
        syncModel.runLoad().then(res => {
          logger.info(`Worker ${i + 1} hoàn thành! Xử lý: ${res.processedCount}`);
          return res;
        })
      );
    }

    const results = await Promise.all(workers);

    let totalProcessed = 0;
    let totalSuccess = 0;
    let totalFailed = 0;

    for (const res of results) {
      totalProcessed += res.processedCount;
      totalSuccess += res.successCount;
      totalFailed += res.failedCount;
    }

    logger.info(`========================================`);
    logger.info(`[run_load_workers] LOAD COMPLETED!`);
    logger.info(`[run_load_workers] Total Processed: ${totalProcessed}`);
    logger.info(`[run_load_workers] Total Success:   ${totalSuccess}`);
    logger.info(`[run_load_workers] Total Failed:    ${totalFailed}`);
    logger.info(`========================================`);

    process.exit(0);
  } catch (error) {
    logger.error(`[run_load_workers] Fatal error: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
  }
}

main();
