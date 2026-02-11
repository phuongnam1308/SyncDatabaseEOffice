const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class DocumentCommentsSyncModel extends BaseModel {
  constructor() {
    super();
  }

  /**
   * Check xem bản ghi có tồn tại trong document_comments và có document_id không
   */
  async getExistingComment(idCommentsBak) {
    try {
      const query = `
        SELECT id, document_id, id_comments_bak
        FROM camunda.dbo.document_comments
        WHERE id_comments_bak = @idCommentsBak
      `;
      
      const result = await this.queryNewDb(query, { idCommentsBak });
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Update document_id cho bản ghi hiện có
   */
  async updateDocumentId(idCommentsBak, documentId) {
    try {
      const query = `
        UPDATE camunda.dbo.document_comments
        SET document_id = @documentId,
            updated_at = GETDATE()
        WHERE id_comments_bak = @idCommentsBak
      `;
      
      await this.queryNewDb(query, { idCommentsBak, documentId });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Insert bản ghi mới từ document_comments2 → document_comments
   */
  async insertFromIntermediate(record) {
    try {
      if (!record.id) {
        record.id = uuidv4();
      }

      const fields = Object.keys(record);
      const params = fields.map((_, i) => `@p${i}`).join(', ');

      const query = `
        INSERT INTO camunda.dbo.document_comments
        (${fields.join(', ')})
        VALUES (${params})
      `;

      const request = this.newPool.request();
      fields.forEach((f, i) => request.input(`p${i}`, record[f]));
      await request.query(query);
    } catch (error) {
      logger.error('insertFromIntermediate error:', error.message);
      throw error;
    }
  }

  /**
   * Lấy tất cả bản ghi từ document_comments2 chưa sync
   */
  async getUnsynced(limit = 100) {
    try {
      const query = `
        SELECT TOP (@limit) *
        FROM camunda.dbo.document_comments2
        ORDER BY created_at ASC
      `;

      const result = await this.queryNewDb(query, { limit });
      return result;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = DocumentCommentsSyncModel;
