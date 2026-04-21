/**
 * Entry point for running incoming document sync v2
 * Usage: node run.js --instance=job001
 *
 * Mirrors sync-outgoing-v2/run.js but targets VanBanDen → incomming_documents.
 */

const SyncIncomingModel = require('./models/SyncIncomingModel');
const logger = require('../../utils/logger');

// Parse command line arguments
const args = process.argv.slice(2);
let instanceId = `pid_${process.pid}`;

for (const arg of args) {
  if (arg.startsWith('--instance=')) {
    instanceId = arg.split('=')[1];
  }
}

// ──────────────────────────────────────────────
// Graceful shutdown
// ──────────────────────────────────────────────

function setupGracefulShutdown(syncModel) {
  const shutdown = (signal) => {
    logger.info(`[run:incoming] Received ${signal}, requesting graceful shutdown...`);
    syncModel.stop();
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main() {
  logger.info(`========================================`);
  logger.info(`[run:incoming] Starting Incoming Document Sync v2`);
  logger.info(`[run:incoming] Instance ID: ${instanceId}`);
  logger.info(`[run:incoming] PID: ${process.pid}`);
  logger.info(`========================================`);

  const syncModel = new SyncIncomingModel();
  setupGracefulShutdown(syncModel);

  try {
    await syncModel.initialize(instanceId);

    const result = await syncModel.run();

    logger.info(`========================================`);
    logger.info(`[run:incoming] Sync completed!`);
    logger.info(`[run:incoming] Extracted: ${result.extractedCount}`);
    logger.info(`[run:incoming] Processed: ${result.processedCount}`);
    logger.info(`[run:incoming] Success:   ${result.successCount}`);
    logger.info(`[run:incoming] Failed:    ${result.failedCount}`);
    logger.info(`========================================`);

    process.exit(0);
  } catch (error) {
    logger.error(`[run:incoming] Fatal error: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
  }
}

main();
