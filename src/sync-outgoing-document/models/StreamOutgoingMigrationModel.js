const BaseModel = require("../../../models/BaseModel");
const logger = require("../../../utils/logger");
const MigrationHelper = require("../../helpers/MigrationHelper");

class StreamOutgoingMigrationModel extends BaseModel {
  constructor() {
    super();
    this.dbName = process.env.NEW_DB_NAME;
    this.mainSchema = "dbo";
    this.mainTable = "outgoing_documents";
    this.helper = new MigrationHelper(this.queryNewDbTx.bind(this), this.queryOldDb.bind(this));
  }

  async processSingleRecord(rowData, transaction) {
    if (!rowData || typeof rowData !== "object") {
      throw new Error("rowData is required");
    }

    if (!rowData.ID) {
      throw new Error("rowData.ID is required");
    }

    if (!transaction) {
      throw new Error("Transaction is required");
    }

    try {
      // 1. Map raw -> main structure
      const mapped = await this._mapSingleRecord(rowData, transaction);

      if (!mapped?.document_id) {
        throw new Error("Mapped document_id is required");
      }

      // 2. Check tồn tại
      const existingQuery = `
        SELECT TOP 1 document_id
        FROM ${this.dbName}.${this.mainSchema}.${this.mainTable}
        WHERE id_outgoing_bak = @idOutgoingBak
      `;

      const existing = await this.queryNewDbTx(
        existingQuery,
        { idOutgoingBak: mapped.id_outgoing_bak },
        transaction
      );

      if (existing && existing.length > 0) {
        await this._updateRecord(mapped, transaction);

        return {
          action: "updated",
          affected: 1,
          documentId: existing[0].document_id
        };
      }

      await this._insertRecord(mapped, transaction);

      return {
        action: "inserted",
        affected: 1,
        documentId: mapped.document_id
      };

    } catch (error) {
      logger.error(
        `[processSingleRecord] Error ID=${rowData?.ID}: ${error.message}`
      );
      throw error;
    }
  }

  async _mapSingleRecord(oldRecord, transaction) {
    if (!oldRecord?.ID) {
      throw new Error("Old record ID is required");
    }

    const promulgationDate = this.helper.parseDate(oldRecord.NgayBanHanh);

    const documentType = await this.helper.processDocumentType(
      oldRecord.LoaiVanBan || oldRecord.LoaiBanHanh
    );

    const urgencyLevel = await this.helper.processUrgencyLevel(oldRecord.DoKhan);
    const privateLevel = await this.helper.processPrivateLevel(oldRecord.DoMat);

    const senderUnit = await this.helper.mapSenderUnitId(
      oldRecord.DonVi,
      transaction);
    const drafter = await this.helper.mapUserName(
      oldRecord.CreatedBy || oldRecord.NguoiSoanThaoText,
      transaction
    );

    const reportSigner = await this.helper.mapUserName(
      oldRecord.NguoiKyVanBanText,
      transaction
    );

    const bookDocumentObj = await this.helper.mapBookDocument(
      oldRecord.SoVanBan || oldRecord.SoVanBanText,
      { drafter, senderUnit, privateLevel }
    );
    // Map đơn vị nhận internalReceivingDeptIds
    const units = this.helper.splitStringSplitBySemicolon(oldRecord.NoiNhan);
    const internalReceivingDeptIds = [];
    for (const unit of units) {
      const id = await this.helper.mapSenderUnitId(unit, transaction);
      if (id) {
        internalReceivingDeptIds.push(id);
      }
    }
    const internalReceivingDeptIdsStr = JSON.stringify(internalReceivingDeptIds);

    return {
      document_id: `${Date.now()}${Math.floor(Math.random() * 10000)}`,
      id_outgoing_bak: String(oldRecord.ID),
      status_code: this.helper.mapStatus(oldRecord.TrangThai),
      sender_unit: senderUnit,
      internal_receiving_dept: internalReceivingDeptIdsStr,
      drafter,
      document_type: documentType,
      urgency_level: urgencyLevel,
      private_level: privateLevel,
      report_signer: reportSigner,
      book_document_id: bookDocumentObj?.id ?? null,
      release_no: this.helper.cleanText(oldRecord.Title),
      release_date: promulgationDate ?? null,
      abstract_note: this.helper.cleanText(oldRecord.TrichYeu),
      to_book: bookDocumentObj?.count ?? null,
      type_doc: 1,
      bpmn_version: "SOANTHAO_PHATHANH_VBD",
      type_of_process: "SOANTHAO_PHATHANH_VBD",
      created_at: this.helper.parseDate(oldRecord.Created),
      updated_at: this.helper.parseDate(oldRecord.Modified),
      replaced: 0,
      tb_bak: 1
    };
  }

