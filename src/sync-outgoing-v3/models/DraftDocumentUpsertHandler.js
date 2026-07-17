const logger = require('../../../utils/logger');
const dbUtils = require('../../../utils/dbUtils');
const crypto = require('crypto');
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

function ensureFileExtension(fileName, preferredExt = null, fallbackPath = '') {
  const rawName = String(fileName || '').trim();
  const safeName = rawName || 'file';
  const currentExt = (safeName.includes('.') ? safeName.split('.').pop() : '').toLowerCase();

  if (currentExt) {
    return safeName;
  }

  const pathExt = String(fallbackPath || '').trim().split('.').pop().toLowerCase();
  const ext = (preferredExt || pathExt || 'bin').replace(/^\.+/, '');

  return `${safeName}.${ext}`;
}

//Mapping tên file Title + Type hoặc Name, return FileName, File Path
function normalizeAttachFileName(attach) {

  const rawType = attach?.Type;
  const typeExt = rawType ? (rawType.startsWith('.') ? rawType : `.${rawType.replace(/^\.+/, '')}`) : '';
  const pathExt = String(attach?.Path || '').trim().split('.').pop().toLowerCase();
  const preferredExt = (typeExt || (pathExt ? `.${pathExt}` : '') || '.bin');

  let candidateName;
  let title = attach?.Title;
  if (!title) {
    candidateName = attach?.Name || preferredExt;
  } else {
    candidateName = `${title}${typeExt || preferredExt}`.trim();
  }
  return ensureFileExtension(candidateName, preferredExt.replace(/^\./, ''), attach?.Path || '');
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

  _isDuplicateOutgoingDocumentError(error) {
    const message = String(error?.message || '').toLowerCase();
    return error?.number === 2627
      || error?.number === 2601
      || message.includes('uq_outgoing_documents_document_id')
      || message.includes('cannot insert duplicate key')
      || message.includes('duplicate key value');
  }

  /**
   * Map old user reference from PersonalProfile to new users.id
   */
  async _mapOldUserToNewUserId(userValue, transaction = null) {
    if (userValue === null || userValue === undefined) {
      return null;
    }

    const rawValue = String(userValue).trim();
    if (!rawValue) {
      return null;
    }

    const helper = this.mapper?.helper;
    if (!helper) {
      return rawValue;
    }

    try {
      return await helper.mapUserDrafter(rawValue, transaction)
        || await helper.mapUserName(rawValue, transaction);
    } catch (error) {
      logger.warn(`[DraftDocumentUpsertHandler] Failed to map old user "${rawValue}": ${error.message}`);
      return null;
    }
  }

  _buildDeterministicFileIdBak(ownerId, seed) {
    const rawValue = `${String(ownerId || '').trim()}|${String(seed || '').trim()}`;
    return crypto.createHash('sha1').update(rawValue).digest('hex');
  }

  async _getExistingFileRelationKeys(objectIdBak, tableBak, fileIdBaks, transaction) {
    if (!objectIdBak || !tableBak || !Array.isArray(fileIdBaks) || fileIdBaks.length === 0) {
      return new Set();
    }

    const params = {
      objectIdBak: String(objectIdBak),
      tableBak: String(tableBak)
    };
    const placeholders = [];

    fileIdBaks.forEach((fileIdBak, index) => {
      const paramName = `fileIdBak${index}`;
      placeholders.push(`@${paramName}`);
      params[paramName] = String(fileIdBak);
    });

    const query = `
      SELECT DISTINCT file_id_bak
      FROM ${this.newDbName}.dbo.file_relations
      WHERE object_id_bak = @objectIdBak
        AND table_bak = @tableBak
        AND file_id_bak IN (${placeholders.join(', ')})
    `;

    const rows = await this.queryNewDbTx(query, params, transaction);
    return new Set((rows || []).map((row) => String(row.file_id_bak).trim()));
  }

  async _getExistingFileIds(fileIdBaks, transaction) {
    if (!Array.isArray(fileIdBaks) || fileIdBaks.length === 0) {
      return new Set();
    }

    const params = {};
    const placeholders = [];

    fileIdBaks.forEach((fileIdBak, index) => {
      const paramName = `fileIdBak${index}`;
      placeholders.push(`@${paramName}`);
      params[paramName] = String(fileIdBak);
    });

    const query = `
      SELECT DISTINCT id_bak
      FROM ${this.newDbName}.dbo.files
      WHERE id_bak IN (${placeholders.join(', ')})
    `;

    const rows = await this.queryNewDbTx(query, params, transaction);
    return new Set((rows || []).map((row) => String(row.id_bak).trim()));
  }

  async _prepareCodeAttachFiles(codeItemId) {
    const attachFiles = await this._fetchAttachmentsFromCodeAttach(codeItemId);
    if (!Array.isArray(attachFiles) || attachFiles.length === 0) {
      return [];
    }

    const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
    const preparedResults = [];

    for (const attach of attachFiles) {
      try {
        const filePath = attach.Path || '';
        const fileName = normalizeAttachFileName(attach);
        const fullUrl = filePath.startsWith('http') ? filePath : `${baseUrl}${filePath}`;

        logger.info(`[DraftDocumentUpsertHandler][CodeAttach] Pre-downloading: ${fileName} | Path: ${filePath}`);
        const buffer = await spDownload(fullUrl, this.newPool);

        if (buffer && buffer.length > 0) {
          preparedResults.push({
            ...attach,
            buffer,
            fileName,
            filePath,
            fileIdBak: String(attach.ID || uuidv4())
          });
        }
      } catch (err) {
        logger.error(`[DraftDocumentUpsertHandler][CodeAttach] Error preparing attachment ID=${attach.ID}: ${err.message}`);
      }
    }

    return preparedResults;
  }

  /**
   * Process one draft document record
   * @param {object} oldRecord - Raw record from staging table
   * @returns {Promise<{success: boolean, documentId: string|null, error: string|null}>}
   */
  async processRecord(oldRecord) {
    const batchResult = await this.processBatch([oldRecord]);
    return batchResult.results?.[0] || { success: false, documentId: null, error: 'No result returned' };
  }

  async processBatch(records) {
    if (!Array.isArray(records) || records.length === 0) {
      return { processedCount: 0, successCount: 0, failedCount: 0, results: [] };
    }

    logger.info(`[DraftDocumentUpsertHandler] Processing batch of ${records.length} draft records`);

    const preparedFilesMap = new Map();
    const attachFilesMap = new Map();
    const concurrency = 3;

    for (let index = 0; index < records.length; index += concurrency) {
      const chunk = records.slice(index, index + concurrency);
      await Promise.all(chunk.map(async (record) => {
        const recordId = String(record?.ID || '').trim();
        try {
          const [sharePointFiles, codeAttachFiles] = await Promise.all([
            this._prepareFilesFromSharePoint(record),
            this._prepareCodeAttachFiles(record?.ID)
          ]);
          preparedFilesMap.set(recordId, sharePointFiles);
          attachFilesMap.set(recordId, codeAttachFiles);
        } catch (error) {
          logger.warn(`[DraftDocumentUpsertHandler] Failed to pre-download files for ID=${recordId}: ${error.message}`);
          preparedFilesMap.set(recordId, []);
          attachFilesMap.set(recordId, []);
        }
      }));
    }

    const results = [];
    let successCount = 0;
    let failedCount = 0;

    for (const oldRecord of records) {
      const id = String(oldRecord?.ID || '').trim();
      const preparedFiles = preparedFilesMap.get(id) || [];
      const attachFiles = attachFilesMap.get(id) || [];
      try {
        const result = await dbUtils.withTransactionRetry(this.newPool, async (transaction) => {
          return await this._processRecordCore(
            oldRecord,
            transaction,
            preparedFiles,
            attachFiles
          );
        });

        results.push({
          ID: id,
          success: true,
          documentId: result.documentId,
          action: result.action || null,
          error: null
        });
        successCount++;
        logger.info(`[DraftDocumentUpsertHandler] Completed draft ID: ${id}, action: ${result.action}`);
      } catch (error) {
        results.push({
          ID: id,
          success: false,
          documentId: null,
          action: null,
          error: error.message
        });
        failedCount++;
        logger.error(`[DraftDocumentUpsertHandler] Failed draft ID=${id}: ${error.message}`);
      } finally {
        if (Array.isArray(preparedFiles)) {
          for (const fileItem of preparedFiles) {
            if (fileItem) fileItem.buffer = null;
          }
          preparedFiles.length = 0;
        }
        if (Array.isArray(attachFiles)) {
          for (const fileItem of attachFiles) {
            if (fileItem) fileItem.buffer = null;
          }
          attachFiles.length = 0;
        }
        preparedFilesMap.delete(id);
        attachFilesMap.delete(id);
      }
    }

    return {
      processedCount: records.length,
      successCount,
      failedCount,
      results
    };
  }

  async _processRecordCore(oldRecord, transaction, preparedFiles = [], attachFiles = []) {
    if (!oldRecord) {
      throw new Error('No record provided');
    }

    const id = String(oldRecord?.ID || '').trim();

    const mapped = await this.mapper.mapRecord(oldRecord, transaction);
    if (!mapped?.document_id) {
      throw new Error('Mapped document_id is required');
    }

    const existingQuery = `
      SELECT TOP 1 document_id, id_outgoing_bak
      FROM ${this.newDbName}.dbo.outgoing_documents
      WHERE id_outgoing_bak = @idOutgoingBak
         OR document_id = @documentId
    `;
    const existing = await this.queryNewDbTx(existingQuery, {
      idOutgoingBak: mapped.id_outgoing_bak,
      documentId: mapped.document_id
    }, transaction);

    let documentId;
    let drafter = mapped.drafter;
    let isNew = false;

    if (existing && existing.length > 0) {
      const dbDocId = existing[0].document_id;
      await this._updateRecord(mapped, transaction, dbDocId);
      documentId = dbDocId;
    } else {
      mapped.document_id = String(mapped.document_id).toUpperCase();
      try {
        await this._insertRecord(mapped, transaction);
        documentId = mapped.document_id;
        isNew = true;
      } catch (insertError) {
        if (!this._isDuplicateOutgoingDocumentError(insertError)) {
          throw insertError;
        }

        logger.warn(`[DraftDocumentUpsertHandler] Duplicate detected on insert for documentId=${mapped.document_id}; re-reading existing row and updating.`);
        const fallbackExisting = await this.queryNewDbTx(existingQuery, {
          idOutgoingBak: mapped.id_outgoing_bak,
          documentId: mapped.document_id
        }, transaction);

        if (fallbackExisting && fallbackExisting.length > 0) {
          const dbDocId = fallbackExisting[0].document_id;
          await this._updateRecord(mapped, transaction, dbDocId);
          documentId = dbDocId;
        } else {
          throw insertError;
        }
      }
    }

    await this._applyPreparedFiles(preparedFiles, oldRecord, {
      id: documentId,
      type_doc: 1,
      drafter
    }, transaction);

    await this._applyCodeAttachFiles(attachFiles, oldRecord, {
      id: documentId,
      type_doc: 1,
      drafter
    }, transaction);

    await this._processAudits(oldRecord, documentId, id, drafter, transaction, isNew);
    await this._processHtmlComments(oldRecord, documentId, id, transaction);

    return { action: isNew ? 'inserted' : 'updated', documentId };
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
        internal_receiving_dept_old, processor, files, stage_status
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
        @internal_receiving_dept_old, @processor, @files, @stage_status
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
      stage_status: record.stage_status
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
        processor = @processor,
        replaced = @replaced,
        replaced_documents = @replaced_documents,
        doc_recall = @doc_recall,
        stage_status = @stage_status,
        doc_draft = @doc_draft,
        bpmn_version = @bpmn_version,
        type_of_process = @type_of_process,
        id_outgoing_bak = @id_outgoing_bak
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
      processor: record.processor,
      replaced: record.replaced,
      replaced_documents: record.replaced_documents,
      doc_recall: record.doc_recall,
      stage_status: record.stage_status,
      doc_draft: record.doc_draft,
      bpmn_version: record.bpmn_version,
      type_of_process: record.type_of_process,
      id_outgoing_bak: record.id_outgoing_bak
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
        const fileIdBak = this._buildDeterministicFileIdBak(oldRecord?.ID, relativePath);

        logger.info(`[DraftDocumentUpsertHandler][prepareFiles] Downloading: ${fileName}`);
        const buffer = await spDownload(fullUrl, this.newPool);

        if (buffer && buffer.length > 0) {
          preparedResults.push({ buffer, fileName, relativePath, fileIdBak });
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

    const objectIdBak = String(oldRecord?.ID || '').trim();
    const fileIdBaks = preparedFiles.map((fileItem) => String(fileItem?.fileIdBak || this._buildDeterministicFileIdBak(objectIdBak, fileItem?.relativePath || fileItem?.fileName || '')));
    const existingRelationKeys = await this._getExistingFileRelationKeys(objectIdBak, 'CodeItem', fileIdBaks, transaction);
    const existingFileIds = await this._getExistingFileIds(fileIdBaks, transaction);

    for (const fileItem of preparedFiles) {
      const { buffer, fileName, relativePath } = fileItem;
      const fileIdBak = String(fileItem?.fileIdBak || this._buildDeterministicFileIdBak(objectIdBak, relativePath || fileName || ''));
      if (existingRelationKeys.has(fileIdBak) || existingFileIds.has(fileIdBak)) {
        continue;
      }

      const fileType = detectFileType(buffer);
      const mimeType = fileType.mime;
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

  async _insertAuditRowsBatch(auditRows, transaction) {
    if (!Array.isArray(auditRows) || auditRows.length === 0) {
      return [];
    }

    const queryParams = {};
    const valuesSql = auditRows.map((row, index) => {
      const suffix = String(index);
      const fields = {
        document_id: row.document_id,
        time: row.time,
        user_id: row.user_id,
        display_name: row.display_name,
        action_code: row.action_code,
        details: row.details,
        origin_id: row.origin_id,
        created_by: row.created_by,
        receiver: row.receiver,
        receiver_unit: row.receiver_unit,
        group_: row.group_,
        roleProcess: row.roleProcess,
        action: row.action,
        stage_status: row.stage_status,
        created_at: row.created_at,
        updated_at: row.updated_at,
        type_document: row.type_document,
        table_backups: row.table_backups,
        role: row.role,
        curStatusCode: row.curStatusCode,
        from_node_id: row.from_node_id,
        to_node_id: row.to_node_id
      };

      Object.entries(fields).forEach(([key, value]) => {
        queryParams[`${key}_${suffix}`] = value;
      });

      return `(
        @document_id_${suffix}, @time_${suffix}, @user_id_${suffix}, @display_name_${suffix},
        @action_code_${suffix}, @details_${suffix}, @origin_id_${suffix}, @created_by_${suffix},
        @receiver_${suffix}, @receiver_unit_${suffix}, @group__${suffix}, @roleProcess_${suffix},
        @action_${suffix}, @stage_status_${suffix}, @created_at_${suffix}, @updated_at_${suffix},
        @type_document_${suffix}, @table_backups_${suffix}, @role_${suffix}, @curStatusCode_${suffix},
        @from_node_id_${suffix}, @to_node_id_${suffix}
      )`;
    });

    const query = `
      INSERT INTO ${this.newDbName}.dbo.audit (
        document_id, [time], user_id, display_name,
        action_code, details, origin_id, created_by,
        receiver, receiver_unit, group_, roleProcess,
        [action], stage_status, created_at, updated_at,
        type_document, table_backups, [role], curStatusCode,
        from_node_id, to_node_id
      )
      OUTPUT inserted.id, inserted.document_id, inserted.[time], inserted.receiver, 
             inserted.receiver_unit, inserted.created_by, inserted.roleProcess, 
             inserted.stage_status, inserted.action_code
      VALUES ${valuesSql.join(',\n')}
    `;

    const request = transaction.request();
    for (const [key, value] of Object.entries(queryParams)) {
      request.input(key, value);
    }
    const result = await request.query(query);
    return result.recordset || [];
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

        let creatorId = await this._mapOldUserToNewUserId(drafter || process.env.VANTHU_USER_ID, transaction)
          || drafter
          || process.env.VANTHU_USER_ID;
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
          )
          OUTPUT inserted.id, inserted.document_id, inserted.[time], inserted.receiver, 
                 inserted.receiver_unit, inserted.created_by, inserted.roleProcess, 
                 inserted.stage_status, inserted.action_code
          VALUES (
            @document_id, @time, @user_id, @display_name,
            @action_code, @details, @origin_id, @created_by,
            @receiver, @receiver_unit, @group_, @roleProcess,
            @action, @stage_status, @created_at, @updated_at,
            @type_document, @table_backups
          )
        `;

        const createResult = await this.queryNewDbTx(insertQuery, {
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

        if (createResult && createResult.length > 0) {
          await this._syncToAssignment(createResult[0], transaction);
        }

        logger.info(`[DraftDocumentUpsertHandler][AutoCreateAudit] Created initial CREATE audit for documentId=${documentId} creator=${displayName}`);
      }
    } catch (autoAuditErr) {
      logger.warn(`[DraftDocumentUpsertHandler][AutoCreateAudit] Failed for documentId=${documentId}: ${autoAuditErr.message}`);
    }

    try {
      // 2. Dong bo tiep luong luan chuyen SLA
      const slaStepsQuery = `
        SELECT 
          s.ID AS [origin_id_raw],
          
          -- Anh xa dat ten truc tiep theo cau truc bang dbo.audit moi
          document_id   = 'VBD_' + CAST(s.ItemID AS NVARCHAR(50)) + '_DRAFT',
          [time]        = ISNULL(s.CompletedDate, s.StartDate),
          [user_id]     = s.UserID,
          display_name  = ISNULL(p.FullName, N'Người dùng hệ thống'),
          
          [role]        = CASE 
                            WHEN s.Step = 1 THEN 'NGUOI_SOAN_THAO'
                            WHEN s.Step = 2 THEN 'VAN_THU'
                            WHEN s.Step = 3 THEN 'NGUOI_KY_NOI_DUNG'
                            WHEN s.Step = 4 THEN 'NGUOI_KY_THE_THUC'
                            ELSE 'NGUOI_KY_BAN_HANH'
                          END,
                          
          action_code   = CASE 
                            WHEN s.Step = 1 THEN 'TRINH_KIEM_TRA_TT'
                            WHEN s.Step = 2 THEN 'TRINH_KY'
                            WHEN s.Step = 3 THEN 'KY_NHAY_NOI_DUNG'
                            WHEN s.Step = 4 THEN 'KY_NHAY_THE_THUC'
                            WHEN s.Step = 5 THEN 'KY_SO'
                            WHEN s.Step = 6 THEN 'DONG_DAU'
                            ELSE 'BAN_HANH'
                          END,

          -- Cac truong chuyen tiep Node So do BPMN theo s.Step
          from_node_id  = CASE 
                            WHEN s.Step = 1 THEN 'StartEvent_1'
                            WHEN s.Step = 2 THEN 'Gateway_03gioyp'
                            WHEN s.Step = 3 THEN 'Gateway_0f9nnuk'
                            WHEN s.Step = 4 THEN 'Gateway_0rj02g2'
                            WHEN s.Step = 5 THEN 'Gateway_1a9cz3v'
                            WHEN s.Step = 6 THEN 'Gateway_00m66ta'
                            WHEN s.Step = 7 THEN 'Gateway_07zem0t'
                            ELSE 'Gateway_14j7h6r'
                          END,

          to_node_id    = CASE 
                            WHEN s.Step = 1 THEN 'Gateway_03gioyp'
                            WHEN s.Step = 2 THEN 'Gateway_0f9nnuk'
                            WHEN s.Step = 3 THEN 'Gateway_0rj02g2'
                            WHEN s.Step = 4 THEN 'Gateway_1a9cz3v'
                            WHEN s.Step = 5 THEN 'Gateway_00m66ta'
                            WHEN s.Step = 6 THEN 'Gateway_07zem0t'
                            WHEN s.Step = 7 THEN 'Gateway_14j7h6r'
                            ELSE 'END'
                          END,
                          
          created_by    = ISNULL(s.CreatedBy, s.UserID),
          receiver      = s.UserID,
          roleProcess   = 'processor', -- Mau quy dinh luon co dinh la 'processor'
          
          [action]      = CASE 
                            WHEN s.Step = 1 THEN N'Tạo văn bản'
                            ELSE N'Xử lý chính'
                          END,
                          
          curStatusCode = CASE 
                            WHEN s.Step = 1 THEN 1
                            WHEN s.Step = 2 THEN 14
                            WHEN s.Step = 3 THEN 3
                            WHEN s.Step = 4 THEN 5
                            WHEN s.Step = 5 THEN 6
                            WHEN s.Step = 6 THEN 15
                            ELSE 9
                          END,
                          
          stage_status  = CASE 
                            WHEN s.CompletedDate IS NOT NULL AND s.Step >= 7 THEN 'DA_BAN_HANH'
                            WHEN s.CompletedDate IS NOT NULL THEN 'DA_XU_LY'
                            ELSE 'BAN_HANH_DU_THAO'
                          END,
                          
          created_at    = s.StartDate,
          updated_at    = ISNULL(s.CompletedDate, s.Modified),
          type_document = 'OutgoingDocument',
          table_backups = 'SLAStepDetail_sync',

          -- Cac gia tri phu tro de nen vao truong JSON details trong NodeJS
          [step_val]          = s.Step,
          [used_minutes_val]  = s.UsedSLAMinutes,
          [actual_minutes_val]= s.ActualSLAMinutes,
          [created_name_val]  = p1.FullName,
          [modified_name_val] = p2.FullName
        FROM (
          SELECT * FROM [SNP].[SLAStepDetail] WHERE ItemID = @recordId
          UNION ALL
          SELECT * FROM [SNP].[SLAStepDetail_History] WHERE ItemID = @recordId
        ) s
        LEFT JOIN [dbo].[PersonalProfile] p ON s.UserId = p.ID
        LEFT JOIN [dbo].[PersonalProfile] p1 ON s.CreatedBy = p1.ID
        LEFT JOIN [dbo].[PersonalProfile] p2 ON s.ModifiedBy = p2.ID
        ORDER BY s.Step ASC, s.StartDate ASC
      `;

      const slaSteps = await this.queryOldDb(slaStepsQuery, { recordId: parseInt(recordId, 10) });

      if (slaSteps && slaSteps.length > 0) {
        let maxStatusCode = null;
        const mappedUserCache = new Map();
        const mappedCreatedByCache = new Map();
        const mappedReceiverCache = new Map();
        const pendingAuditRows = [];
        const pendingOriginIds = new Set();

        for (const row of slaSteps) {
          try {
            // Xac dinh trang thai nghiep vu cua van ban
            let statusCodeVal = 2; // Dang xu ly
            if (row.step_val === 1 || row.action_code === 'PENDING') {
              statusCodeVal = 1; // Khoi tao hoac dang cho
            }

            if (!maxStatusCode || statusCodeVal > maxStatusCode) {
              maxStatusCode = statusCodeVal;
            }

            const rawCreatedByKey = String(row.created_by || row.user_id || '').trim();
            const rawStepKey = String(row.step_val ?? row.step ?? '').trim();
            const stepOriginId = `sla_step_${recordId}_${rawStepKey || 'unknownstep'}_${rawCreatedByKey || 'unknownuser'}`;

            const detailsObj = {
              step: row.step_val,
              usedMinutes: row.used_minutes_val,
              actualMinutes: row.actual_minutes_val,
              createdName: row.created_name_val || null,
              modifiedName: row.modified_name_val || null,
              table_backups: 'SLAStepDetail_sync'
            };

            const mappedUserId = mappedUserCache.has(String(row.user_id || ''))
              ? mappedUserCache.get(String(row.user_id || ''))
              : await this._mapOldUserToNewUserId(row.user_id, transaction);
            mappedUserCache.set(String(row.user_id || ''), mappedUserId);

            const createdByKey = String(row.created_by || '');
            const mappedCreatedBy = mappedCreatedByCache.has(createdByKey)
              ? mappedCreatedByCache.get(createdByKey)
              : await this._mapOldUserToNewUserId(row.created_by, transaction);
            mappedCreatedByCache.set(createdByKey, mappedCreatedBy);

            const receiverKey = String(row.receiver || '');
            const mappedReceiver = mappedReceiverCache.has(receiverKey)
              ? mappedReceiverCache.get(receiverKey)
              : await this._mapOldUserToNewUserId(row.receiver, transaction);
            mappedReceiverCache.set(receiverKey, mappedReceiver);

            if (pendingOriginIds.has(stepOriginId)) {
              continue;
            }

            pendingOriginIds.add(stepOriginId);
            pendingAuditRows.push({
              document_id: documentId,
              time: row.time,
              user_id: mappedUserId || drafter || process.env.VANTHU_USER_ID,
              display_name: row.display_name,
              action_code: row.action_code,
              details: JSON.stringify(detailsObj),
              origin_id: stepOriginId,
              created_by: mappedCreatedBy || drafter || process.env.VANTHU_USER_ID,
              receiver: mappedReceiver || drafter || process.env.VANTHU_USER_ID,
              receiver_unit: null,
              group_: null,
              roleProcess: row.roleProcess,
              action: row.action,
              stage_status: row.stage_status,
              created_at: row.created_at,
              updated_at: row.updated_at,
              type_document: row.type_document,
              table_backups: row.table_backups,
              role: row.role,
              curStatusCode: row.curStatusCode,
              from_node_id: row.from_node_id,
              to_node_id: row.to_node_id,
              step: row.step_val,
              origin_id_raw: row.origin_id_raw
            });
          } catch (stepErr) {
            logger.warn(`[DraftDocumentUpsertHandler][Audit] Failed to sync SLA step ID=${row.origin_id_raw}: ${stepErr.message}`);
          }
        }

        if (pendingAuditRows.length > 0) {
          const existingOriginQueryParams = { documentId };
          const originPlaceholders = [];
          pendingAuditRows.forEach((row, index) => {
            const paramName = `originId${index}`;
            originPlaceholders.push(`@${paramName}`);
            existingOriginQueryParams[paramName] = row.origin_id;
          });

          const existingAuditRows = await this.queryNewDbTx(
            `
              SELECT origin_id
              FROM ${this.newDbName}.dbo.audit
              WHERE document_id = @documentId
                AND origin_id IN (${originPlaceholders.join(', ')})
            `,
            existingOriginQueryParams,
            transaction
          );
          const existingOriginIds = new Set((existingAuditRows || []).map((row) => String(row.origin_id).trim()));
          const rowsToInsert = pendingAuditRows.filter((row) => !existingOriginIds.has(String(row.origin_id).trim()));

          if (rowsToInsert.length > 0) {
            const insertedRows = await this._insertAuditRowsBatch(rowsToInsert, transaction);
            for (const row of insertedRows) {
              await this._syncToAssignment(row, transaction);
            }
          }
        }

        // Cap nhat trang thai cao nhat vao truong status_code cua van ban
        if (maxStatusCode !== null) {
          const updateDocStatusQuery = `
            UPDATE ${this.newDbName}.dbo.outgoing_documents WITH (ROWLOCK)
            SET status_code = @statusCode
            WHERE document_id = @documentId
              AND (status_code IS NULL OR TRY_CONVERT(INT, status_code) < @statusCode)
          `;
          await this.queryNewDbTx(updateDocStatusQuery, {
            statusCode: String(maxStatusCode),
            documentId: documentId
          }, transaction);
        }
      }
    } catch (error) {
      logger.warn(`[DraftDocumentUpsertHandler][Audit] SLA steps sync failed: ${error.message}`);
    }

    // 3. Dong bo bang phu outgoing_current_state
    try {
      await this._refreshCurrentStateDirect(documentId, transaction);
    } catch (stateErr) {
      logger.warn(`[DraftDocumentUpsertHandler][Audit] _refreshCurrentStateDirect failed: ${stateErr.message}`);
    }
  }

  /**
   * Sync single audit record to outgoing_assignment table
   */
  async _syncToAssignment(auditRow, transaction) {
    const {
      id: auditId, document_id, time, receiver, receiver_unit, created_by,
      roleProcess, stage_status, action_code
    } = auditRow;

    if (!document_id) return;

    try {
      if (!stage_status || !roleProcess) return;

      const creatorActionCodes = new Set(['CREATE', 'TONG_HOP', 'SOAN_THAO']);
      const isCreator = creatorActionCodes.has(action_code) ? 1 : 0;

      const allReceivers = [
        ...(receiver ? [{ rec: receiver || created_by, unit: receiver_unit || null }] : []),
        ...(receiver_unit && receiver_unit !== receiver
          ? [{ rec: receiver_unit, unit: receiver_unit }]
          : [])
      ];

      if (allReceivers.length === 0) return;

      const uniqueKeys = new Set();

      for (const { rec, unit } of allReceivers) {
        if (!rec) continue;

        const key = `${rec}_${roleProcess}`;
        if (uniqueKeys.has(key)) continue;
        uniqueKeys.add(key);

        const updateParams = {
          document_id: String(document_id).trim().toUpperCase(),
          receiver: String(rec).trim().substring(0, 100),
          role_process: String(roleProcess).trim().substring(0, 50),
          stage_status: String(stage_status).trim().substring(0, 50),
          created_at: time || new Date(),
          last_audit_id: auditId || null,
          receiver_unit: unit ? String(unit).trim().substring(0, 100) : null,
          is_creator: isCreator
        };

        const upsertQuery = `
          IF EXISTS (SELECT 1 FROM dbo.outgoing_assignment WITH (UPDLOCK, HOLDLOCK) 
                     WHERE document_id = @document_id AND receiver = @receiver AND role_process = @role_process)
          BEGIN
            UPDATE dbo.outgoing_assignment 
            SET stage_status = @stage_status,
                created_at = @created_at,
                last_audit_id = @last_audit_id,
                receiver_unit = @receiver_unit,
                is_creator = @is_creator
            WHERE document_id = @document_id AND receiver = @receiver AND role_process = @role_process
          END
          ELSE
          BEGIN
            INSERT INTO dbo.outgoing_assignment 
            (document_id, receiver, role_process, stage_status, created_at, last_audit_id, receiver_unit, is_creator, table_backups)
            VALUES (@document_id, @receiver, @role_process, @stage_status, @created_at, @last_audit_id, @receiver_unit, @is_creator, 'outgoing_assignment')
          END
        `;

        await this.queryNewDbTx(upsertQuery, updateParams, transaction);
      }

    } catch (err) {
      logger.error(`[DraftDocumentUpsertHandler] Sync assignment failed: doc=${document_id}`, err);
      throw err;
    }
  }

  /**
   * Refresh current state for outgoing_current_state table
   */
  async _refreshCurrentStateDirect(documentId, transaction = null) {
    if (!documentId) return;

    try {
      const query = `
        SELECT id, [time], receiver, receiver_unit, created_by, roleProcess, stage_status, action_code
        FROM ${this.newDbName}.dbo.audit
        WHERE document_id = @documentId
        ORDER BY [time] ASC, id ASC
      `;

      const audits = await this.queryNewDbTx(query, { documentId }, transaction);
      if (!audits || audits.length === 0) return;

      let hasBanHanh = 0;
      let hasDaXuLy = 0;
      let hasHtVbtt = 0;
      let isCompleted = 0;
      let lastDaXuLyAuditId = null;
      let hasTraLaiAfterDaXuLy = 0;

      const latestAudit = audits[audits.length - 1];
      for (const audit of audits) {
        const stageUp = String(audit.stage_status || '').toUpperCase();
        if (stageUp === 'BAN_HANH' || stageUp === 'DA_BAN_HANH') {
          hasBanHanh = 1;
          isCompleted = 1;
        }
        if (stageUp === 'DA_XU_LY') {
          hasDaXuLy = 1;
          lastDaXuLyAuditId = audit.id;
        }
        if (stageUp === 'HT_VBTT' || stageUp === 'BAN_HANH_DU_THAO') {
          hasHtVbtt = 1;
        }
        if (audit.action_code === 'TRA_LAI' && hasDaXuLy === 1) {
          hasTraLaiAfterDaXuLy = 1;
        }
      }

      const upsertQuery = `
        IF EXISTS (
          SELECT 1 FROM ${this.newDbName}.dbo.outgoing_current_state WITH (UPDLOCK, HOLDLOCK)
          WHERE document_id = @document_id
        )
        BEGIN
          UPDATE ${this.newDbName}.dbo.outgoing_current_state
          SET
            current_stage_status   = @stage_status,
            current_action_code    = @action_code,
            current_receiver       = @receiver,
            current_role_process   = @role_process,
            last_audit_id          = @last_audit_id,
            last_audit_time        = @audit_time,
            has_ban_hanh           = @has_ban_hanh,
            has_da_xu_ly           = @has_da_xu_ly,
            has_ht_vbtt            = @has_ht_vbtt,
            is_completed_doc       = @is_completed,
            last_da_xu_ly_audit_id = @last_da_xu_ly_audit_id,
            has_tra_lai_after_da_xu_ly = @has_tra_lai_after_da_xu_ly,
            updated_at             = @audit_time
          WHERE document_id = @document_id;
        END
        ELSE
        BEGIN
          INSERT INTO ${this.newDbName}.dbo.outgoing_current_state (
            document_id, current_stage_status, current_action_code,
            current_receiver, current_role_process,
            last_audit_id, last_audit_time,
            has_ban_hanh, has_da_xu_ly, has_ht_vbtt,
            is_completed_doc, last_da_xu_ly_audit_id, has_tra_lai_after_da_xu_ly,
            has_open_workitem, is_transfer_to_room, updated_at, table_backups
          )
          VALUES (
            @document_id, @stage_status, @action_code,
            @receiver, @role_process,
            @last_audit_id, @audit_time,
            @has_ban_hanh, @has_da_xu_ly, @has_ht_vbtt,
            @is_completed, @last_da_xu_ly_audit_id, @has_tra_lai_after_da_xu_ly,
            0, 0, @audit_time, 'outgoing_current_state'
          );
        END
      `;

      const currentReceiver = latestAudit.receiver || latestAudit.receiver_unit || latestAudit.created_by;
      await this.queryNewDbTx(
        upsertQuery,
        {
          document_id: documentId,
          stage_status: latestAudit.stage_status ? String(latestAudit.stage_status).substring(0, 100) : null,
          action_code: latestAudit.action_code ? String(latestAudit.action_code).substring(0, 100) : null,
          receiver: currentReceiver ? String(currentReceiver).substring(0, 100) : null,
          role_process: latestAudit.roleProcess ? String(latestAudit.roleProcess).substring(0, 100) : null,
          last_audit_id: latestAudit.id || null,
          audit_time: latestAudit.time,
          has_ban_hanh: hasBanHanh,
          has_da_xu_ly: hasDaXuLy,
          has_ht_vbtt: hasHtVbtt,
          is_completed: isCompleted,
          last_da_xu_ly_audit_id: lastDaXuLyAuditId,
          has_tra_lai_after_da_xu_ly: hasTraLaiAfterDaXuLy
        },
        transaction
      );
      logger.info(`[DraftDocumentUpsertHandler] Sync current_state success: doc=${documentId}`);
    } catch (err) {
      logger.error(`[DraftDocumentUpsertHandler] _refreshCurrentStateDirect failed for doc=${documentId}: ${err.message}`);
      throw err;
    }
  }

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

      // logger.info(`[DraftDocumentUpsertHandler][CodeAttach] Found ${rows.recordset?.length || 0} attachments for CodeItemId=${codeItemId}`);
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
    const objectIdBak = String(oldRecord?.ID || '').trim();
    const fileIdBaks = attachFiles.map((attach) => String(attach?.fileIdBak || attach?.ID || ''));
    const existingRelationKeys = await this._getExistingFileRelationKeys(objectIdBak, 'CodeAttach', fileIdBaks, transaction);
    const existingFileIds = await this._getExistingFileIds(fileIdBaks, transaction);

    for (const attach of attachFiles) {
      try {
        const filePath = attach.Path || '';
        const fileName = attach.fileName || normalizeAttachFileName(attach);
        const fullUrl = filePath.startsWith('http') ? filePath : `${baseUrl}${filePath}`;
        const fileIdBak = String(attach.fileIdBak || attach.ID || uuidv4());

        if (existingRelationKeys.has(fileIdBak) || existingFileIds.has(fileIdBak)) {
          // logger.info(`[DraftDocumentUpsertHandler][CodeAttach] Skip duplicate attachment ID=${attach.ID}, fileIdBak=${fileIdBak}`);
          continue;
        }

        // logger.info(`[DraftDocumentUpsertHandler][CodeAttach] Processing: ${fileName} | Path: ${filePath}`);
        const buffer = attach.buffer || await spDownload(fullUrl, this.newPool);

        if (!buffer || buffer.length === 0) {
          logger.warn(`[DraftDocumentUpsertHandler][CodeAttach] Empty buffer for ${fileName}, skipping`);
          continue;
        }

        const fileType = detectFileType(buffer);
        const mimeType = fileType.mime;
        const finalFileName = ensureFileExtension(fileName, fileType.ext, filePath);

        const fileRecord = {
          file_name: finalFileName,
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
          originalName: finalFileName,
          mimeType,
          fileRecord,
          relationRecord,
          folder: 'outgoing',
          localFolder: 'outgoing',
          transaction
        });

        logger.info(`[DraftDocumentUpsertHandler][CodeAttach] Uploaded: ${finalFileName}`);
      } catch (err) {
        logger.error(`[DraftDocumentUpsertHandler][CodeAttach] Error processing attachment ID=${attach.ID}: ${err.message}`);
      }
    }

    return true;
  }
}

module.exports = DraftDocumentUpsertHandler;
