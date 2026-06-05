const logger = require('../../../utils/logger');
const MigrationHelper = require('../../helpers/MigrationHelper');

/**
 * Mapper class for outgoing document sync.
 * Contains field mapping logic from OLD DB to NEW DB.
 * This logic was extracted from StreamOutgoingMigrationModel._mapSingleRecord()
 */
class OutgoingMapper {
  constructor(queryNewDbTx, queryOldDb) {
    this.helper = new MigrationHelper(queryNewDbTx, queryOldDb);
  }

  /**
   * Map a raw outgoing document record to the new structure
   * @param {object} oldRecord - Raw record from VanBanBanHanh
   * @param {object} transaction - Database transaction
   * @returns {Promise<object>} Mapped record
   */
  async mapRecord(oldRecord, transaction) {
    if (!oldRecord?.ID) {
      throw new Error('Old record ID is required');
    }

    const promulgationDate = this.helper.parseDate(oldRecord.NgayBanHanh);
    const createdAt = this.helper.parseDate(oldRecord.Created || oldRecord.NgayTao) || new Date();
    const updatedAt = this.helper.parseDate(oldRecord.Modified) || createdAt;

    const documentField = (await this.helper.processDocumentField(
      this.helper.safeString(oldRecord.LinhVuc)
    )) || process.env.DEFAULT_DOCUMENT_FIELD || 'vn-bn-hnh-chnh';

    const documentType = await this.helper.processDocumentType(
      this.helper.safeString(oldRecord.LoaiVanBan || oldRecord.LoaiBanHanh)
    );

    const urgencyLevel = await this.helper.processUrgencyLevel(this.helper.safeString(oldRecord.DoKhan));
    const privateLevel = await this.helper.processPrivateLevel(this.helper.safeString(oldRecord.DoMat));

    let drafterRaw = this.helper.safeString(oldRecord.NguoiSoanThaoText || oldRecord.CreatedBy);
    let drafter = (await this.helper.mapUserDrafter(
      drafterRaw,
      transaction
    )) || process.env.VANTHU_USER_ID || null;

    // sender_unit của outgoing_document sẽ lấy mặc định là org của người tạo outgoing_document
    const senderUnit = (await this.helper.mapSenderUnitFromCreatedByParent(
      drafterRaw,
      transaction
    )) || process.env.DEFAULT_RECEIVER_UNIT_ID;

    const reportSigner = await this.helper.mapUserDrafter(
      this.helper.safeString(oldRecord.NguoiKyVanBanText),
      transaction
    );

    const bookDocumentObj = await this.helper.mapBookDocument(
      this.helper.safeString(oldRecord.SoVanBan || oldRecord.SoVanBanText),
      { drafter, senderUnit, privateLevel }
    );

    // Map receiving units (using DonVi instead of NoiNhan as per requirements)
    const units = this.helper.splitStringSplitBySemicolon(this.helper.safeString(oldRecord.DonVi));
    const internalReceivingDeptIds = [];
    const externalReceivingUnits = [];
    const allReceiverUserIds = new Set();

    for (const unit of units) {
      if (!unit) continue;

      const unitId = await this.helper.mapSenderUnitId(unit, transaction);
      if (unitId) {
        internalReceivingDeptIds.push(unitId);
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
    const externalReceivingUnitsStr = externalReceivingUnits.length > 0 ? externalReceivingUnits.join('; ') : null;
    const allReceiverArr = Array.from(allReceiverUserIds);
    const knowReceiversStr = allReceiverArr.length > 0 ? JSON.stringify(allReceiverArr) : null;
    const viewedsStr = knowReceiversStr;

    const syncTimestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const textSymbols = `dữ liệu văn bản đi đồng bộ ${syncTimestamp}`;

    const oldId = String(oldRecord.ID);
    let suffix = 'DI';
    const sourceTable = oldRecord.__source_table || '';
    const category = oldRecord.Category || '';

    if (sourceTable) {
      // Lấy phần định danh sau dấu gạch dưới cuối cùng (ví dụ: LuanChuyenVanBan_TCMT -> TCMT)
      const parts = sourceTable.split('_');
      suffix = parts.length > 1 ? parts[parts.length - 1] : 'DI';
    } else if (category.includes('TCT')) {
      suffix = 'TCT';
    } else if (category.includes('ĐV')) {
      suffix = 'DV';
    }

    const uniqueId = `${oldId}_${suffix}`.toUpperCase();

    return {
      document_id: `VBD_${uniqueId}`,
      id_outgoing_bak: uniqueId,
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
      bpmn_version: this.helper.mapStatus(oldRecord.TrangThai).bpmnVersion || 'SOANTHAO_PHATHANH_VBD',
      type_of_process: this.helper.mapStatus(oldRecord.TrangThai).bpmnVersion || 'SOANTHAO_PHATHANH_VBD',
      internal_receiving_dept_old: internalReceivingDeptIdsStr,
      sign_type: this.helper.mapBit(oldRecord.DocSignType),
      from_create_draf: this.helper.mapBit(0),
      know_receivers: knowReceiversStr,
      vieweds: viewedsStr,
      created_at: createdAt,
      updated_at: updatedAt,
      document_date: promulgationDate ?? createdAt ?? updatedAt, // Bổ sung document_date cho Văn bản đi
      text_symbols: textSymbols,
      replaced: this.helper.mapBit(0),
      tb_bak: this.helper.mapBit(1),
      table_backups: 'outgoing_documents_sync'
    };
  }

  /**
   * Parse HTML comments and insert into database
   * @param {string} htmlContent - HTML content containing comments
   * @param {string} documentId - Target document ID
   * @param {string} recordId - Source record ID
   * @param {string} tableName - Source table name
   * @param {string} fieldName - Field name containing comments
   * @param {object} transaction - Database transaction
   * @returns {Promise<number>} Number of comments inserted
   */
  async parseAndInsertHtmlComments(htmlContent, documentId, recordId, tableName, fieldName, transaction) {
    return this.helper.parseAndInsertHtmlComments(
      htmlContent,
      documentId,
      recordId,
      tableName,
      fieldName,
      transaction
    );
  }
}

module.exports = OutgoingMapper;
