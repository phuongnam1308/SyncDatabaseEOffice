const DocumentCommentsMigrationModel =
  require('../models/DocumentCommentsMigrationModel');
const {
  documentCommentsMigration
} = require('../config/documentCommentsMigration.config');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class MigrationDocumentCommentsService {
  constructor() {
    this.model = new DocumentCommentsMigrationModel();
    this.cfg = documentCommentsMigration;
  }

  async initialize() {
    await this.model.initialize();
  }

  // Helper: Lấy document_id từ incoming_documents hoặc outgoing_documents bằng DocumentID_bak
  async getDocumentId(documentIdBak) {
    try {
      if (!documentIdBak) return null;

      // Thử tìm trong incoming_documents trước
      const incomingQuery = `
        SELECT TOP 1 document_id
        FROM camunda.dbo.incomming_documents2
        WHERE id_incoming_bak = @documentIdBak
      `;
      
      const incoming = await this.model.queryNewDb(incomingQuery, { documentIdBak });
      if (incoming.length > 0) {
        return incoming[0].document_id;
      }

      // Nếu không tìm thấy, thử tìm trong outgoing_documents
      const outgoingQuery = `
        SELECT TOP 1 document_id
        FROM camunda.dbo.outgoing_documents2
        WHERE id_outgoing_bak = @documentIdBak
      `;
      
      const outgoing = await this.model.queryNewDb(outgoingQuery, { documentIdBak });
      if (outgoing.length > 0) {
        return outgoing[0].document_id;
      }

      logger.warn(`[getDocumentId] Không tìm thấy document_id cho DocumentID_bak=${documentIdBak}`);
      return null;
    } catch (err) {
      logger.error(`[getDocumentId] Lỗi tra cứu document_id:`, err);
      return null;
    }
  }

  async migrate() {
    logger.info('=== MIGRATE COMMENTS THEO CONFIG (FIX CONTENT NULL) ===');

    const rows = await this.model.getAllSource();

    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of rows) {
      try {
        // 1️⃣ Bỏ qua nếu đã migrate
        if (await this.model.existsByBackupId(row.ID)) {
          skipped++;
          continue;
        }

        // 2️⃣ Record insert
        const record = {
          id: uuidv4(),
          created_at: new Date(),
          updated_at: new Date(),
          table_bak: this.cfg.tableBakName,
          ...this.cfg.defaultFields
        };

        // 3️⃣ Map dữ liệu theo config + FIX NULL
        for (const [targetField, sourceField] of
          Object.entries(this.cfg.mapping)) {

          let value = row[sourceField];

          // FIX CỨNG: content KHÔNG ĐƯỢC NULL
          if (
            targetField === 'content' &&
            (value === null || value === undefined)
          ) {
            value = '';
          }

          record[targetField] = value;
        }

        // 4️⃣ Lấy document_id từ incoming hoặc outgoing documents
        const documentIdBak = row[this.cfg.documentIdLookup];
        const documentId = await this.getDocumentId(documentIdBak);
        record.document_id = documentId;

        // 5️⃣ Insert
        await this.model.insert(record);
        inserted++;

      } catch (err) {
        errors++;
        logger.error(
          `Lỗi migrate comment ID=${row.ID}`,
          err
        );
      }
    }

    return {
      total: rows.length,
      inserted,
      skipped,
      errors
    };
  }
}

module.exports = MigrationDocumentCommentsService;
