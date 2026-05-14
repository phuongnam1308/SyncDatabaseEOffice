const crypto = require('crypto');
const logger = require('../../../utils/logger');
const MigrationHelper = require('../../helpers/MigrationHelper');

/**
 * Mapper class for incoming document sync.
 * Extracted from SyncIncomingDocumentModel._mapSingleRecord().
 *
 * Incoming-specific characteristics vs Outgoing:
 * - Source table: VanBanDen (not VanBanBanHanh)
 * - Cursor direction: ASC (oldest first, from 1753)
 * - Partition column: NgayDen (not Created)
 * - upsert key: id_incoming_bak (not id_outgoing_bak)
 * - Status map: STATUS_MAP_INCOMING (not OUTGOING)
 * - bpmn_version default: PHUC_DAP_DV (not SOANTHAO_PHATHANH_VBD)
 * - receiver_unit (not sender_unit as primary)
 * - HTML comment fields: YKienLanhDao/TCT/VPDN/CuaLDVPChoVanThu (no YKien/YKienChiHuy)
 * - File relation object_type: 'incommingdocument' (not 'docDraft')
 * - No report_signer, release_no, release_date, TraLoiVBDen fields
 */
class IncomingMapper {
  constructor(queryNewDbTx, queryOldDb) {
    this.helper = new MigrationHelper(queryNewDbTx, queryOldDb);
    this.queryNewDbTx = queryNewDbTx;
  }

  // ──────────────────────────────────────────────
  // STATUS MAPPING (Incoming-specific)
  // ──────────────────────────────────────────────

  /**
   * Map TrangThai từ VanBanDen sang status model mới.
   * Dùng STATUS_MAP_INCOMING env (khác với OUTGOING).
   */
  _mapStatus(trangThai) {
    const safeTrangThai = this.helper.safeString(trangThai);
    const defaultResult = {
      statusCode: '1',
      bpmnVersion: 'PHUC_DAP_DV',   // Incoming default khác Outgoing
      stageStatus: 'CHUA_XU_LY',
      curStatusCode: '1',
    };

    if (!safeTrangThai || !process.env.STATUS_MAP_INCOMING) {
      return defaultResult;
    }

    try {
      const statusMap = JSON.parse(process.env.STATUS_MAP_INCOMING);
      if (Array.isArray(statusMap)) {
        for (const mapping of statusMap) {
          if (Array.isArray(mapping.trangthais)) {
            for (const t of mapping.trangthais) {
              if (safeTrangThai.toLowerCase().includes(t.toLowerCase())) {
                return {
                  statusCode: mapping.status_code || defaultResult.statusCode,
                  bpmnVersion: mapping.bpmn_version || defaultResult.bpmnVersion,
                  stageStatus: mapping.stage_status || defaultResult.stageStatus,
                  curStatusCode: mapping.curStatusCode || defaultResult.curStatusCode,
                };
              }
            }
          }
        }
      }
    } catch (e) {
      logger.warn(`[IncomingMapper] Error parsing STATUS_MAP_INCOMING: ${e.message}`);
    }

    return defaultResult;
  }

  // ──────────────────────────────────────────────
  // MAIN MAPPING
  // ──────────────────────────────────────────────

