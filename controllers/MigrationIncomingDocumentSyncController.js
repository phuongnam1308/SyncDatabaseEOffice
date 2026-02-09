// services/MigrationIncomingDocumentSyncService.js
const mssql = require('mssql');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { chunkArray } = require('../utils/helpers'); // hàm chia batch bạn đã có

class MigrationIncomingDocumentSyncService {
  constructor() {
    this.batchSize = 200;
  }
/**
 * @swagger
 * /sync/incoming-document:
 *   get:
 *     summary: Đồng bộ văn bản đến
 *     tags: [IncomingDocumentSync]
 */

  async syncFromTempToMain() {
    const start = Date.now();
    logger.info('=== BẮT ĐẦU ĐỒNG BỘ incomming_documents2 → incomming_documents ===');

    let pool;
    try {
      pool = await mssql.connect(/* your camunda config */);

      // Lấy record chưa sync
      const records = await pool.request().query(`
        SELECT * FROM camunda.dbo.incomming_documents2
        WHERE tb_update IS NULL OR tb_update = 0
        ORDER BY id_incoming_bak
      `);

      const rows = records.recordset;
      if (rows.length === 0) {
        logger.info('Không có dữ liệu cần đồng bộ');
        return { total: 0, synced: 0, skipped: 0, errors: 0 };
      }

      logger.info(`Tìm thấy ${rows.length} bản ghi cần xử lý`);

      const batches = chunkArray(rows, this.batchSize);
      let synced = 0, skipped = 0, errors = 0;

      for (const batch of batches) {
        for (const row of batch) {
          try {
            // Kiểm tra đã tồn tại trong bảng chính
            const exist = await pool.request()
              .input('bak', mssql.NVarChar, row.id_incoming_bak)
              .query(`
                SELECT 1 FROM camunda.dbo.incomming_documents
                WHERE id_incoming_bak = @bak
              `);

            if (exist.recordset.length > 0) {
              skipped++;
              continue;
            }

            // Chuẩn bị dữ liệu cho bảng chính
            const data = this.prepareForMainTable(row);

            // Insert
            const fields = Object.keys(data);
            const placeholders = fields.map((_, i) => `@p${i}`).join(', ');
            const sql = `
              INSERT INTO camunda.dbo.incomming_documents (${fields.join(', ')})
              VALUES (${placeholders})
            `;

            const req = pool.request();
            fields.forEach((f, i) => req.input(`p${i}`, data[f]));

            await req.query(sql);

            // Đánh dấu đã sync ở bảng tạm
            await pool.request()
              .input('bak', mssql.NVarChar, row.id_incoming_bak)
              .query(`
                UPDATE camunda.dbo.incomming_documents2
                SET tb_update = 1, tb_bak = id_incoming_bak
                WHERE id_incoming_bak = @bak
              `);

            synced++;
            logger.info(`Synced: ${row.id_incoming_bak}`);

          } catch (err) {
            errors++;
            logger.error(`Lỗi sync ${row.id_incoming_bak || 'unknown'}: ${err.message}`);
          }
        }
      }

      const duration = ((Date.now() - start) / 1000).toFixed(2);
      logger.info(`Hoàn thành | synced: ${synced} | skipped: ${skipped} | errors: ${errors} | ${duration}s`);

      return { total: rows.length, synced, skipped, errors, duration };

    } catch (err) {
      logger.error('Lỗi toàn bộ quá trình đồng bộ:', err);
      throw err;
    } finally {
      if (pool) pool.close();
    }
  }

  prepareForMainTable(row) {
    const d = { ...row };

    // document_id bắt buộc
    d.document_id = d.document_id?.trim() || uuidv4();

    // Cắt ngắn các trường varchar giới hạn
    d.receive_method   = d.receive_method   ? String(d.receive_method).substring(0, 64)   : null;
    d.private_level    = d.private_level    ? String(d.private_level).substring(0, 64)    : null;
    d.urgency_level    = d.urgency_level    ? String(d.urgency_level).substring(0, 64)    : null;
    d.document_type    = d.document_type    ? String(d.document_type).substring(0, 128)   : null;
    d.to_book_code     = d.to_book_code     ? String(d.to_book_code).substring(0, 50)     : null;

    // Convert bit
    d.IsLibrary = [1, '1', true, 'true'].includes(d.IsLibrary) ? 1 : 0;
    d.ChenSo    = [1, '1', true, 'true'].includes(d.ChenSo)    ? 1 : 0;

    // ForwardType → tinyint
    const ft = parseInt(d.ForwardType, 10);
    d.ForwardType = isNaN(ft) ? 0 : Math.max(0, Math.min(255, ft));

    // Ngày tháng invalid → null
    ['created_at', 'updated_at', 'receive_date', 'to_book_date', 'deadline', 'resolution_deadline', 'document_date']
      .forEach(k => {
        if (d[k] && isNaN(new Date(d[k]).getTime())) d[k] = null;
      });

    // Các trường không tồn tại ở bảng tạm → null hoặc default
    d.tb_update = 1;   // chỉ dùng khi insert, nhưng bảng chính có default 0
    d.tb_bak    = null;

    return d;
  }
}

module.exports = MigrationIncomingDocumentSyncService;