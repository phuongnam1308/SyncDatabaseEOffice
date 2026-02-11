const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');

class DocumentCommentsSyncModel extends BaseModel {
  constructor() {
    super();
  }

  /**
   * Đồng bộ dữ liệu từ document_comments2 → document_comments
   * Thêm document_id từ document_comments2 vào record
   */
  async migrate(limit = 100) {
    const query = `
      INSERT INTO camunda.dbo.document_comments (
        document_id, id_comments_bak, ItemTitle, ItemUrl, ItemImage,
        DocumentID_bak, Category, Type_bak, Email, Author,
        content, user_id_bak, parent_id_bak, EmailReplyTo, ReplyTo,
        Files, LikeNumber, [type], is_edited, is_leader_suggestion,
        created_at, updated_at, table_bak
      )
      SELECT TOP (@limit)
        s.document_id, s.id_comments_bak, s.ItemTitle, s.ItemUrl, s.ItemImage,
        s.DocumentID_bak, s.Category, s.Type_bak, s.Email, s.Author,
        s.content, s.user_id_bak, s.parent_id_bak, s.EmailReplyTo, s.ReplyTo,
        s.Files, s.LikeNumber, s.[type], s.is_edited, s.is_leader_suggestion,
        s.created_at, s.updated_at, s.table_bak
      FROM camunda.dbo.document_comments2 s
      WHERE NOT EXISTS (
        SELECT 1
        FROM camunda.dbo.document_comments d
        WHERE d.id_comments_bak = s.id_comments_bak
      )
      ORDER BY s.created_at;
    `;

    const result = await this.newPool
      .request()
      .input('limit', limit)
      .query(query);

    return result.rowsAffected[0] || 0;
  }
}

module.exports = DocumentCommentsSyncModel;