  async _insertRecord(record, transaction) {
    const query = `
      INSERT INTO ${this.dbName}.${this.mainSchema}.${this.mainTable} (
        document_id,
        status_code,
        sender_unit,
        drafter,
        document_type,
        urgency_level,
        private_level,
        document_field,
        report_signer,
        report_document_symbol,
        to_book_text_symbols,
        viewers,
        deadline_reply,
        abstract_note,
        recipient_ids,
        internal_receiving_unit,
        reply_incomming_doc,
        created_at,
        updated_at,
        draft_signer,
        book_document_id,
        status,
        code_commanders,
        commanders,
        current_note,
        to_book,
        release_no,
        release_date,
        text_symbols,
        doc_work_files,
        doc_proposal,
        doc_draft,
        doc_attachments,
        doc_recall,
        doc_replacement,
        doc_answer,
        external_receiving_unit,
        internal_receiving_dept,
        processor,
        files,
        type_doc,
        bpmn_version,
        vieweds,
        know_receivers,
        type_of_process,
        replaced_documents,
        id_outgoing_bak,
        internal_receiving_dept_old,
        sign_type,
        from_create_draf,
        replaced,
        tb_bak
      )
      VALUES (
        @document_id,
        @status_code,
        @sender_unit,
        @drafter,
        @document_type,
        @urgency_level,
        @private_level,
        @document_field,
        @report_signer,
        @report_document_symbol,
        @to_book_text_symbols,
        @viewers,
        @deadline_reply,
        @abstract_note,
        @recipient_ids,
        @internal_receiving_unit,
        @reply_incomming_doc,
        @created_at,
        @updated_at,
        @draft_signer,
        @book_document_id,
        1,
        @code_commanders,
        @commanders,
        @current_note,
        @to_book,
        @release_no,
        @release_date,
        @text_symbols,
        @doc_work_files,
        @doc_proposal,
        @doc_draft,
        @doc_attachments,
        @doc_recall,
        @doc_replacement,
        @doc_answer,
        @external_receiving_unit,
        @internal_receiving_dept,
        @processor,
        @files,
        @type_doc,
        @bpmn_version,
        @vieweds,
        @know_receivers,
        @type_of_process,
        @replaced_documents,
        @id_outgoing_bak,
        @internal_receiving_dept_old,
        @sign_type,
        @from_create_draf,
        @replaced,
        @tbBak
      )
    `;

    const params = this._mapRecordParams(record);
    await this.queryNewDbTx(query, params, transaction);
  }

