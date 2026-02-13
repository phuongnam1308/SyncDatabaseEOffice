// sync-outgoing.model.js
const BaseModel = require("../../models/BaseModel");
const logger = require("../../utils/logger");
const sql = require('mssql');

class SyncOutgoingModel extends BaseModel {
  constructor() {
    super();
    this.syncSchema = "dbo";
    this.syncTable = "outgoing_documents_sync";
    this.mainSchema = "dbo";
    this.mainTable = "outgoing_documents";
  }

  async getStatus() {
    try {
      const countSyncQuery = `
        SELECT COUNT(*) AS total
        FROM camunda.${this.syncSchema}.${this.syncTable}
      `;
      const syncResult = await this.queryNewDbTx(countSyncQuery);
      const totalInSync = syncResult[0]?.total || 0;

      const countMainQuery = `
        SELECT COUNT(*) AS total
        FROM camunda.${this.mainSchema}.${this.mainTable}
      `;
      const mainResult = await this.queryNewDbTx(countMainQuery);
      const totalInMain = mainResult[0]?.total || 0;

      return {
        totalInSync,
        totalInMain,
        remaining: totalInSync - totalInMain,
      };
    } catch (error) {
      logger.error("[SyncOutgoingModel.getStatus] Error:", error);
      throw error;
    }
  }

  async fetchBatchFromSync({ batch, lastId = null }) {
    try {
      let query = `
        SELECT TOP (@batch) *
        FROM camunda.${this.syncSchema}.${this.syncTable}
        WHERE 1=1
      `;

      const params = { batch };

      if (lastId !== null && lastId !== undefined) {
        query += ` AND id > @lastId`;
        params.lastId = lastId;
      }

      query += ` ORDER BY id ASC`;

      const records = await this.queryNewDbTx(query, params);
      logger.debug(`[fetchBatchFromSync] lastId=${lastId} → fetched ${records.length}`);

      return records;
    } catch (error) {
      logger.error("[fetchBatchFromSync] Error:", error);
      throw error;
    }
  }

  async insertBatchToMain(records) {
    if (!records || records.length === 0) {
      return { inserted: 0, updated: 0 };
    }

    let transaction = null;
    let inserted = 0;
    let updated = 0;

    try {
      transaction = await this.beginTransaction();

      for (const record of records) {
        try {
          const existingQuery = `
            SELECT id FROM camunda.${this.mainSchema}.${this.mainTable}
            WHERE document_id = @documentId
          `;
          const existing = await this.queryNewDbTx(
            existingQuery,
            { documentId: record.document_id },
            transaction
          );

          if (existing && existing.length > 0) {
            await this._updateRecord(record, transaction);
            updated++;
          } else {
            await this._insertRecord(record, transaction);
            inserted++;
          }
        } catch (recordError) {
          logger.warn(`[insertBatchToMain] Skip record id=${record.id}:`, recordError.message);
        }
      }

      await this.commitTransaction(transaction);
      logger.debug(`[insertBatchToMain] Inserted: ${inserted}, Updated: ${updated}`);

      return { inserted, updated };
    } catch (error) {
      if (transaction) {
        await this.rollbackTransaction(transaction);
        logger.error("[insertBatchToMain] Transaction rolled back");
      }
      logger.error("[SyncOutgoingModel.insertBatchToMain] Error:", error);
      throw error;
    }
  }

