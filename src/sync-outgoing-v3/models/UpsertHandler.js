const logger = require('../../../utils/logger');
const dbUtils = require('../../../utils/dbUtils');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const OutgoingMapper = require('../mappers/OutgoingMapper');
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
 * Handler class for upserting outgoing documents.
 * Contains all business logic: document upsert, files, comments, audits.
 */
class UpsertHandler {
  constructor(newPool, oldPool) {
    this.newPool = newPool;
    this.oldPool = oldPool;
    this.mapper = new OutgoingMapper(
      this.queryNewDbTx.bind(this),
      this.queryOldDb.bind(this)
    );
    this._fileService = null;
    this._syncAuditModel = [];
    this.newDbName = process.env.NEW_DB_NAME;
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

  _parseFilesField(fieldValue) {
    if (!fieldValue) return [];

    // Split entries by ;#
    const blocks = String(fieldValue).split(';#').filter(Boolean);
    const filesToPath = [];

    for (const block of blocks) {
      const trimmedBlock = block.trim();
      if (!trimmedBlock) continue;

      // Split parts inside each block by |
      const parts = trimmedBlock.split('|');
      const urlFile = String(parts[0] || '').trim();
      if (!urlFile) continue;

      const nameFile = String(parts[1] || '').trim();
      const typeFile = String(parts[2] || '').trim();

      filesToPath.push({
        urlFile,
        nameFile: nameFile || null,
        typeFile: typeFile || null
      });
    }

    return filesToPath;
  }



  /**
   * Initialize dependencies
   */
  async initialize() {
    const SyncOutgoingAuditModel = require('../../sync-audit/SyncOutgoingAuditModel');

    for (const tableName of AUDIT_TABLES) {
      const model = new SyncOutgoingAuditModel();
      model.oldDbTable = tableName;
      // Trực tiếp gán pool để tránh Model tự init lại từ singleton có thể bị lỗi/chậm
      model.oldPool = this.oldPool;
      model.newPool = this.newPool;
      // Gọi initialize để model check schema (audit table)
      await model.initialize();
      this._syncAuditModel.push(model);
    }

    this._fileService = new FileService(this.newPool);
    logger.info(`[UpsertHandler] Initialized with ${this._syncAuditModel.length} audit models`);
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
   * Process a batch of outgoing document records
   * @param {Array} records - Array of raw records from staging table
   * @returns {Promise<{successIds: Array, failedRecords: Array}>}
   */
  async processBatch(records) {
    if (!records || records.length === 0) {
      return { successIds: [], failedRecords: [], recordStates: [] };
    }

    const successIds = [];
    const failedRecords = [];
    const recordStates = [];
    const currentStateDocIds = new Set();
    const recordIdByDocumentId = new Map();
    logger.info(`[UpsertHandler] Processing batch of ${records.length} records`);

    // Step 1: Pre-download files with concurrency limit
    const concurrency = 5;
    const preparedFilesMap = new Map();
    
    for (let i = 0; i < records.length; i += concurrency) {
      const chunk = records.slice(i, i + concurrency);
      await Promise.all(chunk.map(async (record) => {
        const recordId = record.ID;
        try {
          const files = await this._prepareFilesFromSharePoint(record);
          preparedFilesMap.set(recordId, files);
        } catch (err) {
          logger.warn(`[UpsertHandler] Failed to prepare files for ID=${recordId}: ${err.message}`);
          preparedFilesMap.set(recordId, []);
        }
      }));
    }

    // Step 1.5: Ensure FileService has a valid Keycloak token BEFORE opening the SQL transaction.
    // If the token is expired, Playwright will take 5-10 seconds to fetch a new one. 
    // Doing this inside the transaction would cause SQL timeout.
    if (this._fileService && typeof this._fileService._getNewSystemToken === 'function') {
      try {
        await this._fileService._getNewSystemToken();
      } catch (err) {
        logger.warn(`[UpsertHandler] Failed to pre-fetch API token: ${err.message}`);
      }
    }

    // Step 2: Process each record with its own transaction
    for (const oldRecord of records) {
      let currentDocResult = null;

      try {
        await dbUtils.withTransactionRetry(this.newPool, async (transaction) => {
          const id = String(oldRecord?.ID || '').trim();

          const docResult = await this._processDocument(oldRecord, transaction);
          if (!docResult || docResult.affected === 0) return;

          currentDocResult = docResult;
          const documentId = docResult.documentId;
          const drafter = docResult.drafter;

          const isNew = docResult.action === 'INSERT' || docResult.action === 'inserted';
          await this._processAudits(oldRecord, documentId, id, drafter, transaction, isNew);
          await this._processHtmlComments(oldRecord, documentId, id, transaction);
        });

        if (currentDocResult && currentDocResult.affected > 0) {
          successIds.push(oldRecord.ID);
          recordIdByDocumentId.set(String(currentDocResult.documentId), String(oldRecord.ID));
          currentStateDocIds.add(String(currentDocResult.documentId));

          const preparedFiles = preparedFilesMap.get(oldRecord.ID) || [];
          preparedFilesMap.delete(oldRecord.ID);

          let syncStatus = 'SUCCESS';
          let syncReason = null;

          try {
            await this._applyPreparedFiles(preparedFiles, oldRecord, {
              id: currentDocResult.documentId,
              type_doc: 1,
              drafter: currentDocResult.drafter
            });
          } catch (fileErr) {
            syncStatus = 'PARTIAL_SUCCESS';
            syncReason = `FILE_UPLOAD_FAILED: ${fileErr.message}`;
            logger.warn(`[UpsertHandler] File upload failed for ${currentDocResult.documentId}: ${fileErr.message}`);
          }

          recordStates.push({
            id: oldRecord.ID,
            documentId: currentDocResult.documentId,
            syncStatus,
            syncReason
          });
        }
      } catch (singleError) {
        logger.error(`[UpsertHandler] Failed for ID=${oldRecord.ID}: ${singleError.message}`);
        failedRecords.push({ id: oldRecord.ID, error: singleError.message });
        recordStates.push({
          id: oldRecord.ID,
          syncStatus: 'FAILED',
          syncReason: singleError.message
        });
      }
    }

    // Step 3: Refresh current state after all audits/comments/files are committed
    const currentStateFailures = await this._refreshCurrentStates(Array.from(currentStateDocIds));
    if (currentStateFailures.length > 0) {
      for (const failure of currentStateFailures) {
        const recordId = recordIdByDocumentId.get(String(failure.documentId));
        if (!recordId) continue;

        const existingState = recordStates.find((item) => String(item.id) === String(recordId));
        if (existingState && existingState.syncStatus !== 'FAILED') {
          existingState.syncStatus = existingState.syncStatus === 'SUCCESS' ? 'PARTIAL_SUCCESS' : existingState.syncStatus;
          existingState.syncReason = existingState.syncReason
            ? `${existingState.syncReason}; CURRENT_STATE_FAILED: ${failure.error}`
            : `CURRENT_STATE_FAILED: ${failure.error}`;
        }
      }
    }

    logger.info(`[UpsertHandler] Completed batch. Success: ${successIds.length}, Failed: ${failedRecords.length}`);
    return { successIds, failedRecords, recordStates };
  }

  /**
   * Step 1: Process document (insert/update)
   */
  async _processDocument(oldRecord, transaction) {
    const mapped = await this.mapper.mapRecord(oldRecord, transaction);
    if (!mapped?.document_id) {
      throw new Error('Mapped document_id is required');
    }

    // Check if exists
    const existingQuery = `
      SELECT TOP 1 document_id
      FROM ${this.newDbName}.dbo.outgoing_documents
      WHERE id_outgoing_bak = @idOutgoingBak
    `;
    const existing = await this.queryNewDbTx(existingQuery, { idOutgoingBak: mapped.id_outgoing_bak }, transaction);

    if (existing && existing.length > 0) {
      const dbDocId = existing[0].document_id;
      logger.info(`[UpsertHandler] 🔍 Found existing document in DB: [${dbDocId}] for bak_id: [${mapped.id_outgoing_bak}]`);
      
      await this._updateRecord(mapped, transaction);
      return {
        action: 'updated',
        affected: 1,
        documentId: dbDocId,
        drafter: mapped.drafter ?? null
      };
    }

    mapped.document_id = String(mapped.document_id).toUpperCase();
    await this._insertRecord(mapped, transaction);
    return {
      action: 'inserted',
      affected: 1,
      documentId: mapped.document_id,
      drafter: mapped.drafter ?? null
    };
  }

  /**
   * Insert new document record
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
        document_date
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
        @document_date
      )
    `;

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
      report_document_symbol: null,
      to_book_text_symbols: null,
      viewers: null,
      deadline_reply: null,
      abstract_note: record.abstract_note,
      recipient_ids: null,
      internal_receiving_unit: record.internal_receiving_unit,
      reply_incoming_doc: record.reply_incoming_doc,
      created_at: record.created_at,
      updated_at: record.updated_at,
      draft_signer: null,
      book_document_id: record.book_document_id,
      status: 1,
      code_commanders: null,
      commanders: null,
      current_note: null,
      to_book: record.to_book,
      release_no: record.release_no,
      release_date: record.release_date,
      text_symbols: record.text_symbols,
      doc_work_files: null,
      doc_proposal: null,
      doc_draft: null,
      doc_attachments: null,
      doc_recall: null,
      doc_replacement: null,
      doc_answer: null,
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
      processor: record.processor ?? null,
      files: record.files ?? null,
      stage_status: record.stage_status,
      document_date: record.document_date
    };

    await this.queryNewDbTx(query, params, transaction);
    logger.info(`[UpsertHandler] ✅ Inserted parent document ${record.document_id}`);

    // Safety check: ensure record is visible in this transaction before proceeding to dependents
    const check = await this.queryNewDbTx(
      `SELECT document_id FROM dbo.outgoing_documents WHERE document_id = @id`,
      { id: record.document_id },
      transaction
    );
    
    if (!check || check.length === 0) {
      throw new Error(`CRITICAL: Parent record ${record.document_id} disappeared immediately after INSERT! Check Triggers or Constraints.`);
    } else {
      const foundId = String(check[0].document_id);
      logger.info(`[UpsertHandler] 🔍 Safety check passed for [${foundId}] (Length: ${foundId.length})`);
    }
    
    return record.document_id;
  }

  async _updateRecord(record, transaction) {
    const query = `
      UPDATE ${this.newDbName}.dbo.outgoing_documents WITH (ROWLOCK, UPDLOCK) SET
        status_code = @status_code,
        sender_unit = @sender_unit,
        drafter = @drafter,
        document_type = @document_type,
        urgency_level = @urgency_level,
        private_level = @private_level,
        document_field = @document_field,
        report_signer = @report_signer,
        book_document_id = @book_document_id,
        to_book = @to_book,
        release_no = @release_no,
        release_date = @release_date,
        text_symbols = @text_symbols,
        abstract_note = @abstract_note,
        reply_incoming_doc = @reply_incoming_doc,
        internal_receiving_unit = @internal_receiving_unit,
        internal_receiving_dept = @internal_receiving_dept,
        external_receiving_unit = @external_receiving_unit,
        updated_at = @updated_at,
        status = 1,
        bpmn_version = @bpmn_version,
        type_of_process = @type_of_process,
        stage_status = @stage_status,
        know_receivers = @know_receivers,
        vieweds = @vieweds,
        id_outgoing_bak = @id_outgoing_bak,
        document_date = @document_date
      WHERE id_outgoing_bak = @id_outgoing_bak
    `;

    await this.queryNewDbTx(query, {
      status_code: record.status_code,
      sender_unit: record.sender_unit,
      drafter: record.drafter,
      document_type: record.document_type,
      urgency_level: record.urgency_level,
      private_level: record.private_level,
      document_field: record.document_field,
      report_signer: record.report_signer,
      book_document_id: record.book_document_id,
      to_book: record.to_book,
      release_no: record.release_no,
      release_date: record.release_date,
      text_symbols: record.text_symbols,
      abstract_note: record.abstract_note,
      reply_incoming_doc: record.reply_incoming_doc,
      internal_receiving_unit: record.internal_receiving_unit,
      internal_receiving_dept: record.internal_receiving_dept,
      external_receiving_unit: record.external_receiving_unit,
      updated_at: record.updated_at,
      bpmn_version: record.bpmn_version,
      type_of_process: record.type_of_process,
      stage_status: record.stage_status,
      know_receivers: record.know_receivers,
      vieweds: record.vieweds,
      id_outgoing_bak: record.id_outgoing_bak,
      document_date: record.document_date
    }, transaction);
  }

  /**
   * Prepare files from SharePoint (Files column)
   * Handles the structured format: urlFile|nameFile|typeFile blocks separated by ;#
   */
  async _prepareFilesFromSharePoint(oldRecord) {
    const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
    if (!baseUrl) return [];

    const filesItems = this._parseFilesField(oldRecord?.Files);
    if (filesItems.length === 0) return [];

    const preparedResults = [];
    for (const item of filesItems) {
      const { urlFile, nameFile, typeFile } = item;
      try {
        if (!urlFile.includes('/')) continue;
        const fullUrl = urlFile.startsWith('http') ? urlFile : `${baseUrl}${urlFile}`;
        
        // Extract display name
        const urlFileName = urlFile.substring(urlFile.lastIndexOf('/') + 1);
        let finalFileName = nameFile ? nameFile : urlFileName;

        // Apply ensureFileExtension to guarantee filename has correct extension
        const pathExt = urlFileName.split('.').pop();
        finalFileName = ensureFileExtension(finalFileName, pathExt, urlFileName);

        const fileIdBak = this._buildDeterministicFileIdBak(oldRecord?.ID, urlFile);

        logger.info(`[UpsertHandler][prepareFiles] Downloading: ${finalFileName} | Path: ${urlFile}`);
        const buffer = await spDownload(fullUrl, this.newPool);

        if (buffer && buffer.length > 0) {
          preparedResults.push({
            buffer,
            fileName: finalFileName,
            relativePath: urlFile,
            fileIdBak,
            typeFile
          });
        }
      } catch (err) {
        logger.error(`[UpsertHandler][prepareFiles] Error downloading file ${urlFile}: ${err.message}`);
      }
    }
    return preparedResults;
  }

  /**
   * Apply prepared files to database with duplicate checking
   */
  async _applyPreparedFiles(preparedFiles, oldRecord, newDocumentRecord, transaction) {
    if (!Array.isArray(preparedFiles) || preparedFiles.length === 0) return true;

    const objectIdBak = String(oldRecord?.ID || '').trim();
    const fileIdBaks = preparedFiles.map((fileItem) => String(fileItem?.fileIdBak || this._buildDeterministicFileIdBak(objectIdBak, fileItem?.relativePath || fileItem?.fileName || '')));
    const existingRelationKeys = await this._getExistingFileRelationKeys(objectIdBak, 'VanBanBanHanh', fileIdBaks, transaction);
    const existingFileIds = await this._getExistingFileIds(fileIdBaks, transaction);

    for (const fileItem of preparedFiles) {
      const { buffer, fileName, relativePath, typeFile } = fileItem;
      const fileIdBak = String(fileItem?.fileIdBak || this._buildDeterministicFileIdBak(objectIdBak, relativePath || fileName || ''));
      if (existingRelationKeys.has(fileIdBak) || existingFileIds.has(fileIdBak)) {
        logger.info(`[UpsertHandler] Skip duplicate file attachment fileName=${fileName}, fileIdBak=${fileIdBak}`);
        continue;
      }

      const fileType = detectFileType(buffer);
      const mimeType = fileType.mime;

      // Determine type_doc and object_type based on typeFile category
      let typeDocVal = 'docAttachments';
      let objectTypeVal = 'docAttachments';

      if (typeFile) {
        const typeLower = String(typeFile).toLowerCase();
        if (typeLower.includes('dự thảo') || typeLower.includes('phê duyệt') || typeLower.includes('draft')) {
          typeDocVal = 'docDraft';
          objectTypeVal = 'docDraft';
        } else if (typeLower.includes('trình') || typeLower.includes('proposal')) {
          typeDocVal = 'docProposal';
          objectTypeVal = 'docProposal';
        } else if (typeLower.includes('ban hành') || typeLower.includes('final')) {
          typeDocVal = 'finaldocuments';
          objectTypeVal = 'finaldocuments';
        }
      }

      const fileRecord = {
        file_name: fileName,
        file_path: relativePath,
        mime_type: mimeType,
        created_by: newDocumentRecord?.drafter || null,
        version: 1,
        id_bak: fileIdBak,
        table_bak: 'VanBanBanHanh',
        type_doc: newDocumentRecord?.type_doc || null,
        isBak: 1
      };

      const relationRecord = {
        object_type: 'docDraft',
        object_id: String(newDocumentRecord?.id),
        object_id_bak: oldRecord?.ID,
        file_id_bak: fileIdBak,
        table_bak: 'VanBanBanHanh',
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
   * Step 3: Parse HTML comments
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
            'VanBanBanHanh',
            field,
            transaction
          );
        } catch (err) {
          logger.warn(`[UpsertHandler] Error parsing HTML ${field}: ${err.message}`);
        }
      }
    }
  }

