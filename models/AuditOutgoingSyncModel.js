const mssql = require('mssql');
const { newDbConfig } = require('../config/database');
const logger = require('../utils/logger');

class AuditOutgoingSyncModel {
  constructor() {
    this.pool = null;
  }

  async connect() {
    if (!this.pool) {
      this.pool = await mssql.connect(newDbConfig);
      logger.info('[AuditOutgoingSyncModel] DB connected');
    }
    return this.pool;
  }

  // Lấy các audit2 cần update document_id
  async getPending(limit = 200) {
    const pool = await this.connect();
    const rs = await pool.request().query(`
      SELECT TOP (${limit})
        a.id,
        a.VBId
      FROM DiOffice.dbo.audit2 a
      WHERE a.type_document = 'OutgoingDocument'
        AND a.document_id IS NULL
        AND a.VBId IS NOT NULL
    `);
    return rs.recordset;
  }

  // Tìm outgoing_documents.id theo VBId
  async findOutgoingId(vbId) {
    const pool = await this.connect();
    const rs = await pool.request()
      .input('vbId', mssql.NVarChar(255), vbId)
      .query(`
        SELECT TOP 1 id
        FROM DiOffice.dbo.outgoing_documents
        WHERE id_outgoing_bak = @vbId
          AND tb_bak = 1
      `);

    return rs.recordset[0]?.id || null;
  }

  // Update audit2.document_id
  async updateAuditDocumentId(auditId, documentId) {
    const pool = await this.connect();
    await pool.request()
      .input('auditId', mssql.Int, auditId)
      .input('docId', mssql.Int, documentId)
      .query(`
        UPDATE DiOffice.dbo.audit2
        SET document_id = @docId
        WHERE id = @auditId
      `);
  }
}

module.exports = AuditOutgoingSyncModel;
