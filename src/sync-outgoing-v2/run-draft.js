/**
 * Entry point for running Draft Document sync (Văn bản dự thảo - Tổng công ty)
 * Source: SNP.CodeItem (DataeOfficeSNP database)
 * Usage: node run-draft.js --instance=job001
 */

const SyncDraftDocumentModel = require('./models/SyncDraftDocumentModel');
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
    logger.info(`[run-draft] Received ${signal}, requesting graceful shutdown...`);
    syncModel.stop();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Main execution
async function main() {
  logger.info(`========================================`);
  logger.info(`[run-draft] Starting Draft Document Sync`);
  logger.info(`[run-draft] Source: SNP.CodeItem (DataeOfficeSNP)`);
  logger.info(`[run-draft] Instance ID: ${instanceId}`);
  logger.info(`[run-draft] PID: ${process.pid}`);
  logger.info(`========================================`);

  const syncModel = new SyncDraftDocumentModel();
  setupGracefulShutdown(syncModel);

  try {
    // Initialize
    await syncModel.initialize(instanceId);

    // Run sync
    const result = await syncModel.run();

    logger.info(`========================================`);
    logger.info(`[run-draft] Sync completed!`);
    logger.info(`[run-draft] Extracted: ${result.extractedCount}`);
    logger.info(`[run-draft] Processed: ${result.processedCount}`);
    logger.info(`[run-draft] Success: ${result.successCount}`);
    logger.info(`[run-draft] Failed: ${result.failedCount}`);
    logger.info(`========================================`);

    process.exit(0);
  } catch (error) {
    logger.error(`[run-draft] Fatal error: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
  }
}

main();
