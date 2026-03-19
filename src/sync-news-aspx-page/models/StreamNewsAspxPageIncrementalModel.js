const logger = require('../../../utils/logger');
const sql = require('mssql');
const fs = require('fs');
const path = require('path');

const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const { downloadFile: spDownload } = require('../../sync-file-copy/SharePointAuthService');
const HtmlFileMigrationModel = require('../migrate/HtmlFileMigrationModel');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class StreamNewsAspxPageIncrementalModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'UNIT_TEST_STREAM_NEWS_ASPX_PAGE_INCREMENTAL' });
    this.newDbName = process.env.NEW_DB_NAME;
    this.newDbSchema = 'dbo';
    this.newTableSync = 'news_aspx_pages_temp';
    this.sharePointDb = process.env.SHAREPOINT_DB_NAME || 'WSS_Content_eoffice_khkd';

    // local output
    this.outputRoot =
      process.env.RAW_DOWNLOAD_DIR ||
      process.env.TINTUCRAW_DIR || 
      'tintucraw';
    
    // Parser for JSON extraction
    this.htmlParser = new HtmlFileMigrationModel();
    this.topicIds = [];
    this.adminId = null;
  }

  async initialize() {
    await super.initialize();
    await this.ensureStagingTableExists();

    // Link parser to the same pool
    this.htmlParser.newPool = this.newPool;
    await this.htmlParser.ensureSyncTableExists();

    // Lấy danh sách topicId từ DB mới để random giống Social Sync
    try {
        const rows = await this.queryNewDb(`SELECT id FROM ${this.newDbName}.dbo.topics WHERE status = 1 OR status IS NULL`);
        this.topicIds = rows.map(r => String(r.id));
        console.log(`[StreamNewsAspxPageIncrementalModel] Loaded ${this.topicIds.length} topic IDs.`);

        const adminRows = await this.queryNewDb(`SELECT id FROM ${this.newDbName}.dbo.users WHERE username = 'admin-tancang'`);
        this.adminId = adminRows?.[0]?.id || '6926bd32994b706c8b25118a';
        console.log(`[StreamNewsAspxPageIncrementalModel] Admin ID: ${this.adminId}`);
    } catch (error) {
        console.error('[StreamNewsAspxPageIncrementalModel] Failed to load topics/admin:', error.message);
    }
  }

  getStagingTableRef() {
    if (this.newDbName) return `${this.newDbName}.${this.newDbSchema}.${this.newTableSync}`;
    return `${this.newDbSchema}.${this.newTableSync}`;
  }

  normalizeSyncTime(value) {
    if (!value) return DEFAULT_SYNC_TIME;
    const dateValue = new Date(value);
    if (Number.isNaN(dateValue.getTime())) return DEFAULT_SYNC_TIME;
    return dateValue.toISOString();
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
        ) % 9007199254740991
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
  async getCount(lastSyncTime, lastSyncId = 0) {
    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);
    const limit = Number(process.env.COMPLETED_LIMIT || 0);

    const syncIdExpr = this.getSyncIdExpression();
    const query = `
      ;WITH src AS (
        SELECT
          d.[TimeLastModified] AS __sync_time,
          ${syncIdExpr}        AS __sync_id
        FROM [${this.sharePointDb}].[dbo].[AllDocs] d
        INNER JOIN [${this.sharePointDb}].[dbo].[AllWebs] w
          ON d.[SiteId] = w.[SiteId] AND d.[WebId]  = w.[Id]
        WHERE
          d.[DeleteTransactionId] = 0x0
          AND d.[IsCurrentVersion] = 1
          AND w.[FullUrl] LIKE '%tintuc%'
          AND d.[LeafName] LIKE '%.aspx'
      )
      SELECT COUNT(1) AS total
      FROM src
      WHERE (
        __sync_time > @lastSyncTime
        OR (
          __sync_time = @lastSyncTime
          AND __sync_id > @lastSyncId
        )
      )
    `;

    const rows = await this.queryOldDb(query, {
      lastSyncTime: normalizedLastSyncTime,
      lastSyncId: normalizedLastSyncId
    });

    const total = Number(rows?.[0]?.total || 0);
    if (Number.isFinite(limit) && limit > 0) {
      return Math.min(total, limit);
    }
    return total;
  }

  async ensureStagingTableExists() {
    const table = this.getStagingTableRef();
    // Ensure table + columns exist and are widened to expected size where safe.
    // We only auto-add missing columns and widen NVARCHAR sizes (safe); we avoid destructive type changes.
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

          CONSTRAINT PK_news_aspx_pages_temp PRIMARY KEY (DocId)
        );
      END

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
          ON ${table}(TimeLastModified, DocId);
      END
    `;

    await this.queryNewDb(query);
  }

  buildDocPath(row) {
    const dir = String(row?.DirName || '').replace(/^\/+/, '').replace(/\/+$/, '');
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
    const safeRel = String(docPath || '').replace(/^\/+/, '').replace(/[:*?"<>|]/g, '_');
    return path.join(process.cwd(), this.outputRoot, safeRel);
  }

  ensureLocalDirForFile(absFilePath) {
    const dir = path.dirname(absFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0, take = null, offset = null) {
    const syncIdExpr = this.getSyncIdExpression();
    const safeTake = Number.isFinite(Number(take)) && Number(take) > 0 ? Number(take) : null;
    const safeOffset = Number.isFinite(Number(offset)) && Number(offset) >= 0 ? Number(offset) : 0;
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
      )
      SELECT *
      FROM src
      WHERE (
        __sync_time > @lastSyncTime
        OR (
          __sync_time = @lastSyncTime
          AND __sync_id > @lastSyncId
        )
      )
      ORDER BY
        __sync_time ASC,
        __sync_id ASC,
        DocId ASC
      ${safeTake ? 'OFFSET @offset ROWS FETCH NEXT @take ROWS ONLY' : ''}
    `;

    return this.queryOldDb(query, {
      lastSyncTime,
      lastSyncId: Number(lastSyncId || 0),
      ...(safeTake ? { take: safeTake, offset: safeOffset } : {})
    });
  }

  async syncOldToStaging(rows, { transaction } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return { stagedCount: 0 };
    const table = this.getStagingTableRef();

    for (const row of rows) {
      const docPath = this.buildDocPath(row);
      const fullUrl = this.buildFullPageUrl(docPath);
      const localPath = this.buildLocalFilePath(docPath);

      const params = {
        DocId: row?.DocId,
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
      };

      const q = `
        IF EXISTS (SELECT 1 FROM ${table} WHERE DocId = @DocId)
        BEGIN
          UPDATE ${table}
          SET
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
            LocalFilePath = @LocalFilePath
          WHERE DocId = @DocId;
        END
        ELSE
        BEGIN
          INSERT INTO ${table} (
            DocId, DirName, LeafName, DocType, Size,
            TimeCreated, TimeLastModified, UIVersionString, Level,
            WebUrl, WebTitle, Language, ListTitle, tp_ServerTemplate, ListDescription,
            DocPath, FullPageUrl, LocalFilePath
          ) VALUES (
            @DocId, @DirName, @LeafName, @DocType, @Size,
            @TimeCreated, @TimeLastModified, @UIVersionString, @Level,
            @WebUrl, @WebTitle, @Language, @ListTitle, @tp_ServerTemplate, @ListDescription,
            @DocPath, @FullPageUrl, @LocalFilePath
          );
        END
      `;

      await this.queryNewDbTx(q, params, transaction);
    }

    return { stagedCount: rows.length };
  }

  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    if (!syncJobId) throw new Error('syncJobId is required');

    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);
    // Stage in small batches to avoid 19k-row single run taking too long.
    // Prefer using shared env knobs: BEGIN_LIMIT / COMPLETED_LIMIT (already used across other modules).
    const stageBatchSize = Number(
      process.env.COMPLETED_LIMIT ||
      process.env.TINTUC_STAGE_BATCH_SIZE ||
      300
    );
    const stageOffset = Number(process.env.BEGIN_LIMIT || 0);
    const rows = await this.fetchListFromOldDb(
      normalizedLastSyncTime,
      normalizedLastSyncId,
      Number.isFinite(stageBatchSize) && stageBatchSize > 0 ? stageBatchSize : null,
      Number.isFinite(stageOffset) && stageOffset >= 0 ? stageOffset : 0
    );
    const stageResult = await this.syncOldToStaging(rows);

    let nextSyncTime = normalizedLastSyncTime;
    let nextSyncId = normalizedLastSyncId;

    for (const row of rows) {
      const rowTime = row?.__sync_time ? new Date(row.__sync_time).toISOString() : null;
      const rowId = Number(row?.__sync_id || 0);
      if (!rowTime) continue;
      const ta = new Date(rowTime).getTime();
      const tb = new Date(nextSyncTime).getTime();
      if (ta > tb || (ta === tb && rowId > nextSyncId)) {
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
      { syncJobId }
    );
    return rows?.[0] || null;
  }

  async fetchOneFromStaging({ lastSyncTime, lastSyncId = 0, itemIndex, transaction } = {}) {
    const rowNumber = Number(itemIndex || 0) + 1;
    const table = this.getStagingTableRef();

    const syncIdExpr = `
      (
        ABS(
          CAST(
            SUBSTRING(
              HASHBYTES('SHA1', CONVERT(nvarchar(36), DocId)),
              1,
              8
            ) AS bigint
          )
        ) % 9007199254740991
      )
    `;

    const query = `
      ;WITH source_rows AS (
        SELECT
          *,
          TimeLastModified AS __sync_time,
          ${syncIdExpr} AS __sync_id_num
        FROM ${table}
      ),
      staged AS (
        SELECT
          *,
          ROW_NUMBER() OVER (
            ORDER BY
              __sync_time ASC,
              __sync_id_num ASC,
              DocId ASC
          ) AS rn
        FROM source_rows
        WHERE (
          __sync_time > @lastSyncTime
          OR (
            __sync_time = @lastSyncTime
            AND __sync_id_num > @lastSyncId
          )
        )
      )
      SELECT TOP 1 *
      FROM staged
      WHERE rn = @rowNumber
    `;

    const rows = await this.queryNewDbTx(
      query,
      { lastSyncTime, lastSyncId: Number(lastSyncId || 0), rowNumber },
      transaction
    );

    if (!rows?.length) return null;
    const row = { ...rows[0] };
    delete row.rn;
    return row;
  }

  async processOne(syncJobId, options = {}) {
    if (!syncJobId) throw new Error('syncJobId is required');

    const jobState = await this.getSyncJobState(syncJobId);
    const itemIndex = Number(
      options.itemIndex != null ? options.itemIndex : (jobState?.total_processed || 0)
    );

    const sourceLastSyncTime = this.normalizeSyncTime(
      options.sourceLastSyncTime || options.lastSyncTime || jobState?.last_sync_time || DEFAULT_SYNC_TIME
    );
    const sourceLastSyncId = Number(
      options.sourceLastSyncId != null ? options.sourceLastSyncId : (jobState?.last_sync_id || 0)
    );

    const rowData = await this.fetchOneFromStaging({
      lastSyncTime: sourceLastSyncTime,
      lastSyncId: sourceLastSyncId,
      itemIndex
    });

    if (!rowData) {
      return { syncJobId, itemIndex, processed: false, done: true };
    }

    const result = await this.processRowData(rowData);
    return {
      syncJobId,
      itemIndex,
      processed: true,
      done: false,
      rowId: rowData.DocId || null,
      result
    };
  }

  async processRowData(rowData) {
    const docId = rowData?.DocId;
    const docPath = String(rowData?.DocPath || '').trim();
    const fullUrl = String(rowData?.FullPageUrl || '').trim();
    const localPath = String(rowData?.LocalFilePath || '').trim();

    if (!docId) throw new Error('DocId is required');
    if (!docPath || !fullUrl || !localPath) {
      throw new Error(`Invalid staged row. docPath/fullUrl/localPath are required (DocId=${docId})`);
    }

    // Step 1: Download HTML
    let buffer;
    try {
      buffer = await spDownload(fullUrl);
    } catch (err) {
      await this._markDownloadResult(docId, {
        status: 'ERROR',
        error: err.message,
        downloadedAt: null
      });
      return { action: 'error', error: err.message };
    }

    const html = buffer.toString('utf8');
    this.ensureLocalDirForFile(localPath);
    fs.writeFileSync(localPath, html, 'utf8');

    // Step 2: Parse and Sync to intermediary staging table (news_aspx_new_sync)
    const isNewsArticle = docPath.endsWith('.aspx') 
        && !docPath.includes('/Forms/')
        && !docPath.includes('SitePages/')
        && !docPath.includes('SiteAssets/')
        && !docPath.includes('_catalogs/');

    let parsedData = null;
    if (isNewsArticle) {
        try {
            parsedData = await this.htmlParser.parseHtmlFile(localPath);
            await this.htmlParser.insertToSyncTable(parsedData);
        } catch (e) {
            logger.warn(`[Parser Hook] Parsing/Staging Error for ${docPath}: ${e.message}`);
        }
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
      downloadedAt: new Date()
    });

    return { 
        action: 'processed', 
        localPath,
        logs: actionLogs 
    };
  }

  async upsertToProduction(data, transaction) {
    const topic = this.topicIds.length > 0 
        ? String(this.topicIds[Math.floor(Math.random() * this.topicIds.length)]) 
        : null;
    const authorId = this.adminId;

    const query = `
        DECLARE @nid INT;
        IF EXISTS (SELECT 1 FROM dbo.news WHERE slug = @slug)
        BEGIN
            UPDATE dbo.news SET 
                title = @title, content = @content, authorName = @authorName, 
                publishedAt = @publishedAt, status = @status, updatedAt = GETDATE(),
                topic = @topic, authorId = @authorId
            WHERE slug = @slug;
            SELECT @nid = id FROM dbo.news WHERE slug = @slug;
            SELECT 'updated' AS action, @nid AS newsId;
        END
        ELSE
        BEGIN
            INSERT INTO dbo.news (title, slug, content, authorName, publishedAt, status, createdAt, updatedAt, topic, authorId, isComment, isSpecial, isImportant)
            VALUES (@title, @slug, @content, @authorName, @publishedAt, @status, GETDATE(), GETDATE(), @topic, @authorId, 1, 0, 0);
            SELECT SCOPE_IDENTITY() AS newsId, 'inserted' AS action;
        END
    `;
    const res = await this.queryNewDbTx(query, {
        title: data.title,
        slug: data.slug,
        content: data.content,
        authorName: data.authorName,
        publishedAt: data.publishedAt || new Date(),
        status: data.isActive ? 1 : 0,
        topic,
        authorId
    }, transaction);

    return {
        action: res?.[0]?.action || 'none',
        newsId: res?.[0]?.newsId || null
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
    await this.queryNewDbTx(query, {
        newsId: String(newsId),
        time: isNaN(date.getTime()) ? new Date() : date,
        userId: this.adminId
    }, transaction);
  }

  async _markDownloadResult(docId, { status, error, downloadedAt }, transaction = null) {
    const table = this.getStagingTableRef();
    const q = `
      UPDATE ${table}
      SET DownloadStatus = @status, DownloadError = @error, DownloadedAt = @downloadedAt
      WHERE DocId = @docId
    `;
    const params = { docId, status: status || null, error: error || null, downloadedAt: downloadedAt || null };
    if (transaction) {
        await this.queryNewDbTx(q, params, transaction);
    } else {
        await this.queryNewDb(q, params);
    }
  }
}

module.exports = StreamNewsAspxPageIncrementalModel;

