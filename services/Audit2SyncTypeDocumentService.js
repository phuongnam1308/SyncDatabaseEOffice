const Audit2SyncTypeDocumentModel =
  require('../models/Audit2SyncTypeDocumentModel');
const logger = require('../utils/logger');

class Audit2SyncTypeDocumentService {
  constructor() {
    this.model = new Audit2SyncTypeDocumentModel();
  }

  async initialize() {
    await this.model.initialize();
  }

  async syncTypeDocument() {
    logger.info('=== SYNC TYPE_DOCUMENT FOR AUDIT2 ===');

    const incoming = await this.model.updateIncoming();
    const outgoing = await this.model.updateOutgoing();

    return {
      incoming_updated: incoming,
      outgoing_updated: outgoing,
      total_updated: incoming + outgoing
    };
  }
}

module.exports = Audit2SyncTypeDocumentService;
