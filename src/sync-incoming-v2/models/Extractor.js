const BaseExtractor = require('../../sync-base/BaseExtractor');
const logger = require('../../../utils/logger');
const sql = require('mssql');

/**
 * Extractor for incoming documents (VanBanDen → incomming_documents_sync_{instanceId})
 *
 * KEY DIFFERENCES vs Outgoing Extractor:
 * - Source table: VanBanDen (not VanBanBanHanh)
 * - Cursor direction: ASC (oldest-first, start from 1753-01-01)
 * - Staging table base: incomming_documents_sync
 * - Partition column: NgayDen
 * - SYNC_MIN_DATE: resolves from SYNC_START_DATE if earlier (incoming goes further back)
 */
class Extractor extends BaseExtractor {
  constructor() {
    super({
      modelName: 'INCOMING_EXTRACTOR',
      oldDbTable: 'VanBanDen',
      oldDbSchema: 'dbo',
      stagingTableBaseName: 'incomming_documents_sync',
      partitionColumn: 'NgayDen'
    });

    this.newDbName = process.env.NEW_DB_NAME;

    // Incoming: ASC từ quá khứ lên hiện tại
    this._defaultSyncTime = '1753-01-01T00:00:00.000Z';

    // Effective SYNC_MIN_DATE: nếu SYNC_START_DATE sớm hơn thì dùng SYNC_START_DATE
    this._syncMinDate = this._resolveEffectiveSyncMinDate();
  }

  // ──────────────────────────────────────────────
  // Cursor direction: ASC (incoming goes forward in time)
  // ──────────────────────────────────────────────
  getCursorDirection() {
    return 'ASC';
  }

  _resolveEffectiveSyncMinDate() {
    const configuredMinDate = this._normalizeDate(process.env.SYNC_MIN_DATE);
    const configuredStartDate = this._normalizeDate(process.env.SYNC_START_DATE);

    if (configuredMinDate && configuredStartDate) {
      return new Date(configuredStartDate) < new Date(configuredMinDate)
        ? configuredStartDate
        : configuredMinDate;
    }

    return configuredMinDate || configuredStartDate || this._defaultSyncTime;
  }

