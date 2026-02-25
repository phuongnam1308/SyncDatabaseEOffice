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
      return null;
    } catch (err) {
      logger.error(`[getDocumentId] Lỗi tra cứu document_id:`, err);
      return null;
    }
  }

  async migrate() {
    const rows = await this.model.getAllSource();

    let inserted = 0;
    let skipped = 0;
    let updated = 0;
    let errors = 0;
    const insertedIds = [];

    for (const row of rows) {
      try {
        const commentIdBak = row.ID;
        const documentIdBak = row[this.cfg.documentIdLookup];
        const documentId = documentIdBak;

        // 1️⃣ Check xem bản ghi đã tồn tại không
        const existing = await this.model.existsByBackupId(commentIdBak);
        
        if (existing) {
          // Chỉ skip khi đã có cả document_id
          if (existing.document_id) {
            skipped++;
            continue;
          }
          // Nếu tồn tại nhưng thiếu document_id → UPDATE
          if (documentId) {
            await this.model.updateDocumentId(commentIdBak, documentId);
            updated++;
          }
          continue;
        }

        // 2️⃣ Record insert mới
        const record = {
          id: uuidv4(),
          created_at: new Date(),
          updated_at: new Date(),
          table_bak: this.cfg.tableBakName,
          document_id: documentId,
          ...this.cfg.defaultFields
        };

        // 3️⃣ Map dữ liệu theo config + FIX NULL
        for (const [targetField, sourceField] of Object.entries(this.cfg.mapping)) {
          let value = row[sourceField];
          if (targetField === 'content' && (value === null || value === undefined)) {
            value = '';
          }
          record[targetField] = value;
        }

        // 4️⃣ Insert
        await this.model.insert(record);
        inserted++;
        insertedIds.push(record.id);
        logger.info(`Inserted: id=${commentIdBak}, newId=${record.id}`);

      } catch (err) {
        errors++;
        logger.error(`Error migrate comment ID=${row.ID}:`, err.message);
      }
    }

    const result = {
      total: rows.length,
      inserted,
      updated,
      skipped,
      errors,
      insertedIds
    };
    logger.info('Migration completed:', result);
    return result;
  }
}

module.exports = MigrationDocumentCommentsService;
