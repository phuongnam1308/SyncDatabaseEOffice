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
    // Incoming uses SyncIncomingAuditModel (not Outgoing variant)
    const SyncIncomingAuditModel = require('../../sync-audit/SyncIncomingAuditModel');

    for (const tableName of AUDIT_TABLES) {
      const model = new SyncIncomingAuditModel(tableName);
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
    const request = transaction ? transaction.request() : this.newPool.request();
    for (const [key, value] of Object.entries(params || {})) {
      request.input(key, value);
    }
    const result = await request.query(query);
    return result.recordset;
  }

  async queryOldDb(query, params) {
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
    logger.info(`[UpsertHandler:Incoming] Processing ID: ${id}`);

    try {
      // Download files BEFORE transaction (avoid long lock on network I/O)
      const preparedFiles = await this._prepareFilesFromSharePoint(oldRecord);

      const result = await dbUtils.withTransactionRetry(this.newPool, async (transaction) => {
        // Step 1: Upsert main document
        const docResult = await this._processDocument(oldRecord, transaction);
        if (!docResult || docResult.affected === 0) {
          return { action: 'none', affected: 0, documentId: null };
        }

        const documentId = docResult.documentId;
        const drafter = docResult.drafter;

        // Step 2: Apply files (inside transaction)
        await this._applyPreparedFiles(preparedFiles, oldRecord, {
          documentId,
          drafter
        }, transaction);

        // Step 3: Parse HTML comments (Incoming fields only)
        await this._processHtmlComments(oldRecord, documentId, id, transaction);

        // Step 4: Sync audits
        await this._processAudits(oldRecord, documentId, id, drafter, transaction);

        return {
          action: docResult.action,
          affected: docResult.affected,
          documentId
        };
      }, { maxRetries: 5 });

      logger.info(`[UpsertHandler:Incoming] Completed ID: ${id}, action: ${result.action}`);
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
      logger.info(`[UpsertHandler:Incoming] Found existing document [${dbDocId}] for bak_id: [${mapped.id_incoming_bak}]`);
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
    logger.info(`[UpsertHandler:Incoming] ✅ Inserted document ${record.document_id}`);

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

    const results = [];
    for (const relativePath of filesToPath) {
      try {
        if (!relativePath.includes('/')) continue;
        const fullUrl = `${baseUrl}${relativePath}`;
        const fileName = relativePath.substring(relativePath.lastIndexOf('/') + 1);

        logger.info(`[UpsertHandler:Incoming][prepareFiles] Downloading: ${fileName}`);
        const buffer = await spDownload(fullUrl, this.newPool);

        if (buffer && buffer.length > 0) {
          results.push({ buffer, fileName, relativePath });
        }
      } catch (err) {
        logger.error(`[UpsertHandler:Incoming][prepareFiles] Error downloading ${relativePath}: ${err.message}`);
      }
    }

    return results;
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

  async _processAudits(oldRecord, documentId, recordId, drafter, transaction) {
    if (this._syncAuditModel.length === 0) return;

    try {
      const firstModel = this._syncAuditModel[0];
      const auditTableNames = this._syncAuditModel.map(m => m.oldDbTable);

      const allRawAudits = await firstModel.fetchAllAuditsAcrossTables(
        recordId,
        auditTableNames,
        // Incoming uses different audit categories vs Outgoing
        [CATEGORY_INCOMING_TCT, CATEGORY_INCOMING, CATEGORY_INCOMING_INTERNAL, CATEGORY_INCOMING_SUBMIT]
      );

      if (allRawAudits.length > 0) {
        for (const rawAudit of allRawAudits) {
          const tableName = rawAudit.__source_table;
          const model = this._syncAuditModelMap.get(tableName) || firstModel;

          try {
            const result = await model.processSingleRecord(rawAudit, documentId, transaction, drafter);
            // if (result) {
            //   logger.info(
            //     `[UpsertHandler:Incoming][Audit] table=${tableName} documentId=${documentId} ` +
            //     `inserted=${result?.inserted || 0} updated=${result?.updated || 0}`
            //   );
            // }
          } catch (auditErr) {
            if (dbUtils.isRetryableSqlError(auditErr)) throw auditErr;
            logger.warn(`[UpsertHandler:Incoming][Audit] Error table=${tableName}: ${auditErr.message}`);
          }
        }
      }

      // Auto-create audit if no history found
      await this._autoCreateAuditIfNeeded(oldRecord, documentId, drafter, transaction);

    } catch (error) {
      if (dbUtils.isRetryableSqlError(error)) throw error;
      logger.warn(`[UpsertHandler:Incoming][Audit] Aggregate fetch failed: ${error.message}`);
    }
  }

  async _autoCreateAuditIfNeeded(oldRecord, documentId, drafter, transaction) {
    try {
      const existing = await this.queryNewDbTx(
        `SELECT TOP 1 id FROM ${this.newDbName}.dbo.audit WHERE document_id = @docId`,
        { docId: documentId },
        transaction
      );

      if (existing && existing.length > 0) return;

      const creatorName = oldRecord.CreatedBy || oldRecord.NguoiSoanThaoText || '';
      const createdDate = this.mapper.helper.parseDate(oldRecord.Created) || new Date();

      let creatorId = drafter || process.env.VANTHU_USER_ID || null;
      let displayName = creatorName;

      // Try resolve creator by name if no id yet
      if (!creatorId && creatorName && this.mapper.helper.mapUserName) {
        try {
          const resolved = await this.mapper.helper.mapUserName(creatorName, transaction);
          if (resolved) creatorId = resolved;
        } catch (_) { }
      }

      await this.queryNewDbTx(`
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
          @action, @stage_status, @created_at, GETDATE(),
          @type_document, @table_backups
        )
      `, {
        document_id:   documentId,
        time:          createdDate,
        user_id:       creatorId,
        display_name:  displayName || null,
        action_code:   'CREATE',
        details:       JSON.stringify({ note: 'Tạo văn bản đến (tự động tạo từ migration)', isTransferOption: false }),
        origin_id:     `auto_create_${String(oldRecord.ID || '').substring(0, 80)}`,
        created_by:    creatorId,
        receiver:      creatorId,
        receiver_unit: null,
        group_:        null,
        roleProcess:   'VANTHU',
        action:        'Tạo văn bản',
        stage_status:  'DA_XU_LY',
        created_at:    createdDate,
        type_document: 'IncomingDocument',  // Incoming-specific
        table_backups: 'auto_create'
      }, transaction);

      // logger.info(`[UpsertHandler:Incoming][AutoAudit] Created initial CREATE audit for documentId=${documentId}`);
    } catch (autoAuditErr) {
      if (dbUtils.isRetryableSqlError(autoAuditErr)) throw autoAuditErr;
      logger.warn(`[UpsertHandler:Incoming][AutoAudit] Failed for documentId=${documentId}: ${autoAuditErr.message}`);
    }
  }
}

module.exports = UpsertHandler;
