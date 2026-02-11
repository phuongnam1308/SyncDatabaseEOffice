const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class DocumentCommentsSyncModel extends BaseModel {
  constructor() {
    super();
  }

  /**
   * Đếm tổng số bản ghi chưa sync (kiểm tra bằng id)
   */
  async countUnsynced() {
    try {
      const query = `
        SELECT COUNT(*) as total
        FROM camunda.dbo.document_comments2 dc2
        WHERE NOT EXISTS (
          SELECT 1
          FROM camunda.dbo.document_comments dc
          WHERE dc.id = dc2.id
        )
      `;
      
      const result = await this.queryNewDb(query, {});
      return result[0]?.total || 0;
    } catch (error) {
      logger.error('countUnsynced error:', error.message);
      return 0;
    }
  }

  /**
   * Lấy batch dữ liệu từ document_comments2 với document_id từ outgoing_documents
   * Chỉ lấy những bản ghi chưa tồn tại trong document_comments (kiểm tra bằng id)
   */
  async getBatchWithDocumentId(offset = 0, limit = 100) {
    try {
      const query = `
        SELECT
          dc2.*,
          ISNULL(od.document_id, NULL) as computed_document_id
        FROM camunda.dbo.document_comments2 dc2
        LEFT JOIN camunda.dbo.outgoing_documents od 
          ON od.id_outgoing_bak = dc2.DocumentID_bak
        WHERE NOT EXISTS (
          SELECT 1
          FROM camunda.dbo.document_comments dc
          WHERE dc.id = dc2.id
        )
        ORDER BY dc2.created_at ASC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `;

      const result = await this.queryNewDb(query, { offset, limit });
      return result;
    } catch (error) {
      logger.error('getBatchWithDocumentId error:', error.message);
      throw error;
    }
  }

  /**
   * Check xem bản ghi có tồn tại trong document_comments không (kiểm tra bằng id)
   */
  async getExistingComment(id) {
    try {
      const query = `
        SELECT id, document_id, id_comments_bak
        FROM camunda.dbo.document_comments
        WHERE id = @id
      `;
      
      const result = await this.queryNewDb(query, { id });
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      logger.error('getExistingComment error:', error.message);
      return null;
    }
  }

  /**
   * Upsert: Insert hoặc Update bản ghi
   * - Nếu id tồn tại → UPDATE
   * - Nếu không → INSERT
   */
  async upsertComment(record) {
    try {
      const id = record.id;
      const existing = await this.getExistingComment(id);

      if (existing) {
        // UPDATE bản ghi hiện có
        return await this.updateComment(record);
      } else {
        // INSERT bản ghi mới
        if (!record.id) {
          record.id = uuidv4();
        }
        return await this.insertComment(record);
      }
    } catch (error) {
      logger.error('upsertComment error:', error.message);
      throw error;
    }
  }

  /**
   * Update bản ghi comment (kiểm tra bằng id)
   */
  async updateComment(record) {
    try {
      const fields = Object.keys(record).filter(
        f => f !== 'id_comments_bak' && f !== 'id' && f !== 'computed_document_id'
      );
      
      const setClause = fields.map(f => `${f} = @${f}`).join(', ');
      const query = `
        UPDATE camunda.dbo.document_comments
        SET ${setClause}, updated_at = GETDATE()
        WHERE id = @id
      `;

      const request = this.newPool.request();
      request.input('id', record.id);
      fields.forEach(f => request.input(f, record[f]));
      
      const result = await request.query(query);
      return { action: 'UPDATE', rowsAffected: result.rowsAffected[0] || 0 };
    } catch (error) {
      logger.error('updateComment error:', error.message);
      throw error;
    }
  }

  /**
   * Insert bản ghi comment mới
   */
  async insertComment(record) {
    try {
      // Loại bỏ trường computed_document_id (dùng để xác định document_id)
      const { computed_document_id, ...insertRecord } = record;
      
      if (!insertRecord.id) {
        insertRecord.id = uuidv4();
      }

      // Sử dụng computed_document_id nếu có, nếu không dùng document_id hiện có
      if (computed_document_id) {
        insertRecord.document_id = computed_document_id;
      }

      const fields = Object.keys(insertRecord);
      const params = fields.map((_, i) => `@p${i}`).join(', ');

      const query = `
        INSERT INTO camunda.dbo.document_comments
        (${fields.join(', ')})
        VALUES (${params})
      `;

      const request = this.newPool.request();
      fields.forEach((f, i) => request.input(`p${i}`, insertRecord[f]));
      const result = await request.query(query);
      
      return { action: 'INSERT', rowsAffected: result.rowsAffected[0] || 0, insertedId: insertRecord.id };
    } catch (error) {
      logger.error('insertComment error:', error.message);
      throw error;
    }
  }
}

module.exports = DocumentCommentsSyncModel;
