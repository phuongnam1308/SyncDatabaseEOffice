const logger = require('../../../utils/logger');
const dbUtils = require('../../../utils/dbUtils');
const { v4: uuidv4 } = require('uuid');
const IncomingMapper = require('../mappers/IncomingMapper');
const FileService = require('../../sync-file-copy/Fileuploadservice');
const { downloadFile: spDownload } = require('../../sync-file-copy/SharePointAuthService');
const {
  CATEGORY_INCOMING_SUBMIT,
  CATEGORY_INCOMING_TCT,
  CATEGORY_INCOMING,
  CATEGORY_INCOMING_INTERNAL
} = require('../../sync-audit/SyncAuditModel');

/**
 * Detects MIME type from magic bytes (same helper used in Outgoing)
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

// Same 46 audit tables as outgoing (shared cross-module audit history)
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
 * Handler for upserting incoming documents.
 *
 * KEY DIFFERENCES vs Outgoing UpsertHandler:
 * - Uses SyncIncomingAuditModel (not SyncOutgoingAuditModel)
 * - Audit categories: INCOMING_TCT, INCOMING, INCOMING_INTERNAL, INCOMING_SUBMIT
 * - File object_type: 'incommingdocument' (not 'docDraft')
 * - File table_bak: 'VanBanDen' (not 'VanBanBanHanh')
 * - HTML comment fields: YKienLanhDao/TCT/VPDN/CuaLDVPChoVanThu only
 * - upsert key: id_incoming_bak (not id_outgoing_bak)
 * - Main table: incomming_documents (not outgoing_documents)
 * - No auto maxStatusCode update (incoming audit doesn't drive doc status the same way)
 */
class UpsertHandler {
  constructor(newPool, oldPool) {
    this.newPool = newPool;
    this.oldPool = oldPool;
    this.newDbName = process.env.NEW_DB_NAME;

    this.mapper = new IncomingMapper(
      this.queryNewDbTx.bind(this),
      this.queryOldDb.bind(this)
    );

    this._fileService = null;
    this._syncAuditModel = [];
    this._syncAuditModelMap = new Map();
  }

  // ──────────────────────────────────────────────
  // INITIALIZE
  // ──────────────────────────────────────────────

  async initialize() {
    // Incoming uses SyncAuditModel for the 46 tables
    const SyncAuditModel = require('../../sync-audit/SyncAuditModel');

    for (const tableName of AUDIT_TABLES) {
      const model = new SyncAuditModel(tableName);
      model.oldPool = this.oldPool;
      model.newPool = this.newPool;
      await model.initialize();
      this._syncAuditModel.push(model);
      this._syncAuditModelMap.set(tableName, model);
    }

    this._fileService = new FileService();
    logger.info(`[UpsertHandler:Incoming] Initialized with ${this._syncAuditModel.length} audit models`);
  }

  // ──────────────────────────────────────────────
  // QUERY HELPERS
  // ──────────────────────────────────────────────

  async queryNewDbTx(query, params, transaction) {
    if (!transaction && !this.newPool) {
      throw new Error('Lỗi: Chưa kết nối được Database MỚI (Đích). Không thể ghi dữ liệu.');
    }
    const request = transaction ? transaction.request() : this.newPool.request();
    for (const [key, value] of Object.entries(params || {})) {
      request.input(key, value);
    }
    const result = await request.query(query);
    return result.recordset;
  }

  async queryOldDb(query, params) {
    if (!this.oldPool) {
      throw new Error('Chưa kết nối được Database CŨ (Nguồn). Vui lòng kiểm tra lại cấu hình OLD_DB_* trong file .env.');
    }
    const request = this.oldPool.request();
    for (const [key, value] of Object.entries(params || {})) {
      request.input(key, value);
    }
    const result = await request.query(query);
    return result.recordset;
  }

  // ──────────────────────────────────────────────
  // MAIN PROCESS
  // ──────────────────────────────────────────────

