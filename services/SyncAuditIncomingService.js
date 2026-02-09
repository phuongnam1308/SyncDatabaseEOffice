const AuditIncomingSyncModel = require('../models/AuditIncomingSyncModel');
const logger = require('../utils/logger');

class SyncAuditIncomingService {
  constructor() {
    this.model = new AuditIncomingSyncModel();
  }

  async sync(batchSize = 200) {
    let updated = 0;
    const rows = await this.model.getPending(batchSize);

    for (const row of rows) {
      const documentId = await this.model.findIncomingDocumentId(row.VBId);

      if (!documentId) {
        logger.warn(`[AuditIncomingSync] Không tìm thấy incoming cho VBId=${row.VBId}`);
        continue;
      }

      await this.model.updateAuditDocumentId(row.id, documentId);
      updated++;
    }

    return {
      total: rows.length,
      updated
    };
  }
}

module.exports = new SyncAuditIncomingService();
