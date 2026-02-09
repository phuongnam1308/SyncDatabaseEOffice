const AuditOutgoingSyncModel = require('../models/AuditOutgoingSyncModel');
const logger = require('../utils/logger');

class SyncAuditOutgoingService {
  constructor() {
    this.model = new AuditOutgoingSyncModel();
  }

  async sync(batchSize = 200) {
    let updated = 0;
    const rows = await this.model.getPending(batchSize);

    for (const row of rows) {
      const outgoingId = await this.model.findOutgoingId(row.VBId);

      if (!outgoingId) {
        logger.warn(`[AuditSync] Không tìm thấy outgoing cho VBId=${row.VBId}`);
        continue;
      }

      await this.model.updateAuditDocumentId(row.id, outgoingId);
      updated++;
    }

    return {
      total: rows.length,
      updated
    };
  }
}

module.exports = new SyncAuditOutgoingService();