  /**
   * Process one incoming document record from staging.
   * Pattern: download files outside TX → open TX → upsert doc + files + comments + audits.
   */
  async processRecord(oldRecord) {
    if (!oldRecord) {
      return { success: false, documentId: null, error: 'No record provided' };
    }

    const id = String(oldRecord?.ID || '').trim();
    // logger.info(`[UpsertHandler:Incoming] Processing ID: ${id}`);

    let preparedFiles = [];
    let prepareFilesTime = 0;
    let processDocumentTime = 0;
    let applyFilesTime = 0;
    let processHtmlCommentsTime = 0;
    let processAuditsTime = 0;
    let syncAssignmentTime = 0;
    let syncCurrentStateTime = 0;
    let transactionTime = 0;

    const logIfSlow = (label, elapsed, extra = '') => {
      if (elapsed > 1000) {
        logger.info(`[UpsertHandler:Incoming][timing] ID=${id} ${label}=${elapsed}ms${extra ? ' ' + extra : ''}`);
      }
    };

    try {
      // Download files BEFORE transaction (avoid long lock on network I/O)
      try {
        const start = Date.now();
        preparedFiles = await this._prepareFilesFromSharePoint(oldRecord);
        prepareFilesTime = Date.now() - start;
        logIfSlow('_prepareFilesFromSharePoint', prepareFilesTime, `files=${preparedFiles.length}`);
      } catch (error) {
        logger.error(`[UpsertHandler:Incoming] DEADLOCK in _prepareFilesFromSharePoint ID=${id}: ${error.message}`);
        throw error;
      }

      const result = await dbUtils.withTransactionRetry(this.newPool, async (transaction) => {
        const txStart = Date.now();

        // Step 1: Upsert main document
        let docResult;
        try {
          const start = Date.now();
          docResult = await this._processDocument(oldRecord, transaction);
          processDocumentTime = Date.now() - start;
          logIfSlow('_processDocument', processDocumentTime);
        } catch (error) {
          logger.error(`[UpsertHandler:Incoming] DEADLOCK in _processDocument ID=${id}: ${error.message}`);
          throw error;
        }

        if (!docResult || docResult.affected === 0) {
          transactionTime = Date.now() - txStart;
          logger.info(`[UpsertHandler:Incoming][timing] ID=${id} transaction_aborted txTotal=${transactionTime}ms`);
          return { action: 'none', affected: 0, documentId: null };
        }

        const documentId = docResult.documentId;
        const drafter = docResult.drafter;

        // Step 2: Apply prepared files
        try {
          const start = Date.now();
          await this._applyPreparedFiles(preparedFiles, oldRecord, { documentId, drafter }, transaction);
          applyFilesTime = Date.now() - start;
          logIfSlow('_applyPreparedFiles', applyFilesTime, `files=${preparedFiles.length}`);
        } catch (error) {
          logger.error(`[UpsertHandler:Incoming] DEADLOCK in _applyPreparedFiles ID=${id}, docId=${documentId}: ${error.message}`);
          throw error;
        }

        // Step 3: Process HTML comments
        try {
          const start = Date.now();
          await this._processHtmlComments(oldRecord, documentId, id, transaction);
          processHtmlCommentsTime = Date.now() - start;
          logIfSlow('_processHtmlComments', processHtmlCommentsTime);
        } catch (error) {
          logger.error(`[UpsertHandler:Incoming] DEADLOCK in _processHtmlComments ID=${id}, docId=${documentId}: ${error.message}`);
          throw error;
        }

        // Step 4: Process audits
        let auditResults;
        try {
          const start = Date.now();
          auditResults = await this._processAudits(oldRecord, documentId, id, drafter, transaction);
          processAuditsTime = Date.now() - start;
          logIfSlow('_processAudits', processAuditsTime, `audits=${auditResults?.length ?? 0}`);
        } catch (error) {
          logger.error(`[UpsertHandler:Incoming] DEADLOCK in _processAudits ID=${id}, docId=${documentId}: ${error.message}`);
          throw error;
        }

        // Step 5: Sync assignment
        let latestAuditEntry;
        try {
          const start = Date.now();
          latestAuditEntry = await this._syncAssignment(documentId, transaction, auditResults);
          syncAssignmentTime = Date.now() - start;
          logIfSlow('_syncAssignment', syncAssignmentTime);
        } catch (error) {
          logger.error(`[UpsertHandler:Incoming] DEADLOCK in _syncAssignment ID=${id}, docId=${documentId}: ${error.message}`);
          throw error;
        }

        // Step 6: Sync current state
        if (latestAuditEntry) {
          try {
            const start = Date.now();
            await this._syncCurrentState(documentId, transaction, latestAuditEntry);
            syncCurrentStateTime = Date.now() - start;
            logIfSlow('_syncCurrentState', syncCurrentStateTime);
          } catch (error) {
            logger.error(`[UpsertHandler:Incoming] DEADLOCK in _syncCurrentState ID=${id}, docId=${documentId}: ${error.message}`);
            throw error;
          }
        }

        transactionTime = Date.now() - txStart;
        logIfSlow('transactionTotal', transactionTime);

        return {
          action: docResult.action,
          affected: docResult.affected,
          documentId
        };
      }, { maxRetries: 5 });

      if ([prepareFilesTime, processDocumentTime, applyFilesTime, processHtmlCommentsTime, processAuditsTime, syncAssignmentTime, syncCurrentStateTime, transactionTime].some((time) => time > 1000)) {
        logger.info(`[UpsertHandler:Incoming][timing] ID=${id} summary prepareFiles=${prepareFilesTime}ms processDocument=${processDocumentTime}ms applyFiles=${applyFilesTime}ms htmlComments=${processHtmlCommentsTime}ms audits=${processAuditsTime}ms syncAssignment=${syncAssignmentTime}ms syncCurrentState=${syncCurrentStateTime}ms transaction=${transactionTime}ms`);
      }
      return { success: true, documentId: result.documentId, error: null };

    } catch (error) {
      logger.error(`[UpsertHandler:Incoming] Failed ID=${id}: ${error.message}`);
      return { success: false, documentId: null, error: error.message };
    }
  }

  // ──────────────────────────────────────────────
  // STEP 1: Document upsert
  // ──────────────────────────────────────────────

