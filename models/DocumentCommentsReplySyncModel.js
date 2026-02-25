const BaseModel = require('./BaseModel');

class DocumentCommentsReplySyncModel extends BaseModel {
  constructor() {
    super();
    this.schema = 'dbo';
    this.table = 'document_comments2';
  }

  // Lấy TẤT CẢ record cần xử lý type
  async getAllNeedSync() {
    const query = `
      SELECT
        id,
        EmailReplyTo,
        ReplyTo
      FROM camunda.${this.schema}.${this.table}
      WHERE
        [type] IS NULL
        OR [type] NOT IN ('reply', 'comment')
    `;
    return await this.queryNewDb(query);
  }

  async updateToReply(id, emailReplyTo, replyTo) {
    const query = `
      UPDATE camunda.${this.schema}.${this.table}
      SET
        [type] = 'reply',
        EmailReplyTo = @emailReplyTo,
        ReplyTo = @replyTo,
        updated_at = GETDATE()
      WHERE id = @id
    `;
    await this.queryNewDb(query, {
      id,
      emailReplyTo,
      replyTo
    });
  }

  async updateToComment(id) {
    const query = `
      UPDATE camunda.${this.schema}.${this.table}
      SET
        [type] = 'comment',
        updated_at = GETDATE()
      WHERE id = @id
    `;
    await this.queryNewDb(query, { id });
  }
}

module.exports = DocumentCommentsReplySyncModel;
