/**
 * Entry point for running incoming task sync (TaskVBDen) in v2-like structure.
 * Usage: node run.js --instance=job001 --syncJobId=<sync_job_id>
 */

const SyncTaskIncomingModel = require('./models/SyncTaskIncomingModel');
const logger = require('../../utils/logger');

const args = process.argv.slice(2);
let instanceId = `pid_${process.pid}`;
let syncJobId = null;

for (const arg of args) {
  if (arg.startsWith('--instance=')) {
    instanceId = arg.split('=')[1];
  }
  if (arg.startsWith('--syncJobId=')) {
    syncJobId = arg.split('=')[1];
  }
}

function setupGracefulShutdown(syncModel) {
  const shutdown = (signal) => {
    logger.info(`[run] Received ${signal}, requesting graceful shutdown...`);
    syncModel.stop();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function main() {
  if (!syncJobId) {
    throw new Error('Missing --syncJobId argument');
  }

  const syncModel = new SyncTaskIncomingModel();
  setupGracefulShutdown(syncModel);

  await syncModel.initialize(instanceId, syncJobId);
  const result = await syncModel.run();

  logger.info(`[run] SyncTaskIncoming completed: ${JSON.stringify(result)}`);
}

main().catch((error) => {
  logger.error(`[run] Fatal error: ${error.message}`);
  logger.error(error.stack);
  process.exit(1);
});