  async _insertRecord(record, transaction) {
    const query = `
      INSERT INTO camunda.${this.mainSchema}.${this.mainTable} (
        document_id, status_code, sender_unit, drafter, document_type,
        urgency_level, private_level, document_field, report_signer,
        report_document_symbol, to_book_text_symbols, viewers, deadline_reply,
        abstract_note, recipient_ids, internal_receiving_unit, reply_incomming_doc,
        created_at, updated_at, draft_signer, book_document_id, status,
        code_commanders, commanders, current_note, to_book, release_no,
        release_date, text_symbols, doc_work_files, doc_proposal, doc_draft,
        doc_attachments, doc_recall, doc_replacement, doc_answer,
        external_receiving_unit, internal_receiving_dept, processor, files,
        type_doc, bpmn_version, vieweds, know_receivers, type_of_process,
        replaced_documents, id_outgoing_bak, IsLibrary, DocNum,
        NguoiSoanThaoText, FolderLocation, DonVi, HoSoXuLyLink, InfoVBDi,
        ItemVBPH, NguoiKyVanBan, NguoiKyVanBanText, PhanCong, TraLoiVBDen,
        SoBan, SoTrang, NoiLuuTru, BanLanhDaoTCT, YKien, YKienChiHuy,
        ModuleId, SiteName, ListName, ItemId, YearMonth, Modified, Created,
        ModifiedBy, CreatedBy, MigrateFlg, MigrateErrFlg, MigrateErrMess,
        LoaiMoc, KySoFiles, DGPId, Workflow, IsKyQuyChe, DocSignType,
        IsConverting, CodeItemId, internal_receiving_dept_old, sign_type,
        from_create_draf, replaced
      )
      VALUES (
        @document_id, @status_code, @sender_unit, @drafter, @document_type,
        @urgency_level, @private_level, @document_field, @report_signer,
        @report_document_symbol, @to_book_text_symbols, @viewers, @deadline_reply,
        @abstract_note, @recipient_ids, @internal_receiving_unit, @reply_incomming_doc,
        @created_at, @updated_at, @draft_signer, @book_document_id, @status,
        @code_commanders, @commanders, @current_note, @to_book, @release_no,
        @release_date, @text_symbols, @doc_work_files, @doc_proposal, @doc_draft,
        @doc_attachments, @doc_recall, @doc_replacement, @doc_answer,
        @external_receiving_unit, @internal_receiving_dept, @processor, @files,
        @type_doc, @bpmn_version, @vieweds, @know_receivers, @type_of_process,
        @replaced_documents, @id_outgoing_bak, @is_library, @doc_num,
        @nguoi_soan_thao_text, @folder_location, @don_vi, @ho_so_xu_ly_link,
        @info_vb_di, @item_vbph, @nguoi_ky_van_ban, @nguoi_ky_van_ban_text,
        @phan_cong, @tra_loi_vb_den, @so_ban, @so_trang, @noi_luu_tru,
        @ban_lanh_dao_tct, @y_kien, @y_kien_chi_huy, @module_id, @site_name,
        @list_name, @item_id, @year_month, @modified, @created, @modified_by,
        @created_by, @migrate_flg, @migrate_err_flg, @migrate_err_mess,
        @loai_moc, @ky_so_files, @dgp_id, @workflow, @is_ky_quy_che,
        @doc_sign_type, @is_converting, @code_item_id,
        @internal_receiving_dept_old, @sign_type, @from_create_draf,
        @replaced
      )
    `;

    const params = this._mapRecordParams(record);
    await this.queryNewDbTx(query, params, transaction);
  }

  async _updateRecord(record, transaction) {
    const query = `
      UPDATE camunda.${this.mainSchema}.${this.mainTable}
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
        status = @status,
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
        IsLibrary = @is_library,
        DocNum = @doc_num,
        NguoiSoanThaoText = @nguoi_soan_thao_text,
        FolderLocation = @folder_location,
        DonVi = @don_vi,
        HoSoXuLyLink = @ho_so_xu_ly_link,
        InfoVBDi = @info_vb_di,
        ItemVBPH = @item_vbph,
        NguoiKyVanBan = @nguoi_ky_van_ban,
        NguoiKyVanBanText = @nguoi_ky_van_ban_text,
        PhanCong = @phan_cong,
        TraLoiVBDen = @tra_loi_vb_den,
        SoBan = @so_ban,
        SoTrang = @so_trang,
        NoiLuuTru = @noi_luu_tru,
        BanLanhDaoTCT = @ban_lanh_dao_tct,
        YKien = @y_kien,
        YKienChiHuy = @y_kien_chi_huy,
        ModuleId = @module_id,
        SiteName = @site_name,
        ListName = @list_name,
        ItemId = @item_id,
        YearMonth = @year_month,
        Modified = @modified,
        Created = @created,
        ModifiedBy = @modified_by,
        CreatedBy = @created_by,
        MigrateFlg = @migrate_flg,
        MigrateErrFlg = @migrate_err_flg,
        MigrateErrMess = @migrate_err_mess,
        LoaiMoc = @loai_moc,
        KySoFiles = @ky_so_files,
        DGPId = @dgp_id,
        Workflow = @workflow,
        IsKyQuyChe = @is_ky_quy_che,
        DocSignType = @doc_sign_type,
        IsConverting = @is_converting,
        CodeItemId = @code_item_id,
        internal_receiving_dept_old = @internal_receiving_dept_old,
        sign_type = @sign_type,
        from_create_draf = @from_create_draf,
        replaced = @replaced
      WHERE document_id = @document_id
    `;

    const params = this._mapRecordParams(record);
    await this.queryNewDbTx(query, params, transaction);
  }

