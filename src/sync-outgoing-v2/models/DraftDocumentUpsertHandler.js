const logger = require('../../../utils/logger');
const dbUtils = require('../../../utils/dbUtils');
const DraftDocumentMapper = require('../mappers/DraftDocumentMapper');

/**
 * Handler class for upserting draft documents into outgoing_documents table.
 * Contains business logic for Văn bản dự thảo (Tổng công ty - SNP.CodeItem).
 * Uses the same outgoing_documents table as VanBanBanHanh sync.
 */
class DraftDocumentUpsertHandler {
  constructor(newPool, oldPool) {
    this.newPool = newPool;
    this.oldPool = oldPool;
    this.mapper = new DraftDocumentMapper(
      this.queryNewDbTx.bind(this),
      this.queryOldDb.bind(this)
    );
    this.newDbName = process.env.NEW_DB_NAME || 'DataeOfficeDB';
  }

  /**
   * Query helper for new DB transaction
   */
  async queryNewDbTx(query, params, transaction) {
    const request = transaction ? transaction.request() : this.newPool.request();
    for (const [key, value] of Object.entries(params || {})) {
      request.input(key, value);
    }
    const result = await request.query(query);
    return result.recordset;
  }

  /**
   * Query helper for old DB
   */
  async queryOldDb(query, params) {
    const request = this.oldPool.request();
    for (const [key, value] of Object.entries(params || {})) {
      request.input(key, value);
    }
    const result = await request.query(query);
    return result.recordset;
  }

  /**
   * Process one draft document record
   * @param {object} oldRecord - Raw record from staging table
   * @returns {Promise<{success: boolean, documentId: string|null, error: string|null}>}
   */
  async processRecord(oldRecord) {
    if (!oldRecord) {
      return { success: false, documentId: null, error: 'No record provided' };
    }

    const id = String(oldRecord?.ID || '').trim();
    logger.info(`[DraftDocumentUpsertHandler] Processing draft ID: ${id}`);

    try {
      const result = await dbUtils.withTransactionRetry(this.newPool, async (transaction) => {
        const mapped = await this.mapper.mapRecord(oldRecord, transaction);
        if (!mapped?.document_id) {
          throw new Error('Mapped document_id is required');
        }

        // Check if exists in outgoing_documents
        const existingQuery = `
          SELECT TOP 1 document_id
          FROM ${this.newDbName}.dbo.outgoing_documents
          WHERE id_outgoing_bak = @idOutgoingBak
        `;
        const existing = await this.queryNewDbTx(existingQuery, { idOutgoingBak: mapped.id_outgoing_bak }, transaction);

        if (existing && existing.length > 0) {
          const dbDocId = existing[0].document_id;
          logger.info(`[DraftDocumentUpsertHandler] Found existing document: [${dbDocId}]`);

          await this._updateRecord(mapped, transaction, dbDocId);
          return { action: 'updated', documentId: dbDocId };
        }

        mapped.document_id = String(mapped.document_id).toUpperCase();
        await this._insertRecord(mapped, transaction);
        return { action: 'inserted', documentId: mapped.document_id };
      });

      logger.info(`[DraftDocumentUpsertHandler] Completed draft ID: ${id}, action: ${result.action}`);
      return { success: true, documentId: result.documentId, error: null };

    } catch (error) {
      logger.error(`[DraftDocumentUpsertHandler] Failed draft ID=${id}: ${error.message}`);
      return { success: false, documentId: null, error: error.message };
    }
  }

