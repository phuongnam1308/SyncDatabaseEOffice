// src/meeting-sync2/run.js
const MeetingSync2Model = require('./models/StreamMeetingSync2Model');
const logger = require('../../utils/logger');

async function main() {
  logger.info('=== Starting meeting-sync2 sync ===');
  const model = new MeetingSync2Model();
  try {
    await model.initialize();
    const result = await model.run();
    logger.info(`[meeting-sync2] Extracted: ${result.extractedCount}`);
    logger.info(`[meeting-sync2] Processed: ${result.processedCount}`);
    logger.info(`[meeting-sync2] Success:   ${result.successCount}`);
    logger.info(`[meeting-sync2] Failed:    ${result.failedCount}`);
  } catch (err) {
    logger.error('meeting-sync2 error:', err);
    process.exit(1);
  }
  process.exit(0);
}

main();
