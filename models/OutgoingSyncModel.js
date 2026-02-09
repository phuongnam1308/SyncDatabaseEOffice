// models/OutgoingSyncModel.js
const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');

class OutgoingSyncModel extends BaseModel {
  constructor() {
    super();
    this.schema = 'dbo';
    this.srcTable = 'outgoing_documents2';
    this.destTable = 'outgoing_documents';

    this.tableBackupName = this.srcTable;
  }

  async preview() {
    const query = `
      SELECT COUNT(*) AS total_can_sync
      FROM DiOffice.dbo.${this.srcTable} o2
      WHERE NOT EXISTS (
        SELECT 1
        FROM DiOffice.dbo.${this.destTable} o
        WHERE o.document_id = o2.document_id
      )
    `;
    const { recordset } = await this.newPool.request().query(query);
    return recordset[0];
  }

  // async sync(batchSize = 200) { // 🔥 giảm batch để tránh timeout
  //   const query = `
  //     INSERT INTO DiOffice.dbo.${this.destTable} (
  //       document_id,
  //       status_code,
  //       sender_unit,
  //       drafter,
  //       created_at,
  //       updated_at,
  //       table_backup,
  //       tb_bak,
  //       MigrateFlg,
  //       MigrateErrFlg
  //     )
  //     SELECT TOP (${batchSize})
  //       o2.document_id,
  //       o2.status_code,
  //       o2.sender_unit,
  //       o2.drafter,
  //       GETDATE(),
  //       GETDATE(),
  //       '${this.tableBackupName}',
  //       1,                  -- ✅ đánh dấu out2
  //       0,
  //       0
  //     FROM DiOffice.dbo.${this.srcTable} o2
  //     WHERE NOT EXISTS (
  //       SELECT 1
  //       FROM DiOffice.dbo.${this.destTable} o
  //       WHERE o.document_id = o2.document_id
  //     )
  //     ORDER BY o2.id;

  //     SELECT @@ROWCOUNT AS inserted;
  //   `;

  //   const { recordset } = await this.newPool.request().query(query);
  //   const inserted = recordset?.[0]?.inserted || 0;

  //   logger.info(`[OutgoingSync] inserted=${inserted}`);
  //   return inserted;
  // }

