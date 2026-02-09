// services/incomingSync.service.js
const logger = require('../utils/logger');

class IncomingSyncService {
  constructor(pool) {
    this.pool = pool;
    this.srcTable = 'incomming_documents2';
    this.destTable = 'incomming_documents';
    this.tableBackupName = this.srcTable;
  }

  /** PREVIEW */
  async preview() {
    const sql = `
      SELECT COUNT(*) AS total_can_sync
      FROM camunda.dbo.${this.srcTable} s
      WHERE NOT EXISTS (
        SELECT 1 FROM camunda.dbo.${this.destTable} d
        WHERE d.document_id = s.document_id
      )
    `;
    const { recordset } = await this.pool.request().query(sql);
    return recordset[0];
  }

  /** SYNC */
  async sync(batchSize = 1000) {
    /** ---------- INSERT ---------- */
    const insertSql = `
      INSERT INTO camunda.dbo.${this.destTable} (
        document_id,
        status_code,
        created_at,
        updated_at,
        book_document_id,
        abstract_note,
        to_book,
        sender_unit,
        receiver_unit,
        document_date,
        receive_date,
        to_book_date,
        deadline,
        second_book,
        receive_method,
        private_level,
        urgency_level,
        document_type,
        document_field,
        signer,
        to_book_code,
        fileids,
        status,
        parent_doc,
        type_process_doc,
        bpmn_version,
        SoVanBan,
        id_incoming_bak,
        TrangThai,
        tb_bak
      )
      SELECT TOP (${batchSize})
        s.document_id,
        s.status_code,
        s.created_at,
        s.updated_at,
        s.book_document_id,
        s.abstract_note,
        s.to_book,
        s.sender_unit,
        s.receiver_unit,
        s.document_date,
        s.receive_date,
        s.to_book_date,
        s.deadline,
        s.second_book,
        s.receive_method,
        s.private_level,
        s.urgency_level,
        s.document_type,
        s.document_field,
        s.signer,
        s.to_book_code,
        s.fileids,
        s.status,
        s.parent_doc,
        s.type_process_doc,
        s.bpmn_version,
        s.SoVanBan,
        s.id_incoming_bak,
        s.TrangThai,
        '${this.tableBackupName}'
      FROM camunda.dbo.${this.srcTable} s
      WHERE NOT EXISTS (
        SELECT 1 FROM camunda.dbo.${this.destTable} d
        WHERE d.document_id = s.document_id
      )
      ORDER BY s.created_at;

      SELECT @@ROWCOUNT AS inserted;
    `;

    const insertResult = await this.pool.request().query(insertSql);
    const inserted = insertResult?.recordset?.[0]?.inserted || 0;

    /** ---------- UPDATE tb_bak (PHÒNG TRƯỜNG HỢP ĐÃ TỒN TẠI) ---------- */
    const updateSql = `
      UPDATE d
      SET d.tb_bak = '${this.tableBackupName}'
      FROM camunda.dbo.${this.destTable} d
      JOIN camunda.dbo.${this.srcTable} s
        ON d.document_id = s.document_id
      WHERE d.tb_bak IS NULL
    `;

    const updateResult = await this.pool.request().query(updateSql);
    const updated = updateResult.rowsAffected?.[0] || 0;

    logger.info(
      `[IncomingSync] inserted=${inserted}, updated_tb_bak=${updated}`
    );

    return { inserted, updated };
  }
}

module.exports = IncomingSyncService;
