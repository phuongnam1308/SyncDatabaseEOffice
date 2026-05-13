const logger = require('../../../utils/logger');
const dbUtils = require('../../../utils/dbUtils');
const sql = require('mssql');
const fs = require('fs');
const path = require('path');

const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const HtmlFileMigrationModel = require('../migrate/HtmlFileMigrationModel');
const MigrationHelper = require('../../helpers/MigrationHelper');

const DEFAULT_SYNC_TIME = '2100-01-01T00:00:00.000Z';

const SYNC_START_DATE = process.env.SYNC_START_DATE || null;
const SYNC_END_DATE = process.env.SYNC_END_DATE || null;
const SYNC_MIN_DATE = process.env.SYNC_MIN_DATE || '1970-01-01T00:00:00.000Z';

// Load list of databases for Multi-DB scanning
const dbsConfig = require('../../sync-passport/migrate/databases.json');

class StreamNewsAspxPageIncrementalModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_NEWS_ASPX_PAGE_INCREMENTAL' });
    this.newDbName = process.env.NEW_DB_NAME;
    this.newDbSchema = 'dbo';
    this.newTableSync = 'news_aspx_pages_temp';
    this.sharePointDb = process.env.SHAREPOINT_DB_NAME || 'WSS_Content_eoffice_khkd';
    this.dbs = dbsConfig && dbsConfig.length > 0 ? dbsConfig : [this.sharePointDb];

    // local output
    this.outputRoot = process.env.RAW_DOWNLOAD_DIR || process.env.TINTUCRAW_DIR || 'tintucraw';

    // Parser for JSON extraction
    this.htmlParser = new HtmlFileMigrationModel();
    this.migrationHelper = new MigrationHelper(
      (...args) => this.queryNewDbTx(...args),
      (...args) => this.queryOldDb?.(...args) ?? null,
    );
    this.topicIds = [];
    this.topicMap = {};
    this.adminId = null;

    // === DEDUP CACHE: Tránh download cùng URL ảnh nhiều lần ===
    // Key: URL chuẩn hóa -> Value: Promise (in-flight) hoặc { fileId, viewUrl } (đã xong)
    this._imgDownloadCache = new Map();
    // Set lưu các DocId đang được xử lý để tránh race condition giữa các worker
    this._processingDocIds = new Set();
  }

  async initialize() {
    await super.initialize();
    await this.ensureStagingTableExists();

    // Đảm bảo bảng News chính có đầy đủ các cột cần thiết
    try {
      await this.queryNewDb(`
            -- 1. Đảm bảo cột tóm tắt (summary) đủ lớn để không bị truncated
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news' AND COLUMN_NAME = 'summary')
                ALTER TABLE dbo.news ADD summary NVARCHAR(MAX) NULL;
            ELSE
                ALTER TABLE dbo.news ALTER COLUMN summary NVARCHAR(MAX) NULL;

            -- 2. Đảm bảo các cột tiêu đề/tags cũng đủ lớn
            IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news' AND COLUMN_NAME = 'title')
                ALTER TABLE dbo.news ALTER COLUMN title NVARCHAR(500) NULL;
            IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news' AND COLUMN_NAME = 'tags')
                ALTER TABLE dbo.news ALTER COLUMN tags NVARCHAR(MAX) NULL;

            -- 3. Cột phòng ban tác giả
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news' AND COLUMN_NAME = 'authorDepartment')
                ALTER TABLE dbo.news ADD authorDepartment NVARCHAR(255) NULL;
            ELSE
                ALTER TABLE dbo.news ALTER COLUMN authorDepartment NVARCHAR(255) NULL;

            -- 4. Các trường khác
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news' AND COLUMN_NAME = 'isBak')
                ALTER TABLE dbo.news ADD isBak INT DEFAULT 0;
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news' AND COLUMN_NAME = 'nameThumbnail')
                ALTER TABLE dbo.news ADD nameThumbnail NVARCHAR(500) NULL;
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news' AND COLUMN_NAME = 'topic')
                ALTER TABLE dbo.news ADD topic NVARCHAR(255) NULL;
            -- 4. Cập nhật các cột ID sang NVARCHAR để tránh lỗi Conversion failed (uniqueidentifier)
            IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news' AND COLUMN_NAME = 'authorId' AND DATA_TYPE = 'uniqueidentifier')
                ALTER TABLE dbo.news ALTER COLUMN authorId NVARCHAR(100) NULL;
            IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news' AND COLUMN_NAME = 'DocId' AND DATA_TYPE = 'uniqueidentifier')
                ALTER TABLE dbo.news ALTER COLUMN DocId NVARCHAR(100) NULL;
            IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news' AND COLUMN_NAME = 'topic' AND DATA_TYPE = 'uniqueidentifier')
                ALTER TABLE dbo.news ALTER COLUMN topic NVARCHAR(255) NULL;
            IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news' AND COLUMN_NAME = 'reviewerId' AND DATA_TYPE = 'uniqueidentifier')
                ALTER TABLE dbo.news ALTER COLUMN reviewerId NVARCHAR(100) NULL;

            -- 5. Đảm bảo cột DocId tồn tại
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news' AND COLUMN_NAME = 'DocId')
                ALTER TABLE dbo.news ADD DocId NVARCHAR(100) NULL;

            -- 6. Cột người tạo (created_by)
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news' AND COLUMN_NAME = 'created_by')
                ALTER TABLE dbo.news ADD created_by NVARCHAR(100) NULL;

            -- 7. Cột mã nhân viên tác giả (authorCode)
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news' AND COLUMN_NAME = 'authorCode')
                ALTER TABLE dbo.news ADD authorCode NVARCHAR(255) NULL;

            -- 8. Đảm bảo bảng topics có các cột cần thiết cho migration
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'topics' AND COLUMN_NAME = 'tb_bak')
                ALTER TABLE dbo.topics ADD tb_bak INT DEFAULT 0;
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'topics' AND COLUMN_NAME = 'href')
                ALTER TABLE dbo.topics ADD href NVARCHAR(255) NULL;
        `);
      logger.info(
        '[StreamNewsAspxPageIncrementalModel] Schema widened (NVARCHAR(MAX)) for dbo.news.',
      );
    } catch (e) {
      logger.warn(
        `[StreamNewsAspxPageIncrementalModel] Lỗi khi mở rộng schema bảng news: ${e.message}`,
      );
    }

    // Link parser to the same pool
    this.htmlParser.newPool = this.newPool;
    await this.htmlParser.ensureSyncTableExists();

    // Lấy danh sách topicId từ DB mới để random giống Social Sync
    try {
      const rows = await this.queryNewDb(
        `SELECT id FROM ${this.newDbName}.dbo.topics WHERE status = 1 OR status IS NULL`,
      );
      this.topicIds = rows.map((r) => String(r.id));
      console.log(`[StreamNewsAspxPageIncrementalModel] Loaded ${this.topicIds.length} topic IDs.`);

      const adminRows = await this.queryNewDb(
        `SELECT id FROM ${this.newDbName}.dbo.users WHERE username = 'admin-tancang'`,
      );
      if (adminRows && adminRows.length > 0) {
        this.adminId = adminRows[0].id;
        logger.info(`[StreamNewsAspxPageIncrementalModel] Loaded admin ID: ${this.adminId}`);
      } else {
        // Fallback: Lấy user đầu tiên có ID dạng GUID để tránh lỗi uniqueidentifier conversion
        const fallbackRows = await this.queryNewDb(
          `SELECT TOP 1 id FROM ${this.newDbName}.dbo.users`,
        );
        this.adminId = fallbackRows?.[0]?.id || null;
        if (this.adminId) {
          logger.warn(
            `[StreamNewsAspxPageIncrementalModel] 'admin-tancang' not found, fallback to first user ID: ${this.adminId}`,
          );
        } else {
          logger.error(
            '[StreamNewsAspxPageIncrementalModel] No users found in new DB! Sync might fail if authorId is required.',
          );
        }
      }
    } catch (error) {
      console.error(
        '[StreamNewsAspxPageIncrementalModel] Failed to load topics/admin:',
        error.message,
      );
    }
  }

  getStagingTableRef() {
    if (this.newDbName) return `${this.newDbName}.${this.newDbSchema}.${this.newTableSync}`;
    return `${this.newDbSchema}.${this.newTableSync}`;
  }

  isCursorAhead(aTime, aId, bTime, bId) {
    const ta = new Date(aTime || DEFAULT_SYNC_TIME).getTime();
    const tb = new Date(bTime || DEFAULT_SYNC_TIME).getTime();
    // Chế độ DESC: "Đi trước" nghĩa là cũ hơn
    if (ta < tb) return true;
    if (ta > tb) return false;
    return Number(aId || 0) < Number(bId || 0);
  }

  normalizeSyncTime(value, lookbackHours = 0) {
    if (!value) return DEFAULT_SYNC_TIME;
    const dateValue = new Date(value);
    if (Number.isNaN(dateValue.getTime())) return DEFAULT_SYNC_TIME;
    // Nếu là ngày quá cũ (mặc định ban đầu), coi như chưa đồng bộ
    if (dateValue.getFullYear() <= 1970) return DEFAULT_SYNC_TIME;

    // Nếu có yêu cầu quét lùi (lookback)
    if (lookbackHours > 0) {
      dateValue.setTime(dateValue.getTime() - lookbackHours * 3600 * 1000);
    }

    return dateValue.toISOString();
  }

  /**
   * Lấy mốc thời gian và ID lớn nhất hiện có trong bảng trung gian.
   */
  async getMaxStagedTime() {
    const table = this.getStagingTableRef();
    try {
      const query = `
            SELECT TOP 1 TimeLastModified, __sync_id
            FROM ${table}
            ORDER BY TimeLastModified DESC, __sync_id DESC
        `;
      const rows = await this.queryNewDb(query);
      if (rows && rows.length > 0) {
        return {
          maxTime: new Date(rows[0].TimeLastModified).toISOString(),
          maxId: Number(rows[0].__sync_id || 0),
        };
      }
      return null;
    } catch (e) {
      logger.warn(
        `[StreamNewsAspxPageIncrementalModel] Lỗi khi lấy maxTime từ Staging: ${e.message}`,
      );
      return null;
    }
  }

  /**
   * Lấy mốc thời gian và ID nhỏ nhất hiện có trong bảng trung gian (Dùng để kéo lùi về quá khứ)
   */
  async getMinStagedTime() {
    const table = this.getStagingTableRef();
    try {
      const query = `
            SELECT TOP 1 TimeLastModified, __sync_id
            FROM ${table}
            ORDER BY TimeLastModified ASC, __sync_id ASC
        `;
      const rows = await this.queryNewDb(query);
      if (rows && rows.length > 0) {
        return {
          minTime: new Date(rows[0].TimeLastModified).toISOString(),
          minId: Number(rows[0].__sync_id || 0),
        };
      }
      return null;
    } catch (e) {
      logger.warn(
        `[StreamNewsAspxPageIncrementalModel] Lỗi khi lấy minTime từ Staging: ${e.message}`,
      );
      return null;
    }
  }

  /**
   * Tạo BIGINT deterministic từ GUID để làm tie-breaker (vì SyncManager lưu lastSyncId là number).
   */
  getSyncIdExpression() {
    return `
      (
        ABS(
          CAST(
            SUBSTRING(
              HASHBYTES('SHA1', CONVERT(nvarchar(36), d.[Id])),
              1,
              8
            ) AS bigint
          )
        ) % CAST(9007199254740991 AS bigint)
      )
    `;
  }

  /**
   * SyncManager sẽ gọi countFn để set `total_to_sync` (hiển thị dashboard).
   * Mặc định countFn sẽ fetch list rồi lấy length (rất nặng và sẽ ra ~18k).
   * Implement getCount để:
   * - COUNT(*) nhẹ hơn
   * - và quan trọng: cap theo COMPLETED_LIMIT để 1 job chỉ hiện/process đúng limit mày set.
   */
  async getCount(lastSyncTime, lastSyncId = 0, { useLimit = true, lookbackHours = 0 } = {}) {
    // Nếu là đồng bộ tăng trưởng (ASC), ta áp dụng lookback để tránh sót bài viết bị sửa đổi
    const actualLookback = lastSyncTime !== DEFAULT_SYNC_TIME ? lookbackHours : 0;
    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime, actualLookback);
    const normalizedLastSyncId = Number(lastSyncId || 0);
    const limit = useLimit ? Number(process.env.COMPLETED_LIMIT || 0) : 0;

    const syncIdExpr = this.getSyncIdExpression();
    const isFirstRun = normalizedLastSyncTime === '2100-01-01T00:00:00.000Z';
    const filterClause = isFirstRun
      ? '1=1'
      : `( __sync_time < CAST(@lastSyncTime AS DATETIME2)
           OR ( __sync_time = CAST(@lastSyncTime AS DATETIME2)
                AND __sync_id < CAST(@lastSyncId AS bigint) ) )`;

    let totalAllDbs = 0;

    for (const db of this.dbs) {
      const query = `
        ;WITH src AS (
          SELECT
            d.[TimeLastModified] AS __sync_time,
            ${syncIdExpr}        AS __sync_id
          FROM [${db}].[dbo].[AllDocs] d
          INNER JOIN [${db}].[dbo].[AllWebs] w
            ON d.[SiteId] = w.[SiteId] AND d.[WebId]  = w.[Id]
          LEFT JOIN [${db}].[dbo].[AllLists] l
            ON d.[SiteId]  = l.[tp_SiteId] AND d.[ListId] = l.[tp_ID]
          WHERE
            d.[DeleteTransactionId] = 0x0
            AND d.[IsCurrentVersion] = 1
            AND w.[FullUrl] LIKE '%tintuc%'
            AND d.[LeafName] LIKE '%.aspx'
            AND l.[tp_Title] LIKE '%Pages%'
            AND (d.[TimeCreated] >= @startDate OR @startDate IS NULL)
            AND (d.[TimeCreated] <= @endDate OR @endDate IS NULL)
            AND d.[TimeLastModified] >= '${SYNC_MIN_DATE}'
        )
        SELECT COUNT(1) AS total
        FROM src
        WHERE ${filterClause}
      `;

      try {
        const rows = await this.queryOldDb(query, {
          lastSyncTime: normalizedLastSyncTime,
          lastSyncId: normalizedLastSyncId,
          startDate: SYNC_START_DATE,
          endDate: SYNC_END_DATE,
        });

        const dbTotal = rows?.[0]?.total || 0;
        totalAllDbs += dbTotal;
      } catch (err) {
        logger.warn(
          `[StreamNewsAspxPageIncrementalModel] [getCount] Lỗi khi đếm tại DB ${db}: ${err.message}`,
        );
      }
    }

    // Nếu limit = 0 thì không chặn (chạy full)
    return limit > 0 ? Math.min(totalAllDbs, limit) : totalAllDbs;
  }

  async ensureStagingTableExists() {
    const table = this.getStagingTableRef();
    const query = `
      IF OBJECT_ID('${table}', 'U') IS NULL
      BEGIN
        CREATE TABLE ${table} (
          DocId              UNIQUEIDENTIFIER NOT NULL,
          DirName            NVARCHAR(512) NULL,
          LeafName           NVARCHAR(512) NULL,
          DocType            INT NULL,
          Size               BIGINT NULL,
          TimeCreated        DATETIME2 NULL,
          TimeLastModified   DATETIME2 NULL,
          UIVersionString    NVARCHAR(50) NULL,
          Level              INT NULL,
          WebUrl             NVARCHAR(2048) NULL,
          WebTitle           NVARCHAR(512) NULL,
          Language           INT NULL,
          ListTitle          NVARCHAR(512) NULL,
          tp_ServerTemplate  INT NULL,
          ListDescription    NVARCHAR(MAX) NULL,

          DocPath            NVARCHAR(2048) NULL,
          FullPageUrl        NVARCHAR(2048) NULL,
          LocalFilePath      NVARCHAR(2048) NULL,
          DownloadedAt       DATETIME2 NULL,
          DownloadStatus     NVARCHAR(50) NULL,
          DownloadError      NVARCHAR(MAX) NULL,
          __sync_id          BIGINT NULL,
          source_db          NVARCHAR(255) NULL,

          CONSTRAINT PK_news_aspx_pages_temp PRIMARY KEY (DocId)
        );
      END

      -- Add missing columns (idempotent)
      IF COL_LENGTH('${table}', '__sync_id') IS NULL
        ALTER TABLE ${table} ADD __sync_id BIGINT NULL;

      IF COL_LENGTH('${table}', 'source_db') IS NULL
        ALTER TABLE ${table} ADD source_db NVARCHAR(255) NULL;

      -- Cột theo dõi lỗi
      IF COL_LENGTH('${table}', 'MigrateFlg') IS NULL
        ALTER TABLE ${table} ADD MigrateFlg INT DEFAULT 0;
      IF COL_LENGTH('${table}', 'MigrateErrFlg') IS NULL
        ALTER TABLE ${table} ADD MigrateErrFlg INT DEFAULT 0;
      IF COL_LENGTH('${table}', 'MigrateErrMess') IS NULL
        ALTER TABLE ${table} ADD MigrateErrMess NVARCHAR(MAX) NULL;

      -- Add missing columns (idempotent)
      IF COL_LENGTH('${table}', 'DocId') IS NULL
        ALTER TABLE ${table} ADD DocId UNIQUEIDENTIFIER NULL;
      IF COL_LENGTH('${table}', 'DirName') IS NULL
        ALTER TABLE ${table} ADD DirName NVARCHAR(512) NULL;
      IF COL_LENGTH('${table}', 'LeafName') IS NULL
        ALTER TABLE ${table} ADD LeafName NVARCHAR(512) NULL;
      IF COL_LENGTH('${table}', 'DocType') IS NULL
        ALTER TABLE ${table} ADD DocType INT NULL;
      IF COL_LENGTH('${table}', 'Size') IS NULL
        ALTER TABLE ${table} ADD Size BIGINT NULL;
      IF COL_LENGTH('${table}', 'TimeCreated') IS NULL
        ALTER TABLE ${table} ADD TimeCreated DATETIME2 NULL;
      IF COL_LENGTH('${table}', 'TimeLastModified') IS NULL
        ALTER TABLE ${table} ADD TimeLastModified DATETIME2 NULL;
      IF COL_LENGTH('${table}', 'UIVersionString') IS NULL
        ALTER TABLE ${table} ADD UIVersionString NVARCHAR(50) NULL;
      IF COL_LENGTH('${table}', 'Level') IS NULL
        ALTER TABLE ${table} ADD Level INT NULL;
      IF COL_LENGTH('${table}', 'WebUrl') IS NULL
        ALTER TABLE ${table} ADD WebUrl NVARCHAR(2048) NULL;
      IF COL_LENGTH('${table}', 'WebTitle') IS NULL
        ALTER TABLE ${table} ADD WebTitle NVARCHAR(512) NULL;
      IF COL_LENGTH('${table}', 'Language') IS NULL
        ALTER TABLE ${table} ADD Language INT NULL;
      IF COL_LENGTH('${table}', 'ListTitle') IS NULL
        ALTER TABLE ${table} ADD ListTitle NVARCHAR(512) NULL;
      IF COL_LENGTH('${table}', 'tp_ServerTemplate') IS NULL
        ALTER TABLE ${table} ADD tp_ServerTemplate INT NULL;
      IF COL_LENGTH('${table}', 'ListDescription') IS NULL
        ALTER TABLE ${table} ADD ListDescription NVARCHAR(MAX) NULL;

      IF COL_LENGTH('${table}', 'DocPath') IS NULL
        ALTER TABLE ${table} ADD DocPath NVARCHAR(2048) NULL;
      IF COL_LENGTH('${table}', 'FullPageUrl') IS NULL
        ALTER TABLE ${table} ADD FullPageUrl NVARCHAR(2048) NULL;
      IF COL_LENGTH('${table}', 'LocalFilePath') IS NULL
        ALTER TABLE ${table} ADD LocalFilePath NVARCHAR(2048) NULL;
      IF COL_LENGTH('${table}', 'DownloadedAt') IS NULL
        ALTER TABLE ${table} ADD DownloadedAt DATETIME2 NULL;
      IF COL_LENGTH('${table}', 'DownloadStatus') IS NULL
        ALTER TABLE ${table} ADD DownloadStatus NVARCHAR(50) NULL;
      IF COL_LENGTH('${table}', 'DownloadError') IS NULL
        ALTER TABLE ${table} ADD DownloadError NVARCHAR(MAX) NULL;

      -- Widen SYSTEM columns to BIGINT to support large sync IDs (news hash IDs)
      -- This fixes the "Arithmetic overflow error converting numeric to data type numeric"
      IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'sync_models' AND COLUMN_NAME = 'last_sync_id' AND DATA_TYPE <> 'bigint')
        ALTER TABLE sync_models ALTER COLUMN last_sync_id BIGINT NULL;
      IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'sync_models' AND COLUMN_NAME = 'total_synced' AND DATA_TYPE <> 'bigint')
        ALTER TABLE sync_models ALTER COLUMN total_synced BIGINT NULL;

      IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'sync_jobs' AND COLUMN_NAME = 'last_sync_id' AND DATA_TYPE <> 'bigint')
        ALTER TABLE sync_jobs ALTER COLUMN last_sync_id BIGINT NULL;
      IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'sync_jobs' AND COLUMN_NAME = 'total_to_sync' AND DATA_TYPE <> 'bigint')
        ALTER TABLE sync_jobs ALTER COLUMN total_to_sync BIGINT NULL;
      IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'sync_jobs' AND COLUMN_NAME = 'total_processed' AND DATA_TYPE <> 'bigint')
        ALTER TABLE sync_jobs ALTER COLUMN total_processed BIGINT NULL;
      IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'sync_jobs' AND COLUMN_NAME = 'total_success' AND DATA_TYPE <> 'bigint')
        ALTER TABLE sync_jobs ALTER COLUMN total_success BIGINT NULL;

      -- Widen NVARCHAR columns to expected sizes where needed (safe changes)
      BEGIN TRY
        IF COL_LENGTH('${table}', 'DirName') IS NOT NULL
          ALTER TABLE ${table} ALTER COLUMN DirName NVARCHAR(512) NULL;
      END TRY BEGIN CATCH END CATCH;

      BEGIN TRY
        IF COL_LENGTH('${table}', 'LeafName') IS NOT NULL
          ALTER TABLE ${table} ALTER COLUMN LeafName NVARCHAR(512) NULL;
      END TRY BEGIN CATCH END CATCH;

      BEGIN TRY
        IF COL_LENGTH('${table}', 'WebUrl') IS NOT NULL
          ALTER TABLE ${table} ALTER COLUMN WebUrl NVARCHAR(2048) NULL;
      END TRY BEGIN CATCH END CATCH;

      BEGIN TRY
        IF COL_LENGTH('${table}', 'DocPath') IS NOT NULL
          ALTER TABLE ${table} ALTER COLUMN DocPath NVARCHAR(2048) NULL;
      END TRY BEGIN CATCH END CATCH;

      BEGIN TRY
        IF COL_LENGTH('${table}', 'FullPageUrl') IS NOT NULL
          ALTER TABLE ${table} ALTER COLUMN FullPageUrl NVARCHAR(2048) NULL;
      END TRY BEGIN CATCH END CATCH;

      BEGIN TRY
        IF COL_LENGTH('${table}', 'LocalFilePath') IS NOT NULL
          ALTER TABLE ${table} ALTER COLUMN LocalFilePath NVARCHAR(2048) NULL;
      END TRY BEGIN CATCH END CATCH;

      -- Ensure PK exists (non-destructive; may fail if duplicates/nulls)
      IF NOT EXISTS (
        SELECT 1
        FROM sys.key_constraints kc
        WHERE kc.[type] = 'PK'
          AND kc.[name] = 'PK_news_aspx_pages_temp'
      )
      BEGIN
        BEGIN TRY
          ALTER TABLE ${table} ADD CONSTRAINT PK_news_aspx_pages_temp PRIMARY KEY (DocId);
        END TRY
        BEGIN CATCH
          -- ignore; table might already have another PK or invalid data
        END CATCH
      END

      -- Ensure index exists
      IF NOT EXISTS (
        SELECT 1
        FROM sys.indexes
        WHERE [name] = 'IX_news_aspx_pages_temp_sync'
          AND object_id = OBJECT_ID('${table}')
      )
      BEGIN
        CREATE INDEX IX_news_aspx_pages_temp_sync
          ON ${table}(TimeLastModified, __sync_id, DocId);
      END

      -- Create explicit error log table
      IF OBJECT_ID('dbo.news_aspx_download_errors', 'U') IS NULL
      BEGIN
        CREATE TABLE dbo.news_aspx_download_errors (
          Id                 INT IDENTITY(1,1) PRIMARY KEY,
          DocId              UNIQUEIDENTIFIER NULL,
          LeafName           NVARCHAR(512) NULL,
          FullPageUrl        NVARCHAR(2048) NULL,
          LocalFilePath      NVARCHAR(2048) NULL,
          ErrorMessage       NVARCHAR(MAX) NULL,
          AttemptCount       INT NULL,
          CreatedAt          DATETIME2 DEFAULT GETDATE()
        );
      END
    `;

    await this.queryNewDb(query);

    // === CLEANUP: Reset các row bị kẹt 'PROCESSING' khi tool bị tắt giữa chừng ===
    // Nếu row này đang 'PROCESSING' mà đã quá 10 phút -> Reset về NULL để worker khác tiếp quản
    try {
      const resetResult = await this.queryNewDb(`
        UPDATE ${this.getStagingTableRef()}
        SET DownloadStatus = NULL
        WHERE DownloadStatus = 'PROCESSING'
          AND DownloadedAt IS NULL
          AND (TimeLastModified IS NULL OR DATEDIFF(MINUTE, TimeLastModified, GETDATE()) > 0)
      `);
      logger.info('[StreamNewsAspxPageIncrementalModel] Đã reset các row bị kẹt PROCESSING từ phiên cũ.');
    } catch (e) {
      logger.warn(`[StreamNewsAspxPageIncrementalModel] Không thể reset stuck PROCESSING rows: ${e.message}`);
    }
  }

  buildDocPath(row) {
    const dir = String(row?.DirName || '')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
    const leaf = String(row?.LeafName || '').replace(/^\/+/, '');
    if (!dir && !leaf) return '';
    if (!dir) return leaf;
    if (!leaf) return dir;
    return `${dir}/${leaf}`;
  }

  buildFullPageUrl(docPath) {
    const baseUrl = String(process.env.BASE_URL || '').replace(/\/$/, '');
    const p = String(docPath || '').replace(/^\/+/, '');
    if (!baseUrl || !p) return '';
    return `${baseUrl}/${p}`;
  }


  buildLocalFilePath(docPath) {
    const safeRel = String(docPath || '')
      .split('?')[0]          // === FIX: Strip query string (?InitialTabId=Ribbon.Read...)
      .replace(/^\/+/, '')
      .replace(/[:*?"<>|]/g, '_');
    return path.join(process.cwd(), this.outputRoot, safeRel);
  }

  ensureLocalDirForFile(absFilePath) {
    const dir = path.dirname(absFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.info(`[Downloader] Đã tự động tạo thư mục: ${dir}`);
    }
  }

  async fetchListFromOldDb(
    lastSyncTime,
    lastSyncId = 0,
    take = null,
    offset = null,
    direction = 'DESC',
    dbName = null,
  ) {
    const targetDb = dbName || this.sharePointDb;
    const syncIdExpr = this.getSyncIdExpression();
    const safeTake = Number.isFinite(Number(take)) && Number(take) > 0 ? Number(take) : null;
    const safeOffset = Number.isFinite(Number(offset)) && Number(offset) >= 0 ? Number(offset) : 0;

    const isAsc = direction.toUpperCase() === 'ASC';

    // Logic so sánh tùy theo hướng đồng bộ
    // DESC: Lấy những cái CŨ hơn cursor (Quét về quá khứ)
    // ASC: Lấy những cái MỚI hơn cursor (Đồng bộ lũy tiến)
    const compareOp = isAsc ? '>' : '<';
    const sortDir = isAsc ? 'ASC' : 'DESC';

    logger.debug(
      `[StreamNewsAspxPageIncrementalModel] fetchListFromOldDb [${targetDb}]: lastSyncTime=${lastSyncTime}, lastSyncId=${lastSyncId}, direction=${direction}, take=${safeTake}`,
    );

    // Dùng JS loại bỏ logic cồng kềnh, ép SQL chuẩn hóa kiểu DATETIME2 để tránh lỗi so sánh
    const isFirstRun =
      (isAsc && lastSyncTime === '1900-01-01T00:00:00.000Z') ||
      (!isAsc && lastSyncTime === '2100-01-01T00:00:00.000Z');
    const filterClause = isFirstRun
      ? '1=1'
      : `( __sync_time ${compareOp} CAST(@lastSyncTime AS DATETIME2)
           OR ( __sync_time = CAST(@lastSyncTime AS DATETIME2)
                AND __sync_id ${compareOp} CAST(@lastSyncId AS bigint) ) )`;

    const query = `
      ;WITH src AS (
        SELECT
          d.[Id]               AS DocId,
          d.[DirName],
          d.[LeafName],
          d.[Type]             AS DocType,
          d.[Size],
          d.[TimeCreated],
          d.[TimeLastModified],
          d.[UIVersionString],
          d.[Level],
          w.[FullUrl]          AS WebUrl,
          w.[Title]            AS WebTitle,
          w.[Language],
          l.[tp_Title]         AS ListTitle,
          l.[tp_ServerTemplate],
          l.[tp_Description]   AS ListDescription,
          d.[TimeLastModified] AS __sync_time,
          ${syncIdExpr}        AS __sync_id
        FROM [${targetDb}].[dbo].[AllDocs] d
        INNER JOIN [${targetDb}].[dbo].[AllWebs] w
          ON d.[SiteId] = w.[SiteId] AND d.[WebId]  = w.[Id]
        LEFT JOIN [${targetDb}].[dbo].[AllLists] l
          ON d.[SiteId]  = l.[tp_SiteId] AND d.[ListId] = l.[tp_ID]
        WHERE
          d.[DeleteTransactionId] = 0x0
          AND d.[IsCurrentVersion] = 1
          AND w.[FullUrl] LIKE '%tintuc%'
          AND l.[tp_Title] LIKE '%Pages%'
          AND (d.[TimeCreated] >= @startDate OR @startDate IS NULL)
          AND (d.[TimeCreated] <= @endDate OR @endDate IS NULL)
          AND (d.[TimeLastModified] >= '${SYNC_MIN_DATE}')
      ),
      paged_src AS (
        SELECT *,
          ROW_NUMBER() OVER (
            ORDER BY
              __sync_time ${sortDir},
              __sync_id ${sortDir},
              DocId ${sortDir}
          ) AS __page_rn
        FROM src
        WHERE ${filterClause}
      )
      SELECT *
      FROM paged_src
      WHERE 1=1
      ${safeTake ? 'AND __page_rn > @offset AND __page_rn <= (@offset + @take)' : ''}
      ORDER BY __page_rn
    `;

    const resultRows = await this.queryOldDb(query, {
      lastSyncTime: lastSyncTime,
      lastSyncId: lastSyncId,
      take: safeTake,
      offset: safeOffset,
      startDate: SYNC_START_DATE,
      endDate: SYNC_END_DATE,
    });
    return resultRows;
  }

  async syncOldToStaging(rows, { transaction, dbName } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return { stagedCount: 0 };
    const table = this.getStagingTableRef();
    const sourceDb = dbName || this.sharePointDb;

    let count = 0;
    for (const row of rows) {
      const docPath = this.buildDocPath(row);
      const fullUrl = this.buildFullPageUrl(docPath);
      const localPath = this.buildLocalFilePath(docPath);

      const params = {
        DocId: row?.DocId ? String(row.DocId) : null,
        DirName: row?.DirName ?? null,
        LeafName: row?.LeafName ?? null,
        DocType: row?.DocType ?? null,
        Size: row?.Size ?? null,
        TimeCreated: row?.TimeCreated ?? null,
        TimeLastModified: row?.TimeLastModified ?? null,
        UIVersionString: row?.UIVersionString ?? null,
        Level: row?.Level ?? null,
        WebUrl: row?.WebUrl ?? null,
        WebTitle: row?.WebTitle ?? null,
        Language: row?.Language ?? null,
        ListTitle: row?.ListTitle ?? null,
        tp_ServerTemplate: row?.tp_ServerTemplate ?? null,
        ListDescription: row?.ListDescription ?? null,
        DocPath: docPath || null,
        FullPageUrl: fullUrl || null,
        LocalFilePath: localPath || null,
        __sync_id: Number(row?.__sync_id || 0),
        source_db: sourceDb,
      };

      const q = `
        IF EXISTS (SELECT 1 FROM ${table} WHERE DocId = @DocId)
        BEGIN
            -- Cập nhật nếu có thay đổi về thời gian hoặc chưa được tải thành công
            UPDATE ${table} SET
                DirName = @DirName,
                LeafName = @LeafName,
                DocType = @DocType,
                Size = @Size,
                TimeCreated = @TimeCreated,
                TimeLastModified = @TimeLastModified,
                UIVersionString = @UIVersionString,
                Level = @Level,
                WebUrl = @WebUrl,
                WebTitle = @WebTitle,
                Language = @Language,
                ListTitle = @ListTitle,
                tp_ServerTemplate = @tp_ServerTemplate,
                ListDescription = @ListDescription,
                DocPath = @DocPath,
                FullPageUrl = @FullPageUrl,
                LocalFilePath = @LocalFilePath,
                __sync_id = @__sync_id,
                source_db = @source_db,
                -- Reset trạng thái download nếu bản tin nguồn mới hơn bản tin hiện tại trong staging
                DownloadStatus = CASE
                    WHEN @TimeLastModified > TimeLastModified OR DownloadStatus IS NULL THEN NULL
                    ELSE DownloadStatus
                END,
                DownloadedAt = CASE
                    WHEN @TimeLastModified > TimeLastModified THEN NULL
                    ELSE DownloadedAt
                END
            WHERE DocId = @DocId;
        END
        ELSE
        BEGIN
            INSERT INTO ${table} (
                DocId, DirName, LeafName, DocType, Size,
                TimeCreated, TimeLastModified, UIVersionString, Level,
                WebUrl, WebTitle, Language, ListTitle, tp_ServerTemplate, ListDescription,
                DocPath, FullPageUrl, LocalFilePath, __sync_id, source_db
            ) VALUES (
                @DocId, @DirName, @LeafName, @DocType, @Size,
                @TimeCreated, @TimeLastModified, @UIVersionString, @Level,
                @WebUrl, @WebTitle, @Language, @ListTitle, @tp_ServerTemplate, @ListDescription,
                @DocPath, @FullPageUrl, @LocalFilePath, @__sync_id, @source_db
            );
        END
      `;

      await this.queryNewDbTx(q, params, transaction);
      count++;
    }

    return { stagedCount: count };
  }

  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    if (!syncJobId) throw new Error('syncJobId is required');

    let stageBatchSize = Number(
      process.env.TINTUC_STAGE_BATCH_SIZE || process.env.COMPLETED_LIMIT || 500,
    );
    if (!stageBatchSize || stageBatchSize <= 0) stageBatchSize = 500;
    // Số giờ quét lùi đọc từ biến môi trường (mặc định 24 giờ)
    const lookbackHours = Number(process.env.TINTUC_LOOKBACK_HOURS || 24);

    // 0. CẬP NHẬT TỔNG SỐ BẢN GHI ĐỂ DASHBOARD HIỂN THỊ NGAY
    // QUAN TRỌNG: Khi gọi getCount để lấy total_to_sync, ta áp dụng lookback (nếu không phải chạy lại từ đầu)
    const totalToSync = await this.getCount(lastSyncTime, lastSyncId, {
      useLimit: true,
      lookbackHours,
    });
    logger.info(
      `[StreamNewsAspxPageIncrementalModel] Tổng số bản ghi (News) cần đồng bộ (áp dụng lookback ${lookbackHours}h): ${totalToSync}`,
    );
    await this.queryNewDb(`UPDATE sync_jobs SET total_to_sync = @total WHERE job_id = @jobId`, {
      total: totalToSync,
      jobId: syncJobId,
    });

    // =========================================================================
    // BUOC 0.5: THU LAI CAC BAI BI LOI TIMEOUT (RETRY_WAITING) - CHAY SONG SONG
    // =========================================================================
    await this.retryFailedParallel(syncJobId);

    // =========================================================================
    const runPhase1 = async () => {
      let p1Staged = 0;
      let p1Rows = 0;
      const maxCursor = await this.getMaxStagedTime();
      let currentSyncTime = maxCursor ? maxCursor.maxTime : null;
      let currentSyncId = maxCursor ? maxCursor.maxId : 0;
      const startSyncTime = currentSyncTime || '1900-01-01T00:00:00.000Z';
      const startSyncId = currentSyncId;

      // FIX LOOKBACK: Tính cursor xuất phát thực tế cho Phase 1.
      const isFirstRun = lastSyncTime === DEFAULT_SYNC_TIME || !lastSyncTime;
      const jobCursorWithLookback = isFirstRun
        ? '1900-01-01T00:00:00.000Z'
        : this.normalizeSyncTime(lastSyncTime, lookbackHours);

      let p1StartTime = startSyncTime;
      let p1StartId = startSyncId;
      if (!isFirstRun && jobCursorWithLookback < startSyncTime) {
        p1StartTime = jobCursorWithLookback;
        p1StartId = 0;
        logger.info(
          `🕐 [PHASE 1 - LOOKBACK] Áp dụng lookback: cursor xuất phát từ ${p1StartTime} (lastSyncTime=${lastSyncTime} - ${lookbackHours}h) thay vì maxStaged=${startSyncTime}`,
        );
      }

      let nextP1Time = p1StartTime;
      let nextP1Id = p1StartId;

      if (currentSyncTime || !isFirstRun) {
        logger.info(`🚀 [PHASE 1 - NEW] Kéo bài viết mới/đã sửa từ cursor: ${p1StartTime} 🚀`);

        for (const db of this.dbs) {
          logger.info(`🚀 [PHASE 1] Kéo dữ liệu từ database: ${db}`);
          let offset = 0;
          let batchIndex = 0;

          while (true) {
            const rows = await this.fetchListFromOldDb(
              p1StartTime,
              p1StartId,
              stageBatchSize,
              offset,
              'ASC',
              db,
            );

            if (!rows || rows.length === 0) break;

            let transaction = null;
            let stageResult = null;
            try {
              transaction = new sql.Transaction(this.newPool);
              await transaction.begin();
              stageResult = await this.syncOldToStaging(rows, { transaction, dbName: db });
              await transaction.commit();
            } catch (err) {
              if (transaction) await transaction.rollback().catch(() => {});
              logger.error(
                `[Phase 1] Lỗi đồng bộ staging DB ${db} tại offset ${offset}: ${err.message}`,
              );
              throw err;
            }

            p1Staged += Number(stageResult?.stagedCount || 0);
            p1Rows += rows.length;

            // Tìm cursor lớn nhất trong batch này
            for (const row of rows) {
              const rowTime = new Date(row.__sync_time).toISOString();
              const rowId = Number(row.__sync_id);
              // Nếu bản ghi hiện tại mới hơn nextP1Time, cập nhật cursor
              if (rowTime > nextP1Time || (rowTime === nextP1Time && rowId > nextP1Id)) {
                nextP1Time = rowTime;
                nextP1Id = rowId;
              }
            }

            batchIndex++;
            logger.info(
              `🔥 [PHASE 1] [${db}] Progress: batch ${batchIndex}. Đã kéo thêm ${rows.length} bài. Tổng: ${p1Rows}. Global Cursor: ${nextP1Time} / ${nextP1Id}`,
            );
            offset += stageBatchSize;
          }
        }

        currentSyncTime = nextP1Time;
        currentSyncId = nextP1Id;
      }

      return { p1Staged, p1Rows, currentSyncTime, currentSyncId, startSyncTime, startSyncId };
    };

    // =========================================================================
    // ĐÓNG GÓI PHASE 2: KÉO DỮ LIỆU CŨ (DESC)
    // =========================================================================
    const runPhase2 = async () => {
      // Cho Bước 1 xuất phát trước 2s
      await new Promise((resolve) => setTimeout(resolve, 2000));

      let p2Staged = 0;
      let p2Rows = 0;
      const minCursor = await this.getMinStagedTime();
      let descSyncTime = minCursor ? minCursor.minTime : '2100-01-01T00:00:00.000Z';
      let descSyncId = minCursor ? minCursor.minId : 0;

      logger.info(`[PHASE 2 - OLD] Bắt đầu quét lùi về quá khứ từ: ${descSyncTime}`);

      for (const db of this.dbs) {
        logger.info(`[PHASE 2] Kéo dữ liệu cũ từ database: ${db}`);
        let offset = 0;
        let batchIndex = 0;

        while (true) {
          const rows = await this.fetchListFromOldDb(
            descSyncTime,
            descSyncId,
            stageBatchSize,
            offset,
            'DESC',
            db,
          );
          if (!rows || rows.length === 0) break;

          let transaction = null;
          let stageResult = null;
          try {
            transaction = new sql.Transaction(this.newPool);
            await transaction.begin();
            stageResult = await this.syncOldToStaging(rows, { transaction, dbName: db });
            await transaction.commit();
          } catch (err) {
            if (transaction) await transaction.rollback().catch(() => {});
            logger.error(
              `[Phase 2] Lỗi đồng bộ staging DB ${db} tại offset ${offset}: ${err.message}`,
            );
            throw err;
          }

          p2Staged += Number(stageResult?.stagedCount || 0);
          p2Rows += rows.length;

          batchIndex++;
          logger.info(
            `♻️ [PHASE 2] [${db}] Progress: batch ${batchIndex}. Đã lùi thêm ${rows.length} bài. Tích lũy: ${p2Rows}.`,
          );
          offset += stageBatchSize;
        }
      }

      return { p2Staged, p2Rows };
    };

    // THỰC THI SONG SONG
    const [res1, res2] = await Promise.all([runPhase1(), runPhase2()]);

    const totalStagedCount = res1.p1Staged + res2.p2Staged;
    const allRowsCount = res1.p1Rows + res2.p2Rows;
    const currentSyncTime = res1.currentSyncTime;
    const currentSyncId = res1.currentSyncId;
    const startSyncTime = res1.startSyncTime;
    const startSyncId = res1.startSyncId;

    logger.info(
      `[StreamNewsAspxPageIncrementalModel] Hoàn tất hút dữ liệu đợt này. ` +
        `Tổng cộng kéo được: ${allRowsCount} bản ghi.`,
    );

    // === Phase 3 count: đếm records PENDING trong staging để SyncManager biết gọi processOne() bao nhiêu lần ===
    const beginLimit = Number(process.env.BEGIN_LIMIT || 0);
    const completedLimit = Number(process.env.COMPLETED_LIMIT || 1000);
    const table = this.getStagingTableRef();
    let pendingCount = 0;
    try {
      const fetchNextClause = completedLimit > 0 ? `FETCH NEXT ${completedLimit} ROWS ONLY` : '';
      const countRows = await this.queryNewDb(`
        SELECT COUNT(1) AS cnt
        FROM ${table}
        WHERE ISNULL(DownloadStatus, '') NOT IN ('OK', 'ERROR')
      `);
      pendingCount = Number(countRows?.[0]?.cnt || 0);
    } catch (e) {
      logger.warn(
        `[StreamNewsAspxPageIncrementalModel] Không đếm được pending staging: ${e.message}`,
      );
      pendingCount = 0;
    }

    logger.info(
      `[StreamNewsAspxPageIncrementalModel] Phase 3: ${pendingCount} records pending trong staging ` +
        `(offset=${beginLimit}, limit=${completedLimit}).`,
    );

    // Cập nhật Dashboard lần cuối với tổng số thực tế (bao gồm cả các bản ghi tồn đọng cũ trong staging)
    await this.queryNewDb(`UPDATE sync_jobs SET total_to_sync = @total WHERE job_id = @jobId`, {
      total: pendingCount,
      jobId: syncJobId,
    });

    return {
      syncJobId,
      rows: [],
      totalCount: pendingCount,
      stagedCount: totalStagedCount,
      sourceLastSyncTime: currentSyncTime || startSyncTime,
      sourceLastSyncId: currentSyncId || startSyncId,
      lastSyncTime: currentSyncTime || startSyncTime,
      lastSyncId: currentSyncId || startSyncId,
    };
  }

  async getSyncJobState(syncJobId) {
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

  async fetchOneFromStaging({ transaction } = {}) {
    const table = this.getStagingTableRef();

    // === FIX RACE CONDITION: Dùng UPDATE...OUTPUT để "claim" row nguyên tử ===
    // Mỗi worker sẽ claim một row khác nhau, không bao giờ cùng lấy 1 row.
    // RETRY_WAITING được loại ra để tránh worker thường cướp job của retry job.
    const query = `
      UPDATE TOP(1) ${table}
      SET DownloadStatus = 'PROCESSING'
      OUTPUT
        INSERTED.DocId,
        INSERTED.DirName,
        INSERTED.LeafName,
        INSERTED.DocType,
        INSERTED.Size,
        INSERTED.TimeCreated,
        INSERTED.TimeLastModified,
        INSERTED.UIVersionString,
        INSERTED.Level,
        INSERTED.WebUrl,
        INSERTED.WebTitle,
        INSERTED.Language,
        INSERTED.ListTitle,
        INSERTED.tp_ServerTemplate,
        INSERTED.ListDescription,
        INSERTED.DocPath,
        INSERTED.FullPageUrl,
        INSERTED.LocalFilePath,
        INSERTED.__sync_id,
        INSERTED.source_db
      WHERE ISNULL(DownloadStatus, '') NOT IN ('OK', 'ERROR', 'RETRY_WAITING', 'PROCESSING')
        AND ISNULL(MigrateErrFlg, 0) = 0
    `;

    const rows = await this.queryNewDbTx(query, {}, transaction);
    return rows?.length ? rows[0] : null;
  }

  async processOne(syncJobId, options = {}) {
    if (!syncJobId) throw new Error('syncJobId is required');

    const jobState = await this.getSyncJobState(syncJobId);
    const itemIndex = Number(
      options.itemIndex != null ? options.itemIndex : jobState?.total_processed || 0,
    );

    const sourceLastSyncTime = this.normalizeSyncTime(
      options.sourceLastSyncTime ||
        options.lastSyncTime ||
        jobState?.last_sync_time ||
        DEFAULT_SYNC_TIME,
    );
    const sourceLastSyncId = Number(
      options.sourceLastSyncId != null ? options.sourceLastSyncId : jobState?.last_sync_id || 0,
    );

    const rowData = await this.fetchOneFromStaging();

    if (!rowData) {
      return { syncJobId, itemIndex, processed: false, done: true };
    }

    const docId = rowData.DocId;

    // === FIX RACE CONDITION: Kiểm tra in-memory lock để tránh 2 worker xử lý cùng 1 DocId ===
    // (Hàng phòng thủ thứ 2 sau UPDATE+OUTPUT ở fetchOneFromStaging)
    if (this._processingDocIds.has(docId)) {
      logger.warn(`[processOne] DocId ${docId} đang được xử lý bởi worker khác. Bỏ qua.`);
      return { syncJobId, itemIndex, processed: false, done: false };
    }
    this._processingDocIds.add(docId);

    try {
      const result = await this.processRowData(rowData, syncJobId);
      return {
        syncJobId,
        itemIndex,
        processed: true,
        done: false,
        rowId: docId || null,
        result,
      };
    } finally {
      // Luôn giải phóng lock dù thành công hay thất bại
      this._processingDocIds.delete(docId);
    }
  }
  /**
   * [TEST API] Gọi thẳng SharePoint REST API để lấy JSON của bài viết dựa vào tên file
   */
  async fetchArticleJsonFromApi(leafName) {
    const fs = require('fs');
    const path = require('path');
    const axios = require('axios');
    const https = require('https');
    const { refreshAuth } = require('../../sync-file-copy/SharePointAuthService');

    const domain = process.env.SHAREPOINT_DOMAIN || 'eoffice.saigonnewport.com.vn';
    const baseUrl = `https://${domain}/tintuc`; // Tuỳ thuộc sub-site của bạn
    const listName = 'Pages';
    const apiUrl = `${baseUrl}/_api/web/lists/getbytitle('${listName}')/items?$filter=FileLeafRef eq '${leafName}'`;

    let cookie = '';
    const cookiePath = path.join(process.cwd(), 'auth', 'cookie.txt');
    if (fs.existsSync(cookiePath)) {
      cookie = fs.readFileSync(cookiePath, 'utf8').trim();
    }

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    // Gọi lần 1
    let response;
    try {
      response = await axios.get(apiUrl, {
        httpsAgent,
        headers: { 'Accept': 'application/json;odata=verbose', 'Cookie': cookie }
      });
    } catch (error) {
      if (error.response && (error.response.status === 401 || error.response.status === 403)) {
         logger.warn(`[API] Cookie hết hạn khi gọi API JSON. Đang làm mới Token...`);
         await refreshAuth(this.pool);
         cookie = fs.readFileSync(cookiePath, 'utf8').trim(); // Đọc lại cookie mới
         response = await axios.get(apiUrl, { // Gọi lần 2
            httpsAgent,
            headers: { 'Accept': 'application/json;odata=verbose', 'Cookie': cookie }
         });
      } else {
         throw error;
      }
    }

    const items = response.data?.d?.results;
    if (items && items.length > 0) {
       const article = items[0];
       
       // Bước 2: Dịch Taxonomy ID (WssId) thành Tên thật (Plain Text) từ Root Site
       const taxonomyId = article.Categories1 && article.Categories1.Label ? article.Categories1.Label : null;
       if (taxonomyId && !isNaN(Number(taxonomyId))) {
           try {
               const rootUrl = `https://${domain}`;
               const taxApiUrl = `${rootUrl}/_api/web/lists/getbytitle('TaxonomyHiddenList')/items(${taxonomyId})`;
               const taxResponse = await axios.get(taxApiUrl, {
                   httpsAgent,
                   headers: { 'Accept': 'application/json;odata=verbose', 'Cookie': cookie }
               });
               const taxItem = taxResponse.data.d;
               // Ghi đè số ID thành chữ
               article.Categories1.Label = taxItem.Term || taxItem.Title || taxonomyId;
               logger.info(`[API] Đã dịch chuyên mục ID ${taxonomyId} thành "${article.Categories1.Label}"`);
           } catch (taxErr) {
               logger.warn(`[API] Không thể dịch chuyên mục ID ${taxonomyId}. Lỗi: ${taxErr.message}`);
           }
       }
       
       return article;
    }
    return null;
  }

  async processRowData(rowData, syncJobId) {
    const docId = rowData?.DocId;
    const docPath = String(rowData?.DocPath || '').trim();
    const fullUrl = String(rowData?.FullPageUrl || '').trim();

    // FIX: Tự động tính toán lại đường dẫn lưu file theo thư mục code hiện hành
    // Tránh bị lưu nhầm vào thư mục cũ do CSDL bị kẹt đường dẫn tuyệt đối
    const localPath = this.buildLocalFilePath(docPath);

    if (!docId) throw new Error('DocId is required');
    if (!docPath || !fullUrl) {
      throw new Error(`Invalid staged row. DocPath and FullPageUrl are required (DocId=${docId})`);
    }

    // Step 1: Download HTML
    let buffer = null;
    let attempt = 0;
    const maxAttempts = 3; // Kiểm tra tối đa 3 lần theo yêu cầu
    let downloadError = null;

    // Nếu bản ghi mới hơn tháng 2/2026, cho phép thời gian kết nối (timeout) đợi SharePoint load là 5 phút. Nếu cũ hơn thì 1 phút.
    const recordDate = new Date(rowData?.TimeLastModified || rowData?.TimeCreated);
    const isNewerThanFeb2026 =
      !isNaN(recordDate.getTime()) && recordDate > new Date('2026-02-28T23:59:59.999Z');

    const loadTimeoutMs = isNewerThanFeb2026 ? 300000 : 60000; // Trả lại thời gian đợi 5 phút cho bài mới, 1 phút bài cũ
    const loadTimeoutLabel = isNewerThanFeb2026 ? '5 phút' : '1 phút';

    logger.info(
      `[Downloader] Bắt đầu tải file từ SharePoint: ${fullUrl} (Đợi load tối đa: ${loadTimeoutLabel})`,
    );

    while (attempt < maxAttempts) {
      try {
        attempt++;
        if (attempt > 1) {
          logger.info(
            `[Downloader] Mạng chập chờn. Chờ 10 giây để kiểm tra và tải lại lần ${attempt}/${maxAttempts}...`,
          );
          await new Promise((resolve) => setTimeout(resolve, 10000)); // Đợi 10 giây (10000ms)
        }

        // Fix Circular Dependency: Gọi require động ngay trong lúc chạy
        const { downloadFile } = require('../../sync-file-copy/SharePointAuthService');

        // Bật bộ đếm log mỗi 1 phút để báo cáo trạng thái đang đợi
        let waitedMinutes = 0;
        const waitingInterval = setInterval(() => {
          waitedMinutes++;
          logger.info(
            `[Downloader] ⏳ Vẫn đang kiên nhẫn đợi SharePoint load file: ${rowData?.LeafName || fullUrl} ... (Đã đợi ${waitedMinutes} phút)`,
          );
        }, 60000);

        try {
          // Truyền đúng thứ tự tham số để dùng cơ chế lấy/lưu cookie từ DB + auto refresh auth
          buffer = await downloadFile(fullUrl, this.newPool, 0, loadTimeoutMs);
        } finally {
          clearInterval(waitingInterval); // Tải xong hoặc lỗi thì tắt bộ đếm ngay
        }

        if (!buffer || buffer.length === 0) {
          throw new Error('Downloaded buffer is empty');
        }

        logger.info(
          `[Downloader] Tải thành công ở lần thử ${attempt}. Kích thước: ${buffer.length} bytes.`,
        );
        downloadError = null;
        break; // Tải thành công thì thoát vòng lặp ngay
      } catch (err) {
        downloadError = err;
        logger.warn(`[Downloader] Lỗi tải ở lần ${attempt}: ${err.message}`);

        // Break early if authentication failed to prevent infinite loops and 16-minute delays
        if (err.message && err.message.includes('Authentication required')) {
          logger.error(`[Downloader] Lỗi xác thực SharePoint. Dừng tải, yêu cầu đăng nhập lại.`);
          global.sharePointLoginState = {
            required: true,
            inProgress: false,
            message: 'Phiên đăng nhập SharePoint đã hết hạn.',
          };
          try {
            require('../../sync-manager/SyncManagerService')._broadcastSSE();
          } catch (e) {}
          break;
        }

        // Lắp lại chốt chặn 404: Nếu máy chủ xác nhận file không tồn tại, dừng spam ngay để tiết kiệm thời gian
        if (err.message && err.message.includes('404')) {
          logger.warn(
            `[Downloader] Lỗi 404 Not Found. File thực sự không còn trên máy chủ. Dừng spam.`,
          );
          break;
        }

        // Chốt chặn cho lỗi không thể truy cập vĩnh viễn (sau khi đã refresh token vẫn lỗi 302/401/403)
        if (
          err.message &&
          err.message.includes('File có thể yêu cầu đăng nhập hoặc không tồn tại')
        ) {
          logger.warn(
            `[Downloader] Không thể truy cập file (đã thử làm mới token). Đang kiểm tra xem đây là lỗi file hay lỗi đăng nhập...`,
          );

          try {
            // Test thử xem cookie hiện tại có tải được trang chủ News hay không (giống logic API check-session)
            const testUrl = `${process.env.BASE_URL || 'https://eoffice.saigonnewport.com.vn'}/tintuc/Pages/default.aspx`;
            await require('../../sync-file-copy/SharePointAuthService').downloadFile(
              testUrl,
              this.newPool,
              0,
              15000,
            );

            // Nếu không bị văng lỗi -> Token vẫn ngon! -> Lỗi nằm ở bản thân file này (bị xóa/cấm)
            logger.warn(
              `[Downloader] Token vẫn hợp lệ! File này thực sự bị xoá hoặc phân quyền. Dừng spam và bỏ qua file.`,
            );
            downloadError = new Error('404 Not Found - ' + err.message); // Ép thành 404 để bỏ qua file
            break;
          } catch (sessionErr) {
            // Nếu tải trang chủ cũng chết -> Token hỏng (dù auto-login báo thành công nhưng cookie không xài được)
            logger.error(
              `[Downloader] Token hoàn toàn vô hiệu! Đăng nhập ngầm thất bại. Yêu cầu đăng nhập thủ công.`,
            );
            global.sharePointLoginState = {
              required: true,
              inProgress: false,
              message: 'Đăng nhập ngầm thất bại. Vui lòng đăng nhập thủ công.',
            };
            try {
              const syncManager = require('../../sync-manager/SyncManagerService');
              syncManager.pauseJob(syncJobId); // DỪNG JOB LẠI ĐỂ USER ĐĂNG NHẬP
              syncManager._broadcastSSE();
            } catch (e) {}
            break;
          }
        }
      }
    }

    if (downloadError || !buffer || buffer.length === 0) {
      const errMsg = downloadError ? downloadError.message : 'Unknown error';
      const is404 = errMsg.includes('404');
      logger.error(
        `[Downloader] Đã đợi và thử ${maxAttempts} lần nhưng vẫn không tải được ${fullUrl}: ${errMsg}`,
      );

      // TẠO FILE CHỨA NỘI DUNG LỖI THEO YÊU CẦU
      try {
        this.ensureLocalDirForFile(localPath);
        const titleError = is404
          ? 'Lỗi 404: File đã bị xóa khỏi SharePoint'
          : 'do đường truyền internet bị timeout';
        const errorHtml =
          `<html><head><meta charset="utf-8"><title>Lỗi tải trang</title></head><body>` +
          `<h1>${titleError}</h1>` +
          `<p><strong>Tên file:</strong> ${rowData?.LeafName}</p>` +
          `<p><strong>Đường dẫn gốc (URL):</strong> <a href="${fullUrl}">${fullUrl}</a></p>` +
          `<p><strong>Chi tiết lỗi:</strong> <span style="color:red;">${errMsg}</span></p>` +
          `</body></html>`;
        fs.writeFileSync(localPath, errorHtml, 'utf8');
        logger.info(`[Downloader] Đã lưu file ghi nhận lỗi tại ổ cứng: ${localPath}`);
      } catch (fsErr) {
        logger.error(`[Downloader] Lỗi khi tạo file báo lỗi cục bộ: ${fsErr.message}`);
      }

      await this._markDownloadResult(docId, {
        status: 'RETRY_WAITING',
        error: errMsg,
        downloadedAt: null,
      });

      await this._logDownloadError({
        docId,
        leafName: rowData?.LeafName,
        fullUrl,
        localPath,
        error: errMsg,
        attempts: attempt,
      });

      // Cập nhật cờ lỗi trung gian
      await this.queryNewDbTx(
        `UPDATE ${this.getStagingTableRef()}
         SET MigrateErrFlg = 1, MigrateErrMess = @err
         WHERE DocId = @DocId`,
        { err: errMsg, DocId: docId },
      );

      // XỬ LÝ ĐẶC BIỆT CHO LỖI 404: Không dừng Job, tự động chuyển sang file tiếp theo
      if (is404) {
        logger.warn(`[Downloader] Bỏ qua bài viết lỗi 404 và CHẠY TIẾP bài khác, không dừng Job.`);
        await this._markDownloadResult(docId, {
          status: 'ERROR', // 404 thì coi như lỗi vĩnh viễn
          error: errMsg,
          downloadedAt: null,
        });
        throw new Error(`Bỏ qua bài viết lỗi 404: ${errMsg}`);
      }

      // Quá số lần thử: Ném lỗi để SyncManager đưa vào job_error và skip row
      logger.error(
        `[Downloader] Đã chuyển bài viết ${rowData?.LeafName} sang trạng thái LỖI sau ${maxAttempts} lần tải.`,
      );
      await this._markDownloadResult(docId, {
        status: 'ERROR',
        error: errMsg,
        downloadedAt: null,
      });
      throw new Error(`Quá 3 lần không tải được file: ${errMsg}`);
    }

    const html = buffer.toString('utf8');
    this.ensureLocalDirForFile(localPath);
    try {
      fs.writeFileSync(localPath, html, 'utf8');
      logger.info(`[Downloader] Đã lưu file cục bộ: ${localPath}`);
    } catch (fsErr) {
      logger.error(`[Downloader] Lỗi khi lưu file cục bộ ${localPath}: ${fsErr.message}`);
      throw fsErr;
    }

    // Step 2: Parse and Sync to intermediary staging table (news_aspx_new_sync)
    const isNewsArticle =
      docPath.endsWith('.aspx') &&
      !docPath.includes('/Forms/') &&
      !docPath.includes('SitePages/') &&
      !docPath.includes('SitePages/') &&
      !docPath.includes('SiteAssets/') &&
      !docPath.includes('_catalogs/') &&
      !docPath.toLowerCase().includes('allitems.aspx') &&
      !docPath.toLowerCase().includes('dispform.aspx') &&
      !docPath.toLowerCase().includes('newform.aspx') &&
      !docPath.toLowerCase().includes('editform.aspx') &&
      !docPath.toLowerCase().includes('active.aspx') &&
      !docPath.toLowerCase().includes('byowner.aspx') &&
      !docPath.toLowerCase().includes('myitems.aspx') &&
      !docPath.toLowerCase().includes('duetoday.aspx') &&
      !docPath.toLowerCase().includes('mygrtsks.aspx') &&
      !docPath.toLowerCase().includes('viewnews.aspx');

    logger.info(`[Processor] Kiểm tra bài viết News: ${docPath} | Kết quả: ${isNewsArticle}`);

    let parsedData = null;
    if (isNewsArticle) {
      logger.info(`[Parser Hook] Bắt đầu phân giải nội dung file: ${localPath}`);
      try {
        // ==========================================
        //  CÁCH CŨ: DÙNG THƯ VIỆN PARSE HTML (.aspx)
        // ==========================================

        // parsedData = await this.htmlParser.parseHtmlFile(localPath, syncJobId);

        // ==========================================
        //  CÁCH MỚI [TEST API]: LẤY DỮ LIỆU BẰNG JSON 
        // ==========================================
        // Nếu bạn muốn test chạy bằng JSON API, hãy comment dòng parseHtmlFile ở trên lại 
        // và bỏ comment 5 dòng code dưới đây:
        // 
        const slug = path.basename(localPath, '.aspx');
        const apiArticleData = await this.fetchArticleJsonFromApi(rowData.LeafName);
        if (!apiArticleData) throw new Error('Không lấy được JSON từ API SharePoint cho bài: ' + rowData.LeafName);
        parsedData = await this.htmlParser.parseSharePointApiJson(apiArticleData, slug, syncJobId);
        // ==========================================
        if (parsedData) {
          logger.info(
            `[Parser Hook] Phân giải thành công. Tiêu đề: "${parsedData.title}" | Chủ đề: "${parsedData.topic}"`,
          );

          // TỰ ĐỘNG XUẤT FILE JSON NGAY SAU KHI PARSE (GIỐNG TOOL MIGRATION CŨ)
          try {
            const slug = path.basename(localPath, '.aspx');
            const jsonOutDir = path.join(process.cwd(), this.outputRoot, 'tintuc', 'json_output');
            const imgOutDir = path.join(process.cwd(), this.outputRoot, 'tintuc', 'img');

            if (!fs.existsSync(jsonOutDir)) {
              fs.mkdirSync(jsonOutDir, { recursive: true });
            }
            if (!fs.existsSync(imgOutDir)) {
              fs.mkdirSync(imgOutDir, { recursive: true });
            }

            const jsonFilePath = path.join(jsonOutDir, `${slug}.json`);
            fs.writeFileSync(jsonFilePath, JSON.stringify(parsedData, null, 2), 'utf-8');
            logger.info(`[Parser Hook] Đã tự động xuất file JSON thành quả: ${jsonFilePath}`);

            // === CHẠY ĐỒNG THỜI QUÉT VÀ TẢI ẢNH VỀ Ổ CỨNG & UPLOAD LÊN API MỚI ===
            if (
              parsedData.images &&
              Array.isArray(parsedData.images) &&
              parsedData.images.length > 0
            ) {
              const { downloadFile } = require('../../sync-file-copy/SharePointAuthService');
              const FileUploadService = require('../../sync-file-copy/Fileuploadservice');
              const fileUploader = new FileUploadService(this.newPool);

              // === DEDUP: Chuẩn hóa URL để làm cache key (loại bỏ query string) ===
              const normalizeImgUrl = (u) => {
                try { return new URL(u).origin + new URL(u).pathname; } catch { return u; }
              };

              for (const img of parsedData.images) {
                if (!img.fullUrl) continue;
                const cacheKey = normalizeImgUrl(img.fullUrl);

                try {
                  const rawBaseName = path.basename(img.fullUrl.split('?')[0]);
                  let imgFileName = rawBaseName;
                  try { imgFileName = decodeURIComponent(rawBaseName); } catch (e) {}
                  const imgLocalPath = path.join(imgOutDir, imgFileName);

                  // === FIX IMAGE LOOP: Kiểm tra cache trước, tránh download trùng lặp ===
                  const cachedResult = this._imgDownloadCache.get(cacheKey);
                  if (cachedResult && !(cachedResult instanceof Promise)) {
                    // Đã upload thành công trước đó -> dùng lại URL mới
                    logger.info(`[Image Cache] ✅ Cache hit, tái sử dụng URL: ${cachedResult.viewUrl}`);
                    const newViewUrl = cachedResult.viewUrl;
                    if (parsedData.content) {
                      if (img.originalUrl) parsedData.content = parsedData.content.split(img.originalUrl).join(newViewUrl);
                      parsedData.content = parsedData.content.split(img.fullUrl).join(newViewUrl);
                    }
                    if (parsedData.thumbnail === img.fullUrl || parsedData.thumbnail === img.originalUrl) {
                      parsedData.nameThumbnail = newViewUrl;
                    }
                    continue;
                  }

                  // === IN-FLIGHT GUARD: Nếu URL đang được download bởi worker khác, đợi kết quả ===
                  if (cachedResult instanceof Promise) {
                    logger.info(`[Image Cache] ⏳ URL đang được download bởi worker khác, đợi kết quả: ${cacheKey}`);
                    try {
                      const result = await cachedResult;
                      if (result && result.viewUrl && parsedData.content) {
                        if (img.originalUrl) parsedData.content = parsedData.content.split(img.originalUrl).join(result.viewUrl);
                        parsedData.content = parsedData.content.split(img.fullUrl).join(result.viewUrl);
                      }
                    } catch (_) { /* worker kia lỗi, bỏ qua ảnh này */ }
                    continue;
                  }

                  // === Tạo Promise download và đăng ký vào cache ngay (in-flight) ===
                  const downloadPromise = (async () => {
                    logger.info(`[Image Downloader] Đang tải ảnh từ SharePoint: ${img.fullUrl}`);
                    const imgBuffer = await downloadFile(img.fullUrl, this.newPool, 0, 60000);

                    if (!imgBuffer || imgBuffer.length === 0) return null;

                    // Lưu local song song với upload API
                    const saveLocalTask = fs.promises.writeFile(imgLocalPath, imgBuffer)
                      .then(() => logger.info(`[Image Downloader] Đã lưu ảnh cục bộ: ${imgLocalPath}`))
                      .catch((err) => logger.error(`[Image Downloader] ❌ Lỗi lưu ảnh: ${err.message}`));

                    let viewUrl = null;
                    try {
                      const uploadRes = await fileUploader.uploadToNewSystem({
                        fileBuffer: imgBuffer,
                        originalName: imgFileName,
                        objectType: 'NEWS',
                        objectId: docId,
                      });
                      if (uploadRes && (uploadRes.id || uploadRes.public_id)) {
                        const fileId = uploadRes.id || uploadRes.public_id;
                        const viewPrefix = (process.env.NEW_SYSTEM_VIEW_PREFIX || 'https://apigw-uat.snp.com.vn/doffice-be').replace(/\/$/, '');
                        viewUrl = `${viewPrefix}/api/files/view/${fileId}`;
                        logger.info(`🚀 [API UPLOAD] Thành công: ${viewUrl}`);
                      }
                    } catch (upErr) {
                      logger.warn(`[API UPLOAD] ⚠️ Upload lỗi, ảnh giữ URL cũ: ${upErr.message}`);
                    }

                    await saveLocalTask;
                    return viewUrl ? { viewUrl } : null;
                  })();

                  // Đăng ký in-flight promise vào cache
                  this._imgDownloadCache.set(cacheKey, downloadPromise);

                  let result = null;
                  try {
                    result = await downloadPromise;
                  } finally {
                    // Sau khi xong: ghi kết quả vào cache (hoặc xóa nếu lỗi)
                    if (result) {
                      this._imgDownloadCache.set(cacheKey, result);
                    } else {
                      this._imgDownloadCache.delete(cacheKey); // Cho phép retry lần sau
                    }
                  }

                  if (result && result.viewUrl) {
                    const newViewUrl = result.viewUrl;
                    if (parsedData.content) {
                      if (img.originalUrl) parsedData.content = parsedData.content.split(img.originalUrl).join(newViewUrl);
                      parsedData.content = parsedData.content.split(img.fullUrl).join(newViewUrl);
                    }
                    if (parsedData.thumbnail === img.fullUrl || parsedData.thumbnail === img.originalUrl) {
                      parsedData.nameThumbnail = newViewUrl;
                    }
                  }

                } catch (imgErr) {
                  // Xóa cache nếu lỗi để cho phép retry
                  this._imgDownloadCache.delete(cacheKey);
                  logger.warn(`[Image Downloader] ⚠️ Bỏ qua ảnh ${img.fullUrl} do lỗi: ${imgErr.message}`);
                }
              }

              // Giới hạn kích thước cache để tránh memory leak (giữ tối đa 5000 URL)
              if (this._imgDownloadCache.size > 5000) {
                const keysToDelete = [...this._imgDownloadCache.keys()].slice(0, 1000);
                keysToDelete.forEach(k => this._imgDownloadCache.delete(k));
                logger.info(`[Image Cache] 🧹 Đã dọn cache, còn lại: ${this._imgDownloadCache.size} entries.`);
              }

              // Ghi đè lại file JSON để cập nhật các đường dẫn URL vừa được thay mới
              fs.writeFileSync(jsonFilePath, JSON.stringify(parsedData, null, 2), 'utf-8');
            }
          } catch (jsonErr) {
            logger.error(`[Parser Hook] Lỗi khi tạo file JSON hoặc tải ảnh: ${jsonErr.message}`);
            throw jsonErr; // Ném lỗi lên trên
          }

          parsedData.DocId = docId; // Truyền DocId GUID chuẩn
          await this.htmlParser.insertToSyncTable(parsedData);
          logger.info(`[Parser Hook] Đã lưu vào bảng trung gian news_aspx_new_sync.`);
        } else {
          logger.warn(`[Parser Hook] Không thể phân giải dữ liệu từ file: ${localPath}`);
        }
      } catch (e) {
        logger.error(
          `[Parser Hook] Lỗi khi phân giải/lưu bảng trung gian cho ${docPath}: ${e.message}`,
        );
        // Cập nhật cờ lỗi trung gian
        await this.queryNewDbTx(
          `UPDATE ${this.getStagingTableRef()}
           SET MigrateErrFlg = 1, MigrateErrMess = @err
           WHERE DocId = @DocId`,
          { err: e.message, DocId: docId },
        );
        throw new Error(`Quá 3 lần không tải được tài nguyên (Ảnh/API): ${e.message}`);
      }
    } else {
      logger.warn(
        `[Processor] Bỏ qua file này (không phải bài viết News hoặc nằm trong danh mục loại trừ): ${docPath}`,
      );
    }

    // Step 3: Production Sync (news & audit) - Like sync-social-resource
    const actionLogs = [];
    if (parsedData) {
      try {
        await dbUtils.withTransactionRetry(
          this.newPool,
          async (trans) => {
            const resultProd = await this.upsertToProduction(parsedData, trans);
            actionLogs.push({ table: 'news', action: resultProd.action });

            if (parsedData.isActive && resultProd.newsId) {
              await this.createAuditRecord(resultProd.newsId, parsedData.publishedAt, trans);
              actionLogs.push({ table: 'audit', action: 'DUYET' });
            }

            // === FIX LINKING FILE: Cập nhật object_id cho các file vừa upload từ DocId sang newsId mới sinh ===
            if (resultProd.newsId && parsedData.DocId) {
                await this.queryNewDbTx(
                    `UPDATE dbo.file_relations 
                     SET object_id = CAST(@newsId AS NVARCHAR(50))
                     WHERE object_id = @docId AND object_type IN ('news', 'NEWS')`,
                    { newsId: String(resultProd.newsId), docId: String(parsedData.DocId) },
                    trans
                );
                logger.info(`[Production Sync] Đã liên kết lại file: DocId ${parsedData.DocId} ➔ news.id ${resultProd.newsId}`);
            }
          },
          { maxRetries: 5 },
        );
      } catch (e) {
        logger.error(`[Production Sync] Failed for ${docPath} after retries: ${e.message}`);
        actionLogs.push({ action: 'failed', error: e.message });
        await this.queryNewDbTx(
          `UPDATE ${this.getStagingTableRef()}
           SET MigrateErrFlg = 1, MigrateErrMess = @err
           WHERE DocId = @DocId`,
          { err: `Đồng bộ DB (news) thất bại: ${e.message}`, DocId: docId },
        );
        throw new Error(`Đồng bộ Production thất bại: ${e.message}`);
      }
    }

    // Update staging status (temp table)
    await this._markDownloadResult(docId, {
      status: 'OK',
      error: null,
      downloadedAt: new Date(),
    });

    // Cập nhật cờ thành công
    await this.queryNewDbTx(
      `UPDATE ${this.getStagingTableRef()}
       SET MigrateFlg = 1, MigrateErrFlg = 0, MigrateErrMess = NULL
       WHERE DocId = @DocId`,
      { DocId: docId },
    );

    return {
      action: 'processed',
      localPath,
      logs: actionLogs,
    };
  }

  async upsertToProduction(data, transaction) {
    // Debug & Self-healing: Đảm bảo migrationHelper luôn tồn tại
    if (!this.migrationHelper) {
      logger.warn(
        `[WARN] this.migrationHelper bi undefined tai ${data.slug || 'unknown'}. Dang khoi tao lai...`,
      );
      this.migrationHelper = new MigrationHelper(
        (...args) => this.queryNewDbTx(...args),
        (...args) => this.queryOldDb?.(...args) ?? null,
      );
    }

    if (!this.migrationHelper) {
      logger.error(
        `[CRITICAL] Khong the khoi tao MigrationHelper tai ${data.slug}. Bo qua bai nay.`,
      );
      return null;
    }

    // Topic mapping: Text to ID (GUID)
    let topicId = null;
    try {
      if (this.migrationHelper && typeof this.migrationHelper.getOrCreateTopic === 'function') {
        topicId = await this.migrationHelper.getOrCreateTopic(
          data.topic,
          this.topicMap,
          transaction,
        );
      } else {
        logger.warn(
          `[DIAGNOSTIC] migrationHelper is ${typeof this.migrationHelper}. getOrCreateTopic: ${this.migrationHelper ? typeof this.migrationHelper.getOrCreateTopic : 'N/A'}`,
        );
        // Force re-init if somehow missing
        this.migrationHelper = new MigrationHelper(
          (...args) => this.queryNewDbTx(...args),
          (...args) => this.queryOldDb?.(...args) ?? null,
        );
        topicId = await this.migrationHelper.getOrCreateTopic(
          data.topic,
          this.topicMap,
          transaction,
        );
      }
    } catch (topicErr) {
      logger.error(`[CRITICAL ERROR] Topic Mapping failed for ${data.slug}: ${topicErr.message}`);
      // Fallback to random or default topic to keep the sync ALIVE
    }

    const topic =
      topicId ||
      (this.topicIds.length > 0
        ? String(this.topicIds[Math.floor(Math.random() * this.topicIds.length)])
        : null);

    const authorId = data.created_by || this.adminId || 'admin-tancang';
    const submitterId = data.submitterId || authorId;
    // authorName: Giữ nguyên tên gốc trích xuất được
    const authorName = data.authorName || 'E-Office Admin';

    const authorCode = data.authorCode || null;
    const authorDepartment = data.authorDepartment || null;

    const query = `
            DECLARE @nid INT = NULL;
            -- Tối ưu hóa: Tìm bài viết cũ (theo DocId hoặc slug)
            IF @DocId IS NOT NULL AND @DocId <> ''
            BEGIN
                SELECT TOP 1 @nid = id FROM dbo.news WHERE DocId = @DocId;
                IF @nid IS NULL
                    SELECT TOP 1 @nid = id FROM dbo.news WHERE DocId = TRY_CAST(@DocId AS UNIQUEIDENTIFIER);
            END

            IF @nid IS NULL AND @slug IS NOT NULL
                SELECT TOP 1 @nid = id FROM dbo.news WHERE slug = @slug;

            IF @nid IS NOT NULL
            BEGIN
                UPDATE dbo.news SET
                    title = @title,
                    content = @content,
                    summary = @summary,
                    authorName = @authorName,
                    authorId = @authorId,
                    submitterId = @submitterId,
                    submitterName = @authorName,
                    authorDepartment = @authorDepartment,
                    authorCode = @authorCode,
                    publishedAt = @publishedAt,
                    status = @status,
                    updatedAt = @updatedAt,
                    topic = @topic,
                    nameThumbnail = @nameThumbnail,
                    tags = @tags,
                    isBak = 1,
                    created_by = @authorId,
                    DocId = @DocId,
                    reviewerId = @authorId,
                    reviewerName = @authorName,
                    approvedAt = GETDATE()
                WHERE id = @nid;
                SELECT 'updated' AS action, @nid AS newsId;
            END
            ELSE
            BEGIN
                INSERT INTO dbo.news (
                    title, slug, content, summary, authorName, authorDepartment, authorId, authorCode,
                    publishedAt, status, createdAt, updatedAt, topic, nameThumbnail,
                    isComment, isSpecial, isImportant, tags, isBak, DocId, created_by,
                    reviewerId, reviewerName, approvedAt, submitterId, submitterName, submittedAt
                )
                VALUES (
                    @title, @slug, @content, @summary, @authorName, @authorDepartment, @authorId, @authorCode,
                    @publishedAt, @status, @createdAt, @updatedAt, @topic, @nameThumbnail,
                    1, 0, 0, @tags, 1, @DocId, @authorId,
                    @authorId, @authorName, @updatedAt, @submitterId, @authorName, @createdAt
                );
                SELECT SCOPE_IDENTITY() AS newsId, 'inserted' AS action;
            END
        `;
    const res = await this.queryNewDbTx(
      query,
      {
        title: this.safeTrim(data.title, 500),
        slug: this.safeTrim(data.slug, 255),
        content: data.content, // Usually NVARCHAR(MAX)
        summary: data.summary, // Usually NVARCHAR(MAX)
        authorName: this.safeTrim(authorName, 255),
        authorDepartment: this.safeTrim(authorDepartment, 255),
        authorId: this.safeTrim(authorId, 100),
        submitterId: this.safeTrim(submitterId, 100),
        authorCode: this.safeTrim(authorCode, 255),
        publishedAt: data.publishedAt || new Date(),
        status: data.isActive ? 1 : 0,
        topic: this.safeTrim(topic, 255),
        nameThumbnail: this.safeTrim(data.nameThumbnail, 500),
        tags: data.tags, // Usually NVARCHAR(MAX)
        DocId: data.DocId,
        created_by: this.safeTrim(authorId, 100),
        createdAt: data.createdAt || data.publishedAt || new Date(),
        updatedAt: data.updatedAt || data.publishedAt || new Date(),
      },
      transaction,
    );

    return {
      action: res?.[0]?.action || 'none',
      newsId: res?.[0]?.newsId || null,
    };
  }

  async createAuditRecord(newsId, publishTime, transaction) {
    const date = publishTime ? new Date(publishTime) : new Date();
    const query = `
        IF NOT EXISTS (SELECT 1 FROM dbo.audit WHERE document_id = @newsId AND type_document = 'NEWS' AND action_code = 'DUYET')
        BEGIN
            INSERT INTO dbo.audit (
                document_id, time, user_id, display_name, role, action_code,
                details, created_by, receiver, stage_status, curStatusCode,
                created_at, updated_at, type_document, table_backups, table_bak
            ) VALUES (
                @newsId, @time, @userId, N'Hệ thống Migrator', 'ADMIN_NEWS', 'DUYET',
                N'{"autoApproved":true,"reason":"Migrate từ ASPX Job"}', @userId, @userId, 'HOAN_THANH', 'PUBLISHED',
                GETDATE(), GETDATE(), 'NEWS', 'auto_create', '1'
            );
        END
    `;
    try {
      await this.queryNewDbTx(
        query,
        {
          newsId: String(newsId),
          time: isNaN(date.getTime()) ? new Date() : date,
          userId: this.adminId ? String(this.adminId) : null,
        },
        transaction,
      );
    } catch (e) {
      logger.warn(
        `[StreamNewsAspxPageIncrementalModel] Không thể tạo audit record cho bài viết ${newsId} (có thể do sai kiểu dữ liệu document_id): ${e.message}`,
      );
      // Không throw lỗi ở đây để tránh làm cả quá trình đồng bộ thất bại
    }
  }

  async _markDownloadResult(docId, { status, error, downloadedAt }, transaction = null) {
    const table = this.getStagingTableRef();
    const q = `
      UPDATE ${table}
      SET DownloadStatus = @status, DownloadError = @error, DownloadedAt = @downloadedAt
      WHERE CONVERT(nvarchar(36), DocId) = @docId
    `;
    const params = {
      docId: docId ? String(docId) : null,
      status: status || null,
      error: error ? String(error).substring(0, 1000) : null,
      downloadedAt: downloadedAt || null,
    };
    if (transaction) {
      await this.queryNewDbTx(q, params, transaction);
    } else {
      await this.queryNewDb(q, params);
    }
  }

  async _logDownloadError({ docId, leafName, fullUrl, localPath, error, attempts }) {
    const query = `
      INSERT INTO dbo.news_aspx_download_errors (
        DocId, LeafName, FullPageUrl, LocalFilePath, ErrorMessage, AttemptCount
      ) VALUES (
        @docId, @leafName, @fullUrl, @localPath, @error, @attempts
      )
    `;
    try {
      await this.queryNewDb(query, {
        docId: docId ? String(docId) : null,
        leafName: this.safeTrim(leafName, 512),
        fullUrl: this.safeTrim(fullUrl, 2048),
        localPath: this.safeTrim(localPath, 2048),
        error: error ? String(error).substring(0, 4000) : null,
        attempts: attempts || 1,
      });
    } catch (e) {
      logger.error(`[Downloader] Lỗi khi ghi log vào bảng error: ${e.message}`);
    }
  }

  /**
   * Safe string trimming to prevent truncation errors
   */
  safeTrim(val, maxLen) {
    if (typeof val !== 'string' || !val || !maxLen) return val;
    if (val.length > maxLen) {
      logger.warn(
        `[SafeTrim] Truncating string: length ${val.length} > ${maxLen}. Prefix: ${val.substring(0, 50)}`,
      );
      return val.substring(0, maxLen);
    }
    return val;
  }

  /**
   * Thục hiện thừ lại các bài viết bị lỗi Timeout ở đợt trước (RETRY_WAITING)
   * Chạy song song để tối ưu thời gian.
   */
  async retryFailedParallel(syncJobId) {
    const table = this.getStagingTableRef();
    try {
      // === CLEANUP: Reset các row bị kẹt PROCESSING trong quá 10 phút (do tool crash giữa chừng) ===
      try {
        const stuckCount = await this.queryNewDb(`
          UPDATE ${table}
          SET DownloadStatus = NULL
          OUTPUT INSERTED.DocId
          WHERE DownloadStatus = 'PROCESSING'
        `);
        if (stuckCount && stuckCount.length > 0) {
          logger.warn(`[RETRY] Ðã giải phóng ${stuckCount.length} row bị kẹt ở trạng thái PROCESSING từ phiên trước.`);
        }
      } catch (stuckErr) {
        logger.warn(`[RETRY] Không thể reset stuck rows: ${stuckErr.message}`);
      }

      const pendingRows = await this.queryNewDb(`
        SELECT * FROM ${table} WHERE DownloadStatus = 'RETRY_WAITING' AND ISNULL(MigrateErrFlg, 0) = 0
      `);

      if (!pendingRows || pendingRows.length === 0) return;

      logger.info(
        `[RETRY] Phát hiện ${pendingRows.length} bài viết đang đợi thử lại. Bắt đầu xử lý song song...`,
      );

      // Chia nhỏ để chạy song song (mỗi đợt 5 bài để không làm SharePoint "ngộp")
      const chunkSize = 5;
      for (let i = 0; i < pendingRows.length; i += chunkSize) {
        const chunk = pendingRows.slice(i, i + chunkSize);
        logger.info(
          `[RETRY] Đang xử lý nhóm bài viết ${i + 1} -> ${Math.min(i + chunkSize, pendingRows.length)}...`,
        );

        await Promise.all(
          chunk.map(async (row) => {
            try {
              await this.processRowData(row, syncJobId);
            } catch (err) {
              logger.error(`[RETRY] Thử lại thất bại cho ${row.LeafName}: ${err.message}`);
            }
          }),
        );
      }

      logger.info(`[RETRY] Hoàn tất quá trình thử lại song song.`);
    } catch (err) {
      logger.error(`[RETRY] Lỗi nghiêm trọng trong quá trình retry: ${err.message}`);
    }
  }
}

module.exports = StreamNewsAspxPageIncrementalModel;
