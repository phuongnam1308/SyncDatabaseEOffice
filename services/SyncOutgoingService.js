// services/SyncOutgoingService.js
const logger = require('../utils/logger');

class SyncOutgoingService {
  constructor(model) {
    this.model = model;
  }

  async preview() {
    return this.model.preview();
  }

  async sync(batchSize = 2000) {
    let total = 0;
    let round = 0;

    while (true) {
      round++;
      const inserted = await this.model.sync(batchSize);
      logger.info(`[SyncOutgoing] round=${round}, inserted=${inserted}`);
      total += inserted;
      if (inserted < batchSize) break;
    }

    return {
      success: true,
      totalInserted: total,
      rounds: round
    };
  }
}

module.exports = SyncOutgoingService;
    