const DocumentCommentsSyncModel = require('../models/DocumentCommentsSyncModel');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class DocumentCommentsSyncService {
  constructor() {
    this.model = new DocumentCommentsSyncModel();
  }

  async initialize() {
    await this.model.initialize();
  }



  /**
   * Đồng bộ từ document_comments2 → document_comments
   * Logic:
   * 1. Nếu bản ghi tồn tại → UPDATE document_id với DocumentID_bak
   * 2. Nếu không tồn tại → INSERT với DocumentID_bak làm document_id
   */
  async sync(limit = 100) {
    try {
      const records = await this.model.getUnsynced(limit);

      let inserted = 0;
      let updated = 0;
      let errors = 0;
      const insertedIds = [];

      for (const record of records) {
        try {
          const idCommentsBak = record.id_comments_bak;
          const documentId = record.DocumentID_bak; // Sử dụng DocumentID_bak trực tiếp

          logger.info(`Processing: id=${idCommentsBak}, DocumentID_bak=${documentId}`);

          // Check xem bản ghi có tồn tại chưa
          const existing = await this.model.getExistingComment(idCommentsBak);

          if (existing) {
            // Luôn update với DocumentID_bak (không skip)
            if (documentId) {
              await this.model.updateDocumentId(idCommentsBak, documentId);
              updated++;
            }
          } else {
            // Bản ghi không tồn tại → INSERT
            const insertRecord = {
              id: uuidv4(),
              document_id: documentId || null, // Sử dụng DocumentID_bak làm document_id
              id_comments_bak: record.id_comments_bak,
              ItemTitle: record.ItemTitle || null,
              ItemUrl: record.ItemUrl || null,
              ItemImage: record.ItemImage || null,
              DocumentID_bak: record.DocumentID_bak || null,
              Category: record.Category || null,
              Type_bak: record.Type_bak || null,
              Email: record.Email || null,
              Author: record.Author || null,
              content: record.content || '',
              user_id_bak: record.user_id_bak || null,
              parent_id_bak: record.parent_id_bak || null,
              EmailReplyTo: record.EmailReplyTo || null,
              ReplyTo: record.ReplyTo || null,
              Files: record.Files || null,
              LikeNumber: record.LikeNumber || null,
              type: record.type || null,
              is_edited: record.is_edited || 0,
              is_leader_suggestion: record.is_leader_suggestion || 0,
              created_at: record.created_at || new Date(),
              updated_at: record.updated_at || new Date(),
              table_bak: record.table_bak || null
            };

            await this.model.insertFromIntermediate(insertRecord);
            inserted++;
            insertedIds.push(insertRecord.id);
            logger.info(`Inserted: id=${idCommentsBak}, newId=${insertRecord.id}`);
          }
        } catch (err) {
          errors++;
          logger.error(`Error processing comment ${record.id_comments_bak}:`, err.message);
        }
      }

      const result = {
        total: records.length,
        inserted,
        updated,
        errors,
        insertedIds,
        success: true,
        message: `Complete: ${inserted} inserted, ${updated} updated, ${errors} errors`
      };

      logger.info('SYNC completed:', result);
      return result;
    } catch (error) {
      logger.error('[DocumentCommentsSyncService.sync]', error);
      return {
        total: 0,
        inserted: 0,
        updated: 0,
        errors: 1,
        success: false,
        message: `Error: ${error.message}`
      };
    }
  }
}

module.exports = DocumentCommentsSyncService;