  /**
   * Map raw VanBanDen record → incomming_documents structure.
   * @param {object} oldRecord - Raw record from VanBanDen / staging
   * @param {object} transaction - Database transaction
   * @returns {Promise<object>} Mapped record ready for INSERT/UPDATE
   */
  async mapRecord(oldRecord, transaction) {
    if (!oldRecord?.ID) {
      throw new Error('Old record ID is required');
    }

    // ── Date fields ───────────────────────────────
    const createdAt = this.helper.parseDate(oldRecord.Created) || new Date();
    const updatedAt = this.helper.parseDate(oldRecord.Modified) || createdAt;
    const receiveDate = this.helper.parseDate(oldRecord.NgayDen);
    const documentDate = this.helper.parseDate(oldRecord.NgayTrenVB);
    const deadline = this.helper.parseDate(oldRecord.ThoiHanGQ);

    // ── Classification fields ─────────────────────
    const documentType = await this.helper.processDocumentType(
      this.helper.safeString(oldRecord.LoaiVanBan || oldRecord.LoaiBanHanh)
    );
    const urgencyLevel = await this.helper.processUrgencyLevel(
      this.helper.safeString(oldRecord.DoKhan)
    );
    const privateLevel = await this.helper.processPrivateLevel(
      this.helper.safeString(oldRecord.DoMat)
    );
    const documentField = await this.helper.processDocumentField(
      this.helper.safeString(oldRecord.LinhVuc)
    );

    // ── Unit / user mapping ───────────────────────
    // Incoming: sender_unit = cơ quan gửi (CoQuanGui2/CoQuanGuiText)
    const senderUnit = await this.helper.mapSenderUnitId(
      this.helper.safeString(oldRecord.CoQuanGui2 || oldRecord.CoQuanGui || oldRecord.CoQuanGuiText),
      transaction
    );

    // Incoming: drafter = người tạo (mapUserName, không phải mapUserDrafter)
    const drafter = await this.helper.mapUserName(
      this.helper.safeString(oldRecord.CreatedBy || oldRecord.NguoiSoanThaoText),
      transaction
    );

    // Incoming: receiver_unit = đơn vị nhận nội bộ (DonVi)
    const receiverUnit = await this._resolveReceiverUnit(oldRecord.DonVi, transaction);

    // ── Book document ─────────────────────────────
    const bookDocumentObj = await this.helper.mapBookDocument(
      this.helper.safeString(oldRecord.SoVanBan || oldRecord.SoVanBanText),
      { drafter, senderUnit, privateLevel }
    );

    // ── Status ────────────────────────────────────
    const statusInfo = this._mapStatus(oldRecord.TrangThai);

    // ── Numeric fields ────────────────────────────
    const pageCount = this._safeInt(oldRecord.SoTrang);
    const copyCount = this._safeInt(oldRecord.SoBan);

    return {
      document_id: crypto.randomUUID(),

      // Incoming upsert key (khác outgoing dùng id_outgoing_bak)
      id_incoming_bak: String(oldRecord.ID),

      // Status & workflow
      status_code: statusInfo.statusCode,
      stage_status: statusInfo.stageStatus,
      bpmn_version: statusInfo.bpmnVersion,
      status: Number(statusInfo.statusCode) || 1,

      // Dates
      created_at: createdAt,
      updated_at: updatedAt,
      receive_date: receiveDate,
      to_book_date: receiveDate,  // Gán tạm = ngày đến (như cũ)
      document_date: documentDate,
      deadline: deadline,
      resolution_deadline: null,

      // Units & users
      sender_unit: senderUnit || null,
      receiver_unit: receiverUnit || process.env.DEFAULT_RECEIVER_UNIT_ID || null,
      drafter: drafter || null,  // expose cho caller dùng làm fallback audit

      // Book / numbering
      book_document_id: bookDocumentObj?.id ?? null,
      to_book: bookDocumentObj?.count ?? null,
      to_book_code: this.helper.safeString(oldRecord.SoDen),
      to_book_text_symbols: this.helper.safeString(oldRecord.SoDen),

      // Classification
      document_type: documentType,
      urgency_level: urgencyLevel,
      private_level: privateLevel,
      document_field: documentField,

      // Content
      abstract_note: this.helper.cleanText(oldRecord.TrichYeu),
      fileids: this.helper.safeString(oldRecord.Files),

      // Flags
      isStar: 0,
      tb_bak: 1,
      tb_update: 0,

      // Nullable / unused in basic mapping
      signer: null,
      second_book: null,
      receive_method: null,
      parent_doc: null,
      type_process_doc: null,
      copy_to_internal: null,
      copy_count: copyCount,
      page_count: pageCount,
      view_group: null,
      directive_comment: null,

      // Backups
      table_backups: 'VanBanDen',
    };
  }

  // ──────────────────────────────────────────────
  // HTML COMMENT PARSING (Incoming fields only)
  // ──────────────────────────────────────────────

  /**
   * Parse HTML comments từ các trường ý kiến lãnh đạo của VanBanDen.
   * NOTE: Incoming KHÔNG có YKien/YKienChiHuy như Outgoing.
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

  // ──────────────────────────────────────────────
  // PRIVATE HELPERS
  // ──────────────────────────────────────────────

  /**
   * Resolve receiver unit từ DonVi field (semicolon-separated).
   * Lấy unit đầu tiên map được.
   */
  async _resolveReceiverUnit(donViRaw, transaction) {
    const units = this.helper.splitStringSplitBySemicolon(
      this.helper.safeString(donViRaw)
    );

    for (const unit of units) {
      if (!unit) continue;
      const unitId = await this.helper.mapSenderUnitId(unit, transaction);
      if (unitId) return unitId;
    }

    return null;
  }

  _safeInt(value) {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  }
}

module.exports = IncomingMapper;
