const IncomingDocumentModel2 =
  require('../../models/IncomingDocumentModel2');
const logger = require('../../utils/logger');

class UpdateIncomingBookDocumentIdService {
  constructor() {
    this.model = new IncomingDocumentModel2();
    this.batchSize = 100;
  }

  async update() {
    logger.info('=== START UPDATE book_document_id ===');

    // BẮT BUỘC
    await this.model.initialize();

    let updated = 0;
    let notFound = 0;

    while (true) {
      const rows = await this.model.getNeedUpdate(this.batchSize);
      if (!rows.length) break;

      for (const row of rows) {
        const { document_id, to_book, to_book_code } = row;

        try {
          let bookId = null;

          // 1️⃣ ưu tiên to_book
          if (to_book) {
            bookId =
              await this.model.findBookDocumentIdByIncomingToBook(
                to_book
              );
          }

          // 2️⃣ fallback to_book_code
          if (!bookId && to_book_code) {
            bookId =
              await this.model.findBookDocumentIdByIncomingToBookCode(
                to_book_code
              );
          }

          if (!bookId) {
            notFound++;
            logger.warn(
              `[NOT FOUND] document_id=${document_id} | to_book=${to_book} | to_book_code=${to_book_code}`
            );
            continue;
          }

          await this.model.updateBookDocumentId(
            document_id,
            bookId
          );

          updated++;
          logger.info(
            `[UPDATED] document_id=${document_id} -> book_document_id=${bookId}`
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
