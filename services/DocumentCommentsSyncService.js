const DocumentCommentsSyncModel = require('../models/DocumentCommentsSyncModel');
const logger = require('../utils/logger');

class DocumentCommentsSyncService {
  constructor() {
    this.model = new DocumentCommentsSyncModel();
  }

  async initialize() {
    await this.model.initialize();
  }

  /**
   * Đồng bộ từ document_comments2 → document_comments
   * Tự động insert document_id từ document_comments2
   */
  async sync() {
    logger.info('=== SYNC document_comments2 → document_comments ===');

    try {
      const migrated = await this.model.migrate();

      logger.info(
        `[DocumentCommentsSyncService] Đồng bộ ${migrated} bình luận từ document_comments2 → document_comments`
      );

      return {
        migrated,
        success: true,
        message: `Đã đồng bộ ${migrated} bình luận`
      };
    } catch (error) {
      logger.error('[DocumentCommentsSyncService] Lỗi đồng bộ:', error);
      return {
        migrated: 0,
        success: false,
        message: `Lỗi: ${error.message}`
      };
    }
  }
}

module.exports = DocumentCommentsSyncService;