  /**
   * Insert new draft document into outgoing_documents
   */
  async _insertRecord(record, transaction) {
    const query = `
      INSERT INTO dbo.outgoing_documents (
        document_id, status_code, sender_unit, drafter, document_type,
        urgency_level, private_level, document_field, report_signer,
        report_document_symbol, to_book_text_symbols, viewers, deadline_reply,
        abstract_note, recipient_ids, internal_receiving_unit, reply_incoming_doc,
        created_at, updated_at, draft_signer, book_document_id, status,
        code_commanders, commanders, current_note, to_book, release_no,
        release_date, text_symbols, doc_work_files, doc_proposal, doc_draft,
        doc_attachments, doc_recall, doc_replacement, doc_answer,
        external_receiving_unit, internal_receiving_dept, id_outgoing_bak,
        bpmn_version, type_of_process, type_doc, know_receivers, vieweds,
        sign_type, from_create_draf, replaced, tb_bak, table_backups,
        internal_receiving_dept_old, processor, files, stage_status,
        doc_draft
      ) VALUES (
        @document_id, @status_code, @sender_unit, @drafter, @document_type,
        @urgency_level, @private_level, @document_field, @report_signer,
        @report_document_symbol, @to_book_text_symbols, @viewers, @deadline_reply,
        @abstract_note, @recipient_ids, @internal_receiving_unit, @reply_incoming_doc,
        @created_at, @updated_at, @draft_signer, @book_document_id, @status,
        @code_commanders, @commanders, @current_note, @to_book, @release_no,
        @release_date, @text_symbols, @doc_work_files, @doc_proposal, @doc_draft,
        @doc_attachments, @doc_recall, @doc_replacement, @doc_answer,
        @external_receiving_unit, @internal_receiving_dept, @id_outgoing_bak,
        @bpmn_version, @type_of_process, @type_doc, @know_receivers, @vieweds,
        @sign_type, @from_create_draf, @replaced, @tb_bak, @table_backups,
        @internal_receiving_dept_old, @processor, @files, @stage_status,
        @doc_draft
      )
    `;

    const request = transaction.request();
    const params = {
      document_id: record.document_id,
      status_code: record.status_code,
      sender_unit: record.sender_unit,
      drafter: record.drafter,
      document_type: record.document_type,
      urgency_level: record.urgency_level,
      private_level: record.private_level,
      document_field: record.document_field,
      report_signer: record.report_signer,
      report_document_symbol: record.report_document_symbol,
      to_book_text_symbols: record.to_book_text_symbols,
      viewers: record.viewers,
      deadline_reply: record.deadline_reply,
      abstract_note: record.abstract_note,
      recipient_ids: record.recipient_ids,
      internal_receiving_unit: record.internal_receiving_unit,
      reply_incoming_doc: record.reply_incoming_doc,
      created_at: record.created_at,
      updated_at: record.updated_at,
      draft_signer: record.drafter,
      book_document_id: record.book_document_id,
      status: record.status || 1,
      code_commanders: record.code_commanders,
      commanders: record.commanders,
      current_note: record.current_note,
      to_book: record.to_book,
      release_no: record.release_no,
      release_date: record.release_date,
      text_symbols: record.text_symbols,
      doc_work_files: record.doc_work_files,
      doc_proposal: record.doc_proposal,
      doc_draft: record.doc_draft,
      doc_attachments: record.doc_attachments,
      doc_recall: record.doc_recall,
      doc_replacement: record.doc_replacement,
      doc_answer: record.doc_answer,
      external_receiving_unit: record.external_receiving_unit,
      internal_receiving_dept: record.internal_receiving_dept,
      id_outgoing_bak: record.id_outgoing_bak,
      bpmn_version: record.bpmn_version,
      type_of_process: record.type_of_process,
      type_doc: record.type_doc,
      know_receivers: record.know_receivers,
      vieweds: record.vieweds,
      sign_type: record.sign_type,
      from_create_draf: record.from_create_draf,
      replaced: record.replaced,
      tb_bak: record.tb_bak,
      table_backups: record.table_backups,
      internal_receiving_dept_old: record.internal_receiving_dept_old,
      processor: record.processor,
      files: record.files,
      stage_status: record.stage_status,
      doc_draft: record.doc_draft
    };

    for (const [key, value] of Object.entries(params)) {
      request.input(key, value);
    }
    await request.query(query);
  }

  /**
   * Update existing draft document in outgoing_documents
   */
  async _updateRecord(record, transaction, existingDocId) {
    const query = `
      UPDATE dbo.outgoing_documents SET
        status_code = @status_code,
        sender_unit = @sender_unit,
        drafter = @drafter,
        document_type = @document_type,
        urgency_level = @urgency_level,
        private_level = @private_level,
        report_signer = @report_signer,
        abstract_note = @abstract_note,
        release_no = @release_no,
        release_date = @release_date,
        updated_at = @updated_at,
        current_note = @current_note,
        text_symbols = @text_symbols,
        replaced = @replaced,
        replaced_documents = @replaced_documents,
        doc_recall = @doc_recall,
        stage_status = @stage_status,
        doc_draft = @doc_draft,
        bpmn_version = @bpmn_version,
        type_of_process = @type_of_process
      WHERE document_id = @document_id
    `;

    const request = transaction.request();
    const params = {
      document_id: existingDocId,
      status_code: record.status_code,
      sender_unit: record.sender_unit,
      drafter: record.drafter,
      document_type: record.document_type,
      urgency_level: record.urgency_level,
      private_level: record.private_level,
      report_signer: record.report_signer,
      abstract_note: record.abstract_note,
      release_no: record.release_no,
      release_date: record.release_date,
      updated_at: record.updated_at,
      current_note: record.current_note,
      text_symbols: record.text_symbols,
      replaced: record.replaced,
      replaced_documents: record.replaced_documents,
      doc_recall: record.doc_recall,
      stage_status: record.stage_status,
      doc_draft: record.doc_draft,
      bpmn_version: record.bpmn_version,
      type_of_process: record.type_of_process
    };

    for (const [key, value] of Object.entries(params)) {
      request.input(key, value);
    }
    await request.query(query);
  }
}

module.exports = DraftDocumentUpsertHandler;