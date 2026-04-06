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
          documentId: existing[0].document_id,
          drafter: mapped.drafter ?? null
        };
      }

      await this._insertRecord(mapped, transaction);

      return {
        action: "inserted",
        affected: 1,
        documentId: mapped.document_id,
        drafter: mapped.drafter ?? null
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
    const createdAt = this.helper.parseDate(oldRecord.Created || oldRecord.NgayTao) || new Date();
    const updatedAt = this.helper.parseDate(oldRecord.Modified || oldRecord.NgayTao) || createdAt;

    const documentField = (await this.helper.processDocumentField(
      this.helper.safeString(oldRecord.LinhVuc)
    )) || process.env.DEFAULT_DOCUMENT_FIELD || 'vn-bn-hnh-chnh';
    const documentType = await this.helper.processDocumentType(
      this.helper.safeString(oldRecord.LoaiVanBan || oldRecord.LoaiBanHanh)
    );

    const urgencyLevel = await this.helper.processUrgencyLevel(this.helper.safeString(oldRecord.DoKhan));
    const privateLevel = await this.helper.processPrivateLevel(this.helper.safeString(oldRecord.DoMat));

    const senderUnit = (await this.helper.mapSenderUnitId(
      this.helper.safeString(oldRecord.DonVi),
      transaction)) || process.env.DEFAULT_RECEIVER_UNIT_ID;
    
    // Đảm bảo drafter không bao giờ là chuỗi 'NULL'
    let drafterRaw = this.helper.safeString(oldRecord.NguoiSoanThaoText || oldRecord.CreatedBy);
    const drafter = (await this.helper.mapUserDrafter(
      drafterRaw,
      transaction
    )) || process.env.VANTHU_USER_ID || null;

    const reportSigner = await this.helper.mapUserDrafter(
      this.helper.safeString(oldRecord.NguoiKyVanBanText),
      transaction
    );

    const bookDocumentObj = await this.helper.mapBookDocument(
      this.helper.safeString(oldRecord.SoVanBan || oldRecord.SoVanBanText),
      { drafter, senderUnit, privateLevel }
    );
    // Map đơn vị nhận internalReceivingDeptIds
    const units = this.helper.splitStringSplitBySemicolon(this.helper.safeString(oldRecord.NoiNhan));
    const internalReceivingDeptIds = [];
    const externalReceivingUnits = [];
    const allReceiverUserIds = new Set(); // Tổng hợp user IDs cho know_receivers & vieweds

    for (const unit of units) {
      if (!unit) continue;
      // Thử tìm đơn vị
      const unitId = await this.helper.mapSenderUnitId(unit, transaction);
      if (unitId) {
        internalReceivingDeptIds.push(unitId);
        // Tìm tất cả user thuộc đơn vị đó qua Department
        try {
          const deptUsers = await this.helper.queryNewDbTx(
            `SELECT [id] FROM ${process.env.NEW_DB_NAME}.dbo.users WHERE [Department] LIKE @dept OR [organization_name] LIKE @dept`,
            { dept: `%${unit.trim()}%` },
            transaction
          );
          if (Array.isArray(deptUsers)) {
            deptUsers.forEach(u => { if (u.id) allReceiverUserIds.add(String(u.id)); });
          }
        } catch (deptErr) {
          // Bỏ qua lỗi tìm user theo đơn vị
        }
      } else {
        // Thử tìm như một người dùng (name/username)
        const cleanName = unit.trim();
        if (cleanName.length >= 2) {
          try {
            const userId = await this.helper.mapUserName(cleanName, transaction);
            if (userId) {
              allReceiverUserIds.add(String(userId));
            } else {
              externalReceivingUnits.push(unit);
            }
          } catch (userErr) {
            externalReceivingUnits.push(unit);
          }
        } else {
          externalReceivingUnits.push(unit);
        }
      }
    }
    const internalReceivingDeptIdsStr = JSON.stringify(internalReceivingDeptIds);
    const externalReceivingUnitsStr = externalReceivingUnits.length > 0 ? externalReceivingUnits.join("; ") : null;

    // Tổng hợp mảng IDs cho know_receivers & vieweds (user + unit IDs)
    const allReceiverArr = Array.from(allReceiverUserIds);
    const knowReceiversStr = allReceiverArr.length > 0 ? JSON.stringify(allReceiverArr) : null;
    const viewedsStr = knowReceiversStr; // vieweds = know_receivers (cùng danh sách người nhận)

    // text_symbols = "dữ liệu văn bản đi đồng bộ" + timestamp
    const syncTimestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const textSymbols = `dữ liệu văn bản đi đồng bộ ${syncTimestamp}`;

    return {
      document_id: `${Date.now()}${Math.floor(Math.random() * 10000)}`,
      id_outgoing_bak: String(oldRecord.ID),
      status_code: this.helper.mapStatus(oldRecord.TrangThai).statusCode,
      stage_status: this.helper.mapStatus(oldRecord.TrangThai).stageStatus,
      sender_unit: senderUnit,
      internal_receiving_dept: internalReceivingDeptIdsStr,
      external_receiving_unit: externalReceivingUnitsStr,
      internal_receiving_unit: internalReceivingDeptIds.length > 0 ? JSON.stringify(internalReceivingDeptIds) : null,
      drafter,
      document_type: documentType,
      urgency_level: urgencyLevel,
      private_level: privateLevel,
      report_signer: reportSigner,
      book_document_id: bookDocumentObj?.id ?? null,
      release_no: this.helper.cleanText(oldRecord.Title),
      release_date: promulgationDate ?? null,
      abstract_note: this.helper.cleanText(oldRecord.TrichYeu),
      document_field: documentField,
      to_book: bookDocumentObj?.count ?? null,
      reply_incoming_doc: this.helper.cleanText(this.helper.safeString(oldRecord.TraLoiVBDen)),
      type_doc: 1,
      bpmn_version: this.helper.mapStatus(oldRecord.TrangThai).bpmnVersion || "SOANTHAO_PHATHANH_VBD",
      type_of_process: this.helper.mapStatus(oldRecord.TrangThai).bpmnVersion || "SOANTHAO_PHATHANH_VBD",
      // Mapping bổ sung cho các biến SQL
      internal_receiving_dept_old: internalReceivingDeptIdsStr,
      sign_type: this.helper.mapBit(oldRecord.DocSignType),
      from_create_draf: this.helper.mapBit(0),
      know_receivers: knowReceiversStr,
      vieweds: viewedsStr,
      created_at: createdAt,
      updated_at: updatedAt,
      text_symbols: textSymbols,
      replaced: this.helper.mapBit(0),
      tb_bak: this.helper.mapBit(1),
      table_backups: 'outgoing_documents_sync'
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
        reply_incoming_doc,
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
        stage_status,
        internal_receiving_dept_old,
        sign_type,
        from_create_draf,
        replaced,
        tb_bak,
        table_backups
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
        @reply_incoming_doc,
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
        @stage_status,
        @internal_receiving_dept_old,
        @sign_type,
        @from_create_draf,
        @replaced,
        @tb_bak,
        @table_backups
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
        reply_incoming_doc = @reply_incoming_doc,
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
        stage_status = @stage_status,
        internal_receiving_dept_old = @internal_receiving_dept_old,
        sign_type = @sign_type,
        from_create_draf = @from_create_draf,
        replaced = @replaced,
        tb_bak = @tb_bak,
        table_backups = @table_backups
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
      reply_incoming_doc: record.reply_incoming_doc ?? null,
      created_at: record.created_at ?? new Date(),
      updated_at: record.updated_at ?? new Date(),
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
      type_doc: record.type_doc ?? 1,
      bpmn_version: record.bpmn_version ?? null,
      vieweds: record.vieweds ?? null,
      know_receivers: record.know_receivers ?? null,
      type_of_process: record.type_of_process ?? null,
      replaced_documents: record.replaced_documents ?? null,
      stage_status: record.stage_status ?? null,
      internal_receiving_dept_old: record.internal_receiving_dept_old ?? null,
      sign_type: record.sign_type ?? null,
      from_create_draf: record.from_create_draf ?? 0,
      replaced: record.replaced ?? 0,
      id_outgoing_bak: record.id_outgoing_bak ?? null,
      tb_bak: record.tb_bak ?? 1,
      table_backups: record.table_backups ?? 'outgoing_documents_sync'
    };
  }
}

module.exports = StreamOutgoingMigrationModel;
