// services/MappingBookDocOutgoingService.js
const OutgoingDocument2Model = require('../models/OutgoingDocument2Model');
const logger = require('../utils/logger');
const { formatNumber } = require('../utils/helpers');

class MappingBookDocOutgoingService {
  constructor() {
    this.model = new OutgoingDocument2Model();
  }

  async initialize() {
    await this.model.initialize();
    logger.info('MappingBookDocOutgoingService đã khởi tạo');
  }

  async mapBookDocumentIds() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU MAPPING book_document_id (clean linh hoạt) ===');

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    try {
      const outgoingResult = await this.model.queryNewDb(`
        SELECT id, sovanban
        FROM DiOffice.dbo.outgoing_documents2
        WHERE sovanban IS NOT NULL 
          AND LTRIM(RTRIM(sovanban)) <> ''
          AND (book_document_id IS NULL OR book_document_id = '')
      `);

      const outgoingRecords = outgoingResult.recordset || [];
      logger.info(`Tìm thấy ${formatNumber(outgoingRecords.length)} bản ghi cần mapping`);

      for (const record of outgoingRecords) {
        try {
          const sovanban = record.sovanban.trim();

          const bookResult = await this.model.queryNewDb(`
            SELECT TOP 1 book_document_id
            FROM DiOffice.dbo.book_documents
            WHERE UPPER(
                LTRIM(RTRIM(
                    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                        to_book_code COLLATE Vietnamese_CI_AS, 
                        N'SỐ ', ''), N'SO ', ''), N' ', ''), N'-', ''), N'/', ''
                    )
                ))
            ) = UPPER(
                LTRIM(RTRIM(
                    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                        @sovanban COLLATE Vietnamese_CI_AS, 
                        N'SỐ ', ''), N'SO ', ''), N' ', ''), N'-', ''), N'/', ''
                    )
                ))
            )
            AND type_document = 'OutGoingDocument'
            ORDER BY created_at DESC
          `, { sovanban });

          if (bookResult.recordset && bookResult.recordset.length > 0) {
            const bookId = bookResult.recordset[0].book_document_id;

            await this.model.queryNewDb(`
              UPDATE DiOffice.dbo.outgoing_documents2
              SET book_document_id = @bookId,
                  updated_at = GETDATE()
              WHERE id = @id
            `, { bookId, id: record.id });

            updatedCount++;
            logger.debug(`Mapped: "${sovanban}" → ${bookId}`);
          } else {
            skippedCount++;
            logger.debug(`Skip: "${sovanban}" không tìm thấy sổ khớp`);
          }
        } catch (err) {
          errorCount++;
          logger.error(`Lỗi id=${record.id} - sovanban="${record.sovanban}": ${err.message}`);
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info(`HOÀN THÀNH | ${duration}s | Updated: ${formatNumber(updatedCount)} | Skipped: ${formatNumber(skippedCount)} | Errors: ${formatNumber(errorCount)}`);

      return {
        success: true,
        updated: updatedCount,
        skipped: skippedCount,
        errors: errorCount,
        duration,
      };
    } catch (error) {
      logger.error('Lỗi mapping tổng thể:', error);
      throw error;
    }
  }

  async getMappingStatistics() {
    try {
      const totalOutgoing = await this.model.queryNewDb(`
        SELECT COUNT(*) AS total FROM DiOffice.dbo.outgoing_documents2
      `);

      const mapped = await this.model.queryNewDb(`
        SELECT COUNT(*) AS mapped 
        FROM DiOffice.dbo.outgoing_documents2 
        WHERE book_document_id IS NOT NULL AND book_document_id != ''
      `);

      const unmapped = await this.model.queryNewDb(`
        SELECT COUNT(*) AS unmapped 
        FROM DiOffice.dbo.outgoing_documents2 
        WHERE (book_document_id IS NULL OR book_document_id = '') 
          AND sovanban IS NOT NULL 
          AND LTRIM(RTRIM(sovanban)) != ''
      `);

      const distinctSovanban = await this.model.queryNewDb(`
        SELECT COUNT(DISTINCT sovanban) AS distinct_sovanban 
        FROM DiOffice.dbo.outgoing_documents2 
        WHERE sovanban IS NOT NULL AND LTRIM(RTRIM(sovanban)) != ''
      `);

      const total = totalOutgoing.recordset[0].total;
      return {
        total_outgoing: total,
        mapped: mapped.recordset[0].mapped,
        unmapped_with_sovanban: unmapped.recordset[0].unmapped,
        percentage_mapped: total > 0 ? ((mapped.recordset[0].mapped / total) * 100).toFixed(2) + '%' : '0%',
        distinct_sovanban_values: distinctSovanban.recordset[0].distinct_sovanban,
      };
    } catch (error) {
      logger.error('Lỗi thống kê mapping:', error);
      throw error;
    }
  }

  async close() {
    await this.model.close();
  }
}

module.exports = MappingBookDocOutgoingService;