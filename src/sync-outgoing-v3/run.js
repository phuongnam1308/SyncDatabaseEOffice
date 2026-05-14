/**
 * Entry point for running outgoing document sync v2
 * Usage: node run.js --instance=job001
 */

const SyncOutgoingModel = require('./models/SyncOutgoingModel');
const logger = require('../../utils/logger');

// Parse command line arguments
const args = process.argv.slice(2);
let instanceId = `pid_${process.pid}`;

for (const arg of args) {
  if (arg.startsWith('--instance=')) {
    instanceId = arg.split('=')[1];
  }
}

// Handle graceful shutdown
function setupGracefulShutdown(syncModel) {
  const shutdown = (signal) => {
    logger.info(`[run] Received ${signal}, requesting graceful shutdown...`);
    syncModel.stop();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Main execution
async function main() {
  logger.info(`========================================`);
  logger.info(`[run] Starting Outgoing Document Sync v2`);
  logger.info(`[run] Instance ID: ${instanceId}`);
  logger.info(`[run] PID: ${process.pid}`);
  logger.info(`========================================`);

  const syncModel = new SyncOutgoingModel();
  setupGracefulShutdown(syncModel);

  try {
    // Initialize
    await syncModel.initialize(instanceId);

    // Run sync
    const result = await syncModel.run();

    logger.info(`========================================`);
    logger.info(`[run] Sync completed!`);
    logger.info(`[run] Extracted: ${result.extractedCount}`);
    logger.info(`[run] Processed: ${result.processedCount}`);
    logger.info(`[run] Success: ${result.successCount}`);
    logger.info(`[run] Failed: ${result.failedCount}`);
    logger.info(`========================================`);

    process.exit(0);
  } catch (error) {
    logger.error(`[run] Fatal error: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
  }
}

main();