  async _processDocument(oldRecord, transaction) {
    const mapped = await this.mapper.mapRecord(oldRecord, transaction);
    if (!mapped?.document_id) {
      throw new Error('Mapped document_id is required');
    }

    // Check existence by incoming backup key
    const existing = await this.queryNewDbTx(
      `SELECT TOP 1 document_id
       FROM ${this.newDbName}.dbo.incomming_documents
       WHERE id_incoming_bak = @idIncomingBak`,
      { idIncomingBak: mapped.id_incoming_bak },
      transaction
    );

    if (existing && existing.length > 0) {
      const dbDocId = existing[0].document_id;
      // logger.info(`[UpsertHandler:Incoming] Found existing document [${dbDocId}] for bak_id: [${mapped.id_incoming_bak}]`);
      await this._updateRecord(mapped, transaction);
      return {
        action: 'updated',
        affected: 1,
        documentId: dbDocId,
        drafter: mapped.drafter ?? null
      };
    }

    await this._insertRecord(mapped, transaction);
    return {
      action: 'inserted',
      affected: 1,
      documentId: mapped.document_id,
      drafter: mapped.drafter ?? null
    };
  }

  async _insertRecord(record, transaction) {
    const query = `
      INSERT INTO ${this.newDbName}.dbo.incomming_documents (
        document_id, status_code, created_at, updated_at, book_document_id,
        abstract_note, to_book, sender_unit, receiver_unit,
        document_date, receive_date, to_book_date, deadline,
        second_book, receive_method, private_level, urgency_level,
        document_type, document_field, signer, to_book_code,
        to_book_text_symbols, fileids, status, isStar, parent_doc,
        type_process_doc, bpmn_version, copy_to_internal,
        resolution_deadline, copy_count, page_count, view_group,
        directive_comment, id_incoming_bak, tb_bak, tb_update,
        stage_status, table_backups
      ) VALUES (
        @document_id, @status_code, ISNULL(@created_at, GETDATE()), GETDATE(), @book_document_id,
        @abstract_note, @to_book, @sender_unit, @receiver_unit,
        @document_date, @receive_date, @to_book_date, @deadline,
        @second_book, @receive_method, @private_level, @urgency_level,
        @document_type, @document_field, @signer, @to_book_code,
        @to_book_text_symbols, @fileids, @status, @isStar, @parent_doc,
        @type_process_doc, @bpmn_version, @copy_to_internal,
        @resolution_deadline, @copy_count, @page_count, @view_group,
        @directive_comment, @id_incoming_bak, @tb_bak, @tb_update,
        @stage_status, @table_backups
      )
    `;

    await this.queryNewDbTx(query, this._buildParams(record), transaction);
    // logger.info(`[UpsertHandler:Incoming] ✅ Inserted document ${record.document_id}`);

    // Safety check
    const check = await this.queryNewDbTx(
      `SELECT document_id FROM ${this.newDbName}.dbo.incomming_documents WHERE document_id = @id`,
      { id: record.document_id },
      transaction
    );

    if (!check || check.length === 0) {
      throw new Error(
        `CRITICAL: Parent record ${record.document_id} disappeared after INSERT! Check Triggers/Constraints.`
      );
    }
  }

  async _updateRecord(record, transaction) {
    const query = `
      UPDATE ${this.newDbName}.dbo.incomming_documents WITH (ROWLOCK, UPDLOCK) SET
        status_code          = @status_code,
        updated_at           = GETDATE(),
        book_document_id     = @book_document_id,
        abstract_note        = @abstract_note,
        to_book              = @to_book,
        sender_unit          = @sender_unit,
        receiver_unit        = @receiver_unit,
        document_date        = @document_date,
        receive_date         = @receive_date,
        to_book_date         = @to_book_date,
        deadline             = @deadline,
        private_level        = @private_level,
        urgency_level        = @urgency_level,
        document_type        = @document_type,
        document_field       = @document_field,
        to_book_code         = @to_book_code,
        to_book_text_symbols = @to_book_text_symbols,
        fileids              = @fileids,
        status               = @status,
        bpmn_version         = @bpmn_version,
        stage_status         = @stage_status,
        copy_count           = @copy_count,
        page_count           = @page_count,
        table_backups        = @table_backups,
        tb_bak               = @tb_bak
      WHERE id_incoming_bak = @id_incoming_bak
    `;

    await this.queryNewDbTx(query, this._buildParams(record), transaction);
  }