  _normalizeDate(value) {
    if (!value) return null;
    const d = new Date(String(value).trim());
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  /**
   * Get SQL expression that normalizes source sync time.
   * Since the old DB format is strictly 'yyyy-MM-dd HH:mm:ss.fff', we use style 121
   * for the fastest and most optimal conversion.
   */
  getSyncTimeExpression() {
    return `
      COALESCE(
        TRY_CONVERT(datetime2, Modified, 121),
        TRY_CONVERT(datetime2, Created, 121),
        TRY_CONVERT(datetime2, Modified, 120),
        TRY_CONVERT(datetime2, Created, 120),
        TRY_CONVERT(datetime2, Modified, 105),
        TRY_CONVERT(datetime2, Created, 105),
        TRY_CONVERT(datetime2, [NgayDen], 105),
        TRY_CONVERT(datetime2, [NgayDen], 120),
        TRY_CONVERT(datetime2, [NgayDen], 121),
        TRY_CONVERT(datetime2, [NgayTrenVB], 105),
        TRY_CONVERT(datetime2, [NgayTrenVB], 120),
        TRY_CONVERT(datetime2, [NgayTrenVB], 121),
        TRY_CONVERT(datetime2, Modified),
        TRY_CONVERT(datetime2, Created),
        TRY_CONVERT(datetime2, [NgayDen]),
        TRY_CONVERT(datetime2, [NgayTrenVB]),
        '1753-01-01T00:00:00.000Z'
      )
    `.trim();
  }

  /**
   * Get SQL expression that safely normalizes and converts the partition column (NgayDen) to datetime2.
   * Prioritizes Created and Modified first (using style 121), and falls back to NgayDen with style checks.
   * Prevents crash if the legacy columns contain malformed or empty strings.
   */
  getPartitionColumnExpression() {
    return `
      COALESCE(
        TRY_CONVERT(datetime2, [Created], 121),
        TRY_CONVERT(datetime2, [Modified], 121),
        TRY_CONVERT(datetime2, [${this.partitionColumn}], 105),
        TRY_CONVERT(datetime2, [${this.partitionColumn}], 120),
        TRY_CONVERT(datetime2, [${this.partitionColumn}], 121),
        TRY_CONVERT(datetime2, [${this.partitionColumn}])
      )
    `.trim();
  }

  /**
   * Get the last successfully extracted record's cursor from the staging table.
   * Finds the maximum __sync_time and __sync_id of records already in staging.
   */
  async getLastSyncCursor(instanceId) {
    const stagingTable = this.getStagingTableName(instanceId);
    try {
      const query = `
        SELECT TOP 1 __sync_time, __sync_id
        FROM ${stagingTable}
        WHERE __sync_time IS NOT NULL AND __sync_id IS NOT NULL
        ORDER BY __sync_time DESC, __sync_id DESC
      `;
      const result = await this.newPool.request().query(query);
      if (result.recordset?.length > 0) {
        const row = result.recordset[0];
        return {
          time: row.__sync_time ? new Date(row.__sync_time).toISOString() : null,
          id: Number(row.__sync_id || 0)
        };
      }
    } catch (error) {
      logger.warn(`[${this.modelName}] getLastSyncCursor failed or staging table does not exist: ${error.message}`);
    }
    return { time: null, id: 0 };
  }

  /**
   * Get initial sync time (earliest time) for ASC sync
   * Fetches all records from the past if no last sync time exists.
   */
  getInitialSyncTime() {
    return '1753-01-01T00:00:00.000Z';
  }

  // ──────────────────────────────────────────────
  // Fetch batch từ VanBanDen (ASC order)
  // ──────────────────────────────────────────────

  async fetchBatchFromOldDb(lastSyncTime, lastSyncId = 0, batchSize = 1000, offset = 0) {
    const syncTimeExpr = this.getSyncTimeExpression();

    // Incoming: start từ DEFAULT nếu không có cursor hợp lệ
    const isValidTime = lastSyncTime &&
      lastSyncTime !== '2100-01-01T00:00:00.000Z' &&
      !Number.isNaN(new Date(lastSyncTime).getTime()) &&
      new Date(lastSyncTime).getFullYear() > 1000;

    const effectiveSyncTime = isValidTime ? lastSyncTime : this._defaultSyncTime;

    // Guard: chặn cursor tương lai để tránh skip toàn bộ data
    const maxAllowed = new Date(Date.now() + 8 * 60 * 60 * 1000);
    if (new Date(effectiveSyncTime) > maxAllowed) {
      logger.warn(`[${this.modelName}] Cursor tương lai bị reset về DEFAULT: ${effectiveSyncTime}`);
      lastSyncTime = this._defaultSyncTime;
    }

    const syncMinDate = this._syncMinDate;
    const startDate = process.env.SYNC_START_DATE || null;
    const endDate = process.env.SYNC_END_DATE || '2100-01-01T00:00:00.000Z';
    const partitionExpr = this.getPartitionColumnExpression();

    const query = `
      ;WITH source_rows AS (
        SELECT
          *,
          N'${this.oldDbTable}' AS __source_table,
          ${syncTimeExpr} AS __sync_time,
          TRY_CONVERT(
            BIGINT,
            NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), '')
          ) AS __sync_id_num
        FROM ${this.oldDbSchema}.${this.oldDbTable}
        WHERE 1=1
          AND (${partitionExpr} >= @startDate OR @startDate IS NULL)
          AND (${partitionExpr} <= @endDate OR @endDate IS NULL)
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
        WHERE (
          @lastSyncTime = '1753-01-01T00:00:00.000Z'
          OR __sync_time > @lastSyncTime
          OR (
            __sync_time = @lastSyncTime
            AND ISNULL(__sync_id_num, 0) > @lastSyncId
          )
        )
        AND __sync_time >= @syncMinDate
      ) AS t
      WHERE __page_rn > @offset
        AND __page_rn <= (@offset + @limit)
      ORDER BY __page_rn
    `;

    logger.info(
      `[${this.modelName}] Fetching batch: lastSyncTime=${effectiveSyncTime}, ` +
      `lastSyncId=${lastSyncId}, limit=${batchSize}, offset=${offset}`
    );

    try {
      const results = await this.oldPool.request()
        .input('lastSyncTime', sql.DateTime2, effectiveSyncTime)
        .input('lastSyncId', sql.BigInt, Number(lastSyncId || 0))
        .input('limit', sql.Int, batchSize)
        .input('offset', sql.Int, offset)
        .input('startDate', sql.DateTime2, startDate)
        .input('endDate', sql.DateTime2, endDate)
        .input('syncMinDate', sql.DateTime2, syncMinDate)
        .query(query);

      const count = results.recordset?.length || 0;
      logger.debug(`[${this.modelName}] Query completed. Row count: ${count}`);

      if (count > 0) {
        const first = results.recordset[0];
        const last = results.recordset[count - 1];
        logger.debug(
          `[${this.modelName}] Batch range: [${first.__sync_time}, ID=${first.ID}] ` +
          `to [${last.__sync_time}, ID=${last.ID}]`
        );
      }

      return results.recordset || [];
    } catch (error) {
      logger.error(`[${this.modelName}] fetchBatchFromOldDb failed! Error: ${error.message}`);
      logger.error(
        `[${this.modelName}] Query Params: lastSyncTime=${effectiveSyncTime}, ` +
        `lastSyncId=${lastSyncId}, startDate=${startDate}, endDate=${endDate}`
      );
      throw error;
    }
  }

  /**
   * countListFromOldDb - Đếm tổng số bản ghi từ CSDL cũ (VanBanDen)
   */
  async countListFromOldDb(lastSyncTime, lastSyncId = 0) {
    const syncTimeExpr = this.getSyncTimeExpression();
    const isValidTime = lastSyncTime &&
      lastSyncTime !== '2100-01-01T00:00:00.000Z' &&
      !Number.isNaN(new Date(lastSyncTime).getTime()) &&
      new Date(lastSyncTime).getFullYear() > 1000;

    const effectiveSyncTime = isValidTime ? lastSyncTime : this._defaultSyncTime;
    const syncMinDate = this._syncMinDate;
    const startDate = process.env.SYNC_START_DATE || null;
    const endDate = process.env.SYNC_END_DATE || '2100-01-01T00:00:00.000Z';
    const partitionExpr = this.getPartitionColumnExpression();

    const query = `
      ;WITH source_rows AS (
        SELECT
          ${syncTimeExpr} AS __sync_time,
          TRY_CONVERT(
            BIGINT,
            NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), '')
          ) AS __sync_id_num
        FROM ${this.oldDbSchema}.${this.oldDbTable}
        WHERE 1=1
          AND (${partitionExpr} >= @startDate OR @startDate IS NULL)
          AND (${partitionExpr} <= @endDate OR @endDate IS NULL)
      )
      SELECT COUNT(1) AS total
      FROM source_rows
      WHERE (
        @lastSyncTime = '1753-01-01T00:00:00.000Z'
        OR __sync_time > @lastSyncTime
        OR (
          __sync_time = @lastSyncTime
          AND ISNULL(__sync_id_num, 0) > @lastSyncId
        )
      )
      AND __sync_time >= @syncMinDate
    `;

    try {
      const results = await this.oldPool.request()
        .input('lastSyncTime', sql.DateTime2, effectiveSyncTime)
        .input('lastSyncId', sql.BigInt, Number(lastSyncId || 0))
        .input('startDate', sql.DateTime2, startDate)
        .input('endDate', sql.DateTime2, endDate)
        .input('syncMinDate', sql.DateTime2, syncMinDate)
        .query(query);

      return Number(results.recordset?.[0]?.total || 0);
    } catch (error) {
      logger.error(`[${this.modelName}] countListFromOldDb failed: ${error.message}`);
      return 0;
    }
  }

  // ──────────────────────────────────────────────
  // Ensure staging table exists (incomming_documents_sync schema)
  // ──────────────────────────────────────────────

  async ensureStagingTableExists(instanceId) {
    const stagingTable = this.getStagingTableName(instanceId);

    const query = `
      IF OBJECT_ID('${stagingTable}', 'U') IS NULL
      BEGIN
        CREATE TABLE ${stagingTable} (
          -- Source columns (raw from VanBanDen / old DB)
          ID                          NVARCHAR(255)    NOT NULL,
          Title                       NVARCHAR(MAX)    NULL,
          SoDen                       NVARCHAR(MAX)    NULL,
          CoQuanGui2                  NVARCHAR(MAX)    NULL,
          CoQuanGuiText               NVARCHAR(MAX)    NULL,
          DonVi                       NVARCHAR(MAX)    NULL,
          IsLibrary                   NVARCHAR(MAX)    NULL,
          DoKhan                      NVARCHAR(MAX)    NULL,
          DoMat                       NVARCHAR(MAX)    NULL,
          Files                       NVARCHAR(MAX)    NULL,
          ThoiHanGQ                   NVARCHAR(MAX)    NULL,
          ItemVBDTCT                  NVARCHAR(MAX)    NULL,
          ItemVBPH                    NVARCHAR(MAX)    NULL,
          BanLanhDao                  NVARCHAR(MAX)    NULL,
          LanhDaoTCT                  NVARCHAR(MAX)    NULL,
          LanhDaoTCTDaXuLy            NVARCHAR(MAX)    NULL,
          LanhDaoTCTDeBiet            NVARCHAR(MAX)    NULL,
          LanhDaoVPDN                 NVARCHAR(MAX)    NULL,
          LinhVuc                     NVARCHAR(MAX)    NULL,
          LoaiVanBan                  NVARCHAR(MAX)    NULL,
          NgayDen                     NVARCHAR(MAX)    NULL,
          NgayTrenVB                  NVARCHAR(MAX)    NULL,
          SoBan                       NVARCHAR(MAX)    NULL,
          SoTrang                     NVARCHAR(MAX)    NULL,
          SoVanBan                    NVARCHAR(MAX)    NULL,
          TrangThai                   NVARCHAR(MAX)    NULL,
          TrichYeu                    NVARCHAR(MAX)    NULL,
          VanBanTraLoi                NVARCHAR(MAX)    NULL,
          ChenSo                      NVARCHAR(MAX)    NULL,
          YKienLanhDao                NVARCHAR(MAX)    NULL,
          YKienLanhDaoTCT             NVARCHAR(MAX)    NULL,
          YKienLanhDaoVPDN            NVARCHAR(MAX)    NULL,
          YKienCuaLDVPChoVanThu       NVARCHAR(MAX)    NULL,
          ForwardType                 NVARCHAR(MAX)    NULL,
          Modified                    NVARCHAR(MAX)    NULL,
          Created                     NVARCHAR(MAX)    NULL,
          ModifiedBy                  NVARCHAR(MAX)    NULL,
          CreatedBy                   NVARCHAR(MAX)    NULL,
          ModuleId                    NVARCHAR(MAX)    NULL,
          SiteName                    NVARCHAR(MAX)    NULL,
          ListName                    NVARCHAR(MAX)    NULL,
          ItemId                      NVARCHAR(MAX)    NULL,
          MigrateFlg                  INT              NULL,
          YearMonth                   NVARCHAR(MAX)    NULL,
          MigrateErrFlg               INT              NULL,
          MigrateErrMess              NVARCHAR(MAX)    NULL,
          ItemVBPHOld                 NVARCHAR(MAX)    NULL,
          DGPId                       NVARCHAR(MAX)    NULL,

          -- Heartbeat / ownership tracking (same as outgoing v2)
          processing_owner            NVARCHAR(255)    NULL,
          processing_started_at       DATETIME2        NULL,
          processing_heartbeat_at     DATETIME2        NULL,

          -- Internal cursor columns
          __sync_time                 DATETIME2        NULL,
          __sync_id                   BIGINT           NULL,

          CONSTRAINT PK_incomming_documents_sync_${instanceId} PRIMARY KEY (ID)
        );
      END
    `;

    await this.newPool.request().query(query);
    await this._ensureStagingColumns(stagingTable);
    logger.info(`[${this.modelName}] Staging table ${stagingTable} ensured and schema verified`);
  }

  /**
   * Tự động thêm các cột phục vụ điều phối và đồng bộ nếu chưa có
   */
  async _ensureStagingColumns(tableName) {
    try {
      const sql = `
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tableName}' AND COLUMN_NAME = 'processing_owner')
          ALTER TABLE ${tableName} ADD processing_owner NVARCHAR(255) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tableName}' AND COLUMN_NAME = 'processing_started_at')
          ALTER TABLE ${tableName} ADD processing_started_at DATETIME2 NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tableName}' AND COLUMN_NAME = 'processing_heartbeat_at')
          ALTER TABLE ${tableName} ADD processing_heartbeat_at DATETIME2 NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tableName}' AND COLUMN_NAME = 'MigrateFlg')
          ALTER TABLE ${tableName} ADD MigrateFlg INT DEFAULT 0;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tableName}' AND COLUMN_NAME = 'MigrateErrFlg')
          ALTER TABLE ${tableName} ADD MigrateErrFlg INT DEFAULT 0;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tableName}' AND COLUMN_NAME = 'MigrateErrMess')
          ALTER TABLE ${tableName} ADD MigrateErrMess NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tableName}' AND COLUMN_NAME = '__sync_time')
          ALTER TABLE ${tableName} ADD __sync_time DATETIME2 NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tableName}' AND COLUMN_NAME = '__sync_id')
          ALTER TABLE ${tableName} ADD __sync_id BIGINT NULL;
      `;
      await this.newPool.request().query(sql);
    } catch (err) {
      logger.warn(`[${this.modelName}] _ensureStagingColumns for ${tableName} failed: ${err.message}`);
    }
  }

  // ──────────────────────────────────────────────
  // Sync batch to staging
  // ──────────────────────────────────────────────

  /**
   * Upsert rows vào staging. Incoming dùng MERGE ON Modified để chỉ update khi có bản mới hơn.
   * (Giữ đúng logic từ StreamIncomingIncrementalModel.syncOldToStaging)
   */
  async syncBatchToStaging(rows, instanceId, transaction = null) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { stagedCount: 0 };
    }

