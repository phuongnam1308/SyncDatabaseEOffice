const logger = require('../../../utils/logger');
const dbUtils = require('../../../utils/dbUtils');
const UnitDraftMapper = require('../mappers/UnitDraftMapper');

/**
 * UnitDraftUpsertHandler - Xử lý lưu dữ liệu Văn bản đi đơn vị (từ SharePoint) vào outgoing_documents
 */
class UnitDraftUpsertHandler {
  constructor(newPool, oldPool) {
    this.newPool = newPool;
    this.oldPool = oldPool;
    this.mapper = new UnitDraftMapper(
      this.queryNewDbTx.bind(this),
      this.queryOldDb.bind(this)
    );
    this.newDbName = process.env.NEW_DB_NAME || 'DataeOfficeDB';
  }

  async queryNewDbTx(query, params, transaction) {
    const request = transaction ? transaction.request() : this.newPool.request();
    for (const [key, value] of Object.entries(params || {})) {
      request.input(key, value);
    }
    const result = await request.query(query);
    return result.recordset;
  }

  async queryOldDb(query, params) {
    const request = this.oldPool.request();
    for (const [key, value] of Object.entries(params || {})) {
      request.input(key, value);
    }
    const result = await request.query(query);
    return result.recordset;
  }

  async processRecord(oldRecord) {
    if (!oldRecord) return { success: false, error: 'No record' };

    const id = String(oldRecord.ID);
    try {
      const result = await dbUtils.withTransactionRetry(this.newPool, async (transaction) => {
        const mapped = await this.mapper.mapRecord(oldRecord, transaction);
        
        // Kiểm tra tồn tại
        const existing = await this.queryNewDbTx(
          `SELECT TOP 1 document_id FROM dbo.outgoing_documents WHERE id_outgoing_bak = @bakId`,
          { bakId: mapped.id_outgoing_bak },
          transaction
        );

        if (existing?.length) {
          await this._updateRecord(mapped, transaction, existing[0].document_id);
          return { action: 'updated', docId: existing[0].document_id };
        } else {
          await this._insertRecord(mapped, transaction);
          return { action: 'inserted', docId: mapped.document_id };
        }
      });

      return { success: true, documentId: result.docId, action: result.action };
    } catch (error) {
      logger.error(`[UnitDraftUpsertHandler] Error ID ${id}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async _insertRecord(record, transaction) {
    const query = `
      INSERT INTO dbo.outgoing_documents (
        document_id, id_outgoing_bak, status_code, stage_status, bpmn_version, type_of_process,
        sender_unit, drafter, report_signer, document_type, abstract_note, release_no,
        text_symbols, release_date, type_doc, from_create_draf, status, created_at, updated_at,
        table_backups, current_note, doc_draft
      ) VALUES (
        @document_id, @id_outgoing_bak, @status_code, @stage_status, @bpmn_version, @type_of_process,
        @sender_unit, @drafter, @report_signer, @document_type, @abstract_note, @release_no,
        @text_symbols, @release_date, @type_doc, @from_create_draf, @status, @created_at, @updated_at,
        @table_backups, @current_note, @doc_draft
      )
    `;
    const request = transaction.request();
    for (const [key, value] of Object.entries(record)) {
      request.input(key, value);
    }
    await request.query(query);
  }

  async _updateRecord(record, transaction, existingId) {
    const query = `
      UPDATE dbo.outgoing_documents SET
        status_code = @status_code,
        stage_status = @stage_status,
        sender_unit = @sender_unit,
        drafter = @drafter,
        report_signer = @report_signer,
        abstract_note = @abstract_note,
        release_no = @release_no,
        text_symbols = @text_symbols,
        release_date = @release_date,
        updated_at = @updated_at,
        current_note = @current_note,
        doc_draft = @doc_draft
      WHERE document_id = @existingId
    `;
    const request = transaction.request();
    request.input('existingId', existingId);
    for (const [key, value] of Object.entries(record)) {
      if (key !== 'document_id' && key !== 'id_outgoing_bak' && key !== 'created_at') {
        request.input(key, value);
      }
    }
    await request.query(query);
  }
}

module.exports = UnitDraftUpsertHandler;
