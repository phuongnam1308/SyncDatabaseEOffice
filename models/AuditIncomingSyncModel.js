const mssql = require('mssql');
const { newDbConfig } = require('../config/database');
const logger = require('../utils/logger');

class AuditIncomingSyncModel {
  constructor() {
    this.pool = null;
  }

  async connect() {
    if (!this.pool) {
      this.pool = await mssql.connect(newDbConfig);
      logger.info('[AuditIncomingSyncModel] DB connected');
    }
    return this.pool;
  }

  // Lấy audit2 chưa có document_id
  async getPending(limit = 200) {
    const pool = await this.connect();
    const rs = await pool.request().query(`
      SELECT TOP (${limit})
        a.id,
        a.VBId
      FROM DiOffice.dbo.audit2 a
      WHERE a.type_document = 'IncomingDocument'
        AND a.document_id IS NULL
        AND a.VBId IS NOT NULL
    `);
    return rs.recordset;
  }

  // Tìm document_id thật từ incomming_documents
  async findIncomingDocumentId(vbId) {
    const pool = await this.connect();
    const rs = await pool.request()
      .input('vbId', mssql.NVarChar(255), vbId)
      .query(`
        SELECT TOP 1 document_id
        FROM DiOffice.dbo.incomming_documents
        WHERE id_incoming_bak = @vbId
          AND tb_bak = 1
      `);

    return rs.recordset[0]?.document_id || null;
  }

  // Update audit2.document_id
  async updateAuditDocumentId(auditId, documentId) {
    const pool = await this.connect();
    await pool.request()
      .input('auditId', mssql.Int, auditId)
      .input('docId', mssql.VarChar(64), documentId)
      .query(`
        UPDATE DiOffice.dbo.audit2
        SET document_id = @docId
        WHERE id = @auditId
      `);
  }
}

module.exports = AuditIncomingSyncModel;