    const stagingTable = this.getStagingTableName(instanceId);
    const internalColumns = new Set([
      'MigrateFlg', 'MigrateErrFlg', 'MigrateErrMess',
      '_sync_time_val', '_sync_id_val'
    ]);

    const columns = Object.keys(rows[0] || {}).filter(
      col => !String(col).startsWith('__') && !internalColumns.has(col)
    );

    if (!columns.length) return { stagedCount: 0 };
    if (!columns.includes('ID')) throw new Error('Staging sync requires source column "ID"');

    const safeColumns = columns.map(col => this.sanitizeColumnName(col));
    const nonIdColumns = columns.filter(col => col !== 'ID');
    const safeNonIdColumns = nonIdColumns.map(col => this.sanitizeColumnName(col));

    // Tính batch size an toàn để không vượt 2100 SQL params
    const numCols = columns.length || 1;
    const safeBatchByParams = Math.max(1, Math.floor(2000 / numCols));
    const configuredBatch = Number(process.env.STAGING_BATCH_SIZE || 50);
    const batchSize = Math.min(configuredBatch, safeBatchByParams);

    let totalStaged = 0;

    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);

      const valueParts = [];
      const params = {};

      for (let r = 0; r < chunk.length; r++) {
        const row = chunk[r];
        if (row?.ID == null || String(row.ID).trim() === '') {
          throw new Error('Row ID is required for staging');
        }

        const rowParamNames = columns.map(col => `@r${r}_${col}`);
        valueParts.push(`(${rowParamNames.join(', ')})`);

        for (const col of columns) {
          let val = row[col];
          if (val instanceof Date) val = val.toISOString();
          else if (val !== null && val !== undefined) val = String(val);
          params[`r${r}_${col}`] = val != null ? val : null;
        }
      }

      const updateSetClause = nonIdColumns.length > 0
        ? nonIdColumns
          .map(col => `tgt.${this.sanitizeColumnName(col)} = src.${this.sanitizeColumnName(col)}`)
          .join(',\n             ')
        : 'tgt.[ID] = tgt.[ID]';

      const mergeQuery = `
        MERGE ${stagingTable} AS tgt
        USING (
          SELECT ${columns.map(col => this.sanitizeColumnName(col)).join(', ')}
          FROM (VALUES ${valueParts.join(',\n          ')}) AS v(${safeColumns.join(', ')})
        ) AS src ON tgt.[ID] = src.[ID]
        WHEN MATCHED AND (
          tgt.[Modified] IS NULL
          OR TRY_CONVERT(datetime2, src.[Modified]) > TRY_CONVERT(datetime2, tgt.[Modified])
        ) THEN UPDATE SET
          ${updateSetClause}
        WHEN NOT MATCHED BY TARGET THEN
          INSERT (${safeColumns.join(', ')})
          VALUES (${safeColumns.map(c => `src.${c}`).join(', ')});
      `;

      const request = transaction
        ? transaction.request()
        : this.newPool.request();

      for (const [key, value] of Object.entries(params)) {
        request.input(key, value);
      }

      await request.query(mergeQuery);
      totalStaged += chunk.length;
    }

    logger.info(`[${this.modelName}] Synced ${totalStaged} rows to staging ${stagingTable}`);
    return { stagedCount: totalStaged };
  }

  sanitizeColumnName(column) {
    if (!/^[A-Za-z0-9_]+$/.test(column)) {
      throw new Error(`Invalid column name from source: ${column}`);
    }
    return `[${column}]`;
  }
}

module.exports = Extractor;
