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
   * Batch processing: xử lý 100 bản ghi mỗi lần
   * 
   * Logic:
   * 1. Lấy bản ghi từ document_comments2 chưa sync (chỉ những bản ghi mà id_comments_bak chưa tồn tại)
   * 2. Với mỗi bản ghi:
   *    - Nếu id_comments_bak tồn tại → UPDATE tất cả trường (bao gồm document_id lấy từ outgoing_documents)
   *    - Nếu chưa tồn tại → INSERT bản ghi mới với id và document_id lấy từ outgoing_documents
   * 3. document_id: lấy từ outgoing_documents.document_id (JOIN với id_outgoing_bak = DocumentID_bak)
   * 
   * @param {number} batchSize - Số bản ghi xử lý mỗi batch (default 100)
   * @returns {object} Kết quả sync
   */
  async sync(batchSize = 100) {
    logger.info('=== START SYNC document_comments2 → document_comments (BATCH MODE) ===');
    
    try {
      const totalUnsynced = await this.model.countUnsynced();
      logger.info(`Total unsynced records: ${totalUnsynced}`);

      if (totalUnsynced === 0) {
        logger.info('No unsynced records found.');
        return {
          totalUnsynced: 0,
          totalProcessed: 0,
          inserted: 0,
          updated: 0,
          errors: 0,
          success: true,
          message: 'No unsynced records found'
        };
      }

      let totalProcessed = 0;
      let inserted = 0;
      let updated = 0;
      let errors = 0;
      let offset = 0;

      // Batch processing loop
      while (offset < totalUnsynced) {
        try {
          logger.info(`\nProcessing batch: offset=${offset}, limit=${batchSize}`);
          
          const batch = await this.model.getBatchWithDocumentId(offset, batchSize);
          
          if (!batch || batch.length === 0) {
            logger.info('No more records in batch. Stopping.');
            break;
          }

          logger.info(`Batch size: ${batch.length}`);

          // Process each record in the batch
          for (const record of batch) {
            try {
              const result = await this.model.upsertComment(record);
              totalProcessed++;

              if (result.action === 'INSERT') {
                inserted++;
                logger.info(
                  `[INSERT] id_comments_bak=${record.id_comments_bak}, ` +
                  `document_id=${record.computed_document_id || 'NULL'}, ` +
                  `newId=${result.insertedId}`
                );
              } else if (result.action === 'UPDATE') {
                updated++;
                logger.info(
                  `[UPDATE] id_comments_bak=${record.id_comments_bak}, ` +
                  `document_id=${record.computed_document_id || 'NULL'}`
                );
              }
            } catch (error) {
              errors++;
              logger.error(
                `Error processing record id_comments_bak=${record.id_comments_bak}:`,
                error.message
              );
            }
          }

          offset += batchSize;
          logger.info(`Completed batch. Processed so far: ${totalProcessed}/${totalUnsynced}`);
        } catch (error) {
          logger.error(`Error processing batch at offset ${offset}:`, error.message);
          errors += (totalUnsynced - totalProcessed);
          break;
        }
      }

      const result = {
        totalUnsynced,
        totalProcessed,
        inserted,
        updated,
        errors,
        success: errors === 0,
        message: `Complete: ${inserted} inserted, ${updated} updated, ${errors} errors out of ${totalProcessed} processed`
      };

      logger.info('\n=== SYNC COMPLETED ===');
      logger.info(result);
      return result;
    } catch (error) {
      logger.error('[DocumentCommentsSyncService.sync] Fatal error:', error);
      return {
        totalUnsynced: 0,
        totalProcessed: 0,
        inserted: 0,
        updated: 0,
        errors: 1,
        success: false,
        message: `Fatal error: ${error.message}`
      };
    }
  }
}

module.exports = DocumentCommentsSyncService;