  async sync(batchSize = 200) {
  const query = `
    INSERT INTO DiOffice.dbo.${this.destTable} (
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
      Title,
      BanLanhDao,
      ChenSo,
      TrangThai,
      IsLibrary,
      ChucVu,
      DocNum,
      NguoiSoanThaoText,
      FolderLocation,
      DonVi,
      HoSoXuLyLink,
      InfoVBDi,
      ItemVBPH,
      NguoiKyVanBan,
      NguoiKyVanBanText,
      PhanCong,
      TraLoiVBDen,
      SoBan,
      SoTrang,
      NoiLuuTru,
      BanLanhDaoTCT,
      YKien,
      YKienChiHuy,
      ModuleId,
      SiteName,
      ListName,
      ItemId,
      YearMonth,
      Modified,
      Created,
      ModifiedBy,
      CreatedBy,
      MigrateFlg,
      MigrateErrFlg,
      MigrateErrMess,
      LoaiMoc,
      KySoFiles,
      DGPId,
      Workflow,
      IsKyQuyChe,
      DocSignType,
      IsConverting,
      CodeItemId,
      table_backup,
      tb_bak
    )
    SELECT TOP (${batchSize})
      o2.document_id,
      o2.status_code,
      o2.sender_unit,
      o2.drafter,
      o2.document_type,
      o2.urgency_level,
      o2.private_level,
      o2.document_field,
      o2.report_signer,
      o2.report_document_symbol,
      o2.to_book_text_symbols,
      o2.viewers,
      TRY_CONVERT(datetime, o2.deadline_reply),
      o2.abstract_note,
      o2.recipient_ids,
      o2.internal_receiving_unit,
      o2.reply_incomming_doc,
      TRY_CONVERT(datetime, o2.created_at),
      TRY_CONVERT(datetime, o2.updated_at),
      o2.draft_signer,
      o2.book_document_id,
      o2.status,
      o2.code_commanders,
      o2.commanders,
      o2.current_note,
      o2.to_book,
      o2.release_no,
      o2.release_date,
      o2.text_symbols,
      o2.doc_work_files,
      o2.doc_proposal,
      o2.doc_draft,
      o2.doc_attachments,
      o2.doc_recall,
      o2.doc_replacement,
      o2.doc_answer,
      o2.external_receiving_unit,
      o2.internal_receiving_dept,
      o2.processor,
      o2.files,
      o2.type_doc,
      o2.bpmn_version,
      o2.vieweds,
      o2.know_receivers,
      o2.type_of_process,
      o2.replaced_documents,
      o2.id_outgoing_bak,
      o2.Title,
      o2.BanLanhDao,
      o2.ChenSo,
      o2.TrangThai,
      o2.IsLibrary,
      o2.ChucVu,
      o2.DocNum,
      o2.NguoiSoanThaoText,
      o2.FolderLocation,
      o2.DonVi,
      o2.HoSoXuLyLink,
      o2.InfoVBDi,
      o2.ItemVBPH,
      o2.NguoiKyVanBan,
      o2.NguoiKyVanBanText,
      o2.PhanCong,
      o2.TraLoiVBDen,
      o2.SoBan,
      o2.SoTrang,
      o2.NoiLuuTru,
      o2.BanLanhDaoTCT,
      o2.YKien,
      o2.YKienChiHuy,
      o2.ModuleId,
      o2.SiteName,
      o2.ListName,
      o2.ItemId,
      o2.YearMonth,
      TRY_CONVERT(datetime, o2.Modified),
      TRY_CONVERT(datetime, o2.Created),
      o2.ModifiedBy_guid,
      o2.CreatedBy_guid,
      ISNULL(o2.MigrateFlg, 0),
      ISNULL(o2.MigrateErrFlg, 0),
      o2.MigrateErrMess,
      o2.LoaiMoc,
      o2.KySoFiles,
      o2.DGPId,
      o2.Workflow,
      o2.IsKyQuyChe,
      o2.DocSignType,
      o2.IsConverting,
      o2.CodeItemId,
      '${this.tableBackupName}',
      1
    FROM DiOffice.dbo.${this.srcTable} o2
    WHERE NOT EXISTS (
      SELECT 1
      FROM DiOffice.dbo.${this.destTable} o
      WHERE o.document_id = o2.document_id
    )
    ORDER BY o2.id;

    SELECT @@ROWCOUNT AS inserted;
  `;

  const { recordset } = await this.newPool.request().query(query);
  return recordset?.[0]?.inserted || 0;
}

  // ──────────────────────────────────────────────────────────────────────
  // Methods for SyncManagerService (Dashboard Integration)
  // ──────────────────────────────────────────────────────────────────────

  async getAllFromOldDb() {
    // Lấy danh sách ID cần sync (chưa có trong đích) để Dashboard hiển thị progress
    // Select id AS ID để SyncManagerService log được ID
    const query = `
      SELECT document_id, id AS ID
      FROM DiOffice.dbo.${this.srcTable} o2
      WHERE NOT EXISTS (
        SELECT 1
        FROM DiOffice.dbo.${this.destTable} o
        WHERE o.document_id = o2.document_id
      )
    `;
    const request = this.newPool.request();
    request.setTimeout(600000); // 10 minutes
    const { recordset } = await request.query(query);
    return recordset;
  }

  async updateInNewDb(record) {
    // Skip update: Trả về 0 để SyncManagerService chuyển sang gọi insertToNewDb
    return 0;
  }

