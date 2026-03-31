const logger = require('../../../utils/logger');
const sql = require('mssql');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const FileService = require('../../sync-file-copy/Fileuploadservice');
const { downloadFile: spDownload } = require('../../sync-file-copy/SharePointAuthService');
/**
 * Phát hiện MIME type từ magic bytes — thay thế package file-type (ESM-only)
 */
function detectFileType(buffer) {
  if (!buffer || buffer.length < 4) return { mime: 'application/octet-stream', ext: 'bin' };
  const b = buffer;
  if (b[0]===0x25&&b[1]===0x50&&b[2]===0x44&&b[3]===0x46) return { mime:'application/pdf', ext:'pdf' };
  if (b[0]===0x89&&b[1]===0x50&&b[2]===0x4E&&b[3]===0x47) return { mime:'image/png', ext:'png' };
  if (b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF)               return { mime:'image/jpeg', ext:'jpg' };
  if (b[0]===0x47&&b[1]===0x49&&b[2]===0x46)               return { mime:'image/gif', ext:'gif' };
  if (b[0]===0x42&&b[1]===0x4D)                             return { mime:'image/bmp', ext:'bmp' };
  if (b[0]===0x50&&b[1]===0x4B&&b[2]===0x03&&b[3]===0x04) {
    const s = buffer.slice(0,200).toString('latin1');
    if (s.includes('word/')) return { mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext:'docx' };
    if (s.includes('xl/'))   return { mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext:'xlsx' };
    if (s.includes('ppt/'))  return { mime:'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext:'pptx' };
    return { mime:'application/zip', ext:'zip' };
  }
  if (b[0]===0xD0&&b[1]===0xCF&&b[2]===0x11&&b[3]===0xE0) return { mime:'application/msword', ext:'doc' };
  if (b[0]===0x52&&b[1]===0x61&&b[2]===0x72&&b[3]===0x21) return { mime:'application/x-rar-compressed', ext:'rar' };
  return { mime:'application/octet-stream', ext:'bin' };
}

const SyncCommentModel = require('../../sync-document-comment/SyncCommentModel');
const SyncIncomingAuditModel = require('../../sync-audit/SyncIncomingAuditModel');
const StreamIncomingMigrationModel = require('./SyncIncomingDocumentModel');
const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

const AUDIT_TABLES = [
  'LuanChuyenVanBan',
  'LuanChuyenVanBan_ATPC',
  'LuanChuyenVanBan_CLL',
  'LuanChuyenVanBan_CNTT',
  'LuanChuyenVanBan_CT',
  'LuanChuyenVanBan_CVTC',
  'LuanChuyenVanBan_DonVi',
  'LuanChuyenVanBan_DVHH',
  'LuanChuyenVanBan_DVKT',
  'LuanChuyenVanBan_GNVT',
  'LuanChuyenVanBan_HC',
  'LuanChuyenVanBan_HT',
  'LuanChuyenVanBan_ICDLB',
  'LuanChuyenVanBan_ICDST',
  'LuanChuyenVanBan_KHDT',
  'LuanChuyenVanBan_KHKD',
  'LuanChuyenVanBan_KTVT',
  'LuanChuyenVanBan_KVTC',
  'LuanChuyenVanBan_MKT',
  'LuanChuyenVanBan_NPL',
  'LuanChuyenVanBan_QLCT',
  'LuanChuyenVanBan_QSBV',
  'LuanChuyenVanBan_SNPL',
  'LuanChuyenVanBan_TC',
  'LuanChuyenVanBan_TC189',
  'LuanChuyenVanBan_TCCT',
  'LuanChuyenVanBan_TCHP',
  'LuanChuyenVanBan_TCIDI',
  'LuanChuyenVanBan_TCLD',
  'LuanChuyenVanBan_TCMT',
  'LuanChuyenVanBan_TCO',
  'LuanChuyenVanBan_TCOT',
  'LuanChuyenVanBan_TCPC',
  'LuanChuyenVanBan_TCPH',
  'LuanChuyenVanBan_TCTT',
  'LuanChuyenVanBan_TTDDC',
  'LuanChuyenVanBan_TTDTC',
  'LuanChuyenVanBan_VP',
  'LuanChuyenVanBan_VPMB',
  'LuanChuyenVanBan_VPTNB',
  'LuanChuyenVanBan_VTB',
  'LuanChuyenVanBan_VTT',
  'LuanChuyenVanBan_XDCT',
  'LuanChuyenVanBan_xdsm',
  'LuanChuyenVanBan_XNCG',
  'LuanChuyenVanBan_YTE'
];

const COMMENT_TABLES = [
  'Comments',
  'Comments_ATPC',
  'Comments_CLL',
  'Comments_CNTT',
  'Comments_CT',
  'Comments_CVTC',
  'Comments_DonVi',
  'Comments_DVHH',
  'Comments_DVKT',
  'Comments_GNVT',
  'Comments_HC',
  'Comments_HT',
  'Comments_ICDLB',
  'Comments_ICDST',
  'Comments_KHDT',
  'Comments_KHKD',
  'Comments_KTVT',
  'Comments_KVTC',
  'Comments_MKT',
  'Comments_NPL',
  'Comments_QLCT',
  'Comments_QSBV',
  'Comments_SNPL',
  'Comments_TC',
  'Comments_TC189',
  'Comments_TCCT',
  'Comments_TCHP',
  'Comments_TCIDI',
  'Comments_TCLD',
  'Comments_TCMT',
  'Comments_TCO',
  'Comments_TCOT',
  'Comments_TCPC',
  'Comments_TCPH',
  'Comments_TCTT',
  'Comments_TTDDC',
  'Comments_TTDTC',
  'Comments_VP',
  'Comments_VPMB',
  'Comments_VPTNB',
  'Comments_VTB',
  'Comments_VTT',
  'Comments_XDCT',
  'Comments_xdsm',
  'Comments_XNCG',
  'Comments_YTE'
];

class IncomingDocumentModel extends BaseIncrementalSyncInterface {
  /**
   * Configures source/staging tables and nested migration models for Incoming incremental sync.
   */
  constructor() {
    super({ modelName: '3_incoming' });
    this.newDbName = process.env.NEW_DB_NAME;
    this.oldDbSchema = 'dbo';
    this.oldDbTable = 'VanBanDen';
    this.newDbSchema = 'dbo';
    this.newTableSync = 'incomming_documents_sync';

    this._syncAuditModel = [];
    this._syncCommentModel = [];
    this._IncomingMigrationModels = null;
    this._fileService = null;
  }

  /**
   * Initializes DB pools, creates staging table if needed,
   * and initializes dependent audit/comment/document models.
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      await super.initialize();
      await this.ensureStagingTableExists();

      try {
        await this.queryNewDb(`
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'incomming_documents' AND COLUMN_NAME = 'table_backups')
                ALTER TABLE dbo.incomming_documents ADD table_backups NVARCHAR(MAX) NULL;
        `);
      } catch(e) {
        logger.warn(`[IncomingDocumentModel] Failed to auto alter table incomming_documents: ${e.message}`);
      }

      this._syncAuditModel = [];
      this._syncCommentModel = [];

      this._IncomingMigrationModels = new StreamIncomingMigrationModel();
      await this._IncomingMigrationModels.initialize();

      this._fileService = new FileService(this.newPool);

      for (const table of AUDIT_TABLES) {
        const model = new SyncIncomingAuditModel(table);
        await model.initialize();
        this._syncAuditModel.push(model);
      }

      // for (const table of COMMENT_TABLES) {
      //   const model = new SyncCommentModel(table);
      //   await model.initialize();
      //   this._syncCommentModel.push(model);
      // }

      logger.info(
        `[IncomingDocumentModel] Initialized with auditTables=${this._syncAuditModel.length}, commentTables=${this._syncCommentModel.length}`
      );
    } catch (error) {
      logger.error(`[IncomingDocumentModel.initialize] Failed to initialize: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Tự động tạo bảng trung gian `incomming_documents_sync` trong DB mới nếu chưa tồn tại.
   * Cấu trúc bảng được clone từ `VanBanDen` (DB cũ) qua IF NOT EXISTS + SELECT TOP 0 * INTO.
   */
    async ensureStagingTableExists() {
      try {
        const stagingTableRef = this.getStagingTableRef();

        const createQuery = `
        IF OBJECT_ID('${stagingTableRef}', 'U') IS NULL
        BEGIN
            CREATE TABLE ${stagingTableRef} (

            ID NVARCHAR(MAX) NULL,
            Title NVARCHAR(MAX) NULL,
            SoDen NVARCHAR(MAX) NULL,
            CoQuanGui2 NVARCHAR(MAX) NULL,
            CoQuanGuiText NVARCHAR(MAX) NULL,
            DonVi NVARCHAR(MAX) NULL,
            IsLibrary NVARCHAR(MAX) NULL,
            DoKhan NVARCHAR(MAX) NULL,
            DoMat NVARCHAR(MAX) NULL,
            Files NVARCHAR(MAX) NULL,
            ThoiHanGQ NVARCHAR(MAX) NULL,
            ItemVBDTCT NVARCHAR(MAX) NULL,
            ItemVBPH NVARCHAR(MAX) NULL,
            BanLanhDao NVARCHAR(MAX) NULL,
            LanhDaoTCT NVARCHAR(MAX) NULL,
            LanhDaoTCTDaXuLy NVARCHAR(MAX) NULL,
            LanhDaoTCTDeBiet NVARCHAR(MAX) NULL,
            LanhDaoVPDN NVARCHAR(MAX) NULL,
            LinhVuc NVARCHAR(MAX) NULL,
            LoaiVanBan NVARCHAR(MAX) NULL,
            NgayDen NVARCHAR(MAX) NULL,
            NgayTrenVB NVARCHAR(MAX) NULL,
            SoBan NVARCHAR(MAX) NULL,
            SoTrang NVARCHAR(MAX) NULL,
            SoVanBan NVARCHAR(MAX) NULL,
            TrangThai NVARCHAR(MAX) NULL,
            TrichYeu NVARCHAR(MAX) NULL,
            VanBanTraLoi NVARCHAR(MAX) NULL,
            ChenSo NVARCHAR(MAX) NULL,
            YKienLanhDao NVARCHAR(MAX) NULL,
            YKienLanhDaoTCT NVARCHAR(MAX) NULL,
            YKienLanhDaoVPDN NVARCHAR(MAX) NULL,
            YKienCuaLDVPChoVanThu NVARCHAR(MAX) NULL,
            ForwardType NVARCHAR(MAX) NULL,
            Modified NVARCHAR(MAX) NULL,
            Created NVARCHAR(MAX) NULL,
            ModifiedBy NVARCHAR(MAX) NULL,
            CreatedBy NVARCHAR(MAX) NULL,
            ModuleId NVARCHAR(MAX) NULL,
            SiteName NVARCHAR(MAX) NULL,
            ListName NVARCHAR(MAX) NULL,
            ItemId NVARCHAR(MAX) NULL,
            MigrateFlg NVARCHAR(MAX) NULL,
            YearMonth NVARCHAR(MAX) NULL,
            MigrateErrFlg NVARCHAR(MAX) NULL,
            MigrateErrMess NVARCHAR(MAX) NULL,
            ItemVBPHOld NVARCHAR(MAX) NULL,
            DGPId NVARCHAR(MAX) NULL
            )
        END
        `;

        await this.queryNewDb(createQuery);

        logger.info(`[IncomingDocumentModel] Staging table ready`);
      } catch (err) {
        logger.error(`[IncomingDocumentModel.ensureStagingTableExists] Failed to create or verify staging table: ${err.message}`, { stack: err.stack });
        throw err;
      }
    }

  /**
   * Resolves fully-qualified staging table reference in NEW DB.
   * @returns {string}
   */
  getStagingTableRef() {
    if (this.newDbName) {
      return `${this.newDbName}.${this.newDbSchema}.${this.newTableSync}`;
    }
    return `${this.newDbSchema}.${this.newTableSync}`;
  }

  /**
   * Validates and escapes one dynamic source column name.
   * @param {string} column
   * @returns {string}
   */
  sanitizeColumnName(column) {
    if (!/^[A-Za-z0-9_]+$/.test(column)) {
      throw new Error(`Invalid column name from source: ${column}`);
    }
    return `[${column}]`;
  }

  /**
   * Converts arbitrary datetime input to stable ISO cursor format.
   * @param {string|Date|null|undefined} value
   * @returns {string}
   */
  normalizeSyncTime(value) {
    if (!value) return DEFAULT_SYNC_TIME;
    const dateValue = new Date(value);
    if (Number.isNaN(dateValue.getTime())) return DEFAULT_SYNC_TIME;
    return dateValue.toISOString();
  }

  /**
   * Extracts row-level sync timestamp used for cursor advancement.
   * @param {object} row
   * @returns {string|null}
   */
  extractRowSyncTime(row) {
    const raw = row?.__sync_time || row?.Modified || row?.Created || row?.NgayTao || row?.updated_at || null;
    if (!raw) return null;
    const dateValue = new Date(raw);
    if (Number.isNaN(dateValue.getTime())) return null;
    return dateValue.toISOString();
  }

  /**
   * Extracts row-level sync id used as tie-breaker for same timestamp.
   * @param {object} row
   * @returns {number}
   */
  extractRowSyncId(row) {
    return Number(row?.__sync_id || row?.ID || 0);
  }

  /**
   * Compares two cursors and returns true when (aTime,aId) is ahead of (bTime,bId).
   * @param {string} aTime
   * @param {number} aId
   * @param {string} bTime
   * @param {number} bId
   * @returns {boolean}
   */
  isCursorAhead(aTime, aId, bTime, bId) {
    const ta = new Date(aTime || DEFAULT_SYNC_TIME).getTime();
    const tb = new Date(bTime || DEFAULT_SYNC_TIME).getTime();
    if (ta > tb) return true;
    if (ta < tb) return false;
    return Number(aId || 0) > Number(bId || 0);
  }

  /**
   * Returns SQL expression that normalizes source sync time across supported columns.
   * @returns {string}
   */
  getSyncTimeExpression() {
    return `
      COALESCE(
        TRY_CONVERT(datetime2, Modified),
        TRY_CONVERT(datetime2, Created)
      )
    `;
  }

  /**
   * Loads incremental source records from OLD DB after current cursor.
   * @param {string} lastSyncTime
   * @param {number} [lastSyncId=0]
   * @returns {Promise<object[]>}
   */
  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0) {
    try {
      const syncTimeExpr = this.getSyncTimeExpression();
      const query = `
      ;WITH source_rows AS (
        SELECT
          *,
          ${syncTimeExpr} AS __sync_time,
          TRY_CONVERT(
            BIGINT,
            NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), '')
          ) AS __sync_id_num
        FROM ${this.oldDbSchema}.${this.oldDbTable}
      )
      SELECT
        *,
        ISNULL(__sync_id_num, 0) AS __sync_id
      FROM source_rows
      WHERE (
        __sync_time > @lastSyncTime
        OR (
          __sync_time = @lastSyncTime
          AND ISNULL(__sync_id_num, -9223372036854775808) > @lastSyncId
        )
      )
      ORDER BY
        __sync_time ASC,
        ISNULL(__sync_id_num, -9223372036854775808) ASC,
        ID ASC
      OFFSET ${Number(process.env.BEGIN_LIMIT || 0)} ROWS FETCH NEXT ${Number(process.env.COMPLETED_LIMIT || 100)} ROWS ONLY
    `;

      return await this.queryOldDb(query, {
        lastSyncTime,
        lastSyncId: Number(lastSyncId || 0)
      });
    } catch (error) {
      logger.error(`[IncomingDocumentModel.fetchListFromOldDb] Failed to fetch list from old DB with lastSyncTime=${lastSyncTime}, lastSyncId=${lastSyncId}: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Upserts source rows into staging table so process phase can read deterministic snapshots.
   * @param {object[]} rows
   * @param {{transaction?: object}} [context]
   * @returns {Promise<{stagedCount:number}>}
   */
  async syncOldToStaging(rows, { transaction } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { stagedCount: 0 };
    }

    const internalColumns = new Set(['__sync_time', '__sync_id', '__sync_id_num']);
    const columns = Object.keys(rows[0] || {}).filter((column) => !internalColumns.has(column));
    if (!columns.length) {
      return { stagedCount: 0 };
    }

    if (!columns.includes('ID')) {
      throw new Error('Staging sync requires source column "ID"');
    }

    const safeColumns = columns.map((column) => this.sanitizeColumnName(column));
    const nonIdColumns = columns.filter((column) => column !== 'ID');
    const safeNonIdColumns = nonIdColumns.map((column) => this.sanitizeColumnName(column));
    const stagingTableRef = this.getStagingTableRef();

    try {
      for (const row of rows) {
        const rawId = row?.ID;
        if (rawId == null || String(rawId).trim() === '') {
          throw new Error('Row ID is required for staging');
        }

        const params = {};
        for (const column of columns) {
          params[column] = row[column];
        }

        const updateClause = safeNonIdColumns
          .map((columnName, idx) => `${columnName} = @${nonIdColumns[idx]}`)
          .join(', ');

        const query = `
        IF EXISTS (SELECT 1 FROM ${stagingTableRef} WHERE ID = @ID)
        BEGIN
          ${nonIdColumns.length > 0 ? `
          UPDATE ${stagingTableRef}
          SET ${updateClause}
          WHERE ID = @ID;` : `
          SELECT 1 AS noop;`}
        END
        ELSE
        BEGIN
          INSERT INTO ${stagingTableRef} (${safeColumns.join(', ')})
          VALUES (${columns.map((column) => `@${column}`).join(', ')});
        END
      `;

        await this.queryNewDbTx(query, params, transaction);
      }
    } catch (error) {
      logger.error(`[IncomingDocumentModel.syncOldToStaging] Failed to sync to staging table: ${error.message}`, { stack: error.stack });
      throw error;
    }

    return { stagedCount: rows.length };
  }

  /**
   * Builds one staged incremental list for a sync job and returns cursor progression info.
   * @param {string} lastSyncTime
   * @param {string} syncJobId
   * @param {number} [lastSyncId=0]
   * @returns {Promise<object>}
   */
  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    try {
      if (!syncJobId) {
        throw new Error('syncJobId is required');
      }

      const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
      const normalizedLastSyncId = Number(lastSyncId || 0);
      const rows = await this.fetchListFromOldDb(normalizedLastSyncTime, normalizedLastSyncId);
      const stageResult = await this.syncOldToStaging(rows);

      let nextSyncTime = normalizedLastSyncTime;
      let nextSyncId = normalizedLastSyncId;

      for (const row of rows) {
        const rowTime = this.extractRowSyncTime(row);
        const rowId = this.extractRowSyncId(row);
        if (!rowTime) continue;
        if (this.isCursorAhead(rowTime, rowId, nextSyncTime, nextSyncId)) {
          nextSyncTime = rowTime;
          nextSyncId = rowId;
        }
      }

      return {
        syncJobId,
        rows,
        totalCount: rows.length,
        stagedCount: Number(stageResult?.stagedCount || 0),
        sourceLastSyncTime: normalizedLastSyncTime,
        sourceLastSyncId: normalizedLastSyncId,
        lastSyncTime: nextSyncTime,
        lastSyncId: nextSyncId
      };
    } catch (error) {
      logger.error(`[IncomingDocumentModel.getList] Failed to get list for syncJobId=${syncJobId}: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Reads persisted sync job state from sync_jobs table.
   * @param {string} syncJobId
   * @returns {Promise<object|null>}
   */
  async getSyncJobState(syncJobId) {
    try {
      if (!syncJobId) {
        throw new Error('syncJobId is required');
      }

      const rows = await this.queryNewDb(
        `
      SELECT TOP 1
        job_id,
        total_to_sync,
        total_processed,
        total_success,
        total_errors,
        last_sync_time,
        last_sync_id
      FROM sync_jobs
      WHERE job_id = @syncJobId
      `,
        { syncJobId }
      );

      return rows?.[0] || null;
    } catch (error) {
      logger.error(`[IncomingDocumentModel.getSyncJobState] Failed to get sync job state for syncJobId=${syncJobId}: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Processes one staged item for a sync job inside a DB transaction.
   * @param {string} syncJobId
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async processOne(syncJobId, options = {}) {
    if (!syncJobId) {
      throw new Error('syncJobId is required');
    }

    let jobState;
    let itemIndex;
    try {
      jobState = await this.getSyncJobState(syncJobId);
      itemIndex = Number(
        options.itemIndex != null
          ? options.itemIndex
          : (jobState?.total_processed || 0)
      );
    } catch (error) {
      logger.error(`[IncomingDocumentModel.processOne] Failed to get job state or determine item index for syncJobId=${syncJobId}: ${error.message}`, { stack: error.stack });
      throw error;
    }

    const sourceLastSyncTime = this.normalizeSyncTime(
      options.sourceLastSyncTime || options.lastSyncTime || jobState?.last_sync_time || DEFAULT_SYNC_TIME
    );
    const sourceLastSyncId = Number(
      options.sourceLastSyncId != null
        ? options.sourceLastSyncId
        : (jobState?.last_sync_id || 0)
    );

    const transaction = new sql.Transaction(this.newPool);

    try {
      await transaction.begin();
      const rowData = await this.fetchOneFromStaging({
        lastSyncTime: sourceLastSyncTime,
        lastSyncId: sourceLastSyncId,
        itemIndex,
        transaction
      });

      if (!rowData) {
        await transaction.commit();
        return {
          syncJobId,
          itemIndex,
          processed: false,
          done: true
        };
      }

      const result = await this.processRowData(rowData, { transaction });
      await transaction.commit();

      return {
        syncJobId,
        itemIndex,
        processed: true,
        done: false,
        rowId: rowData.ID || null,
        result
      };
    } catch (error) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        logger.error(`[IncomingDocumentModel.processOne] Rollback failed for syncJobId=${syncJobId}, itemIndex=${itemIndex}:`, rollbackError);
      }
      logger.error(`[IncomingDocumentModel.processOne] Failed to process item for syncJobId=${syncJobId}, itemIndex=${itemIndex}: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Reads one deterministic row from staging based on source cursor and item index.
   * @param {{lastSyncTime:string,lastSyncId?:number,itemIndex:number,transaction?:object}} context
   * @returns {Promise<object|null>}
   */
  async fetchOneFromStaging({ lastSyncTime, lastSyncId = 0, itemIndex, transaction } = {}) {
    try {
      const rowNumber = Number(itemIndex || 0) + 1;
      const stagingTableRef = this.getStagingTableRef();
      const syncTimeExpr = this.getSyncTimeExpression();
      const query = `
      ;WITH source_rows AS (
        SELECT
          *,
          ${syncTimeExpr} AS __sync_time,
          TRY_CONVERT(
            BIGINT,
            NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), '')
          ) AS __sync_id_num
        FROM ${stagingTableRef}
      ),
      staged AS (
        SELECT
          *,
          ROW_NUMBER() OVER (
            ORDER BY
              __sync_time ASC,
              ISNULL(__sync_id_num, -9223372036854775808) ASC,
              ID ASC
          ) AS rn
        FROM source_rows
        WHERE (
          __sync_time > @lastSyncTime
          OR (
            __sync_time = @lastSyncTime
            AND ISNULL(__sync_id_num, -9223372036854775808) > @lastSyncId
          )
        )
      )
      SELECT TOP 1 *
      FROM staged
      WHERE rn = @rowNumber
    `;

      const rows = await this.queryNewDbTx(
        query,
        {
          lastSyncTime,
          lastSyncId: Number(lastSyncId || 0),
          rowNumber
        },
        transaction
      );

      if (!rows?.length) {
        return null;
      }

      const row = { ...rows[0] };
      delete row.rn;
      return row;
    } catch (error) {
      logger.error(`[IncomingDocumentModel.fetchOneFromStaging] Failed to fetch itemIndex=${itemIndex} with lastSyncTime=${lastSyncTime}, lastSyncId=${lastSyncId}: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Validates and applies one Incoming row into destination aggregates.
   * @param {object} rowData
   * @param {{transaction?: object}} [context]
   * @returns {Promise<{action:string,backupId:string,affected:number}>}
   */
  async processRowData(rowData, { transaction } = {}) {
    try {
      if (!rowData) {
        throw new Error('rowData is required');
      }

      const backupId = String(rowData.ID || '').trim();
      if (!backupId) {
        throw new Error('Invalid document ID from staging');
      }

      const res = await this.upsertDocumentAggregateById(rowData, { transaction });
      const affected = Number(res?.affected || 0);

      if (affected === 0) {
        throw new Error(`Document was not inserted or updated for ID=${backupId}`);
      }

      return {
        action: res?.action || 'upsert',
        backupId,
        affected
      };
    } catch (error) {
      const backupId = rowData?.ID || 'unknown';
      logger.error(`[IncomingDocumentModel.processRowData] Failed to process row with ID=${backupId}: ${error.message}`, { stack: error.stack, rowData });
      throw error;
    }
  }

  async ThemFileDinhKem(oldRecord, newDocumentRecord, documentId) {
    const files = oldRecord?.Files || '';
    logger.info(`[DEBUG][ThemFileDinhKem] Dang kiem tra file cho ban ghi ID: ${oldRecord?.ID}. Gia tri cot Files: "${files}"`);

    if (!files) {
      logger.info(`[DEBUG][ThemFileDinhKem] Ban ghi ID ${oldRecord?.ID} KHONG co file đính kèm (cot Files trong DB cũ trống).`);
      return false;
    }

    try {
      const fileSvc = this._fileService;
      const baseUrl = (process.env.BASE_URL || "").replace(/\/$/, "");
      if (!baseUrl) {
        logger.error('[ThemFileDinhKem] BASE_URL is not configured in .env');
        return false;
      }

      const parts = files.split('|').filter(Boolean);
      if (parts.length === 0) return true;

      let filesToProcess = [];

      // Heuristic to decide parsing strategy based on the format of the first part.
      const firstPartIsLikelyFile = /\.(pdf|docx?|xlsx?|jpe?g|png|gif|bmp)$/i.test(parts[0]);

      if (firstPartIsLikelyFile) {
        logger.info(`[DEBUG][ThemFileDinhKem] Phat hien FORMAT 1 (relativePath truc tiep): ${parts[0]}`);
        const relativePath = parts[0];
        filesToProcess.push(relativePath);
      } else {
        const directory = parts[0];
        const names = parts.slice(1);
        logger.info(`[DEBUG][ThemFileDinhKem] Phat hien FORMAT 2 (directory + multiple files). Directory: "${directory}", Files count: ${names.length}`);
        for (const name of names) {
          if (!name) continue;
          const relativePath = directory.endsWith('/') ? `${directory}${name}` : `${directory}/${name}`;
          filesToProcess.push(relativePath);
        }
      }

      logger.info(`[DEBUG][ThemFileDinhKem] Record ${oldRecord.ID}: Found ${filesToProcess.length} files to process: ${filesToProcess.join(', ')}`);

      for (const relativePath of filesToProcess) {
        if (!relativePath.includes('/')) {
            logger.warn(`[ThemFileDinhKem] Skipping invalid path part: "${relativePath}" for record ${oldRecord.ID}`);
            continue;
        }

        const fullUrl = `${baseUrl}${relativePath}`;
        const fileName = relativePath.substring(relativePath.lastIndexOf('/') + 1);

        let buffer;
        try {
          logger.info(`[DEBUG][ThemFileDinhKem] Dang tai file tu SharePoint: ${fullUrl}`);
          // spDownload uses authentication cookies managed by SharePointAuthService
          buffer = await spDownload(fullUrl);
          if (!buffer || buffer.length === 0) {
            throw new Error(`Buffer tải về trống cho file ${fileName}`);
          }
          logger.info(`[DEBUG][ThemFileDinhKem] Tai file thanh cong: ${fileName} | Dung luong: ${buffer.length} bytes`);
        } catch (downloadErr) {
          logger.error(`[ThemFileDinhKem] Failed to download file from ${fullUrl}: ${downloadErr.message}`);
          continue; // Skip this file and continue with the next one.
        }

        const fileType = detectFileType(buffer);
        const mimeType = fileType.mime;

        const fileIdBak = uuidv4();
        const fileRecord = {
          file_name: fileName,
          file_path: relativePath,
          mime_type: mimeType,
          created_by: newDocumentRecord?.drafter,
          version: 1,
          id_bak: fileIdBak,
          table_bak: 'VanBanDen',
          type_doc: 'IncomingDocument',
          isBak: 1
        };

        const relationRecord = {
          object_type: 'IncomingDocument',
          object_id: String(documentId),
          object_id_bak: oldRecord?.ID,
          file_id_bak: fileIdBak,
          table_bak: 'VanBanDen',
          type_doc: 'IncomingDocument',
        };

        logger.info(`[DEBUG][ThemFileDinhKem] [BUOC 4] Chuan bi metadata de upload. fileName=${fileName}, relativePath=${relativePath}, mimeType=${mimeType}`);
        const result = await fileSvc.uploadAndInsert({
          fileBuffer: buffer,
          originalName: fileName,
          mimeType,
          fileRecord,
          relationRecord,
          folder: 'incoming',
          localFolder: 'incoming'
        });

        logger.info(`[DEBUG][ThemFileDinhKem] [KET QUA] Da hoan tat upload cho file ${fileName}. result: ${JSON.stringify(result)}`);
      }

      return true;
    } catch (error) {
      logger.error(`[ThemFileDinhKem] Unexpected error while migrating files for record ID ${oldRecord?.ID}: ${error.message}`, { stack: error.stack });
      return false;
    }
  }

/**
   * Tìm một bản ghi đầy đủ trong bảng staging theo ID.
   * @param {string|number} id
   * @param {object} [transaction]
   * @returns {Promise<object|null>}
   */
  async getByIdFromStaging(id, transaction = null) {
    if (!id) {
      throw new Error('[getByIdFromStaging] id là bắt buộc.');
    }

    const stagingTableRef = this.getStagingTableRef();

    const query = `
      SELECT TOP 1 *
      FROM ${stagingTableRef}
      WHERE ID = @id
    `;

    const rows = await this.queryNewDbTx(
      query,
      { id: String(id).trim() },
      transaction
    );

    return rows?.[0] || null;
  }

  /**
   * Tìm một bản ghi đầy đủ trong bảng VanBanDen (old DB) theo ID.
   * @param {string|number} id
   * @returns {Promise<object|null>}
   */
  async getByIdFromOldDb(id) {
    if (!id) {
      throw new Error('[getByIdFromOldDb] id là bắt buộc.');
    }

    const query = `
      SELECT TOP 1 *
      FROM ${this.oldDbSchema}.${this.oldDbTable}
      WHERE ID = @id
    `;

    const rows = await this.queryOldDb(
      query,
      { id: String(id).trim() }
    );

    return rows?.[0] || null;
  }


  /**
   * Upserts one Incoming document and its related audit/comment entities.
   * @param {object} oldRecord
   * @param {{transaction?: object}} [context]
   * @returns {Promise<{action:string,affected:number}>}
   */
  async upsertDocumentAggregateById(oldRecord, { transaction } = {}) {
    const id = String(oldRecord?.ID || '').trim();
    try {
      if (!oldRecord) {
        return { action: 'none', affected: 0 };
      }

      if (!this._IncomingMigrationModels) {
        throw new Error(`[upsertDocumentAggregateById] Model not initialized for ID=${id}`);
      }

      let totalAffected = 0;

      const documentResult = await this._IncomingMigrationModels.processSingleRecord(
        oldRecord,
        transaction
      );

      if (!documentResult || documentResult.affected === 0) {
        return { action: 'none', affected: 0 };
      }
      logger.info(
        `[AggregateSync][Document] documentId=${documentResult.documentId} action=${documentResult?.action} affected=${documentResult?.affected}`
      );

      totalAffected += Number(documentResult.affected || 0);
      const documentId = documentResult.documentId;

      if (!documentId) {
        return {
          action: documentResult.action || 'upsert',
          affected: Number(totalAffected || 0)
        };
      }

      const newRrecord = await this.getByIdFromStaging(id, transaction);
      logger.info(`[DEBUG][upsertDocumentAggregateById] Bat dau goi ThemFileDinhKem cho documentId: ${documentId}`);
      await this.ThemFileDinhKem(oldRecord, newRrecord, documentId);

      /* ====== Phân tách bình luận từ HTML (Ý kiến lãnh đạo SP cũ) ====== */
      try {
        let totalParsedComments = 0;
        if (oldRecord?.YKienLanhDao) {
           totalParsedComments += await this._IncomingMigrationModels.helper.parseAndInsertHtmlComments(
              oldRecord.YKienLanhDao, documentId, id, 'VanBanDen', 'YKienLanhDao', transaction
           );
        }
        if (oldRecord?.YKienLanhDaoTCT) {
           totalParsedComments += await this._IncomingMigrationModels.helper.parseAndInsertHtmlComments(
              oldRecord.YKienLanhDaoTCT, documentId, id, 'VanBanDen', 'YKienLanhDaoTCT', transaction
           );
        }
        if (oldRecord?.YKienLanhDaoVPDN) {
           totalParsedComments += await this._IncomingMigrationModels.helper.parseAndInsertHtmlComments(
              oldRecord.YKienLanhDaoVPDN, documentId, id, 'VanBanDen', 'YKienLanhDaoVPDN', transaction
           );
        }
        if (oldRecord?.YKienCuaLDVPChoVanThu) {
           totalParsedComments += await this._IncomingMigrationModels.helper.parseAndInsertHtmlComments(
              oldRecord.YKienCuaLDVPChoVanThu, documentId, id, 'VanBanDen', 'YKienCuaLDVPChoVanThu', transaction
           );
        }
        if (totalParsedComments > 0) {
          logger.info(`[AggregateSync][ParsedHTMLComments] documentId=${documentId} newly extracted comments=${totalParsedComments}`);
        }
      } catch (htmlCommentErr) {
        logger.warn(`[upsertDocumentAggregateById] Lỗi parse HTML YKien ID=${id}: ${htmlCommentErr.message}`);
      }

      // ══════════════════════════════════════════════════════════════
      // AGGREGATED AUDIT SYNC: Gộp tất cả audit từ các bảng và xử lý theo thứ tự thời gian
      // ══════════════════════════════════════════════════════════════
      const auditModels = this._syncAuditModel || [];
      if (auditModels.length > 0) {
        try {
          const auditTableNames = auditModels.map(m => m.oldDbTable);
          const firstModel = auditModels[0];
          
          // Lấy tất cả audit từ tất cả các bảng, đã được sắp xếp chronologically bên trong method này
          const allRawAudits = await firstModel.fetchAllAuditsAcrossTables(
            id,
            auditTableNames,
            [
              CATEGORY_INCOMING_TCT,
              CATEGORY_INCOMING,
              CATEGORY_INCOMING_INTERNAL,
              CATEGORY_INCOMING_SUBMIT
            ] // Categories cho văn bản đến
          );

          if (allRawAudits.length > 0) {
            // Tạo map để tìm nhanh model xử lý dựa trên tên bảng
            const modelMap = new Map(auditModels.map(m => [m.oldDbTable, m]));

            for (const rawAudit of allRawAudits) {
              const tableName = rawAudit.__source_table;
              const model = modelMap.get(tableName) || firstModel;
              
              try {
                const result = await model.processSingleRecord(rawAudit, documentId, transaction);
                if (!result) continue;
                
                logger.info(
                  `[AggregateSync][Audit] table=${tableName} documentId=${documentId} inserted=${result?.inserted || 0} updated=${result?.updated || 0}`
                );
                totalAffected += Number(result.inserted || 0);
                totalAffected += Number(result.updated || 0);
              } catch (auditErr) {
                logger.warn(
                  `[upsertDocumentAggregateById] Audit migrate failed for table=${tableName}, source ID=${id}, target documentId=${documentId}: ${auditErr.message}`, { stack: auditErr.stack }
                );
              }
            }
          }
        } catch (error) {
          logger.warn(
            `[upsertDocumentAggregateById] Aggregated fetch audit failed for ID=${id}: ${error.message}`, { stack: error.stack }
          );
        }
      }

      // ══════════════════════════════════════════════════════════════
      // AUTO-CREATE AUDIT: Nếu document_id chưa có audit nào → tạo 1 bản ghi CREATE
      // ══════════════════════════════════════════════════════════════
      try {
        const existingAudit = await this.queryNewDbTx(
          `SELECT TOP 1 id FROM ${process.env.NEW_DB_NAME}.dbo.audit WHERE document_id = @docId`,
          { docId: documentId },
          transaction
        );

        if (!existingAudit || existingAudit.length === 0) {
          const creatorName = oldRecord.CreatedBy || oldRecord.NguoiSoanThaoText || '';
          const parsedDate = this.helper
            ? this.helper.parseDate(oldRecord.Created)
            : null;
          const createdDate = parsedDate || new Date();

          let creatorId = process.env.VANTHU_USER_ID;
          let displayName = creatorName;
          if (this.helper && creatorName) {
            try {
              const cleanName = this.helper.extractDisplayName
                ? this.helper.extractDisplayName(creatorName)
                : creatorName;
              displayName = cleanName || creatorName;
              const resolvedId = await this.helper.mapUserName(cleanName, transaction);
              if (resolvedId) creatorId = resolvedId;
            } catch (mapErr) {
              logger.warn(`[AutoCreateAudit][Incoming] mapUserName failed for "${creatorName}": ${mapErr.message}`);
            }
          }

          const insertQuery = `
            INSERT INTO ${process.env.NEW_DB_NAME}.dbo.audit (
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
          `;

          await this.queryNewDbTx(insertQuery, {
            document_id: documentId,
            time: createdDate || new Date(),
            user_id: creatorId,
            display_name: displayName || null,
            action_code: 'CREATE',
            details: JSON.stringify({ note: 'Tạo văn bản (tự động tạo từ migration)', isTransferOption: false }),
            origin_id: `auto_create_${String(id).substring(0, 80)}`,
            created_by: creatorId,
            receiver: creatorId,
            receiver_unit: null,
            group_: null,
            roleProcess: 'VANTHU',
            action: 'Tạo văn bản',
            stage_status: 'DA_XU_LY',
            created_at: createdDate || new Date(),
            type_document: 'IncomingDocument',
            table_backups: 'auto_create'
          }, transaction);

          logger.info(`[AutoCreateAudit][Incoming] Created initial CREATE audit for documentId=${documentId} creator=${displayName}`);
          totalAffected++;
        }
      } catch (autoAuditErr) {
        logger.warn(`[AutoCreateAudit][Incoming] Failed for documentId=${documentId}: ${autoAuditErr.message}`);
      }

      // for (const commentModel of this._syncCommentModel || []) {
      //   try {
      //     const rawComments = await commentModel.fetchByDocumentId(id);
      //
      //     if (!Array.isArray(rawComments) || !rawComments.length) {
      //       continue;
      //     }
      //
      //     for (const rawComment of rawComments) {
      //       try {
      //         const result = await commentModel.processSingleRecord(rawComment, documentId, transaction);
      //         if (!result) continue;
      //         logger.info(
      //           `[AggregateSync][Comment] table=${commentModel?.oldDbTable} documentId=${documentResult.documentId} inserted=${result?.inserted || 0} updated=${result?.updated || 0}`
      //         );
      //         totalAffected += Number(result.inserted || 0);
      //         totalAffected += Number(result.updated || 0);
      //       } catch (error) {
      //         logger.warn(
      //           `[upsertDocumentAggregateById] Comment migrate failed for table=${commentModel?.oldDbTable}, source ID=${id}, target documentId=${documentId}: ${error.message}`, { stack: error.stack }
      //         );
      //       }
      //     }
      //   } catch (error) {
      //     logger.warn(
      //       `[upsertDocumentAggregateById] Fetch comment failed for table=${commentModel?.oldDbTable}, source ID=${id}: ${error.message}`, { stack: error.stack }
      //     );
      //   }
      // }

      return {
        action: documentResult.action || 'upsert',
        affected: Number(totalAffected || 0)
      };
    } catch (error) {
      logger.error(`[IncomingDocumentModel.upsertDocumentAggregateById] Failed to upsert document aggregate for ID=${id}: ${error.message}`, { stack: error.stack, oldRecord });
      throw error;
    }
  }
}

module.exports = IncomingDocumentModel;
