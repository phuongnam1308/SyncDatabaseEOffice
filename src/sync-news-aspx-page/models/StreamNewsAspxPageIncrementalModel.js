const logger = require('../../../utils/logger');
const sql = require('mssql');
const fs = require('fs');
const path = require('path');

const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const HtmlFileMigrationModel = require('../migrate/HtmlFileMigrationModel');
const MigrationHelper = require('../../helpers/MigrationHelper');

const DEFAULT_SYNC_TIME = '2100-01-01T00:00:00.000Z';

class StreamNewsAspxPageIncrementalModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_NEWS_ASPX_PAGE_INCREMENTAL' });
    this.newDbName = process.env.NEW_DB_NAME;
    this.newDbSchema = 'dbo';
    this.newTableSync = 'news_aspx_pages_temp';
    this.sharePointDb = process.env.SHAREPOINT_DB_NAME || 'WSS_Content_eoffice_khkd';

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
    const actualLookback = (lastSyncTime !== DEFAULT_SYNC_TIME) ? lookbackHours : 0;
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

    const query = `
      ;WITH src AS (
        SELECT
          d.[TimeLastModified] AS __sync_time,
          ${syncIdExpr}        AS __sync_id
        FROM [${this.sharePointDb}].[dbo].[AllDocs] d
        INNER JOIN [${this.sharePointDb}].[dbo].[AllWebs] w
          ON d.[SiteId] = w.[SiteId] AND d.[WebId]  = w.[Id]
        LEFT JOIN [${this.sharePointDb}].[dbo].[AllLists] l
          ON d.[SiteId]  = l.[tp_SiteId] AND d.[ListId] = l.[tp_ID]
        WHERE
          d.[DeleteTransactionId] = 0x0
          AND d.[IsCurrentVersion] = 1
          AND w.[FullUrl] LIKE '%tintuc%'
          AND d.[LeafName] LIKE '%.aspx'
          AND l.[tp_Title] LIKE '%Pages%'
      )
      SELECT COUNT(1) AS total
      FROM src
      WHERE ${filterClause}
    `;

    const rows = await this.queryOldDb(query, {
      lastSyncTime: normalizedLastSyncTime,
      lastSyncId: normalizedLastSyncId,
    });

    const total = rows?.[0]?.total || 0;
    // Nếu limit = 0 thì không chặn (chạy full)
    return limit > 0 ? Math.min(total, limit) : total;
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

          CONSTRAINT PK_news_aspx_pages_temp PRIMARY KEY (DocId)
        );
      END

      -- Add missing columns (idempotent)
      IF COL_LENGTH('${table}', '__sync_id') IS NULL
        ALTER TABLE ${table} ADD __sync_id BIGINT NULL;

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
  ) {
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
      `[StreamNewsAspxPageIncrementalModel] fetchListFromOldDb: lastSyncTime=${lastSyncTime}, lastSyncId=${lastSyncId}, direction=${direction}, take=${safeTake}`,
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
        FROM [${this.sharePointDb}].[dbo].[AllDocs] d
        INNER JOIN [${this.sharePointDb}].[dbo].[AllWebs] w
          ON d.[SiteId] = w.[SiteId] AND d.[WebId]  = w.[Id]
        LEFT JOIN [${this.sharePointDb}].[dbo].[AllLists] l
          ON d.[SiteId]  = l.[tp_SiteId] AND d.[ListId] = l.[tp_ID]
        WHERE
          d.[DeleteTransactionId] = 0x0
          AND d.[IsCurrentVersion] = 1
          AND w.[FullUrl] LIKE '%tintuc%'
          AND d.[LeafName] LIKE '%.aspx'
          AND l.[tp_Title] LIKE '%Pages%'
      )
      SELECT *
      FROM src
      WHERE ${filterClause}
      ORDER BY
        __sync_time ${sortDir},
        __sync_id ${sortDir},
        DocId ${sortDir}
      ${safeTake ? 'OFFSET @offset ROWS FETCH NEXT @take ROWS ONLY' : ''}
    `;

    const resultRows = await this.queryOldDb(query, {
      lastSyncTime: lastSyncTime,
      lastSyncId: lastSyncId,
      take: safeTake,
      offset: safeOffset,
    });
    return resultRows;
  }

  async syncOldToStaging(rows, { transaction } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return { stagedCount: 0 };
    const table = this.getStagingTableRef();

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
                DocPath, FullPageUrl, LocalFilePath, __sync_id
            ) VALUES (
                @DocId, @DirName, @LeafName, @DocType, @Size,
                @TimeCreated, @TimeLastModified, @UIVersionString, @Level,
                @WebUrl, @WebTitle, @Language, @ListTitle, @tp_ServerTemplate, @ListDescription,
                @DocPath, @FullPageUrl, @LocalFilePath, @__sync_id
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

    const stageBatchSize = Number(
      process.env.TINTUC_STAGE_BATCH_SIZE || process.env.COMPLETED_LIMIT || 500,
    );
    // Số giờ quét lùi đọc từ biến môi trường (mặc định 24 giờ)
    const lookbackHours = Number(process.env.TINTUC_LOOKBACK_HOURS || 24);

    // 0. CẬP NHẬT TỔNG SỐ BẢN GHI ĐỂ DASHBOARD HIỂN THỊ NGAY
    // QUAN TRỌNG: Khi gọi getCount để lấy total_to_sync, ta áp dụng lookback (nếu không phải chạy lại từ đầu)
    const totalToSync = await this.getCount(lastSyncTime, lastSyncId, { useLimit: true, lookbackHours });
    logger.info(`[StreamNewsAspxPageIncrementalModel] Tổng số bản ghi (News) cần đồng bộ (áp dụng lookback ${lookbackHours}h): ${totalToSync}`);
    await this.queryNewDb(`UPDATE sync_jobs SET total_to_sync = @total WHERE job_id = @jobId`, {
      total: totalToSync,
      jobId: syncJobId
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
      // Áp dụng lookback 1 ngày vào lastSyncTime của job (mốc đồng bộ lần trước),
      // để cover các bài viết bị sửa đổi trong 24h cuối của chu kỳ trước.
      // Nếu staging rỗng (lần đầu chạy), dùng '1900-01-01' để kéo tất cả.
      const isFirstRun = lastSyncTime === DEFAULT_SYNC_TIME || !lastSyncTime;
      const jobCursorWithLookback = isFirstRun
        ? '1900-01-01T00:00:00.000Z'
        : this.normalizeSyncTime(lastSyncTime, lookbackHours); // Trừ lookbackHours vào lastSyncTime của job

      // Cursor xuất phát thực tế = cái NHỎ HƠN giữa maxStagedTime và (lastSyncTime - 24h)
      // Để đảm bảo không bỏ sót bài cũ hơn staging nhưng mới hơn checkpoint cũ
      let p1StartTime = startSyncTime;
      let p1StartId = startSyncId;
      if (!isFirstRun && jobCursorWithLookback < startSyncTime) {
        p1StartTime = jobCursorWithLookback;
        p1StartId = 0;
        logger.info(`🕐 [PHASE 1 - LOOKBACK] Áp dụng lookback: cursor xuất phát từ ${p1StartTime} (lastSyncTime=${lastSyncTime} - ${lookbackHours}h) thay vì maxStaged=${startSyncTime}`);
      }

      if (currentSyncTime || !isFirstRun) {
        logger.info(`🚀 [PHASE 1 - NEW] Kéo bài viết mới/đã sửa từ cursor: ${p1StartTime} 🚀`);

        // FIX: Dùng useLimit: false để không bị chặn bởi COMPLETED_LIMIT khi đếm
        // số bài mới cho Phase 1. COMPLETED_LIMIT chỉ áp dụng cho pending staging.
        const p1Total = await this.getCount(p1StartTime, p1StartId, { useLimit: false });
        const p1Iterations = Math.ceil(p1Total / stageBatchSize) || 0;

        logger.info(`🔢 [PHASE 1] Tổng bài mới/đã sửa cần kéo: ${p1Total} (${p1Iterations} đợt).`);

        currentSyncTime = p1StartTime;
        currentSyncId = p1StartId;

        for (let i = 0; i < p1Iterations; i++) {
          const begin = i * stageBatchSize;
          const rows = await this.fetchListFromOldDb(
            p1StartTime,
            p1StartId,
            stageBatchSize,
            begin,
            'ASC',
          );
          if (!rows || rows.length === 0) break;

          let transaction = null;
          let stageResult = null;
          try {
            transaction = new sql.Transaction(this.newPool);
            await transaction.begin();
            stageResult = await this.syncOldToStaging(rows, { transaction });
            await transaction.commit();
          } catch (err) {
            if (transaction) await transaction.rollback().catch(() => {});
            logger.error(`[Phase 1] Lỗi đồng bộ staging tại iteration ${i}: ${err.message}`);
            throw err;
          }

          p1Staged += Number(stageResult?.stagedCount || 0);
          p1Rows += rows.length;

          // Cập nhật cursor theo batch cuối cùng
          for (const row of rows) {
              const rowTime = new Date(row.__sync_time).toISOString();
              const rowId = Number(row.__sync_id);
              currentSyncTime = rowTime;
              currentSyncId = rowId;
          }

          logger.info(`🔥 [PHASE 1] Progress: ${i+1}/${p1Iterations} batches. Đã kéo ${p1Rows} dòng mới/đã sửa. LastCursor: ${currentSyncTime} / ${currentSyncId}`);
        }
      }

      return { p1Staged, p1Rows, currentSyncTime, currentSyncId, startSyncTime, startSyncId };
    };

    // =========================================================================
    // ĐÓNG GÓI PHASE 2: KÉO DỮ LIỆU CŨ (DESC)
    // =========================================================================
    const runPhase2 = async () => {
      // Cho Bước 1 xuất phát trước 2s
      await new Promise(resolve => setTimeout(resolve, 2000));

      let p2Staged = 0;
      let p2Rows = 0;
      const minCursor = await this.getMinStagedTime();
      let descSyncTime = minCursor ? minCursor.minTime : '2100-01-01T00:00:00.000Z';
      let descSyncId = minCursor ? minCursor.minId : 0;

      // Tính tổng số bài cũ cần lùi về
      const p2Total = await this.getCount(descSyncTime, descSyncId);
      const p2Iterations = Math.ceil(p2Total / stageBatchSize);

      logger.info(`[PHASE 2 - OLD] Cần lùi về ${p2Total} bài (${p2Iterations} đợt). Bắt đầu từ: ${descSyncTime}`);

      for (let i = 0; i < p2Iterations; i++) {
        const begin = i * stageBatchSize;
        const rows = await this.fetchListFromOldDb(
          descSyncTime,
          descSyncId,
          stageBatchSize,
          begin,
          'DESC',
        );
        if (!rows || rows.length === 0) break;

        let transaction = null;
        let stageResult = null;
        try {
          transaction = new sql.Transaction(this.newPool);
          await transaction.begin();
          stageResult = await this.syncOldToStaging(rows, { transaction });
          await transaction.commit();
        } catch (err) {
          if (transaction) await transaction.rollback().catch(() => {});
          logger.error(`[Phase 2] Lỗi đồng bộ staging tại iteration ${i}: ${err.message}`);
          throw err;
        }

        p2Staged += Number(stageResult?.stagedCount || 0);
        p2Rows += rows.length;

        // LOG chi tiết từng bản ghi để debug cursor
        for (const row of rows) {
            const rowTime = new Date(row.__sync_time).toISOString();
            const rowId = Number(row.__sync_id);
            logger.info(`  └─ [Compare P2] DocId: ${row.DocId} | T: ${rowTime} ID: ${rowId} vs P2_Cursor(T: ${descSyncTime} ID: ${descSyncId})`);

            descSyncTime = rowTime;
            descSyncId = rowId;
        }

        logger.info(`♻️ [PHASE 2] Progress: ${i+1}/${p2Iterations} batches. Đã lùi thêm ${rows.length} bài. Tích lũy: ${p2Rows}. LastCursor: ${descSyncTime} / ${descSyncId}`);
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
    const beginLimit = Number(process.env.BEGIN_LIMIT || 0);

    // Dùng BEGIN_LIMIT làm OFFSET để bỏ qua những record đầu (nếu cần)
    // Lấy 1 record pending tiếp theo (newest-first)
    const query = `
      SELECT *
      FROM (
        SELECT *, ROW_NUMBER() OVER (ORDER BY TimeLastModified DESC, DocId DESC) AS __rn
        FROM ${table}
        WHERE ISNULL(DownloadStatus, '') NOT IN ('OK', 'ERROR', 'RETRY_WAITING')
      ) AS sub
      WHERE __rn = ${beginLimit + 1}
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

    const result = await this.processRowData(rowData, syncJobId);
    return {
      syncJobId,
      itemIndex,
      processed: true,
      done: false,
      rowId: rowData.DocId || null,
      result,
    };
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
    const maxAttempts = 100; // Kiểm tra tối đa 100 lần theo yêu cầu
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
            `[Downloader] Mạng chập chờn. Chờ 10 giây để kiểm tra và tải lại lần ${attempt}/${maxAttempts}...`
          );
          await new Promise((resolve) => setTimeout(resolve, 10000)); // Đợi 10 giây (10000ms)
        }

        // Fix Circular Dependency: Gọi require động ngay trong lúc chạy
        const { downloadFile } = require('../../sync-file-copy/SharePointAuthService');

        // Bật bộ đếm log mỗi 1 phút để báo cáo trạng thái đang đợi
        let waitedMinutes = 0;
        const waitingInterval = setInterval(() => {
          waitedMinutes++;
          logger.info(`[Downloader] ⏳ Vẫn đang kiên nhẫn đợi SharePoint load file: ${rowData?.LeafName || fullUrl} ... (Đã đợi ${waitedMinutes} phút)`);
        }, 60000);

        try {
          // Truyền tham số timeout động vào hàm downloadFile
          buffer = await downloadFile(fullUrl, 0, loadTimeoutMs);
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

        // Lắp lại chốt chặn 404: Nếu máy chủ xác nhận file không tồn tại, dừng spam ngay để tiết kiệm thời gian
        if (err.message && err.message.includes('404')) {
          logger.warn(`[Downloader] Lỗi 404 Not Found. File thực sự không còn trên máy chủ. Dừng spam.`);
          break;
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
        const titleError = is404 ? 'Lỗi 404: File đã bị xóa khỏi SharePoint' : 'do đường truyền internet bị timeout';
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

      // XỬ LÝ ĐẶC BIỆT CHO LỖI 404: Không dừng Job, tự động chuyển sang file tiếp theo
      if (is404) {
        logger.warn(`[Downloader] Bỏ qua bài viết lỗi 404 và CHẠY TIẾP bài khác, không dừng Job.`);
        await this._markDownloadResult(docId, {
          status: 'ERROR', // 404 thì coi như lỗi vĩnh viễn
          error: errMsg,
          downloadedAt: null,
        });
        return { action: 'skipped_404', error: errMsg };
      }

      // Thay vì dừng Job, ta thông báo bài này sẽ được thử lại song song sau.
      logger.warn(`[Downloader] Đã chuyển bài viết ${rowData?.LeafName} sang trạng thái RETRY_WAITING. Sẽ thử lại sau.`);
      return { action: 'retry_queued', error: errMsg };
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
        parsedData = await this.htmlParser.parseHtmlFile(localPath);
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
            if (parsedData.images && Array.isArray(parsedData.images) && parsedData.images.length > 0) {
              const { downloadFile } = require('../../sync-file-copy/SharePointAuthService');
              const FileUploadService = require('../../sync-file-copy/Fileuploadservice');
              const fileUploader = new FileUploadService(this.newPool);

              await Promise.all(parsedData.images.map(async (img) => {
                if (!img.fullUrl) return;
                try {
                  const rawBaseName = path.basename(img.fullUrl.split('?')[0]);
                  let imgFileName = rawBaseName;
                  try { imgFileName = decodeURIComponent(rawBaseName); } catch(e) {}

                  const imgLocalPath = path.join(imgOutDir, imgFileName);

                  logger.info(`[Image Downloader] Đang tải ảnh từ SharePoint: ${img.fullUrl}`);
                  const imgBuffer = await downloadFile(img.fullUrl, 0, 60000); // Timeout 1 phút/ảnh

                  if (imgBuffer && imgBuffer.length > 0) {
                    // CHẠY SONG SONG: 1. Lưu ảnh cục bộ & 2. Upload API
                    const saveLocalTask = (async () => {
                      try {
                        await fs.promises.writeFile(imgLocalPath, imgBuffer);
                        logger.info(`[Image Downloader] Đã lưu ảnh cục bộ thành công: ${imgLocalPath}`);
                      } catch (err) {
                        logger.error(`[Image Downloader] ❌ Lỗi lưu ảnh cục bộ: ${err.message}`);
                      }
                    })();

                    const uploadApiTask = (async () => {
                      try {
                        const uploadRes = await fileUploader.uploadToNewSystem({
                          fileBuffer: imgBuffer,
                          originalName: imgFileName,
                          objectType: 'NEWS',
                          objectId: docId // Tạm dùng DocId làm ID liên kết
                        });

                        if (uploadRes && uploadRes.file_path) {
                          logger.info(`\n🚀🚀🚀 [API UPLOAD] ĐÃ ĐẨY ẢNH LÊN HỆ THỐNG MỚI THÀNH CÔNG! ĐƯỜNG DẪN MỚI: ${uploadRes.file_path} 🚀🚀🚀\n`);

                          // THAY THẾ URL ẢNH CŨ BẰNG URL MỚI TRONG NỘI DUNG BÀI VIẾT HTML
                          if (parsedData.content) {
                            if (img.originalUrl) parsedData.content = parsedData.content.split(img.originalUrl).join(uploadRes.file_path);
                            parsedData.content = parsedData.content.split(img.fullUrl).join(uploadRes.file_path);
                          }

                          // Cập nhật lại thumbnail nếu ảnh này là ảnh đại diện
                          if (parsedData.thumbnail === img.fullUrl || parsedData.thumbnail === img.originalUrl) {
                            parsedData.nameThumbnail = uploadRes.file_path;
                          }
                        }
                      } catch (upErr) {
                        logger.error(`[API UPLOAD] ❌ Lỗi khi đẩy ảnh lên hệ thống mới: ${upErr.message}`);
                      }
                    })();

                    // Đợi cả 2 tiến trình (lưu file và upload) hoàn tất cùng lúc
                    await Promise.all([saveLocalTask, uploadApiTask]);
                  }
                } catch (imgErr) {
                  logger.warn(`[Image Downloader] ❌ Lỗi khi tải ảnh ${img.fullUrl}: ${imgErr.message}`);
                }
              }));

              // Ghi đè lại file JSON để cập nhật các đường dẫn URL vừa được thay mới
              fs.writeFileSync(jsonFilePath, JSON.stringify(parsedData, null, 2), 'utf-8');
            }
          } catch (jsonErr) {
            logger.error(`[Parser Hook] Lỗi khi tạo file JSON hoặc tải ảnh: ${jsonErr.message}`);
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
      }
    } else {
      logger.warn(
        `[Processor] Bỏ qua file này (không phải bài viết News hoặc nằm trong danh mục loại trừ): ${docPath}`,
      );
    }

    // Step 3: Production Sync (news & audit) - Like sync-social-resource
    const actionLogs = [];
    if (parsedData) {
      const trans = new sql.Transaction(this.newPool);
      await trans.begin();
      try {
        const resultProd = await this.upsertToProduction(parsedData, trans);
        actionLogs.push({ table: 'news', action: resultProd.action });

        if (parsedData.isActive && resultProd.newsId) {
          await this.createAuditRecord(resultProd.newsId, parsedData.publishedAt, trans);
          actionLogs.push({ table: 'audit', action: 'DUYET' });
        }
        await trans.commit();
      } catch (e) {
        await trans.rollback();
        logger.error(`[Production Sync] Rollback for ${docPath}: ${e.message}`);
        actionLogs.push({ action: 'rollback', error: e.message });
      }
    }

    // Update staging status (temp table)
    await this._markDownloadResult(docId, {
      status: 'OK',
      error: null,
      downloadedAt: new Date(),
    });

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
                    updatedAt = GETDATE(),
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
                    @publishedAt, @status, GETDATE(), GETDATE(), @topic, @nameThumbnail,
                    1, 0, 0, @tags, 1, @DocId, @authorId,
                    @authorId, @authorName, GETDATE(), @submitterId, @authorName, GETDATE()
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
                created_at, updated_at, type_document
            ) VALUES (
                @newsId, @time, @userId, N'Hệ thống Migrator', 'ADMIN_NEWS', 'DUYET',
                N'{"autoApproved":true,"reason":"Migrate từ ASPX Job"}', @userId, @userId, 'HOAN_THANH', 'PUBLISHED',
                GETDATE(), GETDATE(), 'NEWS'
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
      logger.warn(`[SafeTrim] Truncating string: length ${val.length} > ${maxLen}. Prefix: ${val.substring(0, 50)}`);
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
      const pendingRows = await this.queryNewDb(`
        SELECT * FROM ${table} WHERE DownloadStatus = 'RETRY_WAITING'
      `);

      if (!pendingRows || pendingRows.length === 0) return;

      logger.info(`[RETRY] Phát hiện ${pendingRows.length} bài viết đang đợi thử lại. Bắt đầu xử lý song song...`);

      // Chia nhỏ để chạy song song (mỗi đợt 5 bài để không làm SharePoint "ngộp")
      const chunkSize = 5;
      for (let i = 0; i < pendingRows.length; i += chunkSize) {
        const chunk = pendingRows.slice(i, i + chunkSize);
        logger.info(`[RETRY] Đang xử lý nhóm bài viết ${i + 1} -> ${Math.min(i + chunkSize, pendingRows.length)}...`);
        
        await Promise.all(chunk.map(async (row) => {
          try {
            await this.processRowData(row, syncJobId);
          } catch (err) {
            logger.error(`[RETRY] Thử lại thất bại cho ${row.LeafName}: ${err.message}`);
          }
        }));
      }
      
      logger.info(`[RETRY] Hoàn tất quá trình thử lại song song.`);
    } catch (err) {
      logger.error(`[RETRY] Lỗi nghiêm trọng trong quá trình retry: ${err.message}`);
    }
  }
}

module.exports = StreamNewsAspxPageIncrementalModel;
