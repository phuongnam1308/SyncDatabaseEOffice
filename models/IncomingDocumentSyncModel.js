// models/IncomingDocumentSyncModel.js
const mssql = require('mssql');
const { newDbConfig } = require('../config/database');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class IncomingDocumentSyncModel {
  constructor() {
    this.pool = null;
  }

  async connect() {
    if (!this.pool) {
      this.pool = await mssql.connect(newDbConfig);
      logger.info('[SyncModel] Kết nối camunda OK');
    }
    return this.pool;
  }

  async close() {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
    }
  }

  // Lấy batch record (không lọc tb_update nữa)
  async getPendingRecords(limit = 200) {
    const pool = await this.connect();
    const result = await pool.request().query(`
      SELECT TOP ${limit} *
      FROM camunda.dbo.incomming_documents2
      ORDER BY id_incoming_bak
    `);
    return result.recordset;
  }

  // Kiểm tra đã tồn tại trong bảng chính qua id_incoming_bak
  async existsInMain(id_incoming_bak) {
    const pool = await this.connect();
    const result = await pool.request()
      .input('bak', mssql.NVarChar(255), id_incoming_bak)
      .query(`
        SELECT TOP 1 1 
        FROM camunda.dbo.incomming_documents 
        WHERE id_incoming_bak = @bak
      `);
    return result.recordset.length > 0;
  }

  // Insert vào bảng chính (đã clean dữ liệu, lưu tên bảng nguồn vào tb_bak)
  async insertToMain(record) {
    const pool = await this.connect();
    const cleaned = this.cleanRecord(record);

    const columns = Object.keys(cleaned);
    const placeholders = columns.map(col => `@${col}`).join(', ');
    const query = `
      INSERT INTO camunda.dbo.incomming_documents 
      (${columns.join(', ')}) 
      VALUES (${placeholders})
    `;

    const req = pool.request();
    columns.forEach(col => req.input(col, cleaned[col]));

    await req.query(query);
  }

  // Clean dữ liệu + lưu tên bảng nguồn vào tb_bak
  cleanRecord(row) {
    const d = { ...row };

    d.document_id = d.document_id?.trim() || uuidv4();

    const truncate = (val, max) => val ? String(val).trim().substring(0, max) : null;
    d.receive_method   = truncate(d.receive_method, 64);
    d.private_level    = truncate(d.private_level, 64);
    d.urgency_level    = truncate(d.urgency_level, 64);
    d.document_type    = truncate(d.document_type, 128);
    d.to_book_code     = truncate(d.to_book_code, 50);

    d.IsLibrary = [1, '1', true, 'true'].includes(d.IsLibrary) ? 1 : 0;
    d.ChenSo    = [1, '1', true, 'true'].includes(d.ChenSo) ? 1 : 0;

    const ft = parseInt(d.ForwardType, 10);
    d.ForwardType = isNaN(ft) ? 0 : Math.max(0, Math.min(255, ft));

    ['created_at', 'updated_at', 'receive_date', 'to_book_date', 'deadline', 'resolution_deadline'].forEach(key => {
      if (d[key] && isNaN(new Date(d[key]).getTime())) d[key] = null;
    });

    // Lưu tên bảng nguồn vào tb_bak
    d.tb_bak = 'incomming_documents2';

    return d;
  }

  async getStatistics() {
    const pool = await this.connect();
    const [sourceRes, destRes] = await Promise.all([
      pool.request().query(`SELECT COUNT(*) as cnt FROM camunda.dbo.incomming_documents2`),
      pool.request().query(`SELECT COUNT(*) as cnt FROM camunda.dbo.incomming_documents`)
    ]);

    const source = sourceRes.recordset[0].cnt;
    const dest = destRes.recordset[0].cnt;

    return {
      source: source,
      destination: dest,
      synced: dest,
      percentage: source > 0 ? (dest / source * 100).toFixed(2) : 0
    };
  }
}

module.exports = IncomingDocumentSyncModel;