  _mapRecordParams(record) {
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
      status: record.status ?? null,
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
      is_library: record.is_library ?? null,
      doc_num: record.doc_num ?? null,
      nguoi_soan_thao_text: record.nguoi_soan_thao_text ?? null,
      folder_location: record.folder_location ?? null,
      don_vi: record.don_vi ?? null,
      ho_so_xu_ly_link: record.ho_so_xu_ly_link ?? null,
      info_vb_di: record.info_vb_di ?? null,
      item_vbph: record.item_vbph ?? null,
      nguoi_ky_van_ban: record.nguoi_ky_van_ban ?? null,
      nguoi_ky_van_ban_text: record.nguoi_ky_van_ban_text ?? null,
      phan_cong: record.phan_cong ?? null,
      tra_loi_vb_den: record.tra_loi_vb_den ?? null,
      so_ban: record.so_ban ?? null,
      so_trang: record.so_trang ?? null,
      noi_luu_tru: record.noi_luu_tru ?? null,
      ban_lanh_dao_tct: record.ban_lanh_dao_tct ?? null,
      y_kien: record.y_kien ?? null,
      y_kien_chi_huy: record.y_kien_chi_huy ?? null,
      module_id: record.module_id ?? null,
      site_name: record.site_name ?? null,
      list_name: record.list_name ?? null,
      item_id: record.item_id ?? null,
      year_month: record.year_month ?? null,
      modified: record.modified ?? null,
      created: record.created ?? null,
      modified_by: record.modified_by ?? null,
      created_by: record.created_by ?? null,
      migrate_flg: record.migrate_flg ?? null,
      migrate_err_flg: record.migrate_err_flg ?? null,
      migrate_err_mess: record.migrate_err_mess ?? null,
      loai_moc: record.loai_moc ?? null,
      ky_so_files: record.ky_so_files ?? null,
      dgp_id: record.dgp_id ?? null,
      workflow: record.workflow ?? null,
      is_ky_quy_che: record.is_ky_quy_che ?? null,
      doc_sign_type: record.doc_sign_type ?? null,
      is_converting: record.is_converting ?? null,
      code_item_id: record.code_item_id ?? null,
      internal_receiving_dept_old: record.internal_receiving_dept_old ?? null,
      sign_type: record.sign_type ?? null,
      from_create_draf: record.from_create_draf ?? null,
      replaced: record.replaced ?? null,
    };
  }

  async beginTransaction() {
    try {
      const transaction = new sql.Transaction(this.newPool);
      await transaction.begin();
      logger.debug("[beginTransaction] Started");
      return transaction;
    } catch (error) {
      logger.error("[beginTransaction] Error:", error);
      throw error;
    }
  }

  async commitTransaction(transaction) {
    try {
      if (!transaction) return;
      await transaction.commit();
      logger.debug("[commitTransaction] Committed");
    } catch (error) {
      logger.error("[commitTransaction] Error:", error);
      throw error;
    }
  }

  async rollbackTransaction(transaction) {
    try {
      if (!transaction) return;
      await transaction.rollback();
      logger.debug("[rollbackTransaction] Rolled back");
    } catch (error) {
      logger.error("[rollbackTransaction] Error:", error);
    }
  }
}

module.exports = SyncOutgoingModel;