  _buildParams(record) {
    return {
      document_id:          record.document_id ?? null,
      status_code:          record.status_code ?? null,
      created_at:           record.created_at ?? null,
      book_document_id:     record.book_document_id ?? null,
      abstract_note:        record.abstract_note ?? null,
      to_book:              record.to_book ?? null,
      sender_unit:          record.sender_unit ?? null,
      receiver_unit:        record.receiver_unit ?? null,
      document_date:        record.document_date ?? null,
      receive_date:         record.receive_date ?? null,
      to_book_date:         record.to_book_date ?? null,
      deadline:             record.deadline ?? null,
      second_book:          record.second_book ?? null,
      receive_method:       record.receive_method ?? null,
      private_level:        record.private_level ?? null,
      urgency_level:        record.urgency_level ?? null,
      document_type:        record.document_type ?? null,
      document_field:       record.document_field ?? null,
      signer:               record.signer ?? null,
      to_book_code:         record.to_book_code ?? null,
      to_book_text_symbols: record.to_book_text_symbols ?? null,
      fileids:              record.fileids ?? null,
      status:               record.status ?? 1,
      isStar:               record.isStar ?? 0,
      parent_doc:           record.parent_doc ?? null,
      type_process_doc:     record.type_process_doc ?? null,
      bpmn_version:         record.bpmn_version ?? null,
      copy_to_internal:     record.copy_to_internal ?? null,
      resolution_deadline:  record.resolution_deadline ?? null,
      copy_count:           record.copy_count ?? null,
      page_count:           record.page_count ?? null,
      view_group:           record.view_group ?? null,
      directive_comment:    record.directive_comment ?? null,
      id_incoming_bak:      record.id_incoming_bak ?? null,
      tb_bak:               record.tb_bak ?? 1,
      tb_update:            record.tb_update ?? 0,
      stage_status:         record.stage_status ?? null,
      table_backups:        record.table_backups ?? 'VanBanDen',
    };
  }

  // ──────────────────────────────────────────────
  // STEP 2: File handling
  // ──────────────────────────────────────────────

  async _prepareFilesFromSharePoint(oldRecord) {
    const files = oldRecord?.Files || '';
    if (!files) return [];

    const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
    if (!baseUrl) return [];

    const parts = files.split('|').filter(Boolean);
    if (!parts.length) return [];

    const filesToPath = [];
    const firstIsFile = /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|bmp|txt|zip|rar)$/i.test(parts[0]);

    if (firstIsFile) {
      filesToPath.push(parts[0]);
    } else {
      const directory = parts[0];
      for (const name of parts.slice(1)) {
        if (!name) continue;
        filesToPath.push(directory.endsWith('/') ? `${directory}${name}` : `${directory}/${name}`);
      }
    }

    const downloadPromises = filesToPath.map(async (relativePath) => {
      try {
        if (!relativePath.includes('/')) return null;
        const fullUrl = `${baseUrl}${relativePath}`;
        const fileName = relativePath.substring(relativePath.lastIndexOf('/') + 1);

        // logger.info(`[UpsertHandler:Incoming][prepareFiles] Downloading: ${fileName}`);
        const buffer = await spDownload(fullUrl, this.newPool);

        if (buffer && buffer.length > 0) {
          return { buffer, fileName, relativePath };
        }
      } catch (err) {
        logger.error(`[UpsertHandler:Incoming][prepareFiles] Error downloading ${relativePath}: ${err.message}`);
      }
      return null;
    });