  async _updateRecord(record, transaction) {
    const query = `
      UPDATE ${this.dbName}.${this.mainSchema}.${this.mainTable}
      SET
        status_code = @status_code,
        sender_unit = @sender_unit,
        drafter = @drafter,
        document_type = @document_type,
        urgency_level = @urgency_level,
        private_level = @private_level,
        document_field = @document_field,
        report_signer = @report_signer,
        report_document_symbol = @report_document_symbol,
        to_book_text_symbols = @to_book_text_symbols,
        viewers = @viewers,
        deadline_reply = @deadline_reply,
        abstract_note = @abstract_note,
        recipient_ids = @recipient_ids,
        internal_receiving_unit = @internal_receiving_unit,
        reply_incomming_doc = @reply_incomming_doc,
        updated_at = GETDATE(),
        draft_signer = @draft_signer,
        book_document_id = @book_document_id,
        status = 1,
        code_commanders = @code_commanders,
        commanders = @commanders,
        current_note = @current_note,
        to_book = @to_book,
        release_no = @release_no,
        release_date = @release_date,
        text_symbols = @text_symbols,
        doc_work_files = @doc_work_files,
        doc_proposal = @doc_proposal,
        doc_draft = @doc_draft,
        doc_attachments = @doc_attachments,
        doc_recall = @doc_recall,
        doc_replacement = @doc_replacement,
        doc_answer = @doc_answer,
        external_receiving_unit = @external_receiving_unit,
        internal_receiving_dept = @internal_receiving_dept,
        processor = @processor,
        files = @files,
        type_doc = @type_doc,
        bpmn_version = @bpmn_version,
        vieweds = @vieweds,
        know_receivers = @know_receivers,
        type_of_process = @type_of_process,
        replaced_documents = @replaced_documents,
        internal_receiving_dept_old = @internal_receiving_dept_old,
        sign_type = @sign_type,
        from_create_draf = @from_create_draf,
        replaced = @replaced,
        tb_bak = @tbBak
      WHERE id_outgoing_bak = @id_outgoing_bak
    `;

    const params = this._mapRecordParams(record);
    await this.queryNewDbTx(query, params, transaction);
  }

  _mapRecordParams(record) {
    if (!record || typeof record !== 'object') {
      return {};
    }

    return {
      document_id: record.document_id ?? null,
      status_code: record.status_code ?? null,
      sender_unit: record.sender_unit ?? null,
      drafter: record.drafter ?? null,
      document_type: record.document_type ?? null,
      urgency_level: record.urgency_level ?? null,
      private_level: record.private_level ?? null,
      document_field: record.document_field ?? null,
      report_signer: record.report_signer ?? null,
      report_document_symbol: record.report_document_symbol ?? null,
      to_book_text_symbols: record.to_book_text_symbols ?? null,
      viewers: record.viewers ?? null,
      deadline_reply: record.deadline_reply ?? null,
      abstract_note: record.abstract_note ?? null,
      recipient_ids: record.recipient_ids ?? null,
      internal_receiving_unit: record.internal_receiving_unit ?? null,
      reply_incomming_doc: record.reply_incomming_doc ?? null,
      created_at: record.created_at ?? null,
      updated_at: record.updated_at ?? null,
      draft_signer: record.draft_signer ?? null,
      book_document_id: record.book_document_id ?? null,
      status: 1,
      code_commanders: record.code_commanders ?? null,
      commanders: record.commanders ?? null,
      current_note: record.current_note ?? null,
      to_book: record.to_book ?? null,
      release_no: record.release_no ?? null,
      release_date: record.release_date ?? null,
      text_symbols: record.text_symbols ?? null,
      doc_work_files: record.doc_work_files ?? null,
      doc_proposal: record.doc_proposal ?? null,
      doc_draft: record.doc_draft ?? null,
      doc_attachments: record.doc_attachments ?? null,
      doc_recall: record.doc_recall ?? null,
      doc_replacement: record.doc_replacement ?? null,
      doc_answer: record.doc_answer ?? null,
      external_receiving_unit: record.external_receiving_unit ?? null,
      internal_receiving_dept: record.internal_receiving_dept ?? null,
      processor: record.processor ?? null,
      files: record.files ?? null,
      type_doc: record.type_doc ?? null,
      bpmn_version: record.bpmn_version ?? null,
      vieweds: record.vieweds ?? null,
      know_receivers: record.know_receivers ?? null,
      type_of_process: record.type_of_process ?? null,
      replaced_documents: record.replaced_documents ?? null,
      id_outgoing_bak: record.id_outgoing_bak ?? null,
      internal_receiving_dept_old: record.internal_receiving_dept_old ?? null,
      sign_type: record.sign_type ?? null,
      from_create_draf: record.from_create_draf ?? null,
      replaced: record.replaced ?? null,
      tbBak: record.tbBak ?? record.tb_bak ?? null,
    };
  }
}

module.exports = StreamOutgoingMigrationModel;
