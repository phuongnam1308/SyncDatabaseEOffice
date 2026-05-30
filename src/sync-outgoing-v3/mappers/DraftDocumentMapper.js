const MigrationHelper = require('../../helpers/MigrationHelper');

/**
 * Mapper class for Draft Document sync (Văn bản dự thảo).
 * Maps SNP.CodeItem fields to outgoing_documents table structure.
 * Uses the same field structure as OutgoingMapper for VanBanBanHanh.
 */
class DraftDocumentMapper {
  constructor(queryNewDbTx, queryOldDb) {
    this.helper = new MigrationHelper(queryNewDbTx, queryOldDb);
  }

  _toJsonArrayString(value) {
    if (value === null || value === undefined) {
      return null;
    }

    const rawValue = String(value).trim();
    if (!rawValue) {
      return null;
    }

    return JSON.stringify([rawValue]);
  }

  /**
   * Map a raw draft document record to the outgoing_documents structure
   * @param {object} oldRecord - Raw record from SNP.CodeItem
   * @param {object} transaction - Database transaction
   * @returns {Promise<object>} Mapped record
   */
  async mapRecord(oldRecord, transaction) {
    if (!oldRecord?.ID) {
      throw new Error('Old record ID is required');
    }

    const createdAt = this.helper.parseDate(oldRecord.Created) || new Date();
    const updatedAt = this.helper.parseDate(oldRecord.Modified) || createdAt;
    const issuedDate = this.helper.parseDate(oldRecord.IssuedDate);

    const documentType = await this.helper.processDocumentType(
      this.helper.safeString(oldRecord.LoaiVanBan || oldRecord.LoaiBanHanh)
    );

    // Map status - draft documents have different status workflow
    const statusResult = this.helper.mapStatus(oldRecord.StatusText || 'DRAFT');
    const statusCode = statusResult.statusCode || oldRecord.Status || 1;
    const stageStatus = statusResult.stageStatus || 'DRAFT';
    const bpmnVersion = statusResult.bpmnVersion || 'SOANTHAO_PHATHANH_VBD';

    // Sender unit from DepartmentId, fallback to parent of CreatedBy in new users table
    const senderUnit = await this.helper.mapSenderUnitId(
      String(oldRecord.DepartmentId || ''),
      transaction
    ) || await this.helper.mapSenderUnitFromCreatedByParent(
      oldRecord.CreatedBy || oldRecord.CBNV,
      transaction
    ) || process.env.DEFAULT_RECEIVER_UNIT_ID;

    // Drafter
    const drafterRaw = this.helper.safeString(oldRecord.CreatedBy || oldRecord.CBNV);
    const drafter = await this.helper.mapUserDrafter(drafterRaw, transaction)
      || process.env.VANTHU_USER_ID || null;

    // Report signer (approver)
    const reportSigner = await this.helper.mapUserDrafter(
      this.helper.safeString(oldRecord.Approver),
      transaction
    );

    // Get abstract_note from Subject field
    const abstractNote = this.helper.cleanText(oldRecord.Subject);

    // Get title for release_no
    const releaseNo = this.helper.cleanText(oldRecord.Title);

    // Get document_id for reference
    const documentIdValue = Number(oldRecord.DocumentId || 0);
    const documentIdRef = documentIdValue > 0 ? `VBD_${documentIdValue}_DI` : null;

    // Parent/Child document references
    const parentIdValue = Number(oldRecord.ParentId || 0);
    const replacedRef = parentIdValue > 0 ? `VBD_${parentIdValue}_DRAFT` : null;

    const oldId = String(oldRecord.ID);
    const suffix = 'DRAFT';

    const uniqueId = `${oldId}_${suffix}`.toUpperCase();

    const syncTimestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const textSymbols = `dữ liệu văn bản đi dự thảo ${syncTimestamp}`;

    return {
      // Core identification
      document_id: `VBD_${uniqueId}`,
      id_outgoing_bak: uniqueId,

      // Status mapping
      status_code: statusCode,
      stage_status: stageStatus,
      bpmn_version: bpmnVersion,
      type_of_process: bpmnVersion,

      // Sender info
      sender_unit: senderUnit,
      drafter: drafter,

      // Document type and fields
      document_type: documentType,
      abstract_note: abstractNote,
      release_no: releaseNo,
      release_date: issuedDate,

      // Signer info
      report_signer: this._toJsonArrayString(reportSigner),

      // Type doc = 1 for outgoing
      type_doc: 1,

      // Document references
      reply_incoming_doc: null,
      replaced: oldRecord.VBBiThayThe ? 1 : 0,
      replaced_documents: oldRecord.VBBiThayThe,

      // Book document
      book_document_id: null,
      to_book: null,

      // Urgency and private levels - defaults for draft
      urgency_level: null,
      private_level: null,

      // Receiving units - not applicable for draft
      internal_receiving_dept: null,
      internal_receiving_unit: null,
      external_receiving_unit: null,
      recipient_ids: null,
      internal_receiving_dept_old: null,

      // Viewers and receivers
      viewers: null,
      know_receivers: null,
      vieweds: null,

      // Document field - use default for draft
      document_field: process.env.DEFAULT_DOCUMENT_FIELD || 'vn-bn-hnh-chnh',

      // Report document symbol
      report_document_symbol: null,
      to_book_text_symbols: null,

      // Deadline reply
      deadline_reply: null,

      // Code commanders
      code_commanders: null,
      commanders: null,

      // Current note
      current_note: this.helper.safeString(oldRecord.YKien),

      // Sign type
      sign_type: null,

      // From create draft
      from_create_draf: 1,

      // Table back
      tb_bak: 1,
      table_backups: 'draft_documents_sync',

      // Text symbols for tracking
      text_symbols: textSymbols,

      // Dates
      created_at: createdAt,
      updated_at: updatedAt,

      // Document ID reference (for linking draft to issued doc)
      doc_recall: documentIdRef,

      // Files placeholders
      doc_work_files: null,
      doc_proposal: null,
      doc_draft: null,
      doc_attachments: null,
      doc_replacement: replacedRef,
      doc_answer: null,

      // Processor
      processor: this._toJsonArrayString(drafter),

      // Files
      files: null,

      // Status
      status: 1,

      // Step tracking
      doc_draft: JSON.stringify({
        step: oldRecord.Step,
        previous_step: oldRecord.PreviousStep,
        workflow_id: oldRecord.WorkflowId,
        task_id: oldRecord.TaskId,
        action_status: oldRecord.ActionStatus,
        is_archived: oldRecord.IsArchived,
        is_converting: oldRecord.IsConverting,
        is_ky_quy_che: oldRecord.IsKyQuyChe,
        is_da_in: oldRecord.IsDaIn,
        is_da_ky: oldRecord.IsDaKy,
        chen_so: oldRecord.ChenSo,
        dong_moc: oldRecord.DongMoc,
        end_loop: oldRecord.EndLoop,
        ky_hai_lien: oldRecord.KyHaiLien
      })
    };
  }
}

module.exports = DraftDocumentMapper;
