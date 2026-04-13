const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const { tableMappings } = require('./config');
const { v4: uuidv4 } = require('uuid');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class StreamSocialMigrationModel extends BaseIncrementalSyncInterface {
    constructor() {
        super({ modelName: 'STREAM_SOCIAL_RESOURCE_MIGRATION' });

        // Config bảng cũ
        this.oldConfig = tableMappings.news;

        this.oldDbName = this.oldConfig.oldDatabase;
        this.oldDbSchema = this.oldConfig.oldSchema;
        this.oldDbTable = this.oldConfig.oldTable;

        // Bảng staging tạm thời
        this.newDbName = this.oldConfig.newDatabase;
        this.newDbSchema = this.oldConfig.newSchema;
        this.newTableSync = 'social_resource_sync';

        this.topicIds = [];
        // Gioi han so luong ban ghi sync trong 1 job (0 = khong gioi han).
        this.maxSyncRows = Math.max(
            0,
            Number(process.env.STREAM_SOCIAL_SYNC_LIMIT || process.env.SOCIAL_SYNC_LIMIT || 0)
        );
    }

    async initialize() {
        await super.initialize();
        // Tự động tạo bảng staging nếu chưa có
        await this.ensureStagingTableExists();
        // Lấy danh sách topicId từ DB mới để random
        try {
            const rows = await this.queryNewDb(`SELECT id FROM ${this.newDbName}.dbo.topics`);
            this.topicIds = rows.map(r => String(r.id));
            console.log(`[StreamSocialMigrationModel] Loaded ${this.topicIds.length} topic IDs for random assignment.`);

            // Lấy thêm adminId fallback (admin-tancang)
            const adminRows = await this.queryNewDb(`SELECT id FROM ${this.newDbName}.dbo.users WHERE username = 'admin-tancang'`);
            this.adminId = adminRows?.[0]?.id || '6926bd32994b706c8b25118a';
            console.log(`[StreamSocialMigrationModel] Fallback Admin ID: ${this.adminId}`);
            console.log(`[StreamSocialMigrationModel] Sync row limit: ${this.maxSyncRows || 'ALL'}`);
        } catch (error) {
            console.error('[StreamSocialMigrationModel] Failed to load initial data:', error.message);
        }
    }

    /**
     * Tự động tạo bảng staging `social_resource_sync` trong DB mới nếu chưa tồn tại.
     * Clone cấu trúc từ bảng nguồn qua SELECT TOP 0 * INTO,
     * sau đó ALTER TABLE thêm các cột tracking cần thiết.
     */
        async ensureStagingTableExists() {
        try {
            const stagingTableRef = this.getStagingTableRef();
            const schema = this.newDbSchema || 'dbo';
            const table = this.newTableSync;

            const query = `
            IF NOT EXISTS (
                SELECT 1
                FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = '${schema}'
                AND TABLE_NAME = '${table}'
            )
            BEGIN
                CREATE TABLE ${stagingTableRef} (
                    SY_SyncId INT IDENTITY(1,1) PRIMARY KEY,
                    [__sync_time] DATETIME2 NULL,
                    [__sync_id_num] BIGINT NULL,

                    ID NVARCHAR(MAX) NULL,
                    ResourceUrl NVARCHAR(MAX) NULL,
                    Title NVARCHAR(MAX) NULL,
                    ItemId NVARCHAR(MAX) NULL,
                    ItemImage NVARCHAR(MAX) NULL,
                    ItemDepartmentId NVARCHAR(MAX) NULL,
                    PostTime NVARCHAR(MAX) NULL,
                    Author NVARCHAR(MAX) NULL,
                    ListId NVARCHAR(MAX) NULL,
                    SiteId NVARCHAR(MAX) NULL,
                    ResourceCategoryId NVARCHAR(MAX) NULL,
                    ResourceSubCategoryId NVARCHAR(MAX) NULL,
                    ViewCount NVARCHAR(MAX) NULL,
                    LikeCount NVARCHAR(MAX) NULL,
                    ShareCount NVARCHAR(MAX) NULL,
                    CommentCount NVARCHAR(MAX) NULL,
                    FlgArchived NVARCHAR(MAX) NULL,
                    FlgDeleted NVARCHAR(MAX) NULL,
                    LastAccess NVARCHAR(MAX) NULL,
                    Created NVARCHAR(MAX) NULL,
                    ResourceId NVARCHAR(MAX) NULL,
                    ThumbUrl NVARCHAR(MAX) NULL,
                    Description NVARCHAR(MAX) NULL,
                    ResourceData NVARCHAR(MAX) NULL,
                    FavoriteFolderCount NVARCHAR(MAX) NULL,
                    FavoriteCount NVARCHAR(MAX) NULL,
                    QnACount NVARCHAR(MAX) NULL,
                    Modified NVARCHAR(MAX) NULL,
                    [__sync_id] BIGINT NULL,
                    Subject NVARCHAR(MAX) NULL,
                    rn_dedup NVARCHAR(MAX) NULL
                );
            END
            `;

            await this.queryNewDb(query);

            console.log(`[ensureStagingTableExists] OK: ${stagingTableRef}`);

        } catch (err) {
            console.error(`[ensureStagingTableExists] ERROR: ${err.message}`);
            throw err;
        }
        }

    getStagingTableRef() {
        if (this.newDbName) {
            return `${this.newDbName}.${this.newDbSchema}.${this.newTableSync}`;
        }
        return `${this.newDbSchema}.${this.newTableSync}`;
    }

    sanitizeColumnName(column) {
        if (!/^[A-Za-z0-9_]+$/.test(column)) {
            throw new Error(`Invalid column name from source: ${column}`);
        }
        return `[${column}]`;
    }

    normalizeSyncTime(value) {
        if (!value) return DEFAULT_SYNC_TIME;
        const dateValue = new Date(value);
        if (Number.isNaN(dateValue.getTime())) return DEFAULT_SYNC_TIME;
        return dateValue.toISOString();
    }

    extractRowSyncTime(row) {
        const raw = row?.__sync_time || row?.Modified || row?.Created || row?.PostTime || null;
        if (!raw) return null;
        const dateValue = new Date(raw);
        if (Number.isNaN(dateValue.getTime())) return null;
        return dateValue.toISOString();
    }

    extractRowSyncId(row) {
        // ID cũ là string (UUID), convert sang numeric/hash để sort index cho đúng (nếu cần)
        // Tạm thời để string so sánh, hoặc dùng checksum bigint.
        return row?.__sync_id_num || 0;
    }

    isCursorAhead(aTime, aId, bTime, bId) {
        const ta = new Date(aTime || DEFAULT_SYNC_TIME).getTime();
        const tb = new Date(bTime || DEFAULT_SYNC_TIME).getTime();
        if (ta > tb) return true;
        if (ta < tb) return false;
        return Number(aId || 0) > Number(bId || 0);
    }

    async fetchListFromOldDb(lastSyncTime, lastSyncId = 0, offset = 0, limit = 2000) {
        // Giả định bảng cũ là Social_otherResource (DataEOfficeSNP)
        // Sử dụng ROW_NUMBER() OVER (PARTITION BY r.ID) để khử trùng bản ghi (thực tế dữ liệu cũ đang bị nhân đôi do lỗi quét/insert)
        const query = `
      ;WITH source_rows AS (
        SELECT
          r.*,
          ci.Subject,
          -- Loại bỏ các date rác (vd PostTime = 6065), chỉ lấy chuỗi dài hơn 4 ký tự và valid
          COALESCE(
             CASE WHEN LEN(r.Modified) > 4 AND TRY_CONVERT(datetime2, r.Modified) IS NOT NULL AND YEAR(TRY_CONVERT(datetime2, r.Modified)) BETWEEN 1970 AND 2099 THEN TRY_CONVERT(datetime2, r.Modified) ELSE NULL END,
             CASE WHEN LEN(r.Created) > 4 AND TRY_CONVERT(datetime2, r.Created) IS NOT NULL AND YEAR(TRY_CONVERT(datetime2, r.Created)) BETWEEN 1970 AND 2099 THEN TRY_CONVERT(datetime2, r.Created) ELSE NULL END,
             CASE WHEN LEN(r.PostTime) > 4 AND TRY_CONVERT(datetime2, r.PostTime) IS NOT NULL AND YEAR(TRY_CONVERT(datetime2, r.PostTime)) BETWEEN 1970 AND 2099 THEN TRY_CONVERT(datetime2, r.PostTime) ELSE NULL END,
             '1970-01-01T00:00:00.000Z'
          ) AS __sync_time,
          CHECKSUM(r.ID) AS __sync_id_num,
          ROW_NUMBER() OVER (PARTITION BY r.ID ORDER BY r.PostTime DESC, r.Created DESC) as rn_dedup
        FROM ${this.oldDbName}.${this.oldDbSchema}.${this.oldDbTable} r
        OUTER APPLY (
            SELECT TOP 1 Subject
            FROM ${this.oldDbName}.SNP.CodeItem
            WHERE SPItemId = r.ItemId
            ORDER BY ID DESC -- Lấy bản ghi mới nhất nếu có nhiều Subject
        ) ci
      )
      SELECT
        *,
        ISNULL(__sync_id_num, 0) AS __sync_id
      FROM source_rows
      WHERE rn_dedup = 1 AND (
        __sync_time > @lastSyncTime
        OR (
          __sync_time = @lastSyncTime
          AND ISNULL(__sync_id_num, -2147483648) > @lastSyncId
        )
      )
      ORDER BY
        __sync_time ASC,
        ISNULL(__sync_id_num, -2147483648) ASC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `;

        const params = {
            lastSyncTime,
            lastSyncId: Number(lastSyncId || 0),
            offset: Number(offset || 0),
            limit: Number(limit || 2000)
        };

        return this.queryOldDb(query, params);
    }

    async getCount(lastSyncTime, lastSyncId = 0) {
        const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
        const normalizedLastSyncId = Number(lastSyncId || 0);
        const query = `
            ;WITH source_rows AS (
                SELECT
                    r.ID,
                    COALESCE(
                        CASE WHEN LEN(r.Modified) > 4 AND TRY_CONVERT(datetime2, r.Modified) IS NOT NULL AND YEAR(TRY_CONVERT(datetime2, r.Modified)) BETWEEN 1970 AND 2099 THEN TRY_CONVERT(datetime2, r.Modified) ELSE NULL END,
                        CASE WHEN LEN(r.Created) > 4 AND TRY_CONVERT(datetime2, r.Created) IS NOT NULL AND YEAR(TRY_CONVERT(datetime2, r.Created)) BETWEEN 1970 AND 2099 THEN TRY_CONVERT(datetime2, r.Created) ELSE NULL END,
                        CASE WHEN LEN(r.PostTime) > 4 AND TRY_CONVERT(datetime2, r.PostTime) IS NOT NULL AND YEAR(TRY_CONVERT(datetime2, r.PostTime)) BETWEEN 1970 AND 2099 THEN TRY_CONVERT(datetime2, r.PostTime) ELSE NULL END,
                        '1970-01-01T00:00:00.000Z'
                    ) AS __sync_time,
                    CHECKSUM(r.ID) AS __sync_id_num,
                    ROW_NUMBER() OVER (PARTITION BY r.ID ORDER BY r.PostTime DESC, r.Created DESC) AS rn_dedup
                FROM ${this.oldDbName}.${this.oldDbSchema}.${this.oldDbTable} r
            )
            SELECT COUNT(*) AS total
            FROM source_rows
            WHERE rn_dedup = 1 AND (
                __sync_time > @lastSyncTime
                OR (
                    __sync_time = @lastSyncTime
                    AND ISNULL(__sync_id_num, -2147483648) > @lastSyncId
                )
            )
        `;
        const result = await this.queryOldDb(query, {
            lastSyncTime: normalizedLastSyncTime,
            lastSyncId: normalizedLastSyncId
        });
        const total = Number(result?.[0]?.total || 0);
        if (this.maxSyncRows > 0) {
            return Math.min(total, this.maxSyncRows);
        }
        return total;
    }

    async syncOldToStaging(rows, { transaction } = {}) {
        if (!Array.isArray(rows) || rows.length === 0) {
            return { stagedCount: 0 };
        }

        const internalColumns = new Set(['__sync_time', '__sync_id', '__sync_id_num']);
        const columns = Object.keys(rows[0] || {}).filter((column) => !internalColumns.has(column));
        if (!columns.length) return { stagedCount: 0 };

        if (!columns.includes('ID')) {
            throw new Error('Staging sync requires source column "ID"');
        }

        // Bảng staging đã được tạo trong ensureStagingTableExists() lúc initialize.
        // Tự động thêm cột mới nếu source có thêm cột (vd: join mới)
        const alterStagingQuery = `
            ${columns.map(c => `
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'${this.newDbName}.${this.newDbSchema}.${this.newTableSync}') AND name = N'${c}')
            BEGIN
                ALTER TABLE ${this.newDbName}.${this.newDbSchema}.${this.newTableSync} ADD ${this.sanitizeColumnName(c)} nvarchar(max) null;
            END`).join('\n')}
        `;
        await this.queryNewDbTx(alterStagingQuery, {}, transaction);

        const safeColumns = columns.map((column) => this.sanitizeColumnName(column));
        const nonIdColumns = columns.filter((column) => column !== 'ID');
        const safeNonIdColumns = nonIdColumns.map((column) => this.sanitizeColumnName(column));
        const stagingTableRef = this.getStagingTableRef();

        for (const row of rows) {
            const params = {};
            for (const column of columns) {
                params[column] = row[column] != null ? String(row[column]) : null;
            }
            params.__sync_time = row.__sync_time || null;
            params.__sync_id_num = row.__sync_id_num || 0;

            const updateClause = safeNonIdColumns
                .map((columnName, idx) => `${columnName} = @${nonIdColumns[idx]}`)
                .join(', ');

            const query = `
        IF EXISTS (SELECT 1 FROM ${stagingTableRef} WHERE ID = @ID)
        BEGIN
          ${nonIdColumns.length > 0 ? `
          UPDATE ${stagingTableRef}
          SET ${updateClause}, __sync_time = @__sync_time, __sync_id_num = @__sync_id_num
          WHERE ID = @ID;` : `SELECT 1 AS noop;`}
        END
        ELSE
        BEGIN
          INSERT INTO ${stagingTableRef} (${safeColumns.join(', ')}, [__sync_time], [__sync_id_num])
          VALUES (${columns.map((column) => `@${column}`).join(', ')}, @__sync_time, @__sync_id_num);
        END
      `;

            await this.queryNewDbTx(query, params, transaction);
        }

        return { stagedCount: rows.length };
    }

    async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
        if (!syncJobId) throw new Error('syncJobId is required');

        const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
        const normalizedLastSyncId = Number(lastSyncId || 0);

        const totalCount = await this.getCount(normalizedLastSyncTime, normalizedLastSyncId);
        console.log(`[StreamSocialMigrationModel] Total records needing sync: ${totalCount}`);

        // Cập nhật Dashboard ngay lập tức để người dùng thấy tổng số bản ghi
        await this.queryNewDb(`UPDATE sync_jobs SET total_to_sync = @total WHERE job_id = @jobId`, {
            total: totalCount,
            jobId: syncJobId
        });

        const fetchBatchSize = Number(process.env.STAGING_FETCH_BATCH_SIZE || 2000);
        const numIterations = Math.ceil(totalCount / fetchBatchSize);

        let totalStagedCount = 0;
        let nextSyncTime = normalizedLastSyncTime;
        let nextSyncId = normalizedLastSyncId;

        for (let i = 0; i < numIterations; i++) {
            const offset = i * fetchBatchSize;
            logger.info(`[StreamSocialMigrationModel] Fetching batch ${i + 1}/${numIterations} (Offset: ${offset}, Limit: ${fetchBatchSize})`);

            const rows = await this.fetchListFromOldDb(normalizedLastSyncTime, normalizedLastSyncId, offset, fetchBatchSize);
            if (!rows || rows.length === 0) break;

            const stageResult = await this.syncOldToStaging(rows);
            totalStagedCount += Number(stageResult?.stagedCount || rows.length || 0);

            // Cập nhật cursor và LOG chi tiết từng bản ghi
            for (const row of rows) {
                const rowTime = this.extractRowSyncTime(row);
                const rowId = this.extractRowSyncId(row);
                if (!rowTime) continue;

                const isAhead = this.isCursorAhead(rowTime, rowId, nextSyncTime, nextSyncId);
                logger.info(`  └─ [Compare] rowID: ${row.ID} | T: ${rowTime} ID: ${rowId} vs Cursor(T: ${nextSyncTime} ID: ${nextSyncId}) -> Ahead: ${isAhead}`);

                if (isAhead) {
                    nextSyncTime = rowTime;
                    nextSyncId = rowId;
                }
            }
            logger.info(`🔥 [StreamSocialMigrationModel] Batch ${i + 1}/${numIterations} staged: ${totalStagedCount}/${totalCount}. LastSyncTime: ${nextSyncTime}, LastSyncId: ${nextSyncId}`);
        }

        return {
            syncJobId,
            rows: [],
            totalCount: totalCount,
            stagedCount: totalStagedCount,
            sourceLastSyncTime: normalizedLastSyncTime,
            sourceLastSyncId: normalizedLastSyncId,
            lastSyncTime: nextSyncTime,
            lastSyncId: nextSyncId,
            appliedLimit: this.maxSyncRows > 0 ? this.maxSyncRows : null
        };
    }

    async getSyncJobState(syncJobId) {
        if (!syncJobId) throw new Error('syncJobId is required');
        const rows = await this.queryNewDb(
            `SELECT TOP 1 job_id, total_to_sync, total_processed, total_success, total_errors, last_sync_time, last_sync_id
       FROM sync_jobs WHERE job_id = @syncJobId`,
            { syncJobId }
        );
        return rows?.[0] || null;
    }

    async fetchOneFromStaging({ lastSyncTime, lastSyncId = 0, itemIndex, transaction } = {}) {
        const rowNumber = Number(itemIndex || 0) + 1;
        const stagingTableRef = this.getStagingTableRef();
        const query = `
      ;WITH staged AS (
        SELECT *, ROW_NUMBER() OVER (
            ORDER BY __sync_time ASC, ISNULL(__sync_id_num, -2147483648) ASC, ID ASC
        ) AS rn
        FROM ${stagingTableRef}
        WHERE (__sync_time > @lastSyncTime OR (__sync_time = @lastSyncTime AND ISNULL(__sync_id_num, -2147483648) > @lastSyncId))
      )
      SELECT TOP 1 * FROM staged WHERE rn = @rowNumber
    `;

        const rows = await this.queryNewDbTx(query, {
            lastSyncTime, lastSyncId: Number(lastSyncId || 0), rowNumber
        }, transaction);

        if (!rows?.length) return null;
        const row = { ...rows[0] };
        delete row.rn;
        return row;
    }

    async processOne(syncJobId, options = {}) {
        if (!syncJobId) throw new Error('syncJobId is required');

        const jobState = await this.getSyncJobState(syncJobId);
        const itemIndex = Number(options.itemIndex != null ? options.itemIndex : (jobState?.total_processed || 0));
        const sourceLastSyncTime = this.normalizeSyncTime(options.sourceLastSyncTime || options.lastSyncTime || jobState?.last_sync_time || DEFAULT_SYNC_TIME);
        const sourceLastSyncId = Number(options.sourceLastSyncId != null ? options.sourceLastSyncId : (jobState?.last_sync_id || 0));

        const rowData = await this.fetchOneFromStaging({
            lastSyncTime: sourceLastSyncTime,
            lastSyncId: sourceLastSyncId,
            itemIndex,
        });

        if (!rowData) {
            return { syncJobId, itemIndex, processed: false, done: true };
        }

        const result = await this.processRowData(rowData);
        return {
            syncJobId, itemIndex, processed: true, done: false,
            rowId: rowData.ID || null,
            result
        };
    }

    /**
     * processFn cốt lõi để transform và nạp vào 4 bảng mới
     */
    async processRowData(rowData, { transaction } = {}) {
        if (!rowData?.ID) throw new Error('ID from old record is required (Social_otherResource.ID)');

        const recordId = String(rowData.ID);
        let totalAffected = 0;
        const actionLogs = [];

        // 1. Sync News table
        const randomTopicId = this.topicIds.length > 0
            ? this.topicIds[Math.floor(Math.random() * this.topicIds.length)]
            : (rowData.topic || null);

        // Fallback author if missing
        const authorId = rowData.Author && rowData.Author !== 'NULL' ? rowData.Author : this.adminId;

        const resultNews = await this.upsertDataToNewDB(rowData, {
            ...tableMappings.news,
            fixedValues: {
                topic: randomTopicId,
                authorId: authorId
            }
        }, 'topic', recordId, transaction);
        totalAffected += resultNews.affected;
        actionLogs.push({ table: 'news', action: resultNews.action });

        // 1.5 Sync Audit table để xác nhận news này đã xuất bản
        if (resultNews.newsId) {
            const author = authorId; // Đồng bộ authorId giữa news và audit
            let publishTime = rowData.__sync_time || new Date().toISOString();
            let publishDate = new Date(publishTime);
            if (Number.isNaN(publishDate.getTime())) {
                publishDate = new Date();
            }

            const auditQuery = `
            IF NOT EXISTS (SELECT 1 FROM ${process.env.NEW_DB_NAME}.dbo.audit WHERE document_id = @newsId AND type_document = 'NEWS' AND action_code = 'DUYET')
            BEGIN
                INSERT INTO ${process.env.NEW_DB_NAME}.dbo.audit (
                    document_id, time, user_id, display_name, role, action_code,
                    details, created_by, receiver, stage_status, curStatusCode,
                    created_at, updated_at, type_document
                ) VALUES (
                    @newsId, @publishTime, @author, N'Hệ thống Migrator', 'ADMIN_NEWS', 'DUYET',
                    N'{"autoApproved":true,"reason":"Migrate từ hệ thống cũ"}', @author, @author, 'HOAN_THANH', 'PUBLISHED',
                    @publishTime, @publishTime, 'NEWS'
                )
            END
            `;
            await this.queryNewDbTx(auditQuery, {
                newsId: String(resultNews.newsId),
                publishTime: publishDate,
                author: String(author)
            }, transaction);
        }

        return {
            backupId: recordId,
            affected: totalAffected,
            logs: actionLogs
        };
    }

    async getExistingColumns(tableName, schema = 'dbo') {
        const result = await this.queryNewDb(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @tableName AND TABLE_SCHEMA = @schema`, { tableName, schema });
        return new Set(result.map(r => r.COLUMN_NAME.toLowerCase()));
    }

    async upsertDataToNewDB(rawData, config, externalKeyField, externalKeyValue, transaction) {
        const { newTable, newSchema, newDatabase, fieldMapping, defaultValues, fixedValues } = config;
        const existingCols = await this.getExistingColumns(newTable, newSchema);

        // Prepare Data
        const params = {};
        const insertCols = [];
        const insertVals = [];
        const updateSet = [];

        // Tự động sinh ID nếu bảng có cột 'id' (case-insensitive) nhưng mapping không có
        if (existingCols.has('id') && !params.hasOwnProperty('id')) {
            const hasIdInMapping = Object.values(fieldMapping).some(v => v.toLowerCase() === 'id') ||
                                  Object.keys(defaultValues || {}).some(v => v.toLowerCase() === 'id') ||
                                  Object.keys(fixedValues || {}).some(v => v.toLowerCase() === 'id');
            if (!hasIdInMapping) {
                // Kiểm tra xem ID có phải là IDENTITY không? Ở đây Social target table 'news' có vẻ dùng IDENTITY
                // nhưng để chắc chắn, ta kiểm tra nếu mapping không cung cấp ID thì ta để DB tự sinh HOẶC ta sinh UUID.
                // Thường các bảng render mới dùng UUID NVARCHAR(255).
                // Nếu resultNews.newsId dùng SCOPE_IDENTITY() thì news.id là INT IDENTITY.
                // Trong trường hợp đó, ta KHÔNG nên chèn ID thủ công.
            }
        }

        // 1. Map fields from source
        for (const [oldField, newField] of Object.entries(fieldMapping)) {
            if (!existingCols.has(newField.toLowerCase())) continue;
            if (rawData[oldField] !== undefined) {
                params[newField] = rawData[oldField];
            }
        }

        // 2. Add default values (computed or fixed)
        for (const [newField, valueFn] of Object.entries(defaultValues || {})) {
            if (!existingCols.has(newField.toLowerCase())) continue;
            if (!params.hasOwnProperty(newField)) {
                params[newField] = typeof valueFn === 'function' ? valueFn(rawData) : valueFn;
            }
        }

        // 3. Add fixed values (overrides)
        for (const [newField, value] of Object.entries(fixedValues || {})) {
            if (!existingCols.has(newField.toLowerCase())) continue;
            params[newField] = value;
        }

        // 4. Build SQL fragments
        for (const [newField, value] of Object.entries(params)) {
            insertCols.push(this.sanitizeColumnName(newField));
            insertVals.push(`@${newField}`);

            // 🔥 NEVER update ID or created_at
            if (newField.toLowerCase() !== 'id' && newField.toLowerCase() !== 'created_at') {
                updateSet.push(`${this.sanitizeColumnName(newField)} = @${newField}`);
            }
        }

        // Upsert query pattern based on external key (vd: topic = ID UUID)
        params._externalKeyValue = externalKeyValue;

        const tableRef = `[${newDatabase}].[${newSchema}].[${newTable}]`;
        const query = `
          DECLARE @OutputTable TABLE (id NVARCHAR(255));
          DECLARE @affected INT;

          IF EXISTS (SELECT 1 FROM ${tableRef} WHERE ${this.sanitizeColumnName(externalKeyField)} = @_externalKeyValue)
          BEGIN
              UPDATE ${tableRef} SET ${updateSet.length ? updateSet.join(', ') : `${this.sanitizeColumnName(externalKeyField)} = ${this.sanitizeColumnName(externalKeyField)}`}
              OUTPUT INSERTED.id INTO @OutputTable
              WHERE ${this.sanitizeColumnName(externalKeyField)} = @_externalKeyValue;

              SELECT @affected = @@ROWCOUNT;
              SELECT (SELECT TOP 1 id FROM @OutputTable) AS id, @affected AS affected, 'updated' AS action;
          END
          ELSE
          BEGIN
              INSERT INTO ${tableRef} (${insertCols.join(', ')})
              OUTPUT INSERTED.id INTO @OutputTable
              VALUES (${insertVals.join(', ')});

              SELECT @affected = @@ROWCOUNT;
              SELECT (SELECT TOP 1 id FROM @OutputTable) AS id, @affected AS affected, 'inserted' AS action;
          END
        `;

        const result = await this.queryNewDbTx(query, params, transaction);
        const row = Array.isArray(result) ? result[0] : result;
        return {
            id: row?.id || null,
            action: row?.action || (row?.affected ? 'updated' : 'none'),
            affected: Number(row?.affected || 0),
            newsId: row?.id || null // For Social compatibility
        };
    }

}

module.exports = StreamSocialMigrationModel;