    const results = await Promise.all(downloadPromises);
    return results.filter(Boolean);
  }

  async _applyPreparedFiles(preparedFiles, oldRecord, documentInfo, transaction) {
    if (!Array.isArray(preparedFiles) || preparedFiles.length === 0) return;

    for (const { buffer, fileName, relativePath } of preparedFiles) {
      const fileType = detectFileType(buffer);
      let mimeType = fileType.mime;

      // Fallback mime from extension if generic
      if (mimeType === 'application/octet-stream') {
        const ext = fileName.split('.').pop().toLowerCase();
        const mimeMap = {
          pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.word',
          xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.spreadsheet',
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg'
        };
        mimeType = mimeMap[ext] || mimeType;
      }

      const fileIdBak = uuidv4();
      const fileRecord = {
        file_name:  fileName,
        file_path:  relativePath,
        mime_type:  mimeType,
        created_by: documentInfo.drafter || null,
        version:    1,
        id_bak:     fileIdBak,
        table_bak:  'VanBanDen',          // Incoming-specific (not VanBanBanHanh)
        type_doc:   'incommingdocument',  // Incoming-specific (not docDraft)
        isBak:      1
      };

      const relationRecord = {
        object_type:  'incommingdocument',  // Incoming-specific
        object_id:    String(documentInfo.documentId),
        object_id_bak: oldRecord?.ID,
        file_id_bak:  fileIdBak,
        table_bak:    'VanBanDen',
        type_doc:     'incommingdocument',
      };

      await this._fileService.uploadAndInsert({
        fileBuffer:   buffer,
        originalName: fileName,
        mimeType,
        fileRecord,
        relationRecord,
        folder:       'incoming',
        localFolder:  'incoming',
        transaction
      });
    }
  }

  // ──────────────────────────────────────────────
  // STEP 3: HTML comments (Incoming fields only)
  // ──────────────────────────────────────────────

  /**
   * Incoming KHÔNG có YKien và YKienChiHuy (khác Outgoing).
   * Chỉ parse 4 trường lãnh đạo.
   */
  async _processHtmlComments(oldRecord, documentId, recordId, transaction) {
    const htmlFields = [
      'YKienLanhDao',
      'YKienLanhDaoTCT',
      'YKienLanhDaoVPDN',
      'YKienCuaLDVPChoVanThu'
    ];

    for (const field of htmlFields) {
      if (!oldRecord?.[field]) continue;
      try {
        await this.mapper.parseAndInsertHtmlComments(
          oldRecord[field],
          documentId,
          recordId,
          'VanBanDen',    // Incoming source table
          field,
          transaction
        );
      } catch (err) {
        if (dbUtils.isRetryableSqlError(err)) throw err;
        logger.warn(`[UpsertHandler:Incoming] Error parsing HTML ${field}: ${err.message}`);
      }
    }
  }

  // ──────────────────────────────────────────────
  // STEP 4: Audit sync (Incoming categories)
  // ──────────────────────────────────────────────

  /**
   * OPTIMIZED: Xử lý audit bằng cách:
   * 1. Fetch all raw audits từ 46 bảng
   * 2. Map tất cả raw audits → mapped objects
   * 3. Expand tất cả mapped → mảng audits
   * 4. Lấy tất cả existing audits (batch query)
   * 5. Separate toInsert vs toUpdate
   * 6. Bulk insert + update
   * Thay vì vòng lặp process từng cái riêng lẻ.
   */
  async _processAudits(oldRecord, documentId, recordId, drafter, transaction) {
    if (this._syncAuditModel.length === 0) return [];

    try {
      const firstModel = this._syncAuditModel[0];
      const auditTableNames = this._syncAuditModel.map(m => m.oldDbTable);

      // STEP 1: Fetch tất cả raw audits
      const allRawAudits = await firstModel.fetchAllAuditsAcrossTables(
        recordId,
        auditTableNames,
        [CATEGORY_INCOMING_TCT, CATEGORY_INCOMING, CATEGORY_INCOMING_INTERNAL, CATEGORY_INCOMING_SUBMIT]
      );

      let collectedAuditResults = [];

      if (allRawAudits.length > 0) {
        // STEP 2: Map tất cả raw audits thành mapped objects
        const allMappedAudits = await this._mapAllRawAudits(
          allRawAudits,
          documentId,
          drafter,
          transaction
        );

        // STEP 3: Expand tất cả mapped audits
        const allExpandedAudits = this._expandAllMappedAudits(allMappedAudits);

        // STEP 4: Lấy tất cả existing audits của document_id (batch)
        const existingAuditsRows = await this.queryNewDbTx(
          `SELECT id, [time], receiver, receiver_unit
           FROM ${this.newDbName}.dbo.audit WITH (NOLOCK)
           WHERE document_id = @document_id`,
          { document_id: documentId },
          transaction
        );
        const existingAuditsList = Array.isArray(existingAuditsRows) ? existingAuditsRows : [];

        // STEP 5: Separate toInsert vs toUpdate
        const { toInsert, toUpdate } = this._separateInsertUpdate(
          allExpandedAudits,
          existingAuditsList
        );

        // STEP 6: Bulk insert
        if (toInsert.length > 0) {
          try {
            const insertResults = await firstModel._insertMany(toInsert, transaction);
            collectedAuditResults.push(...insertResults);
          } catch (auditErr) {
            if (dbUtils.isRetryableSqlError(auditErr)) throw auditErr;
            logger.warn(`[UpsertHandler:Incoming][Audit] Bulk INSERT failed: ${auditErr.message}`);
          }
        }

        // STEP 7: Bulk update
        if (toUpdate.length > 0) {
          try {
            const updateResults = await firstModel._updateMany(toUpdate, transaction);
            collectedAuditResults.push(...updateResults);
          } catch (auditErr) {
            if (dbUtils.isRetryableSqlError(auditErr)) throw auditErr;
            logger.warn(`[UpsertHandler:Incoming][Audit] Bulk UPDATE failed: ${auditErr.message}`);
          }
        }
      }

      // Auto-create nếu chưa có audit nào
      const autoResult = await this._autoCreateAuditIfNeeded(oldRecord, documentId, drafter, transaction);
      if (autoResult) {
        collectedAuditResults.push(autoResult);
      }

      return collectedAuditResults;

    } catch (error) {
      if (dbUtils.isRetryableSqlError(error)) throw error;
      logger.warn(`[UpsertHandler:Incoming][Audit] Aggregate process failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Map tất cả raw audits thành mapped objects (parallel).
   * Trả về mảng các audit đã map (lọc bỏ null).
   * @private
   */
  async _mapAllRawAudits(allRawAudits, documentId, drafter, transaction) {
    const firstModel = this._syncAuditModel[0];
    const mappedResults = [];

    for (const rawAudit of allRawAudits) {
      try {
        const tableName = rawAudit.__source_table;
        const model = this._syncAuditModelMap.get(tableName) || firstModel;
        // Gọi _mapSingleRecord thay vì processSingleRecord để lấy mapped object
        const mapped = await model._mapSingleRecord(rawAudit, documentId, transaction, drafter);
        if (mapped) mappedResults.push(mapped);
      } catch (err) {
        logger.warn(`[UpsertHandler:Incoming][Audit:Map] Error mapping raw audit: ${err.message}`);
      }
    }

    return mappedResults;
  }

  /**
   * Expand tất cả mapped audits thành mảng audits (có thể 1 mapped → N audits).
   * @private
   */
  _expandAllMappedAudits(allMappedAudits) {
    const allAudits = [];
    for (const mapped of allMappedAudits) {
      if (!mapped) continue;
      // Mỗi mapped object có thể expand thành N audits (receiver variations)
      const expanded = this._syncAuditModel[0].helper._expandMappedRecords(mapped);
      if (Array.isArray(expanded)) {
        allAudits.push(...expanded);
      }
    }
    // Sort để deterministic
    allAudits.sort((a, b) => {
      const keyA = String(a.receiver || "") + String(a.receiver_unit || "");
      const keyB = String(b.receiver || "") + String(b.receiver_unit || "");
      return keyA.localeCompare(keyB);
    });
    return allAudits;
  }

  /**
   * Tách audits thành toInsert vs toUpdate dựa trên existing audits.
   * Sử dụng logika tương tự SyncAuditModel.processSingleRecord().
   * @private
   */
  _separateInsertUpdate(allAudits, existingAuditsList) {
    const toInsert = [];
    const toUpdate = [];

    for (const audit of allAudits) {
      if (!audit) continue;

      let matchedId = null;
      if (audit.document_id && audit.time) {
        const timeA = new Date(audit.time).getTime();

        // Priority 1: Tìm theo receiver
        if (audit.receiver !== undefined) {
          const match = existingAuditsList.find(r => {
            const rTime = new Date(r.time).getTime();
            return (
              rTime === timeA &&
              ((audit.receiver === null && r.receiver === null) || r.receiver === audit.receiver)
            );
          });
          if (match) matchedId = match.id;
        }

        // Priority 2: Tìm theo receiver_unit (fallback)
        if (!matchedId && audit.receiver_unit !== undefined) {
          const match = existingAuditsList.find(r => {
            const rTime = new Date(r.time).getTime();
            return (
              rTime === timeA &&
              ((audit.receiver_unit === null && r.receiver_unit === null) ||
                r.receiver_unit === audit.receiver_unit)
            );
          });
          if (match) matchedId = match.id;
        }
      }

      if (matchedId) {
        toUpdate.push({ audit, id: matchedId });
      } else {
        toInsert.push(audit);
      }
    }

    return { toInsert, toUpdate };
  }

  async _autoCreateAuditIfNeeded(oldRecord, documentId, drafter, transaction) {
    try {
      const existing = await this.queryNewDbTx(
        `SELECT TOP 1 id FROM ${this.newDbName}.dbo.audit WHERE document_id = @docId`,
        { docId: documentId },
        transaction
      );

      if (existing && existing.length > 0) return null;

      const creatorName = oldRecord.CreatedBy || oldRecord.NguoiSoanThaoText || '';
      const createdDate = this.mapper.helper.parseDate(oldRecord.Created) || new Date();

      let creatorId = drafter || process.env.VANTHU_USER_ID || null;
      let displayName = creatorName;

      if (!creatorId && creatorName && this.mapper.helper.mapUserName) {
        try {
          const resolved = await this.mapper.helper.mapUserName(creatorName, transaction);
          if (resolved) creatorId = resolved;
        } catch (_) { }
      }

      const autoAuditParams = {
        document_id:   documentId,
        time:          createdDate,
        user_id:       creatorId,
        display_name:  displayName || null,
        action_code:   'CREATE',
        details:       JSON.stringify({ note: 'Tạo văn bản đến (tự động tạo từ migration)', isTransferOption: false }),
        origin_id:     `auto_create_${String(oldRecord.ID || '').substring(0, 80)}`,
        created_by:    creatorId,
        receiver:      creatorId,      // single value, không phải array
        receiver_unit: null,
        group_:        null,
        roleProcess:   'VANTHU',
        action:        'Tạo văn bản',
        stage_status:  'DA_XU_LY',
        created_at:    createdDate,
        type_document: 'IncomingDocument',
        table_backups: 'auto_create',
      };

      // Thêm OUTPUT INSERTED.id để lấy id vừa insert
      const insertedRows = await this.queryNewDbTx(`
        INSERT INTO ${this.newDbName}.dbo.audit (
          document_id, [time], user_id, display_name,
          action_code, details, origin_id, created_by,
          receiver, receiver_unit, group_, roleProcess,
          [action], stage_status, created_at, updated_at,
          type_document, table_backups
        )
        OUTPUT INSERTED.id
        VALUES (
          @document_id, @time, @user_id, @display_name,
          @action_code, @details, @origin_id, @created_by,
          @receiver, @receiver_unit, @group_, @roleProcess,
          @action, @stage_status, @created_at, GETDATE(),
          @type_document, @table_backups
        )
      `, autoAuditParams, transaction);

      const newId = insertedRows?.[0]?.id ?? null;
      if (!newId) {
        logger.warn(`[UpsertHandler:Incoming][AutoAudit] INSERT succeeded but no id returned for documentId=${documentId}`);
        return null;
      }

      // Trả về đúng shape { audit, id } để caller push vào collectedAuditResults
      return {
        audit: autoAuditParams,
        id: newId,
      };

    } catch (autoAuditErr) {
      if (dbUtils.isRetryableSqlError(autoAuditErr)) throw autoAuditErr;
      logger.warn(`[UpsertHandler:Incoming][AutoAudit] Failed for documentId=${documentId}: ${autoAuditErr.message}`);
      return null;
    }
  }

  // ──────────────────────────────────────────────
  // STEP 5: Assignment & Current State sync
  // ──────────────────────────────────────────────
  async _syncAssignment(documentId, transaction, auditResults = []) {
    const assignmentMap = new Map();
    let latestAuditEntry = null;

    // ── PHASE 1: Build assignment map (giữ nguyên logic) ──
    for (const entry of auditResults) {
      if (!entry?.audit) continue;

      const { audit, id: auditId } = entry;
      const { roleProcess, stage_status } = audit;

      const receiver = audit.receiver || audit.receiver_unit || audit.created_by;
      if (!receiver || !roleProcess || !stage_status) continue;

      const receiverKey = Array.isArray(audit.receiver)
        ? (audit.receiver[0] || null)
        : (typeof audit.receiver === 'string' && audit.receiver.includes(','))
          ? audit.receiver.split(',')[0].trim()
          : receiver;

      if (!receiverKey) continue;

      const auditTime = audit.time instanceof Date ? audit.time : new Date(audit.time || 0);
      if (isNaN(auditTime.getTime())) continue;

      const mapKey = `${receiverKey}::${roleProcess}`;
      const existing = assignmentMap.get(mapKey);

      if (existing) {
        const existingTime = existing.auditTime instanceof Date
          ? existing.auditTime
          : new Date(existing.auditTime || 0);

        const isNewer = auditTime > existingTime
          || (auditTime.getTime() === existingTime.getTime() && auditId > existing.auditId);

        if (!isNewer) continue;
      }

      assignmentMap.set(mapKey, {
        document_id:   documentId,
        receiver:      receiverKey,
        role_process:  roleProcess,
        stage_status:  stage_status,
        created_at:    auditTime,
        last_audit_id: auditId,
        auditTime,
        auditId,
      });

      if (
        !latestAuditEntry
        || auditTime > latestAuditEntry.auditTime
        || (auditTime.getTime() === latestAuditEntry.auditTime.getTime() && auditId > latestAuditEntry.auditId)
      ) {
        latestAuditEntry = { audit, auditId, auditTime };
      }
    }

    // ── PHASE 2: Batch upsert (mirror pattern của _processAudits) ──
    const entries = Array.from(assignmentMap.values());
    if (entries.length === 0) return latestAuditEntry;

    // 1 query duy nhất lấy toàn bộ existing assignments của document
    const existingRows = await this.queryNewDbTx(
      `SELECT receiver, role_process
      FROM ${this.newDbName}.dbo.incomming_assignment WITH (NOLOCK)
      WHERE document_id = @document_id`,
      { document_id: documentId },
      transaction
    );

    // Index existing theo composite key để lookup O(1)
    const existingMap = new Set();
    for (const row of (existingRows || [])) {
      const key = `${row.receiver}::${row.role_process}`;
      existingMap.add(key);
    }

    const toInsert = [];
    const toUpdate = [];

    for (const entry of entries) {
      const key = `${entry.receiver}::${entry.role_process}`;
      if (existingMap.has(key)) {
        toUpdate.push(entry);
      } else {
        toInsert.push(entry);
      }
    }

    if (toInsert.length > 0) {
      try {
        await this._insertManyAssignments(toInsert, transaction);
      } catch (err) {
        const dbUtils = require('../../../utils/dbUtils');
        if (dbUtils.isRetryableSqlError(err)) throw err;
        logger.warn(`[UpsertHandler:Incoming][Assignment] Bulk INSERT failed: ${err.message}`);
      }
    }

    if (toUpdate.length > 0) {
      try {
        await this._updateManyAssignments(toUpdate, transaction);
      } catch (err) {
        const dbUtils = require('../../../utils/dbUtils');
        if (dbUtils.isRetryableSqlError(err)) throw err;
        logger.warn(`[UpsertHandler:Incoming][Assignment] Bulk UPDATE failed: ${err.message}`);
      }
    }

    return latestAuditEntry;
  }

  /**
   * Bulk insert incomming_assignment.
   * 6 params/row → chunkSize = 300 (1800 params, dưới giới hạn 2100 của SQL Server).
   * Deduplicate trong chunk theo (receiver, role_process) để tránh unique constraint violation
   * nếu auditResults có entries trùng sau khi map.
   * @private
   */
  async _insertManyAssignments(entries, transaction) {
    // Deduplicate: ưu tiên entry có last_audit_id lớn hơn (đã được xử lý ở map, nhưng safe guard)
    const deduped = new Map();
    for (const entry of entries) {
      const key = `${entry.receiver}::${entry.role_process}`;
      const existing = deduped.get(key);
      if (!existing || entry.last_audit_id > existing.last_audit_id) {
        deduped.set(key, entry);
      }
    }
    const dedupedEntries = Array.from(deduped.values());

    const PARAMS_PER_ROW = 6;
    const CHUNK_SIZE = Math.floor(2000 / PARAMS_PER_ROW); // 333, dùng an toàn

    for (let i = 0; i < dedupedEntries.length; i += CHUNK_SIZE) {
      const chunk = dedupedEntries.slice(i, i + CHUNK_SIZE);
      const params = {};
      const valuesClauses = [];

      chunk.forEach((entry, idx) => {
        params[`document_id_${idx}`]   = entry.document_id;
        params[`receiver_${idx}`]      = entry.receiver;
        params[`role_process_${idx}`]  = entry.role_process;
        params[`stage_status_${idx}`]  = entry.stage_status;
        params[`created_at_${idx}`]    = entry.created_at;
        params[`last_audit_id_${idx}`] = entry.last_audit_id ?? null;

        valuesClauses.push(
          `(@document_id_${idx}, @receiver_${idx}, @role_process_${idx}, @stage_status_${idx}, @created_at_${idx}, @last_audit_id_${idx}, SYSDATETIME())`
        );
      });

      const query = `
        INSERT INTO ${this.newDbName}.dbo.incomming_assignment
          (document_id, receiver, role_process, stage_status, created_at, last_audit_id, updated_at)
        VALUES
          ${valuesClauses.join(',\n        ')}
      `;

      await this.queryNewDbTx(query, params, transaction);
    }
  }

  /**
   * Bulk update incomming_assignment.
   * 4 params/row (SET fields) + 1 param WHERE id → 5 params/row.
   * chunkSize = 400 (2000 params, dưới giới hạn 2100).
   * Dùng batched UPDATE statements trong 1 query call (tương tự _updateMany của audit).
   * @private
   */
  async _updateManyAssignments(items, transaction) {
    const PARAMS_PER_ROW = 8;
    const CHUNK_SIZE = Math.floor(2000 / PARAMS_PER_ROW); // 250

    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);
      const params = {};
      let query = '';

      chunk.forEach((entry, idx) => {
        params[`document_id_${idx}`]   = entry.document_id;
        params[`receiver_${idx}`]      = entry.receiver;
        params[`role_process_${idx}`]  = entry.role_process;
        params[`stage_status_${idx}`]  = entry.stage_status;
        params[`created_at_${idx}`]    = entry.created_at;
        params[`last_audit_id_${idx}`] = entry.last_audit_id ?? null;

        query += `
          UPDATE ${this.newDbName}.dbo.incomming_assignment WITH (ROWLOCK, UPDLOCK)
          SET
            stage_status  = @stage_status_${idx},
            created_at    = @created_at_${idx},
            last_audit_id = @last_audit_id_${idx},
            updated_at    = SYSDATETIME()
          WHERE document_id = @document_id_${idx}
            AND receiver = @receiver_${idx}
            AND role_process = @role_process_${idx};
        `;
      });

      await this.queryNewDbTx(query, params, transaction);
    }
  }

  async _syncCurrentState(documentId, transaction, latestAuditEntry) {
    if (!latestAuditEntry || !latestAuditEntry.audit) return;

    const { audit, auditId, auditTime } = latestAuditEntry;
    const currentReceiver = audit.receiver || audit.receiver_unit || audit.created_by;

    await this.queryNewDbTx(
      `UPDATE ${this.newDbName}.dbo.incomming_current_state SET
          current_stage_status  = @current_stage_status,
          current_action_code   = @current_action_code,
          current_receiver      = @current_receiver,
          current_role_process  = @current_role_process,
          last_audit_id         = @last_audit_id,
          last_audit_time       = @last_audit_time,
          is_completed_doc      = @is_completed_doc,
          has_open_workitem     = 0,
          is_transfer_to_room   = 0,
          updated_at            = SYSDATETIME()
        WHERE document_id = @document_id;

        IF @@ROWCOUNT = 0
        BEGIN
          INSERT INTO ${this.newDbName}.dbo.incomming_current_state (
            document_id, current_stage_status, current_action_code, current_receiver,
            current_role_process, last_audit_id, last_audit_time,
            is_completed_doc, has_open_workitem, is_transfer_to_room, updated_at, table_backups
          ) VALUES (
            @document_id, @current_stage_status, @current_action_code, @current_receiver,
            @current_role_process, @last_audit_id, @last_audit_time,
            @is_completed_doc, 0, 0, SYSDATETIME(), 'incomming_current_state'
          );
        END`,
      {
        document_id:          documentId,
        current_stage_status: audit.stage_status,
        current_action_code:  audit.action_code ?? null,
        current_receiver:     currentReceiver ?? null,
        current_role_process: audit.roleProcess ?? null,
        last_audit_id:        auditId,
        last_audit_time:      auditTime,
        is_completed_doc:     (audit.stage_status || '').toUpperCase() === 'HOAN_THANH_VAN_BAN' ? 1 : 0,
      },
      transaction
    );
  }
}

module.exports = UpsertHandler;
