// sync-incoming.model.js
const BaseModel = require('../../../models/BaseModel');
const logger = require('../../../utils/logger');
const sql = require('mssql');
const crypto = require('crypto');
const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const MigrationHelper = require('../../helpers/MigrationHelper');

const DEFAULT_SYNC_TIME = '1753-01-01T00:00:00.000Z';

class SyncIncomingDocumentModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: '3_incoming' });
    this.newDbName = process.env.NEW_DB_NAME;
    this.oldDbSchema = 'dbo';
    this.oldDbTable = 'VanBanDen';
    this.newDbSchema = 'dbo';
    this.newTableSync = 'incomming_documents_sync'; //Bảng trung gian lưu data raw dùng để sync dần vào bảng chính `user_clone_for_sync`
    this.newDbTable = 'incomming_documents';
    // Properties for INSERT/UPDATE queries
    this.dbName = this.newDbName;
    this.mainSchema = this.newDbSchema;
    this.mainTable = this.newDbTable;
    this.helper = new MigrationHelper(this.queryNewDbTx.bind(this), this.queryOldDb.bind(this));
  }

  async initialize() {
    await super.initialize();
    await this.ensureOldTableHasNgayDen();
    await this.ensureStagingTableExists();
    await this.ensureMainTableExists();
  }

  async ensureOldTableHasNgayDen() {
    const query = `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.oldDbTable}' AND TABLE_SCHEMA = '${this.oldDbSchema}' AND COLUMN_NAME = 'NgayDen')
      BEGIN
        ALTER TABLE ${this.oldDbSchema}.${this.oldDbTable} ADD NgayDen NVARCHAR(MAX) NULL;
      END
    `;
    await this.queryOldDb(query);
  }

  async ensureStagingTableExists() {
    const stagingTableRef = this.getStagingTableRef();
    const query = `
        IF OBJECT_ID('${stagingTableRef}', 'U') IS NULL
        BEGIN
            CREATE TABLE ${stagingTableRef} (
                ID NVARCHAR(255) PRIMARY KEY,
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
    await this.queryNewDb(query);
  }

  async ensureMainTableExists() {
    const mainTableRef = this.getMainTableRef();
    const query = `
        IF OBJECT_ID('${mainTableRef}', 'U') IS NULL
        BEGIN
            CREATE TABLE ${mainTableRef} (
                document_id NVARCHAR(50) PRIMARY KEY,
                status_code NVARCHAR(10) NULL,
                created_at DATETIME2 NULL,
                updated_at DATETIME2 NULL,
                book_document_id NVARCHAR(50) NULL,
                abstract_note NVARCHAR(MAX) NULL,
                to_book INT NULL,
                sender_unit NVARCHAR(MAX) NULL,
                receiver_unit NVARCHAR(MAX) NULL,
                document_date DATETIME2 NULL,
                receive_date DATETIME2 NULL,
                to_book_date DATETIME2 NULL,
                deadline DATETIME2 NULL,
                second_book NVARCHAR(MAX) NULL,
                receive_method NVARCHAR(MAX) NULL,
                private_level NVARCHAR(MAX) NULL,
                urgency_level NVARCHAR(MAX) NULL,
                document_type NVARCHAR(MAX) NULL,
                document_field NVARCHAR(MAX) NULL,
                signer NVARCHAR(MAX) NULL,
                to_book_code NVARCHAR(MAX) NULL,
                to_book_text_symbols NVARCHAR(MAX) NULL,
                fileids NVARCHAR(MAX) NULL,
                status NVARCHAR(10) NULL,
                isStar INT DEFAULT 0,
                parent_doc NVARCHAR(50) NULL,
                type_process_doc NVARCHAR(MAX) NULL,
                bpmn_version NVARCHAR(MAX) NULL,
                copy_to_internal NVARCHAR(MAX) NULL,
                resolution_deadline DATETIME2 NULL,
                copy_count INT NULL,
                page_count INT NULL,
                view_group varchar(100) NULL,
                directive_comment NVARCHAR(MAX) NULL,
                /* SoVanBan NVARCHAR(MAX) NULL, */
                id_incoming_bak NVARCHAR(255) NULL,
                /*
                CoQuanGui2 NVARCHAR(MAX) NULL,
                CoQuanGuiText NVARCHAR(MAX) NULL,
                DonVi NVARCHAR(MAX) NULL,
                IsLibrary INT NULL,
                ItemVBDTCT NVARCHAR(MAX) NULL,
                ItemVBPH NVARCHAR(MAX) NULL,
                ItemVBPHOld NVARCHAR(MAX) NULL,
                BanLanhDao NVARCHAR(MAX) NULL,
                LanhDaoTCT NVARCHAR(MAX) NULL,
                LanhDaoTCTDaXuLy NVARCHAR(MAX) NULL,
                LanhDaoTCTDeBiet NVARCHAR(MAX) NULL,
                LanhDaoVPDN NVARCHAR(MAX) NULL,
                LinhVuc NVARCHAR(MAX) NULL,
                SoBan INT NULL,
                SoTrang INT NULL,
                TrichYeu NVARCHAR(MAX) NULL,
                VanBanTraLoi NVARCHAR(MAX) NULL,
                ChenSo NVARCHAR(MAX) NULL,
                YKienLanhDao NVARCHAR(MAX) NULL,
                YKienLanhDaoTCT NVARCHAR(MAX) NULL,
                YKienLanhDaoVPDN NVARCHAR(MAX) NULL,
                YKienCuaLDVPChoVanThu NVARCHAR(MAX) NULL,
                ForwardType NVARCHAR(MAX) NULL,
                ModuleId NVARCHAR(MAX) NULL,
                SiteName NVARCHAR(MAX) NULL,
                ListName NVARCHAR(MAX) NULL,
                ItemId NVARCHAR(MAX) NULL,
                MigrateFlg NVARCHAR(MAX) NULL,
                YearMonth NVARCHAR(MAX) NULL,
                MigrateErrFlg NVARCHAR(MAX) NULL,
                MigrateErrMess NVARCHAR(MAX) NULL,
                TrangThai NVARCHAR(MAX) NULL,
                ModifiedBy NVARCHAR(MAX) NULL,
                CreatedBy NVARCHAR(MAX) NULL,
                DGPId NVARCHAR(MAX) NULL,
                deadline_reply DATETIME2 NULL,
                table_backup NVARCHAR(255) DEFAULT 'VanBanDen',
                */
                tb_bak INT DEFAULT 0,
                tb_update INT DEFAULT 0,
                /*
                status_code_bef_test NVARCHAR(10) NULL,
                sender_unit_bef_test NVARCHAR(MAX) NULL,
                receiver_unit_bef_test NVARCHAR(MAX) NULL,
                */
                table_backups NVARCHAR(MAX) NULL,
                stage_status NVARCHAR(50) NULL
                /* curStatusCode NVARCHAR(10) NULL */
            );
            CREATE INDEX idx_id_incoming_bak ON ${mainTableRef}(id_incoming_bak);
        END
        ELSE
        BEGIN
            -- Ensure table_backups column exists if table already existed
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.newDbTable}' AND COLUMN_NAME = 'table_backups')
                ALTER TABLE ${mainTableRef} ADD table_backups NVARCHAR(MAX) NULL;

            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.newDbTable}' AND COLUMN_NAME = 'tb_bak')
                ALTER TABLE ${mainTableRef} ADD tb_bak INT DEFAULT 0;

            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.newDbTable}' AND COLUMN_NAME = 'tb_update')
                ALTER TABLE ${mainTableRef} ADD tb_update INT DEFAULT 0;

            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.newDbTable}' AND COLUMN_NAME = 'stage_status')
                ALTER TABLE ${mainTableRef} ADD stage_status NVARCHAR(50) NULL;

            /*
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.newDbTable}' AND COLUMN_NAME = 'curStatusCode')
                ALTER TABLE ${mainTableRef} ADD curStatusCode NVARCHAR(10) NULL;
            */

            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.newDbTable}' AND COLUMN_NAME = 'to_book_text_symbols')
                ALTER TABLE ${mainTableRef} ADD to_book_text_symbols NVARCHAR(MAX) NULL;

            -- Fix missing columns for old/new documents sync
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.newDbTable}' AND COLUMN_NAME = 'id_incoming_bak')
            BEGIN
                ALTER TABLE ${mainTableRef} ADD id_incoming_bak NVARCHAR(255) NULL;
                IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_id_incoming_bak_v2' AND object_id = OBJECT_ID('${mainTableRef}'))
                    CREATE INDEX idx_id_incoming_bak_v2 ON ${mainTableRef}(id_incoming_bak);
            END

            /*
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.newDbTable}' AND COLUMN_NAME = 'CoQuanGui2')
                ALTER TABLE ${mainTableRef} ADD CoQuanGui2 NVARCHAR(MAX) NULL;
            ... (and all other similar rows)
            */
        END
        `;
    await this.queryNewDb(query);
  }

  getStagingTableRef() {
    if (this.newDbName) {
      return `${this.newDbName}.${this.newDbSchema}.${this.newTableSync}`;
    }
    return `${this.newDbSchema}.${this.newTableSync}`;
  }

  getMainTableRef() {
    if (this.newDbName) {
      return `${this.newDbName}.${this.mainSchema}.${this.mainTable}`;
    }
    return `${this.mainSchema}.${this.mainTable}`;
  }
  /**
   * Override queryNewDbTx để hỗ trợ explicit type cho NVARCHAR(MAX) fields.
   * Giải quyết vấn đề mssql driver tự động infer NVARCHAR(4000) thay vì MAX.
   */
  async queryNewDbTx(query, params = {}, transaction = null) {
    try {
      const canUseTransaction = Boolean(
        transaction &&
        transaction._acquiredConnection &&
        !transaction._aborted
      );

      if (!canUseTransaction && !this.newPool) {
        throw new Error('Database pool not initialized. Call initialize() first.');
      }

      const request = canUseTransaction
        ? new sql.Request(transaction)
        : this.newPool.request();

      // Danh sách UUID fields
      const uuidFields = [];

      // Danh sách NVARCHAR(MAX) fields
      const maxFields = [
        /*'CoQuanGui2', 'CoQuanGuiText', 'DonVi',*/ 'abstract_note',
        'to_book_code',
        'urgency_level',
        'private_level',
        'document_type',
        /*'SoVanBan',*/ 'TrichYeu',
        /*'VanBanTraLoi', 'YKienLanhDao', 'YKienLanhDaoTCT',
                'YKienLanhDaoVPDN', 'YKienCuaLDVPChoVanThu', 'ForwardType',*/ 'MigrateErrMess',
        'receiver_unit',
        'copy_to_internal',
        'view_group',
        'directive_comment',
        'fileids',
        /*'LanhDaoTCT', 'LanhDaoTCTDaXuLy', 'LanhDaoTCTDeBiet',*/ 'Files',
      ]; // <-- thêm 'Files'

      Object.keys(params || {}).forEach((key) => {
        const value = params[key];

        // UUID fields - chỉ set type khi value là GUID hợp lệ
        if (uuidFields && uuidFields.includes(key)) {
          if (value && this.isValidUUID(value)) {
            request.input(key, sql.UniqueIdentifier, value);
          } else {
            // Nếu null hoặc không phải GUID, để driver tự infer (sẽ là NULL)
            request.input(key, value);
          }
        }
        // NVARCHAR(MAX) fields
        else if (maxFields.includes(key)) {
          request.input(key, sql.NVarChar(sql.MAX), this.normalizeNVarCharValue(value));
        }
        // Các field khác để driver tự infer
        else {
          request.input(key, value);
        }
      });

      const result = await request.query(query);
      return result.recordset;
    } catch (error) {
      logger.error(`Lỗi query database mới: ${error.message}`);
      throw error;
    }
  }
  sanitizeColumnName(column) {
    if (!/^[A-Za-z0-9_]+$/.test(column)) {
      throw new Error(`Invalid column name from source: ${column}`);
    }
    return `[${column}]`;
  }
  extractRowSyncTime(row) {
    const raw = row?.__sync_time || row?.Modified || row?.NgayTao || row?.updated_at || null;
    if (!raw) return null;
    const dateValue = new Date(raw);
    if (Number.isNaN(dateValue.getTime())) return null;
    return dateValue.toISOString();
  }

  extractRowSyncId(row) {
    return Number(row?.__sync_id || row?.ID || 0);
  }

  isCursorAhead(aTime, aId, bTime, bId) {
    const ta = new Date(aTime || DEFAULT_SYNC_TIME).getTime();
    const tb = new Date(bTime || DEFAULT_SYNC_TIME).getTime();
    // Chế độ ASC: "Đi trước" nghĩa là mới hơn
    if (ta > tb) return true;
    if (ta < tb) return false;
    return Number(aId || 0) > Number(bId || 0);
  }
  normalizeSyncTime(value) {
    if (!value || value === '2100-01-01T00:00:00.000Z') return DEFAULT_SYNC_TIME;
    const dateValue = new Date(value);
    if (Number.isNaN(dateValue.getTime())) return DEFAULT_SYNC_TIME;
    // Chế độ ASC: Nếu cursor quá cũ, ép về 1753
    if (dateValue.getFullYear() <= 1753) return DEFAULT_SYNC_TIME;
    return dateValue.toISOString();
  }
  parseStatus(value) {
    const statusStr = String(value || '');
    if (statusStr === '-1') return 3;
    return 1;
  }

  isValidUUID(value) {
    if (!value) return false;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidPattern.test(String(value));
  }

  parseBit(value) {
    if (value === '1' || value === 1 || value === true) return 1;
    if (value === '0' || value === 0 || value === false) return 0;
    return 0;
  }
  /**
   * Chuan hoa gia tri cho tham so NVARCHAR(MAX) truoc khi bind.
   * Tranh loi "Validation failed ... Invalid string" khi value la so/object.
   */
  normalizeNVarCharValue(value) {
    if (value === 'NULL' || value === 'null' || value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string') {
      return value;
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
      return value.toString('utf8');
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch (_) {
        return String(value);
      }
    }
    return String(value);
  }
  safeDate(value) {
    if (value === 'NULL' || value === 'null' || value === null || value === undefined) {
      return null;
    }
    try {
      const dateStr = String(value).trim();
      if (!dateStr) return null;
      const date = new Date(dateStr);
      return Number.isNaN(date.getTime()) ? null : date;
    } catch (error) {
      return null;
    }
  }
  safeNumber(value, defaultValue = 0) {
    if (value === 'NULL' || value === 'null' || value === null || value === undefined) {
      return defaultValue;
    }
    const num = Number(value);
    return Number.isNaN(num) ? defaultValue : num;
  }
  safeString(value) {
    if (value === 'NULL' || value === 'null' || value === null || value === undefined) {
      return null;
    }
    const strValue = String(value).trim();
    if (strValue === '' || strValue === 'NULL' || strValue === 'null') {
      return null;
    }
    return strValue;
  }
  /**
   * Strip HTML tags from string
   * @param {*} value - value to clean
   * @returns {string|null}
   */
  stripHtml(value) {
    const str = this.safeString(value);
    if (!str) return null;
    return str
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  /**
   * Safe string cho các field chứa số (có thể là số hoặc chuỗi)
   */
  safeStringOrNumber(value) {
    const str = this.safeString(value);
    if (!str) return null;
    // Nếu là số thuần túy, giữ nguyên
    if (/^\d+$/.test(str)) return str;
    // Nếu là format số văn bản, giữ nguyên
    return str;
  }
  /**
   * Truncate string to max length to prevent SQL truncation errors
   * @param {*} value - value to truncate
   * @param {number} maxLength - maximum length
   * @returns {string|null}
   */
  safeTruncate(value, maxLength) {
    const str = this.safeString(value);
    if (!str) return null;
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength);
  }
  /**
   * Lấy danh sách user từ CSDL cũ sau `lastSyncTime`.
   * Trả về mảng bản ghi (ID, AccountName, FullName, Modified, NgayTao) đã sắp xếp theo thời gian sửa/tao.
   * @param {string} lastSyncTime - ISO datetime hoặc giá trị mặc định để lấy từ thời điểm đó về sau
   * @returns {Promise<Array>} danh sách bản ghi từ CSDL cũ
   */
  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0, offset = 0, limit = 100) {
    const query = `
    ;WITH source_rows AS (
        SELECT
            [ID], [Title], [SoDen], [CoQuanGui2], [CoQuanGuiText], [DonVi], [IsLibrary], [DoKhan], [DoMat],
            CAST([Files] AS NVARCHAR(MAX)) AS [Files],
            [ThoiHanGQ], [ItemVBDTCT], [ItemVBPH], [BanLanhDao], [LanhDaoTCT], [LanhDaoTCTDaXuLy],
            [LanhDaoTCTDeBiet], [LanhDaoVPDN], [LinhVuc], [LoaiVanBan], [NgayTrenVB],
            [SoBan], [SoTrang], [SoVanBan], [TrangThai], [TrichYeu], [VanBanTraLoi], [ChenSo],
            [YKienLanhDao], [YKienLanhDaoTCT], [YKienLanhDaoVPDN], [YKienCuaLDVPChoVanThu],
            [ForwardType], [Modified], [Created], [ModifiedBy], [CreatedBy], [ModuleId],
            [SiteName], [ListName], [ItemId], [MigrateFlg], [YearMonth], [MigrateErrFlg],
            [MigrateErrMess], [ItemVBPHOld], [DGPId],
            ${this.getSyncTimeExpression()} AS __sync_time,
            TRY_CONVERT(
                BIGINT,
                NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), '')
            ) AS __sync_id_num
        FROM ${this.oldDbSchema}.${this.oldDbTable}
    )
    SELECT * FROM (
        SELECT
            *,
            ISNULL(__sync_id_num, 0) AS __sync_id,
            ROW_NUMBER() OVER (
                ORDER BY
                    __sync_time ASC,
                    ISNULL(__sync_id_num, 0) ASC,
                    ID ASC
            ) AS __page_rn
        FROM source_rows
        WHERE
            __sync_time IS NOT NULL
            AND (
                @lastSyncTime = '1753-01-01T00:00:00.000Z'
                OR __sync_time > @lastSyncTime
                OR (
                    __sync_time = @lastSyncTime
                    AND ISNULL(__sync_id_num, 0) > @lastSyncId
                )
            )
    ) AS t
    WHERE __page_rn > @offset AND __page_rn <= (@offset + @limit)
    ORDER BY __page_rn
    `;

    const params = {
      lastSyncTime,
      lastSyncId: Number(lastSyncId || 0),
      offset: Number(offset || 0),
      limit: Number(limit || 100),
    };

    return this.queryOldDb(query, params);
  }

  /**
   * Alias for countListFromOldDb to support SyncHandlerModel.
   */
  async getCount(lastSyncTime, lastSyncId = 0) {
    return this.countListFromOldDb(lastSyncTime, lastSyncId);
  }

  /**
   * Đếm tổng số bản ghi từ CSDL cũ.
   */
  async countListFromOldDb(lastSyncTime, lastSyncId = 0) {
    const query = `
    ;WITH source_rows AS (
        SELECT
            ${this.getSyncTimeExpression()} AS __sync_time,
            TRY_CONVERT(
                BIGINT,
                NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), '')
            ) AS __sync_id_num
        FROM ${this.oldDbSchema}.${this.oldDbTable}
    )
    SELECT COUNT(1) AS total
    FROM source_rows
    WHERE
        __sync_time IS NOT NULL
        AND (
            @lastSyncTime = '1753-01-01T00:00:00.000Z'
            OR __sync_time > @lastSyncTime
            OR (
                __sync_time = @lastSyncTime
                AND ISNULL(__sync_id_num, 0) > @lastSyncId
            )
        )
    `;
    const params = {
      lastSyncTime,
      lastSyncId: Number(lastSyncId || 0),
    };
    const res = await this.queryOldDb(query, params);
    return Number(res?.[0]?.total || 0);
  }

  async syncOldToStaging(rows, { transaction } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { stagedCount: 0 };
    }

    const internalColumns = new Set(['__sync_time', '__sync_id', '__sync_id_num']);
    const columns = Object.keys(rows[0] || {}).filter(
      (column) => !String(column).startsWith('__') && !internalColumns.has(column),
    );
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

    for (const row of rows) {
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
          ${
            nonIdColumns.length > 0
              ? `
          UPDATE ${stagingTableRef}
          SET ${updateClause}
          WHERE ID = @ID
            AND (Modified IS NULL OR TRY_CONVERT(datetime2, @Modified, 121) > TRY_CONVERT(datetime2, Modified, 121));`
              : `
          SELECT 1 AS noop;`
          }
        END
        ELSE
        BEGIN
          INSERT INTO ${stagingTableRef} (${safeColumns.join(', ')})
          VALUES (${columns.map((column) => `@${column}`).join(', ')});
        END
      `;

      await this.queryNewDbTx(query, params, transaction);
    }

    return { stagedCount: rows.length };
  }

  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    try {
      if (!syncJobId) {
        throw new Error('syncJobId is required');
      }

      const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
      const normalizedLastSyncId = Number(lastSyncId || 0);

      let currentSyncTime = normalizedLastSyncTime;
      let currentSyncId = normalizedLastSyncId;

      if (currentSyncTime === DEFAULT_SYNC_TIME) {
        const stagingTableRef = this.getStagingTableRef();
        const maxRes = await this.queryNewDb(
          `SELECT MAX(Modified) as maxTime FROM ${stagingTableRef}`,
        );
        if (maxRes?.[0]?.maxTime) {
          currentSyncTime = this.normalizeSyncTime(maxRes[0].maxTime);
          logger.info(
            `[SyncIncomingDocumentModel] Tự động lấy mốc thời gian lớn nhất từ bảng trung gian: ${currentSyncTime}`,
          );
        }
      }

      let totalStagedCount = 0;
      let allRowsCount = 0;

      const totalCountToFetch = await this.countListFromOldDb(currentSyncTime, currentSyncId);
      logger.info(`[SyncIncomingDocumentModel] Tổng số bản ghi cần đồng bộ: ${totalCountToFetch}`);

      const fetchLimit = Number(process.env.COMPLETED_LIMIT || 100);

      // 2 vòng for: Outer loop theo batch size, Inner loop xử lý batch đó
      for (let offset = 0; offset < totalCountToFetch; offset += fetchLimit) {
        const rows = await this.fetchListFromOldDb(
          currentSyncTime,
          currentSyncId,
          offset,
          fetchLimit,
        );
        if (!rows || rows.length === 0) break;

        // Sync batch to staging
        const stageResult = await this.syncOldToStaging(rows);
        totalStagedCount += Number(stageResult?.stagedCount || 0);
        allRowsCount += rows.length;

        // Cập nhật cursor (dùng cho mốc log/tiến trình)
        for (const row of rows) {
          const rowTime = this.extractRowSyncTime(row);
          const rowId = this.extractRowSyncId(row);
          if (rowTime && this.isCursorAhead(rowTime, rowId, currentSyncTime, currentSyncId)) {
            currentSyncTime = rowTime;
            currentSyncId = rowId;
          }
        }

        logger.info(
          `[SyncIncomingDocumentModel] >> Tiến độ: ${allRowsCount}/${totalCountToFetch} bản ghi (Staged=${totalStagedCount})`,
        );
      }

      logger.info(`[SyncIncomingDocumentModel] Hoàn tất đẩy ${allRowsCount} bản ghi về Staging.`);

      return {
        syncJobId,
        rows: [],
        totalCount: allRowsCount,
        stagedCount: totalStagedCount,
        sourceLastSyncTime: normalizedLastSyncTime,
        sourceLastSyncId: normalizedLastSyncId,
        lastSyncTime: currentSyncTime,
        lastSyncId: currentSyncId,
      };
    } catch (error) {
      logger.error(
        `[SyncIncomingDocumentModel.getList] Failed to get list for syncJobId=${syncJobId}: ${error.message}`,
        { stack: error.stack },
      );
      throw error;
    }
  }
  /**
   * Đếm số user hiện có trong bảng `user_clone_for_sync` (schema mặc định của service).
   * @returns {Promise<number>} tổng số bản ghi
   */
  async countNewIncomingDocument() {
    const rows = await this.queryNewDb(
      `
      SELECT COUNT(1) AS total
      FROM ${this.newDbSchema}.${this.newDbTable}
      `,
    );
    return Number(rows?.[0]?.total || 0);
  }
  async getSyncJobState(syncJobId) {
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
      { syncJobId },
    );

    return rows?.[0] || null;
  }
  /**
   * Returns SQL expression that normalizes source sync time across supported columns.
   * @returns {string}
   */
  getSyncTimeExpression() {
    return `
      COALESCE(
        TRY_CONVERT(datetime2, Modified, 105),
        TRY_CONVERT(datetime2, Created, 105),

        TRY_CONVERT(datetime2, Modified, 120),
        TRY_CONVERT(datetime2, Created, 120),

        TRY_CONVERT(datetime2, Modified),
        TRY_CONVERT(datetime2, Created)
      )
    `;
  }

  async processOne(syncJobId, options = {}) {
    if (!syncJobId) {
      throw new Error('syncJobId is required');
    }

    let jobState;
    try {
      jobState = await this.getSyncJobState(syncJobId);
    } catch (error) {
      throw error;
    }

    const lastSyncTime = this.normalizeSyncTime(jobState?.last_sync_time);
    const lastSyncId = Number(jobState?.last_sync_id || 0);

    let rowData = null;
    let transaction = null;

    try {
      const stagingTableRef = this.getStagingTableRef();

      rowData = await this.fetchOneFromStaging();

      if (!rowData) {
        logger.info(
          `[SyncIncomingDocumentModel] Không còn dữ liệu trong staging để xử lý cho job ${syncJobId}.`,
        );
        return {
          syncJobId,
          processed: false,
          done: true,
        };
      }

      const rowId = rowData.ID || null;
      const current = Number(jobState?.total_processed || 0) + 1;
      logger.info(`[SyncIncomingDocumentModel] Process ${current}: record ID=${rowId}`);

      transaction = new sql.Transaction(this.newPool);
      await transaction.begin();

      const result = await this.processRowData(rowData, { transaction });

      const nextSyncTime = this.extractRowSyncTime(rowData) || lastSyncTime;
      const nextSyncId = this.extractRowSyncId(rowData) || lastSyncId;

      await this.queryNewDbTx(
        `UPDATE sync_jobs
                 SET total_processed = ISNULL(total_processed, 0) + 1,
                     total_success   = ISNULL(total_success, 0) + 1,
                     last_sync_time  = @lastSyncTime,
                     last_sync_id    = @lastSyncId
                 WHERE job_id = @syncJobId`,
        { syncJobId, lastSyncTime: nextSyncTime, lastSyncId: nextSyncId },
        transaction,
      );

      await this.queryNewDbTx(
        `UPDATE ${stagingTableRef} SET MigrateFlg = 1, MigrateErrFlg = 0, MigrateErrMess = NULL WHERE ID = @ID`,
        { ID: rowId },
        transaction,
      );

      await transaction.commit();

      return {
        syncJobId,
        processed: true,
        done: false,
        rowId,
        result,
      };
    } catch (error) {
      if (transaction) {
        try {
          await transaction.rollback();
        } catch (rollbackError) {}
      }

      if (rowData && rowData.ID) {
        try {
          const stagingTableRef = this.getStagingTableRef();
          await this.queryNewDb(
            `UPDATE ${stagingTableRef} SET MigrateErrFlg = 1, MigrateErrMess = @Err WHERE ID = @ID`,
            { ID: rowData.ID, Err: String(error.message).slice(0, 1000) },
          );
        } catch (updateErr) {}
      }

      logger.error(
        `[SyncIncomingDocumentModel.processOne] Failed row ID=${rowData?.ID}: ${error.message}`,
      );
      throw error;
    }
  }

  async processRowData(rowData, { transaction } = {}) {
    if (!rowData) {
      throw new Error('rowData is required');
    }

    const backupId = String(rowData.ID || '').trim();
    if (!backupId) {
      throw new Error('Invalid document ID from staging');
    }

    const res = await this.processSingleRecord(rowData, transaction);
    const affected = Number(res?.affected || 0);

    if (affected === 0) {
      throw new Error(`Document was not inserted or updated for ID=${backupId}`);
    }

    return {
      action: res?.action || 'upsert',
      backupId,
      affected,
    };
  }
  async fetchOneFromStaging() {
    try {
      const stagingTableRef = this.getStagingTableRef();
      const query = `
            SELECT TOP 1 *
            FROM ${stagingTableRef}
            WHERE ISNULL(MigrateFlg, 0) = 0
              AND ISNULL(MigrateErrFlg, 0) = 0
            ORDER BY TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(ID)), '')) DESC
            `;

      const rows = await this.queryNewDb(query);
      return rows?.length ? rows[0] : null;
    } catch (error) {
      logger.error(
        `[SyncIncomingDocumentModel.fetchOneFromStaging] Failed to fetch: ${error.message}`,
      );
      throw error;
    }
  }
  async processSingleRecord(rowData, transaction) {
    if (!rowData || typeof rowData !== 'object') {
      throw new Error('rowData is required');
    }

    if (!rowData.ID) {
      throw new Error('rowData.ID is required');
    }

    if (!transaction) {
      throw new Error('Transaction is required');
    }

    try {
      logger.info(
        `[SyncIncomingDocumentModel][STEP 1.1] Bắt đầu Mapping dữ liệu từ Staging sang Model mới cho record ID=${rowData.ID}`,
      );
      // 1. Map raw -> main structure
      const mapped = await this._mapSingleRecord(rowData, transaction);
      logger.info(
        `[SyncIncomingDocumentModel][STEP 1.2] Mapping hoàn tất -> document_id mới: ${mapped?.document_id}`,
      );

      if (!mapped?.document_id) {
        throw new Error('Mapped document_id is required');
      }

      // 2. Check tồn tại
      const mainTableRef = this.getMainTableRef();
      const existingQuery = `
        SELECT TOP 1 document_id
        FROM ${mainTableRef}
        WHERE id_incoming_bak = @idIncomingBak
      `;

      const existing = await this.queryNewDbTx(
        existingQuery,
        { idIncomingBak: mapped.id_incoming_bak },
        transaction,
      );

      if (existing && existing.length > 0) {
        await this._updateRecord(mapped, transaction);

        return {
          action: 'updated',
          affected: 1,
          documentId: existing[0].document_id,
          drafter: mapped.drafter ?? null,
        };
      }

      await this._insertRecord(mapped, transaction);

      return {
        action: 'inserted',
        affected: 1,
        documentId: mapped.document_id,
        drafter: mapped.drafter ?? null,
      };
    } catch (error) {
      logger.error(`[processSingleRecord] Error ID=${rowData?.ID}: ${error.message}`);
      throw error;
    }
  }

  async _insertRecord(record, transaction) {
    const mainTableRef = this.getMainTableRef();
    const query = `
      INSERT INTO ${mainTableRef} (
        document_id, status_code, created_at, updated_at, book_document_id,
        abstract_note, to_book, sender_unit, receiver_unit,
        document_date, receive_date, to_book_date, deadline, second_book, receive_method,
        private_level, urgency_level, document_type, document_field,
        signer, to_book_code, fileids, status, isStar,
        parent_doc, type_process_doc, bpmn_version, copy_to_internal,
        resolution_deadline, copy_count, page_count, view_group, directive_comment,
        id_incoming_bak, to_book_text_symbols,
        /*
        CoQuanGui2, CoQuanGuiText,
        DonVi, IsLibrary, ItemVBDTCT, ItemVBPH, ItemVBPHOld,
        BanLanhDao, LanhDaoTCT, LanhDaoTCTDaXuLy, LanhDaoTCTDeBiet, LanhDaoVPDN,
        LinhVuc, SoBan, SoTrang, TrichYeu, VanBanTraLoi, ChenSo,
        YKienLanhDao, YKienLanhDaoTCT, YKienLanhDaoVPDN, YKienCuaLDVPChoVanThu,
        ForwardType, ModuleId, SiteName, ListName, ItemId,
        MigrateFlg, YearMonth, MigrateErrFlg, MigrateErrMess,
        TrangThai, ModifiedBy, CreatedBy, DGPId, deadline_reply, table_backup,
        */
        tb_bak, tb_update, stage_status, table_backups
        /* curStatusCode */
      )
      VALUES (
        @document_id, @status_code, ISNULL(@created_at, GETDATE()), GETDATE(), @book_document_id,
        @abstract_note, @to_book, @sender_unit, @receiver_unit,
        @document_date, @receive_date, @to_book_date, @deadline, @second_book, @receive_method,
        @private_level, @urgency_level, @document_type, @document_field,
        @signer, @to_book_code, @fileids, @status, @isStar,
        @parent_doc, @type_process_doc, @bpmn_version, @copy_to_internal,
        @resolution_deadline, @copy_count, @page_count, @view_group, @directive_comment,
        @id_incoming_bak, @to_book_text_symbols,
        /*
        @CoQuanGui2, @CoQuanGuiText,
        @DonVi, @IsLibrary, @ItemVBDTCT, @ItemVBPH, @ItemVBPHOld,
        @BanLanhDao, @LanhDaoTCT, @LanhDaoTCTDaXuLy, @LanhDaoTCTDeBiet, @LanhDaoVPDN,
        @LinhVuc, @SoBan, @SoTrang, @TrichYeu, @VanBanTraLoi, @ChenSo,
        @YKienLanhDao, @YKienLanhDaoTCT, @YKienLanhDaoVPDN, @YKienCuaLDVPChoVanThu,
        @ForwardType, @ModuleId, @SiteName, @ListName, @ItemId,
        @MigrateFlg, @YearMonth, @MigrateErrFlg, @MigrateErrMess,
        @TrangThai, @ModifiedBy, @CreatedBy, @DGPId, @deadline_reply, @table_backup,
        */
        @tb_bak, @tb_update, @stage_status, @table_backups
        /* @curStatusCode */
      )
    `;

    const params = this._mapRecordParams(record);
    await this.queryNewDbTx(query, params, transaction);
  }

  async _updateRecord(record, transaction) {
    const mainTableRef = this.getMainTableRef();
    const query = `
      UPDATE ${mainTableRef}
      SET
        status_code = @status_code,
        updated_at = GETDATE(),
        book_document_id = @book_document_id,
        abstract_note = @abstract_note,
        to_book = @to_book,
        sender_unit = @sender_unit,
        receiver_unit = @receiver_unit,
        document_date = @document_date,
        receive_date = @receive_date,
        to_book_date = @to_book_date,
        deadline = @deadline,
        second_book = @second_book,
        receive_method = @receive_method,
        private_level = @private_level,
        urgency_level = @urgency_level,
        document_type = @document_type,
        document_field = @document_field,
        signer = @signer,
        to_book_code = @to_book_code,
        to_book_text_symbols = @to_book_text_symbols,
        fileids = @fileids,
        status = @status,
        isStar = @isStar,
        parent_doc = @parent_doc,
        type_process_doc = @type_process_doc,
        bpmn_version = @bpmn_version,
        stage_status = @stage_status,
        /* curStatusCode = @curStatusCode, */
        copy_to_internal = @copy_to_internal,
        resolution_deadline = @resolution_deadline,
        copy_count = @copy_count,
        page_count = @page_count,
        view_group = @view_group,
        directive_comment = @directive_comment,
        /* SoVanBan = @SoVanBan, */
        /*
        CoQuanGui2 = @CoQuanGui2,
        CoQuanGuiText = @CoQuanGuiText,
        DonVi = @DonVi,
        IsLibrary = @IsLibrary,
        ItemVBDTCT = @ItemVBDTCT,
        ItemVBPH = @ItemVBPH,
        ItemVBPHOld = @ItemVBPHOld,
        BanLanhDao = @BanLanhDao,
        LanhDaoTCT = @LanhDaoTCT,
        LanhDaoTCTDaXuLy = @LanhDaoTCTDaXuLy,
        LanhDaoTCTDeBiet = @LanhDaoTCTDeBiet,
        LanhDaoVPDN = @LanhDaoVPDN,
        LinhVuc = @LinhVuc,
        SoBan = @SoBan,
        SoTrang = @SoTrang,
        TrichYeu = @TrichYeu,
        VanBanTraLoi = @VanBanTraLoi,
        ChenSo = @ChenSo,
        YKienLanhDao = @YKienLanhDao,
        YKienLanhDaoTCT = @YKienLanhDaoTCT,
        YKienLanhDaoVPDN = @YKienLanhDaoVPDN,
        YKienCuaLDVPChoVanThu = @YKienCuaLDVPChoVanThu,
        ForwardType = @ForwardType,
        ModuleId = @ModuleId,
        SiteName = @SiteName,
        ListName = @ListName,
        ItemId = @ItemId,
        MigrateFlg = @MigrateFlg,
        YearMonth = @YearMonth,
        MigrateErrFlg = @MigrateErrFlg,
        MigrateErrMess = @MigrateErrMess,
        TrangThai = @TrangThai,
        ModifiedBy = @ModifiedBy,
        CreatedBy = @CreatedBy,
        DGPId = @DGPId,
        deadline_reply = @deadline_reply,
        table_backup = @table_backup,
        */
        tb_bak = @tb_bak,
        tb_update = @tb_update,
        table_backups = @table_backups
        /*
        status_code_bef_test = @status_code_bef_test,
        sender_unit_bef_test = @sender_unit_bef_test,
        receiver_unit_bef_test = @receiver_unit_bef_test
        */
      WHERE id_incoming_bak = @id_incoming_bak
    `;

    const params = this._mapRecordParams(record);
    await this.queryNewDbTx(query, params, transaction);
  }

  _mapStatus(trangThai) {
    const safeTrangThai = this.safeString(trangThai);
    const defaultResult = {
      statusCode: String(this.parseStatus(trangThai)),
      bpmnVersion: 'PHUC_DAP_DV',
      stageStatus: 'CHUA_XU_LY',
      curStatusCode: String(this.parseStatus(trangThai)),
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
      logger.warn(`[SyncIncomingDocumentModel] Error parsing STATUS_MAP_INCOMING: ${e.message}`);
    }

    return defaultResult;
  }

  async _mapSingleRecord(oldRecord, transaction) {
    if (!oldRecord?.ID) {
      throw new Error('Old record ID is required');
    }

    const documentType = await this.helper.processDocumentType(
      oldRecord.LoaiVanBan || oldRecord.LoaiBanHanh,
    );

    const urgencyLevel = await this.helper.processUrgencyLevel(oldRecord.DoKhan);
    const privateLevel = await this.helper.processPrivateLevel(oldRecord.DoMat);

    const senderUnit = await this.helper.mapSenderUnitId(
      oldRecord.CoQuanGui2 || oldRecord.CoQuanGui || oldRecord.CoQuanGuiText,
      transaction,
    );

    const drafter = await this.helper.mapUserName(
      oldRecord.CreatedBy || oldRecord.NguoiSoanThaoText,
      transaction,
    );

    const bookDocumentObj = await this.helper.mapBookDocument(
      oldRecord.SoVanBan || oldRecord.SoVanBanText,
      { drafter, senderUnit, privateLevel },
    );

    // Map đơn vị nhận
    const units = this.helper.splitStringSplitBySemicolon(oldRecord.DonVi);
    let receiverUnit = null;
    for (const unit of units) {
      const id = await this.helper.mapSenderUnitId(unit, transaction);
      if (id) {
        receiverUnit = id;
        break;
      }
    }

    if (!receiverUnit) {
      receiverUnit = process.env.DEFAULT_RECEIVER_UNIT_ID || '17736403455966351';
    }

    const statusInfo = this._mapStatus(oldRecord.TrangThai);
    const statusCode = statusInfo.statusCode;
    const bpmnVersion = statusInfo.bpmnVersion;
    const stageStatus = statusInfo.stageStatus;
    const curStatusCode = statusInfo.curStatusCode;

    // Lấy created_at từ Created, fallback sang Modified từ bảng trung gian
    const createdAt = this.safeDate(oldRecord.Created) || this.safeDate(oldRecord.Modified);
    const updatedAt = this.safeDate(oldRecord.Modified) || createdAt;
    const abstractNote = this.safeString(oldRecord.TrichYeu);
    const toBook = bookDocumentObj?.count ?? null;
    const documentDate = this.safeDate(oldRecord.NgayTrenVB);
    const receiveDate = this.safeDate(oldRecord.NgayDen);
    const deadline = this.safeDate(oldRecord.ThoiHanGQ);
    const documentField = await this.helper.processDocumentField(oldRecord.LinhVuc);
    const pageCount = this.safeNumber(oldRecord.SoTrang, null);
    const soBan = this.safeNumber(oldRecord.SoBan, null);

    return {
      // Core fields
      document_id: crypto.randomUUID(),
      drafter: drafter ?? null, // Expose để caller dùng làm fallback cho audit
      status_code: statusCode,
      stage_status: stageStatus,
      // curStatusCode: curStatusCode,
      created_at: createdAt,
      updated_at: updatedAt,
      book_document_id: bookDocumentObj?.id ?? null,
      abstract_note: abstractNote,
      to_book: toBook,
      sender_unit: senderUnit,
      receiver_unit: receiverUnit,
      document_date: documentDate,
      receive_date: receiveDate,
      to_book_date: receiveDate, // Gán tạm bằng ngày đến
      deadline: deadline,
      second_book: null,
      receive_method: null,
      private_level: privateLevel,
      urgency_level: urgencyLevel,
      document_type: documentType,
      document_field: documentField,
      signer: null,
      to_book_code: this.safeString(oldRecord.SoDen),
      to_book_text_symbols: this.safeString(oldRecord.SoDen),
      fileids: this.safeString(oldRecord.Files),
      status: statusCode,
      isStar: 0,
      parent_doc: null,
      type_process_doc: null,
      bpmn_version: bpmnVersion,
      copy_to_internal: null,
      resolution_deadline: null,
      copy_count: null,
      page_count: pageCount,
      view_group: null,
      directive_comment: null,

      // Legacy/backup columns from old database
      // SoVanBan: this.safeString(oldRecord.SoVanBan),
      id_incoming_bak: String(oldRecord.ID),
      /*
            CoQuanGui2: this.safeString(oldRecord.CoQuanGui2),
            CoQuanGuiText: this.safeString(oldRecord.CoQuanGuiText),
            DonVi: this.safeString(oldRecord.DonVi),
            IsLibrary: this.parseBit(oldRecord.IsLibrary),
            ItemVBDTCT: this.safeString(oldRecord.ItemVBDTCT),
            ItemVBPH: this.safeString(oldRecord.ItemVBPH),
            ItemVBPHOld: this.safeString(oldRecord.ItemVBPHOld),
            BanLanhDao: this.safeString(oldRecord.BanLanhDao),
            LanhDaoTCT: this.safeString(oldRecord.LanhDaoTCT),
            LanhDaoTCTDaXuLy: this.safeString(oldRecord.LanhDaoTCTDaXuLy),
            LanhDaoTCTDeBiet: this.safeString(oldRecord.LanhDaoTCTDeBiet),
            LanhDaoVPDN: this.safeString(oldRecord.LanhDaoVPDN),
            LinhVuc: this.safeString(oldRecord.LinhVuc),
            SoBan: soBan,
            SoTrang: pageCount,
            TrichYeu: abstractNote,
            VanBanTraLoi: this.safeString(oldRecord.VanBanTraLoi),
            ChenSo: this.parseBit(oldRecord.ChenSo),
            YKienLanhDao: this.safeString(oldRecord.YKienLanhDao),
            YKienLanhDaoTCT: this.safeString(oldRecord.YKienLanhDaoTCT),
            YKienLanhDaoVPDN: this.safeString(oldRecord.YKienLanhDaoVPDN),
            YKienCuaLDVPChoVanThu: this.safeString(oldRecord.YKienCuaLDVPChoVanThu),
            // ForwardType map truc tiep tu cot cu, luu dang string/number-string.
            ForwardType: this.safeStringOrNumber(oldRecord.ForwardType),
            ModuleId: this.safeNumber(oldRecord.ModuleId, null),
            SiteName: this.safeString(oldRecord.SiteName),
            ListName: this.safeString(oldRecord.ListName),
            ItemId: this.safeNumber(oldRecord.ItemId, null),
            MigrateFlg: this.safeNumber(oldRecord.MigrateFlg, null),
            YearMonth: this.safeString(oldRecord.YearMonth),
            MigrateErrFlg: this.safeNumber(oldRecord.MigrateErrFlg, null),
            MigrateErrMess: this.safeString(oldRecord.MigrateErrMess),
            TrangThai: this.safeString(oldRecord.TrangThai),
            ModifiedBy: this.safeString(oldRecord.ModifiedBy),
            CreatedBy: drafter,
            DGPId: this.safeNumber(oldRecord.DGPId, null),
            deadline_reply: this.safeString(oldRecord.ThoiHanGQ),
            table_backup: 'VanBanDen',
            */
      table_backups: 'VanBanDen',
      tb_bak: 1,
      tb_update: 0,
      /*
            status_code_bef_test: statusCode,
            sender_unit_bef_test: this.safeString(oldRecord.CoQuanGui2 || oldRecord.CoQuanGuiText),
            receiver_unit_bef_test: this.safeString(oldRecord.DonVi),
            */
    };
  }

  _mapRecordParams(record) {
    return {
      // Core fields
      document_id: record.document_id ?? null,
      status_code: record.status_code ?? null,
      created_at: record.created_at ?? null,
      updated_at: record.updated_at ?? null,
      book_document_id: record.book_document_id ?? null,
      abstract_note: record.abstract_note ?? null,
      to_book: record.to_book ?? null,
      sender_unit: record.sender_unit ?? null,
      receiver_unit: record.receiver_unit ?? null,
      document_date: record.document_date ?? null,
      receive_date: record.receive_date ?? null,
      to_book_date: record.to_book_date ?? null,
      deadline: record.deadline ?? null,
      second_book: record.second_book ?? null,
      receive_method: record.receive_method ?? null,
      private_level: record.private_level ?? null,
      urgency_level: record.urgency_level ?? null,
      document_type: record.document_type ?? null,
      document_field: record.document_field ?? null,
      signer: record.signer ?? null,
      to_book_code: record.to_book_code ?? null,
      to_book_text_symbols: record.to_book_text_symbols ?? null,
      fileids: record.fileids ?? null,
      status: record.status ?? 1,
      isStar: record.isStar ?? 0,
      parent_doc: record.parent_doc ?? null,
      type_process_doc: record.type_process_doc ?? null,
      bpmn_version: record.bpmn_version ?? null,
      copy_to_internal: record.copy_to_internal ?? null,
      resolution_deadline: record.resolution_deadline ?? null,
      copy_count: record.copy_count ?? null,
      page_count: record.page_count ?? null,
      view_group: record.view_group ?? null,
      directive_comment: record.directive_comment ?? null,
      stage_status: record.stage_status ?? null,
      // curStatusCode: record.curStatusCode ?? null,
      table_backups: record.table_backups ?? null,

      // Legacy/backup columns
      // SoVanBan: record.SoVanBan ?? null,
      id_incoming_bak: record.id_incoming_bak ?? null,
      /*
            CoQuanGui2: record.CoQuanGui2 ?? null,
            CoQuanGuiText: record.CoQuanGuiText ?? null,
            DonVi: record.DonVi ?? null,
            IsLibrary: record.IsLibrary ?? null,
            ItemVBDTCT: record.ItemVBDTCT ?? null,
            ItemVBPH: record.ItemVBPH ?? null,
            ItemVBPHOld: record.ItemVBPHOld ?? null,
            BanLanhDao: record.BanLanhDao ?? null,
            LanhDaoTCT: record.LanhDaoTCT ?? null,
            LanhDaoTCTDaXuLy: record.LanhDaoTCTDaXuLy ?? null,
            LanhDaoTCTDeBiet: record.LanhDaoTCTDeBiet ?? null,
            LanhDaoVPDN: record.LanhDaoVPDN ?? null,
            LinhVuc: record.LinhVuc ?? null,
            SoBan: record.SoBan ?? null,
            SoTrang: record.SoTrang ?? null,
            TrichYeu: record.TrichYeu ?? null,
            VanBanTraLoi: record.VanBanTraLoi ?? null,
            ChenSo: record.ChenSo ?? null,
            YKienLanhDao: record.YKienLanhDao ?? null,
            YKienLanhDaoTCT: record.YKienLanhDaoTCT ?? null,
            YKienLanhDaoVPDN: record.YKienLanhDaoVPDN ?? null,
            YKienCuaLDVPChoVanThu: record.YKienCuaLDVPChoVanThu ?? null,
            ForwardType: record.ForwardType ?? null,
            ModuleId: record.ModuleId ?? null,
            SiteName: record.SiteName ?? null,
            ListName: record.ListName ?? null,
            ItemId: record.ItemId ?? null,
            MigrateFlg: record.MigrateFlg ?? null,
            YearMonth: record.YearMonth ?? null,
            MigrateErrFlg: record.MigrateErrFlg ?? null,
            MigrateErrMess: record.MigrateErrMess ?? null,
            TrangThai: record.TrangThai ?? null,
            ModifiedBy: record.ModifiedBy ?? null,
            CreatedBy: record.CreatedBy ?? null,
            DGPId: record.DGPId ?? null,
            deadline_reply: record.deadline_reply ?? null,
            table_backup: record.table_backup ?? 'VanBanDen',
            */
      tb_bak: record.tb_bak ?? 0,
      tb_update: record.tb_update ?? 0,
      /*
            status_code_bef_test: record.status_code_bef_test ?? null,
            sender_unit_bef_test: record.sender_unit_bef_test ?? null,
            receiver_unit_bef_test: record.receiver_unit_bef_test ?? null
            */
    };
  }
}

module.exports = SyncIncomingDocumentModel;