  /**
   * Step 4: Process audits + outgoing_assignment in the same transaction.
   * current_state is intentionally deferred to a separate post-batch phase.
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

        logger.info(`[UpsertHandler][AutoCreateAudit] Created initial CREATE audit for documentId=${documentId} creator=${displayName}`);
      }
    } catch (autoAuditErr) {
      logger.warn(`[UpsertHandler][AutoCreateAudit] Failed for documentId=${documentId}: ${autoAuditErr.message}`);
      if (transaction) {
        throw autoAuditErr;
      }
    }

    if (this._syncAuditModel.length === 0) return;

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
              // Thu thập status_code từ record vừa xử lý (nếu có)
              if (result.results && Array.isArray(result.results)) {
                for (const r of result.results) {
                  if (r.audit && r.audit.status_code) {
                     const sc = parseInt(r.audit.status_code, 10);
                     if (!maxStatusCode || sc > maxStatusCode) maxStatusCode = sc;
                  }
                }
              }
              logger.info(`[UpsertHandler][Audit] table=${tableName} documentId=${documentId} inserted=${result?.inserted || 0}`);
            }
          } catch (auditErr) {
            logger.error(`[UpsertHandler][Audit] Error table=${tableName}: ${auditErr.message}`);
            if (transaction) {
              throw auditErr;
            }
          }
        }

        // Cập nhật trạng thái cuối cùng (Duy nhất 1 lần cho cả văn bản)
        if (maxStatusCode !== null) {
          await firstModel._updateDocumentStatusCode(documentId, 1, String(maxStatusCode), transaction);
          logger.info(`[UpsertHandler][Audit] ✅ Final status updated to ${maxStatusCode} for document ${documentId}`);
        }
      }

    } catch (error) {
      logger.warn(`[UpsertHandler][Audit] Aggregate fetch failed: ${error.message}`);
      if (transaction) {
        throw error;
      }
    }
  }

  /**
   * Refresh outgoing_current_state after all audit/comment/file work is committed.
   */
  async _refreshCurrentStates(documentIds) {
    if (!Array.isArray(documentIds) || documentIds.length === 0) return [];
    if (this._syncAuditModel.length === 0) return [];

    const failures = [];
    const auditModel = this._syncAuditModel.find((model) => typeof model?.updateCurrentState === 'function') || null;

    for (const documentId of documentIds) {
      try {
        if (auditModel) {
          await dbUtils.withTransactionRetry(this.newPool, async (transaction) => {
            await auditModel.updateCurrentState(documentId, transaction);
          });
        } else {
          await dbUtils.withTransactionRetry(this.newPool, async (transaction) => {
            await this._refreshCurrentStateDirect(documentId, transaction);
          });
        }
      } catch (err) {
        logger.warn(`[UpsertHandler][Audit] updateCurrentState failed for documentId=${documentId}: ${err.message}`);
        failures.push({ documentId, error: err.message });
      }
    }

    return failures;
  }

  /**
   * Fallback updater for outgoing_current_state when the audit model instance
   * is unavailable or does not expose updateCurrentState().
   */
  async _refreshCurrentStateDirect(documentId, transaction = null) {
    if (!documentId) return;

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
  }
}

module.exports = UpsertHandler;
