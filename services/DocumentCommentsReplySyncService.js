const DocumentCommentsReplySyncModel =
  require('../models/DocumentCommentsReplySyncModel');
const logger = require('../utils/logger');

class DocumentCommentsReplySyncService {
  constructor() {
    this.model = new DocumentCommentsReplySyncModel();
  }

  async initialize() {
    await this.model.initialize();
  }

  async sync() {
    logger.info('=== SYNC COMMENT / REPLY (FIX CỨNG) ===');

    const records = await this.model.getAllNeedSync();

    let replyUpdated = 0;
    let commentUpdated = 0;

    for (const row of records) {
      const hasReply =
        row.EmailReplyTo !== null ||
        row.ReplyTo !== null;

      if (hasReply) {
        // 👉 REPLY
        const emailReplyTo = row.EmailReplyTo || row.ReplyTo;
        const replyTo = row.ReplyTo || row.EmailReplyTo;

        await this.model.updateToReply(
          row.id,
          emailReplyTo,
          replyTo
        );
        replyUpdated++;
      } else {
        // 👉 COMMENT (FIX CỨNG)
        await this.model.updateToComment(row.id);
        commentUpdated++;
      }
    }

    return {
      total: records.length,
      replyUpdated,
      commentUpdated
    };
  }
}

module.exports = DocumentCommentsReplySyncService;