  async insertToNewDb(record) {
    // Insert từng dòng (row-by-row) phục vụ Dashboard
    const query = `
      INSERT INTO DiOffice.dbo.${this.destTable} (
        document_id, status_code, sender_unit, drafter, document_type, urgency_level, private_level, document_field, report_signer, report_document_symbol, to_book_text_symbols, viewers, deadline_reply, abstract_note, recipient_ids, internal_receiving_unit, reply_incomming_doc, created_at, updated_at, draft_signer, book_document_id, status, code_commanders, commanders, current_note, to_book, release_no, release_date, text_symbols, doc_work_files, doc_proposal, doc_draft, doc_attachments, doc_recall, doc_replacement, doc_answer, external_receiving_unit, internal_receiving_dept, processor, files, type_doc, bpmn_version, vieweds, know_receivers, type_of_process, replaced_documents, id_outgoing_bak, Title, BanLanhDao, ChenSo, TrangThai, IsLibrary, ChucVu, DocNum, NguoiSoanThaoText, FolderLocation, DonVi, HoSoXuLyLink, InfoVBDi, ItemVBPH, NguoiKyVanBan, NguoiKyVanBanText, PhanCong, TraLoiVBDen, SoBan, SoTrang, NoiLuuTru, BanLanhDaoTCT, YKien, YKienChiHuy, ModuleId, SiteName, ListName, ItemId, YearMonth, Modified, Created, ModifiedBy, CreatedBy, MigrateFlg, MigrateErrFlg, MigrateErrMess, LoaiMoc, KySoFiles, DGPId, Workflow, IsKyQuyChe, DocSignType, IsConverting, CodeItemId, table_backup, tb_bak
      )
      SELECT
        o2.document_id, o2.status_code, o2.sender_unit, o2.drafter, o2.document_type, o2.urgency_level, o2.private_level, o2.document_field, o2.report_signer, o2.report_document_symbol, o2.to_book_text_symbols, o2.viewers, TRY_CONVERT(datetime, o2.deadline_reply), o2.abstract_note, o2.recipient_ids, o2.internal_receiving_unit, o2.reply_incomming_doc, TRY_CONVERT(datetime, o2.created_at), TRY_CONVERT(datetime, o2.updated_at), o2.draft_signer, o2.book_document_id, o2.status, o2.code_commanders, o2.commanders, o2.current_note, o2.to_book, o2.release_no, o2.release_date, o2.text_symbols, o2.doc_work_files, o2.doc_proposal, o2.doc_draft, o2.doc_attachments, o2.doc_recall, o2.doc_replacement, o2.doc_answer, o2.external_receiving_unit, o2.internal_receiving_dept, o2.processor, o2.files, o2.type_doc, o2.bpmn_version, o2.vieweds, o2.know_receivers, o2.type_of_process, o2.replaced_documents, o2.id_outgoing_bak, o2.Title, o2.BanLanhDao, o2.ChenSo, o2.TrangThai, o2.IsLibrary, o2.ChucVu, o2.DocNum, o2.NguoiSoanThaoText, o2.FolderLocation, o2.DonVi, o2.HoSoXuLyLink, o2.InfoVBDi, o2.ItemVBPH, o2.NguoiKyVanBan, o2.NguoiKyVanBanText, o2.PhanCong, o2.TraLoiVBDen, o2.SoBan, o2.SoTrang, o2.NoiLuuTru, o2.BanLanhDaoTCT, o2.YKien, o2.YKienChiHuy, o2.ModuleId, o2.SiteName, o2.ListName, o2.ItemId, o2.YearMonth, TRY_CONVERT(datetime, o2.Modified), TRY_CONVERT(datetime, o2.Created), o2.ModifiedBy_guid, o2.CreatedBy_guid, ISNULL(o2.MigrateFlg, 0), ISNULL(o2.MigrateErrFlg, 0), o2.MigrateErrMess, o2.LoaiMoc, o2.KySoFiles, o2.DGPId, o2.Workflow, o2.IsKyQuyChe, o2.DocSignType, o2.IsConverting, o2.CodeItemId, '${this.tableBackupName}', 1
      FROM DiOffice.dbo.${this.srcTable} o2
      WHERE o2.document_id = @document_id
    `;
    const request = this.newPool.request();
    request.input('document_id', record.document_id);
    await request.query(query);
  }


}

module.exports = OutgoingSyncModel;
