const logger = require('../../../utils/logger');
const dbUtils = require('../../../utils/dbUtils');
const { v4: uuidv4 } = require('uuid');
const DraftDocumentMapper = require('../mappers/DraftDocumentMapper');
const FileService = require('../../sync-file-copy/Fileuploadservice');
const { downloadFile: spDownload } = require('../../sync-file-copy/SharePointAuthService');
const {
  CATEGORY_RELEASE_DV,
  CATEGORY_RELEASE_TCT,
  CATEGORY_OUTGOING
} = require('../../sync-audit/SyncAuditModel');

/**
 * Detects MIME type from magic bytes
 */
function detectFileType(buffer) {
  if (!buffer || buffer.length < 4) return { mime: 'application/octet-stream', ext: 'bin' };
  const b = buffer;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { mime: 'application/pdf', ext: 'pdf' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { mime: 'image/gif', ext: 'gif' };
  if (b[0] === 0x42 && b[1] === 0x4D) return { mime: 'image/bmp', ext: 'bmp' };
  if (b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04) {
    const s = buffer.slice(0, 200).toString('latin1');
    if (s.includes('word/')) return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' };
    if (s.includes('xl/')) return { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' };
    if (s.includes('ppt/')) return { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx' };
    return { mime: 'application/zip', ext: 'zip' };
  }
  if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return { mime: 'application/msword', ext: 'doc' };
  if (b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21) return { mime: 'application/x-rar-compressed', ext: 'rar' };
  return { mime: 'application/octet-stream', ext: 'bin' };
}

const AUDIT_TABLES = [
  'LuanChuyenVanBan', 'LuanChuyenVanBan_ATPC', 'LuanChuyenVanBan_CLL',
  'LuanChuyenVanBan_CNTT', 'LuanChuyenVanBan_CT', 'LuanChuyenVanBan_CVTC',
  'LuanChuyenVanBan_DonVi', 'LuanChuyenVanBan_DVHH', 'LuanChuyenVanBan_DVKT',
  'LuanChuyenVanBan_GNVT', 'LuanChuyenVanBan_HC', 'LuanChuyenVanBan_HT',
  'LuanChuyenVanBan_ICDLB', 'LuanChuyenVanBan_ICDST', 'LuanChuyenVanBan_KHDT',
  'LuanChuyenVanBan_KHKD', 'LuanChuyenVanBan_KTVT', 'LuanChuyenVanBan_KVTC',
  'LuanChuyenVanBan_MKT', 'LuanChuyenVanBan_NPL', 'LuanChuyenVanBan_QLCT',
  'LuanChuyenVanBan_QSBV', 'LuanChuyenVanBan_SNPL', 'LuanChuyenVanBan_TC',
  'LuanChuyenVanBan_TC189', 'LuanChuyenVanBan_TCCT', 'LuanChuyenVanBan_TCHP',
  'LuanChuyenVanBan_TCIDI', 'LuanChuyenVanBan_TCLD', 'LuanChuyenVanBan_TCMT',
  'LuanChuyenVanBan_TCO', 'LuanChuyenVanBan_TCOT', 'LuanChuyenVanBan_TCPC',
  'LuanChuyenVanBan_TCPH', 'LuanChuyenVanBan_TCTT', 'LuanChuyenVanBan_TTDDC',
  'LuanChuyenVanBan_TTDTC', 'LuanChuyenVanBan_VP', 'LuanChuyenVanBan_VPMB',
  'LuanChuyenVanBan_VPTNB', 'LuanChuyenVanBan_VTB', 'LuanChuyenVanBan_VTT',
  'LuanChuyenVanBan_XDCT', 'LuanChuyenVanBan_xdsm', 'LuanChuyenVanBan_XNCG',
  'LuanChuyenVanBan_YTE'
];

/**
 * Handler class for upserting draft documents into outgoing_documents table.
 * Contains business logic for Văn bản dự thảo (Tổng công ty - SNP.CodeItem).
 * Uses the same outgoing_documents table as VanBanBanHanh sync.
 */
class DraftDocumentUpsertHandler {
  constructor(newPool, oldPool) {
    this.newPool = newPool;
    this.oldPool = oldPool;
    this.mapper = new DraftDocumentMapper(
      this.queryNewDbTx.bind(this),
      this.queryOldDb.bind(this)
    );
    this._fileService = null;
    this._syncAuditModel = [];
    this.newDbName = process.env.NEW_DB_NAME || 'DataeOfficeDB';
  }

  /**
   * Initialize dependencies (audit models, file service)
   */
  async initialize() {
    const SyncOutgoingAuditModel = require('../../sync-audit/SyncOutgoingAuditModel');

    for (const tableName of AUDIT_TABLES) {
      const model = new SyncOutgoingAuditModel();
      model.oldDbTable = tableName;
      model.oldPool = this.oldPool;
      model.newPool = this.newPool;
      await model.initialize();
      this._syncAuditModel.push(model);
    }

    this._fileService = new FileService();
    logger.info(`[DraftDocumentUpsertHandler] Initialized with ${this._syncAuditModel.length} audit models`);
  }

  /**
   * Query helper for new DB transaction
   */
  async queryNewDbTx(query, params, transaction) {
    const request = transaction ? transaction.request() : this.newPool.request();
    for (const [key, value] of Object.entries(params || {})) {
      request.input(key, value);
    }
    const result = await request.query(query);
    return result.recordset;
  }

  /**
   * Query helper for old DB
   */
  async queryOldDb(query, params) {
    const request = this.oldPool.request();
    for (const [key, value] of Object.entries(params || {})) {
      request.input(key, value);
    }
    const result = await request.query(query);
    return result.recordset;
  }

  /**
   * Process one draft document record
   * @param {object} oldRecord - Raw record from staging table
   * @returns {Promise<{success: boolean, documentId: string|null, error: string|null}>}
   */
  async processRecord(oldRecord) {
    if (!oldRecord) {
      return { success: false, documentId: null, error: 'No record provided' };
    }

    const id = String(oldRecord?.ID || '').trim();
    logger.info(`[DraftDocumentUpsertHandler] Processing draft ID: ${id}`);

    try {
      const result = await dbUtils.withTransactionRetry(this.newPool, async (transaction) => {
        const mapped = await this.mapper.mapRecord(oldRecord, transaction);
        if (!mapped?.document_id) {
          throw new Error('Mapped document_id is required');
        }

        // Check if exists in outgoing_documents
        const existingQuery = `
          SELECT TOP 1 document_id
          FROM ${this.newDbName}.dbo.outgoing_documents
          WHERE id_outgoing_bak = @idOutgoingBak
        `;
        const existing = await this.queryNewDbTx(existingQuery, { idOutgoingBak: mapped.id_outgoing_bak }, transaction);

        let documentId;
        let drafter = mapped.drafter;
        let isNew = false;

        if (existing && existing.length > 0) {
          const dbDocId = existing[0].document_id;
          logger.info(`[DraftDocumentUpsertHandler] Found existing document: [${dbDocId}]`);
          await this._updateRecord(mapped, transaction, dbDocId);
          documentId = dbDocId;
        } else {
          mapped.document_id = String(mapped.document_id).toUpperCase();
          await this._insertRecord(mapped, transaction);
          documentId = mapped.document_id;
          isNew = true;
        }

        // Step 2: Process files (prepare outside transaction then apply)
        // 2a. Files from SharePoint (old approach via Files field)
        const preparedFiles = await this._prepareFilesFromSharePoint(oldRecord);

        // 2b. Files from SNP.CodeAttach table
        const attachFiles = await this._fetchAttachmentsFromCodeAttach(oldRecord.ID);

        // Apply all files
        await this._applyPreparedFiles(preparedFiles, oldRecord, {
          id: documentId,
          type_doc: 1,
          drafter: drafter
        }, transaction);

        await this._applyCodeAttachFiles(attachFiles, oldRecord, {
          id: documentId,
          type_doc: 1,
          drafter: drafter
        }, transaction);

        // Step 3: Process audits (Inside same transaction)
        await this._processAudits(oldRecord, documentId, id, drafter, transaction, isNew);

        // Step 4: Parse HTML comments
        await this._processHtmlComments(oldRecord, documentId, id, transaction);

        return { action: isNew ? 'inserted' : 'updated', documentId };
      });

      logger.info(`[DraftDocumentUpsertHandler] Completed draft ID: ${id}, action: ${result.action}`);
      return { success: true, documentId: result.documentId, error: null };

    } catch (error) {
      logger.error(`[DraftDocumentUpsertHandler] Failed draft ID=${id}: ${error.message}`);
      return { success: false, documentId: null, error: error.message };
    }
  }

  /**
   * Insert new draft document into outgoing_documents
   */
  async _insertRecord(record, transaction) {
    const query = `
      INSERT INTO dbo.outgoing_documents (
        document_id, status_code, sender_unit, drafter, document_type,
        urgency_level, private_level, document_field, report_signer,
        report_document_symbol, to_book_text_symbols, viewers, deadline_reply,
        abstract_note, recipient_ids, internal_receiving_unit, reply_incoming_doc,
        created_at, updated_at, draft_signer, book_document_id, status,
        code_commanders, commanders, current_note, to_book, release_no,
        release_date, text_symbols, doc_work_files, doc_proposal, doc_draft,
        doc_attachments, doc_recall, doc_replacement, doc_answer,
        external_receiving_unit, internal_receiving_dept, id_outgoing_bak,
        bpmn_version, type_of_process, type_doc, know_receivers, vieweds,
        sign_type, from_create_draf, replaced, tb_bak, table_backups,
        internal_receiving_dept_old, processor, files, stage_status,
        doc_draft
      ) VALUES (
        @document_id, @status_code, @sender_unit, @drafter, @document_type,
        @urgency_level, @private_level, @document_field, @report_signer,
        @report_document_symbol, @to_book_text_symbols, @viewers, @deadline_reply,
        @abstract_note, @recipient_ids, @internal_receiving_unit, @reply_incoming_doc,
        @created_at, @updated_at, @draft_signer, @book_document_id, @status,
        @code_commanders, @commanders, @current_note, @to_book, @release_no,
        @release_date, @text_symbols, @doc_work_files, @doc_proposal, @doc_draft,
        @doc_attachments, @doc_recall, @doc_replacement, @doc_answer,
        @external_receiving_unit, @internal_receiving_dept, @id_outgoing_bak,
        @bpmn_version, @type_of_process, @type_doc, @know_receivers, @vieweds,
        @sign_type, @from_create_draf, @replaced, @tb_bak, @table_backups,
        @internal_receiving_dept_old, @processor, @files, @stage_status,
        @doc_draft
      )
    `;

    const request = transaction.request();
    const params = {
      document_id: record.document_id,
      status_code: record.status_code,
      sender_unit: record.sender_unit,
      drafter: record.drafter,
      document_type: record.document_type,
      urgency_level: record.urgency_level,
      private_level: record.private_level,
      document_field: record.document_field,
      report_signer: record.report_signer,
      report_document_symbol: record.report_document_symbol,
      to_book_text_symbols: record.to_book_text_symbols,
      viewers: record.viewers,
      deadline_reply: record.deadline_reply,
      abstract_note: record.abstract_note,
      recipient_ids: record.recipient_ids,
      internal_receiving_unit: record.internal_receiving_unit,
      reply_incoming_doc: record.reply_incoming_doc,
      created_at: record.created_at,
      updated_at: record.updated_at,
      draft_signer: record.drafter,
      book_document_id: record.book_document_id,
      status: record.status || 1,
      code_commanders: record.code_commanders,
      commanders: record.commanders,
      current_note: record.current_note,
      to_book: record.to_book,
      release_no: record.release_no,
      release_date: record.release_date,
      text_symbols: record.text_symbols,
      doc_work_files: record.doc_work_files,
      doc_proposal: record.doc_proposal,
      doc_draft: record.doc_draft,
      doc_attachments: record.doc_attachments,
      doc_recall: record.doc_recall,
      doc_replacement: record.doc_replacement,
      doc_answer: record.doc_answer,
      external_receiving_unit: record.external_receiving_unit,
      internal_receiving_dept: record.internal_receiving_dept,
      id_outgoing_bak: record.id_outgoing_bak,
      bpmn_version: record.bpmn_version,
      type_of_process: record.type_of_process,
      type_doc: record.type_doc,
      know_receivers: record.know_receivers,
      vieweds: record.vieweds,
      sign_type: record.sign_type,
      from_create_draf: record.from_create_draf,
      replaced: record.replaced,
      tb_bak: record.tb_bak,
      table_backups: record.table_backups,
      internal_receiving_dept_old: record.internal_receiving_dept_old,
      processor: record.processor,
      files: record.files,
      stage_status: record.stage_status,
      doc_draft: record.doc_draft
    };

    for (const [key, value] of Object.entries(params)) {
      request.input(key, value);
    }
    await request.query(query);
  }

  /**
   * Update existing draft document in outgoing_documents
   */
  async _updateRecord(record, transaction, existingDocId) {
    const query = `
      UPDATE dbo.outgoing_documents SET
        status_code = @status_code,
        sender_unit = @sender_unit,
        drafter = @drafter,
        document_type = @document_type,
        urgency_level = @urgency_level,
        private_level = @private_level,
        report_signer = @report_signer,
        abstract_note = @abstract_note,
        release_no = @release_no,
        release_date = @release_date,
        updated_at = @updated_at,
        current_note = @current_note,
        text_symbols = @text_symbols,
        replaced = @replaced,
        replaced_documents = @replaced_documents,
        doc_recall = @doc_recall,
        stage_status = @stage_status,
        doc_draft = @doc_draft,
        bpmn_version = @bpmn_version,
        type_of_process = @type_of_process
      WHERE document_id = @document_id
    `;

    const request = transaction.request();
    const params = {
      document_id: existingDocId,
      status_code: record.status_code,
      sender_unit: record.sender_unit,
      drafter: record.drafter,
      document_type: record.document_type,
      urgency_level: record.urgency_level,
      private_level: record.private_level,
      report_signer: record.report_signer,
      abstract_note: record.abstract_note,
      release_no: record.release_no,
      release_date: record.release_date,
      updated_at: record.updated_at,
      current_note: record.current_note,
      text_symbols: record.text_symbols,
      replaced: record.replaced,
      replaced_documents: record.replaced_documents,
      doc_recall: record.doc_recall,
      stage_status: record.stage_status,
      doc_draft: record.doc_draft,
      bpmn_version: record.bpmn_version,
      type_of_process: record.type_of_process
    };

    for (const [key, value] of Object.entries(params)) {
      request.input(key, value);
    }
    await request.query(query);
  }

  /**
   * Prepare files from SharePoint
   */
  async _prepareFilesFromSharePoint(oldRecord) {
    const files = oldRecord?.Files || '';
    if (!files) return [];

    const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
    if (!baseUrl) return [];

    const parts = files.split('|').filter(Boolean);
    if (parts.length === 0) return [];

    let filesToPath = [];
    const firstPartIsLikelyFile = /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|bmp|txt|zip|rar)$/i.test(parts[0]);

    if (firstPartIsLikelyFile) {
      filesToPath.push(parts[0]);
    } else {
      const directory = parts[0];
      const names = parts.slice(1);
      for (const name of names) {
        if (!name) continue;
        filesToPath.push(directory.endsWith('/') ? `${directory}${name}` : `${directory}/${name}`);
      }
    }

    const preparedResults = [];
    for (const relativePath of filesToPath) {
      try {
        if (!relativePath.includes('/')) continue;
        const fullUrl = `${baseUrl}${relativePath}`;
        const fileName = relativePath.substring(relativePath.lastIndexOf('/') + 1);

        logger.info(`[DraftDocumentUpsertHandler][prepareFiles] Downloading: ${fileName}`);
        const buffer = await spDownload(fullUrl, this.newPool);

        if (buffer && buffer.length > 0) {
          preparedResults.push({ buffer, fileName, relativePath });
        }
      } catch (err) {
        logger.error(`[DraftDocumentUpsertHandler][prepareFiles] Error downloading file ${relativePath}: ${err.message}`);
      }
    }
    return preparedResults;
  }

  /**
   * Apply prepared files to database
   */
  async _applyPreparedFiles(preparedFiles, oldRecord, newDocumentRecord, transaction) {
    if (!Array.isArray(preparedFiles) || preparedFiles.length === 0) return true;

    for (const fileItem of preparedFiles) {
      const { buffer, fileName, relativePath } = fileItem;
      const fileType = detectFileType(buffer);
      const mimeType = fileType.mime;

      const fileIdBak = uuidv4();
      const fileRecord = {
        file_name: fileName,
        file_path: relativePath,
        mime_type: mimeType,
        created_by: newDocumentRecord?.drafter || null,
        version: 1,
        id_bak: fileIdBak,
        table_bak: 'CodeItem',
        type_doc: newDocumentRecord?.type_doc || null,
        isBak: 1
      };

      const relationRecord = {
        object_type: 'docDraft',
        object_id: String(newDocumentRecord?.id),
        object_id_bak: oldRecord?.ID,
        file_id_bak: fileIdBak,
        table_bak: 'CodeItem',
        type_doc: 'docDraft',
      };

      await this._fileService.uploadAndInsert({
        fileBuffer: buffer,
        originalName: fileName,
        mimeType,
        fileRecord,
        relationRecord,
        folder: 'outgoing',
        localFolder: 'outgoing',
        transaction
      });
    }
    return true;
  }

  /**
   * Process HTML comments (YKien fields)
   */
  async _processHtmlComments(oldRecord, documentId, recordId, transaction) {
    const htmlFields = ['YKien', 'YKienChiHuy', 'YKienLanhDao', 'YKienLanhDaoTCT', 'YKienLanhDaoVPDN', 'YKienCuaLDVPChoVanThu'];

    for (const field of htmlFields) {
      if (oldRecord?.[field]) {
        try {
          await this.mapper.parseAndInsertHtmlComments(
            oldRecord[field],
            documentId,
            recordId,
            'CodeItem',
            field,
            transaction
          );
        } catch (err) {
          logger.warn(`[DraftDocumentUpsertHandler] Error parsing HTML ${field}: ${err.message}`);
        }
      }
    }
  }

  /**
   * Process audits (LuanChuyenVanBan*)
   */
  async _processAudits(oldRecord, documentId, recordId, drafter, transaction, isNew = false) {
    // 1. Luôn luôn kiểm tra và tạo bản ghi audit khởi tạo 'CREATE'
    try {
      const existingAudit = await this.queryNewDbTx(
        `SELECT TOP 1 id FROM ${this.newDbName}.dbo.audit WHERE document_id = @docId AND action_code = 'CREATE'`,
        { docId: documentId },
        transaction
      );

      if (!existingAudit || existingAudit.length === 0) {
        // Lấy thông tin người tạo từ bản ghi cũ
        const creatorName = oldRecord.CreatedBy || oldRecord.NguoiSoanThaoText || oldRecord.NguoiSoanThao || oldRecord.CBNV || '';
        const parsedDate = this.mapper && this.mapper.helper
          ? this.mapper.helper.parseDate(oldRecord.Created || oldRecord.NgayTao)
          : null;
        const createdDate = parsedDate || new Date();

        let creatorId = drafter || process.env.VANTHU_USER_ID;
        let displayName = creatorName;

        if (this.mapper && this.mapper.helper && creatorName && !creatorId) {
          try {
            const cleanName = this.mapper.helper.extractDisplayName
              ? this.mapper.helper.extractDisplayName(creatorName)
              : creatorName;
            displayName = cleanName || creatorName;
            const resolvedId = await this.mapper.helper.mapUserName(cleanName, transaction);
            if (resolvedId) creatorId = resolvedId;
          } catch (mapErr) {
            logger.warn(`[AutoCreateAudit] mapUserName failed for "${creatorName}": ${mapErr.message}`);
          }
        }

        const typeDoc = 'OutgoingDocument';

        const insertQuery = `
          INSERT INTO ${this.newDbName}.dbo.audit (
            document_id, [time], user_id, display_name,
            action_code, details, origin_id, created_by,
            receiver, receiver_unit, group_, roleProcess,
            [action], stage_status, created_at, updated_at,
            type_document, table_backups
          ) VALUES (
            @document_id, @time, @user_id, @display_name,
            @action_code, @details, @origin_id, @created_by,
            @receiver, @receiver_unit, @group_, @roleProcess,
            @action, @stage_status, @created_at, @updated_at,
            @type_document, @table_backups
          )
        `;

        await this.queryNewDbTx(insertQuery, {
          document_id: documentId,
          time: createdDate,
          user_id: creatorId,
          display_name: displayName || null,
          action_code: 'CREATE',
          details: JSON.stringify({ note: 'Tạo văn bản (tự động tạo từ migration)', isTransferOption: false }),
          origin_id: `auto_create_${String(oldRecord.ID || '').substring(0, 80)}`,
          created_by: creatorId,
          receiver: creatorId,
          receiver_unit: null,
          group_: null,
          roleProcess: 'VANTHU',
          action: 'Tạo văn bản',
          stage_status: 'DA_XU_LY',
          created_at: createdDate,
          updated_at: createdDate,
          type_document: typeDoc,
          table_backups: 'auto_create'
        }, transaction);

        logger.info(`[DraftDocumentUpsertHandler][AutoCreateAudit] Created initial CREATE audit for documentId=${documentId} creator=${displayName}`);
      }
    } catch (autoAuditErr) {
      logger.warn(`[DraftDocumentUpsertHandler][AutoCreateAudit] Failed for documentId=${documentId}: ${autoAuditErr.message}`);
    }

    if (!this._syncAuditModel || this._syncAuditModel.length === 0) {
      logger.warn(`[DraftDocumentUpsertHandler][Audit] _syncAuditModel not initialized, skipping`);
      return;
    }

    try {
      const firstModel = this._syncAuditModel[0];
      const auditTableNames = this._syncAuditModel.map(m => m.oldDbTable);

      const allRawAudits = await firstModel.fetchAllAuditsAcrossTables(
        recordId,
        auditTableNames,
        [CATEGORY_RELEASE_DV, CATEGORY_RELEASE_TCT, CATEGORY_OUTGOING]
      );

      if (allRawAudits.length > 0) {
        const modelMap = new Map(this._syncAuditModel.map(m => [m.oldDbTable, m]));

        let maxStatusCode = null;
        for (const rawAudit of allRawAudits) {
          const tableName = rawAudit.__source_table;
          const model = modelMap.get(tableName) || firstModel;

          try {
            const result = await model.processSingleRecord(rawAudit, documentId, transaction, drafter, isNew);
            if (result) {
              if (result.results && Array.isArray(result.results)) {
                for (const r of result.results) {
                  if (r.audit && r.audit.status_code) {
                    const sc = parseInt(r.audit.status_code, 10);
                    if (!maxStatusCode || sc > maxStatusCode) maxStatusCode = sc;
                  }
                }
              }
              logger.info(`[DraftDocumentUpsertHandler][Audit] table=${tableName} documentId=${documentId} inserted=${result?.inserted || 0}`);
            }
          } catch (auditErr) {
            logger.warn(`[DraftDocumentUpsertHandler][Audit] Error table=${tableName}: ${auditErr.message}`);
          }
        }

        if (maxStatusCode !== null) {
          await firstModel._updateDocumentStatusCode(documentId, 1, String(maxStatusCode), transaction);
          logger.info(`[DraftDocumentUpsertHandler][Audit] Final status updated to ${maxStatusCode} for document ${documentId}`);
        }
      }
    } catch (error) {
      logger.warn(`[DraftDocumentUpsertHandler][Audit] Aggregate fetch failed: ${error.message}`);
    }
  }

  /**
   * Fetch attachments from SNP.CodeAttach table by CodeItemId
   */
  async _fetchAttachmentsFromCodeAttach(codeItemId) {
    if (!codeItemId) return [];

    try {
      const query = `
        SELECT
          ID,
          CodeItemId,
          AttachCategoryId,
          Code,
          FullCode,
          Name,
          Title,
          Type,
          Size,
          Path,
          Flag,
          Created,
          Modified,
          CreatedBy,
          ModifiedBy,
          SiteName,
          SPListId,
          SPItemId,
          SPFileGuid,
          SignInfoOld
        FROM SNP.CodeAttach
        WHERE CodeItemId = @codeItemId
      `;

      const rows = await this.oldPool.request()
        .input('codeItemId', codeItemId)
        .query(query);

      logger.info(`[DraftDocumentUpsertHandler][CodeAttach] Found ${rows.recordset?.length || 0} attachments for CodeItemId=${codeItemId}`);
      return rows.recordset || [];
    } catch (error) {
      logger.warn(`[DraftDocumentUpsertHandler][CodeAttach] Error fetching attachments: ${error.message}`);
      return [];
    }
  }

  /**
   * Apply files from SNP.CodeAttach to database
   */
  async _applyCodeAttachFiles(attachFiles, oldRecord, newDocumentRecord, transaction) {
    if (!Array.isArray(attachFiles) || attachFiles.length === 0) return true;

    const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');

    for (const attach of attachFiles) {
      try {
        const filePath = attach.Path || '';
        const fileName = attach.Title || attach.Name || 'unknown';
        const fullUrl = filePath.startsWith('http') ? filePath : `${baseUrl}${filePath}`;

        logger.info(`[DraftDocumentUpsertHandler][CodeAttach] Processing: ${fileName} | Path: ${filePath}`);

        // Download file from SharePoint
        const buffer = await spDownload(fullUrl, this.newPool);

        if (!buffer || buffer.length === 0) {
          logger.warn(`[DraftDocumentUpsertHandler][CodeAttach] Empty buffer for ${fileName}, skipping`);
          continue;
        }

        const fileType = detectFileType(buffer);
        const mimeType = fileType.mime;
        const fileIdBak = String(attach.ID || uuidv4());

        const fileRecord = {
          file_name: fileName,
          file_path: filePath,
          mime_type: mimeType,
          file_size: attach.Size || buffer.length,
          created_by: newDocumentRecord?.drafter || null,
          version: 1,
          id_bak: fileIdBak,
          table_bak: 'CodeAttach',
          type_doc: newDocumentRecord?.type_doc || null,
          isBak: 1
        };

        const relationRecord = {
          object_type: 'docDraft',
          object_id: String(newDocumentRecord?.id),
          object_id_bak: String(oldRecord?.ID),
          file_id_bak: fileIdBak,
          table_bak: 'CodeAttach',
          type_doc: 'docDraft',
        };

        await this._fileService.uploadAndInsert({
          fileBuffer: buffer,
          originalName: fileName,
          mimeType,
          fileRecord,
          relationRecord,
          folder: 'outgoing',
          localFolder: 'outgoing',
          transaction
        });

        logger.info(`[DraftDocumentUpsertHandler][CodeAttach] Uploaded: ${fileName}`);
      } catch (err) {
        logger.error(`[DraftDocumentUpsertHandler][CodeAttach] Error processing attachment ID=${attach.ID}: ${err.message}`);
      }
    }

    return true;
  }
}

module.exports = DraftDocumentUpsertHandler;