const IncomingDocumentModel2 =
  require('../../models/IncomingDocumentModel2');
const logger = require('../../utils/logger');

class UpdateIncomingBookDocumentIdService {
  constructor() {
    this.model = new IncomingDocumentModel2();
    this.batchSize = 100;
  }

  async update() {
    logger.info('=== START UPDATE book_document_id (BY to_book_code) ===');

    let updated = 0;
    let notFound = 0;

    while (true) {
      const rows = await this.model.getNeedUpdate(this.batchSize);
      if (!rows || rows.length === 0) break;

      for (const row of rows) {
        const { document_id, to_book_code } = row;

        try {
          const bookDocumentId =
            await this.model.findBookDocumentIdRelative(to_book_code);

          if (!bookDocumentId) {
            notFound++;
            logger.warn(
              `[NOT FOUND] document_id=${document_id} | to_book_code=${to_book_code}`
            );
            continue;
          }

          await this.model.updateBookDocumentId(
            document_id,
            bookDocumentId
          );

          updated++;
          logger.info(
            `[UPDATED] document_id=${document_id} -> book_document_id=${bookDocumentId}`
          );
        } catch (err) {
          logger.error(
            `[ERROR] document_id=${document_id}`,
            err
          );
        }
      }
    }

    logger.info('=== FINISH UPDATE book_document_id ===');

    return { updated, notFound };
  }
}

module.exports = UpdateIncomingBookDocumentIdService;
