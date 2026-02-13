const BaseModel = require('./BaseModel');

class IncomingDocumentsMigrateModel extends BaseModel {
  constructor() {
    super();
  }

  /**
   * Insert dữ liệu từ incomming_documents2 -> incomming_documents
   * bỏ cột id
   */
  async migrate(limit = 100) {
    const query = `
      INSERT INTO DiOffice.dbo.incomming_documents (
        document_id, status_code, created_at, updated_at,
        book_document_id, abstract_note, to_book,
        sender_unit, receiver_unit, document_date, receive_date,
        to_book_date, deadline, second_book, receive_method,
        private_level, urgency_level, document_type, document_field,
        signer, to_book_code, fileids, status, isStar, parent_doc,
        type_process_doc, bpmn_version, copy_to_internal,
        resolution_deadline, copy_count, page_count, view_group,
        directive_comment, SoVanBan, id_incoming_bak, CoQuanGui2,
        CoQuanGuiText, DonVi, IsLibrary, ItemVBDTCT, ItemVBPH,
        ItemVBPHOld, BanLanhDao, LanhDaoTCT, LanhDaoTCTDaXuLy,
        LanhDaoTCTDeBiet, LanhDaoVPDN, LinhVuc, SoBan, SoTrang,
        TrichYeu, VanBanTraLoi, ChenSo, YKienLanhDao,
        YKienLanhDaoTCT, YKienLanhDaoVPDN,
        YKienCuaLDVPChoVanThu, ForwardType, ModuleId,
        SiteName, ListName, ItemId, MigrateFlg, YearMonth,
        MigrateErrFlg, MigrateErrMess, TrangThai,
        ModifiedBy, CreatedBy, DGPId,
        tb_update, tb_bak
      )
      SELECT TOP (@limit)
        s.document_id, s.status_code, s.created_at, s.updated_at,
        s.book_document_id, s.abstract_note, s.to_book,
        s.sender_unit, s.receiver_unit, s.document_date, s.receive_date,
        s.to_book_date, s.deadline, s.second_book, s.receive_method,
        s.private_level, s.urgency_level, s.document_type, s.document_field,
        s.signer, s.to_book_code, s.fileids, s.status, s.isStar, s.parent_doc,
        s.type_process_doc, s.bpmn_version, s.copy_to_internal,
        s.resolution_deadline, s.copy_count, s.page_count, s.view_group,
        s.directive_comment, s.SoVanBan, s.id_incoming_bak, s.CoQuanGui2,
        s.CoQuanGuiText, s.DonVi, s.IsLibrary, s.ItemVBDTCT, s.ItemVBPH,
        s.ItemVBPHOld, s.BanLanhDao, s.LanhDaoTCT, s.LanhDaoTCTDaXuLy,
        s.LanhDaoTCTDeBiet, s.LanhDaoVPDN, s.LinhVuc, s.SoBan, s.SoTrang,
        s.TrichYeu, s.VanBanTraLoi, s.ChenSo, s.YKienLanhDao,
        s.YKienLanhDaoTCT, s.YKienLanhDaoVPDN,
        s.YKienCuaLDVPChoVanThu, s.ForwardType, s.ModuleId,
        s.SiteName, s.ListName, s.ItemId, s.MigrateFlg, s.YearMonth,
        s.MigrateErrFlg, s.MigrateErrMess, s.TrangThai,
        s.ModifiedBy, s.CreatedBy, s.DGPId,
        1 AS tb_update,
        'incomming_documents2' AS tb_bak
      FROM DiOffice.dbo.incomming_documents2 s
      WHERE NOT EXISTS (
        SELECT 1
        FROM DiOffice.dbo.incomming_documents d
        WHERE d.document_id = s.document_id
      )
      ORDER BY s.created_at;
    `;

    const result = await this.newPool
      .request()
      .input('limit', limit)
      .query(query);

    return result.rowsAffected[0] || 0;
  }
}

module.exports = IncomingDocumentsMigrateModel;
