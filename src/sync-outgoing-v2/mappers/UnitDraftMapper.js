const MigrationHelper = require('../../helpers/MigrationHelper');
const logger = require('../../../utils/logger');

/**
 * UnitDraftMapper - Ánh xạ dữ liệu Văn bản đi đơn vị từ SharePoint sang outgoing_documents
 */
class UnitDraftMapper {
  constructor(queryNewDbTx, queryOldDb) {
    this.helper = new MigrationHelper(queryNewDbTx, queryOldDb);
  }

  async mapRecord(oldRecord, transaction) {
    if (!oldRecord?.ID) {
      throw new Error('Old record ID is required');
    }

    const createdAt = this.helper.parseDate(oldRecord.Created) || new Date();
    const updatedAt = this.helper.parseDate(oldRecord.Modified) || createdAt;
    const issuedDate = this.helper.parseDate(oldRecord.NgayBanHanh);

    // Ánh xạ trạng thái
    const statusResult = this.helper.mapStatus(oldRecord.TrangThai || oldRecord.Status || 'DRAFT');
    const statusCode = statusResult.statusCode || 1;
    const stageStatus = statusResult.stageStatus || 'DRAFT';
    const bpmnVersion = statusResult.bpmnVersion || 'SOANTHAO_PHATHANH_VBD';

    // Sử dụng Promise.all để gọi song song các hàm ánh xạ
    const [
      documentType,
      senderUnitResult,
      drafterResult,
      reportSigner
    ] = await Promise.all([
      // Ánh xạ loại văn bản
      this.helper.processDocumentType(
        this.helper.safeString(oldRecord.LoaiVanBan || oldRecord.LoaiBanHanh)
      ),
      // Đơn vị soạn thảo (Sử dụng DonVi ID nếu có)
      this.helper.mapSenderUnitId(
        String(oldRecord.DonVi || ''),
        transaction
      ),
      // Người soạn (Drafter) - Ưu tiên AuthorId hoặc Author name
      this.helper.mapUserDrafter(
        oldRecord.Author || String(oldRecord.AuthorId || ''),
        transaction
      ),
      // Người duyệt/ký (Approver)
      this.helper.mapUserDrafter(
        this.helper.safeString(oldRecord.Approver),
        transaction
      )
    ]);

    const senderUnit = senderUnitResult || process.env.DEFAULT_RECEIVER_UNIT_ID;
    const drafter = drafterResult || process.env.VANTHU_USER_ID || null;

    const oldId = String(oldRecord.ID);
    const uniqueId = `SHP_UNIT_${oldId}`.toUpperCase();

    // Ký hiệu văn bản (Nếu cả 2 đều NULL thì để tạm "DỰ THẢO")
    const docSymbol = oldRecord.SoVaKyHieu || oldRecord.SoVBBH || 'DỰ THẢO';

    // Get abstract_note from TrichYeu field
    const abstractNote = this.helper.cleanText(oldRecord.TrichYeu || oldRecord.Title);

    // Get title for release_no
    const releaseNo = docSymbol;

    return {
      document_id: `VBD_${uniqueId}`,
      id_outgoing_bak: uniqueId,

      // Thông tin cơ bản
      status_code: statusCode,
      stage_status: stageStatus,
      bpmn_version: bpmnVersion,
      type_of_process: bpmnVersion,

      sender_unit: senderUnit,
      drafter: drafter,
      report_signer: reportSigner,

      document_type: documentType,
      abstract_note: abstractNote,
      release_no: releaseNo,
      text_symbols: oldRecord.SoVaKyHieu,
      release_date: issuedDate,

      type_doc: 1, // Văn bản đi
      from_create_draf: 1,
      status: 1,

      created_at: createdAt,
      updated_at: updatedAt,

      // Metadata lưu vết
      table_backups: 'draft_documents_unit_sync',
      current_note: `Sync từ SharePoint Site: ${oldRecord.__site_name}`,
      
      // Thông tin bước (Step) lưu vào json
      doc_draft: JSON.stringify({
        step: oldRecord.Step,
        approver_by_step: oldRecord.ApproverByStep,
        approved_date: oldRecord.ApprovedDate,
        site_url: oldRecord.__site_url,
        file_ref: oldRecord.FileRef
      })
    };
  }
}

module.exports = UnitDraftMapper;
