const logger = require('../../utils/logger');
const dbUtils = require('../../utils/dbUtils');
const sql = require('mssql');

/**
 * Base class for extracting data from OLD DB and syncing to staging table.
 * Each instance gets its own staging table (outgoing_documents_sync_{instanceId}).
 */
class BaseExtractor {
  /**
   * @param {object} config
   * @param {string} config.modelName - Name of the model
   * @param {string} config.oldDbTable - Source table name in OLD DB
   * @param {string} config.oldDbSchema - Schema of source table (default: 'dbo')
   * @param {string} config.stagingTableBaseName - Base name for staging table (without instance suffix)
   */
  constructor(config) {
    this.modelName = config.modelName || 'BASE_EXTRACTOR';
    this.oldDbTable = config.oldDbTable;
    this.oldDbSchema = config.oldDbSchema || 'dbo';
    this.stagingTableBaseName = config.stagingTableBaseName;

    this.oldPool = null;
    this.newPool = null;
    this.partitionColumn = config.partitionColumn || 'Created';
  }

  /**
   * Initialize database pools (can be overridden or pools set externally)
   */
  async initialize() {
    // Pools should be set externally via .oldPool and .newPool properties
    // or by subclass calling _initializePools()
    if (!this.oldPool || !this.newPool) {
      const dbConnection = require('../../db/connection');
      await dbConnection.connectAll();
      this.oldPool = this.oldPool || dbConnection.getOldPool();
      this.newPool = this.newPool || dbConnection.getNewPool();
    }
  }

  /**
   * Get staging table name with instance suffix
   * @param {string} instanceId
   * @returns {string}
   */
  getStagingTableName(instanceId) {
    return `${this.stagingTableBaseName}_${instanceId}`;
  }

  /**
   * Sanitize column name for SQL
   * @param {string} column
   * @returns {string}
   */
  sanitizeColumnName(column) {
    return column.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  /**
   * Get SQL expression that normalizes source sync time across supported columns.
   * Uses both Modified and Created (as fallback) to ensure we don't miss updates.
   * @returns {string}
   */
  getSyncTimeExpression() {
    return `
      ISNULL(
        TRY_CONVERT(datetime2, Modified),
        ISNULL(
          TRY_CONVERT(datetime2, Created),
          '1753-01-01'
        )
      )
    `;
  }

  /**
   * Ensure staging table exists for this instance
   * @param {string} instanceId
   */
  async ensureStagingTableExists(instanceId) {
    const stagingTable = this.getStagingTableName(instanceId);

    await this.newPool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${stagingTable}')
      BEGIN
        -- Tạo bảng staging từ source table structure
        SELECT * INTO ${stagingTable}
        FROM (
          SELECT TOP 0 *,
            CAST(0 AS INT) AS MigrateFlg,
            CAST(0 AS INT) AS MigrateErrFlg,
            CAST(NULL AS NVARCHAR(MAX)) AS MigrateErrMess,
            CAST(NULL AS NVARCHAR(100)) AS processing_owner,
            CAST(NULL AS DATETIME) AS processing_started_at,
            CAST(NULL AS DATETIME) AS processing_heartbeat_at,
            CAST(SYSUTCDATETIME() AS DATETIME) AS CreatedAt
          FROM ${this.oldDbSchema}.${this.oldDbTable}
        ) AS src
      END
    `);
    logger.info(`[${this.modelName}] Staging table ${stagingTable} ensured`);
  }

  /**
   * Fetch batch of records from OLD DB using cursor pagination
   * @param {string} lastSyncTime - Last sync timestamp
   * @param {number} lastSyncId - Last sync ID
   * @param {number} batchSize - Number of records to fetch
   * @param {number} offset - Offset for pagination
   * @returns {Promise<object[]>}
   */
  async fetchBatchFromOldDb(lastSyncTime, lastSyncId = 0, batchSize = 1000, offset = 0) {
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
        WHERE 1=1
          AND (${this.partitionColumn} >= @startDate OR @startDate IS NULL)
          AND (${this.partitionColumn} <= @endDate OR @endDate IS NULL)
      )
      SELECT * FROM (
        SELECT
          *,
          ISNULL(__sync_id_num, 0) AS __sync_id,
          ROW_NUMBER() OVER (
            ORDER BY
              __sync_time DESC,
              ISNULL(__sync_id_num, 9223372036854775807) DESC,
              ID DESC
          ) AS __page_rn
        FROM source_rows
        WHERE (
          __sync_time < @lastSyncTime
          OR (
            __sync_time = @lastSyncTime
            AND ISNULL(__sync_id_num, 9223372036854775807) < @lastSyncId
          )
        )
        AND __sync_time >= @syncMinDate
      ) AS t
      WHERE __page_rn > @offset
      AND __page_rn <= (@offset + @limit)
      ORDER BY __page_rn
    `;

    logger.info(`[${this.modelName}] Fetching batch: lastSyncTime=${lastSyncTime}, lastSyncId=${lastSyncId}, limit=${batchSize}, offset=${offset}`);

    const results = await this.oldPool.request()
      .input('lastSyncTime', sql.DateTime2, lastSyncTime)
      .input('lastSyncId', sql.BigInt, lastSyncId)
      .input('limit', sql.Int, batchSize)
      .input('offset', sql.Int, offset)
      .input('startDate', sql.DateTime2, process.env.SYNC_START_DATE || null)
      .input('endDate', sql.DateTime2, process.env.SYNC_END_DATE || null)
      .input('syncMinDate', sql.DateTime2, process.env.SYNC_MIN_DATE || '1753-01-01T00:00:00.000Z')
      .query(query);

    logger.info(`[${this.modelName}] Fetched ${results.recordset?.length || 0} rows`);
    return results.recordset || [];
  }

  /**
   * Sync batch of rows to staging table
   * @param {object[]} rows - Rows to sync
   * @param {string} instanceId - Instance ID for staging table
   * @param {object} [transaction] - Optional transaction
   * @returns {Promise<{stagedCount: number}>}
   */
  async syncBatchToStaging(rows, instanceId, transaction = null) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { stagedCount: 0 };
    }

    const stagingTable = this.getStagingTableName(instanceId);
    const columns = Object.keys(rows[0] || {}).filter(col => !String(col).startsWith('__'));
    const nonIdColumns = columns.filter(col => col !== 'ID');

    const safeColumns = columns.map(col => this.sanitizeColumnName(col));
    const safeNonIdColumns = nonIdColumns.map(col => this.sanitizeColumnName(col));

    // Build column lists for INSERT
    const insertColumns = safeColumns.join(', ');
    const updateSetClause = safeNonIdColumns.map(col => `${col} = SRC.${col}`).join(', ');

    // Build VALUES clause with parameter names
    const valuesClauses = rows.map((row, rowIdx) => {
      const colRefs = safeColumns.map((col, colIdx) => `@p${rowIdx}_${colIdx}`).join(', ');
      return `SELECT ${colRefs}`;
    }).join(' UNION ALL ');

    // Build parameter object
    const params = {};
    rows.forEach((row, rowIdx) => {
      columns.forEach((col, colIdx) => {
        params[`p${rowIdx}_${colIdx}`] = row[col];
      });
    });

    const query = `
      ;WITH source_data AS (
        ${valuesClauses}
      )
      MERGE ${stagingTable} AS tgt
      USING source_data AS src
      ON tgt.ID = src.ID
      WHEN MATCHED THEN
        UPDATE SET ${updateSetClause}
      WHEN NOT MATCHED THEN
        INSERT (${insertColumns}) VALUES (${safeColumns.map((_, i) => `SRC.@p_*`.replace('*', i)).join(', ')});
    `.replace(/\.\ @p_\*/g, (match) => match);

    // Actually build the proper query
    const upsertQuery = `
      MERGE ${stagingTable} AS tgt
      USING (${valuesClauses}) AS src
      ON tgt.ID = src.ID
      WHEN MATCHED THEN
        UPDATE SET ${updateSetClause}
      WHEN NOT MATCHED THEN
        INSERT (${insertColumns}) VALUES (${safeColumns.map((_, i) => `src.@p${i}`).join(', ')});
    `;

    try {
      const request = (transaction || this.newPool.request());
      const result = await request.query(upsertQuery);
      logger.info(`[${this.modelName}] Synced ${rows.length} rows to staging table ${stagingTable}`);
      return { stagedCount: rows.length };
    } catch (error) {
      logger.error(`[${this.modelName}] Failed to sync batch to staging: ${error.message}`);
      throw error;
    }
  }

  /**
   * Count total records in OLD DB
   * @returns {Promise<number>}
   */
  async countOldDbRecords() {
    const query = `
      SELECT COUNT(1) AS cnt
      FROM ${this.oldDbSchema}.${this.oldDbTable}
      WHERE (${this.partitionColumn} >= @startDate OR @startDate IS NULL)
        AND (${this.partitionColumn} <= @endDate OR @endDate IS NULL)
    `;

    const result = await this.oldPool.request()
      .input('startDate', sql.DateTime2, process.env.SYNC_START_DATE || null)
      .input('endDate', sql.DateTime2, process.env.SYNC_END_DATE || null)
      .query(query);

    return Number(result.recordset?.[0]?.cnt || 0);
  }

  /**
   * Count pending records in staging table
   * @param {string} instanceId
   * @returns {Promise<number>}
   */
  async countStagingPending(instanceId) {
    const stagingTable = this.getStagingTableName(instanceId);
    const query = `
      SELECT COUNT(1) AS cnt
      FROM ${stagingTable}
      WHERE ISNULL(MigrateFlg, 0) = 0
        AND ISNULL(MigrateErrFlg, 0) = 0
    `;

    const result = await this.newPool.request().query(query);
    return Number(result.recordset?.[0]?.cnt || 0);
  }

  /**
   * Cleanup stale processing records (MigrateFlg = 2 but too old)
   * @param {string} instanceId
   * @param {number} staleMinutes - Minutes to consider a record stale
   */
  async cleanupStaleRecords(instanceId, staleMinutes = 30) {
    const stagingTable = this.getStagingTableName(instanceId);
    const query = `
      UPDATE ${stagingTable} WITH (ROWLOCK)
      SET MigrateFlg = 0,
          MigrateErrFlg = 0,
          MigrateErrMess = NULL,
          processing_owner = NULL,
          processing_started_at = NULL,
          processing_heartbeat_at = NULL
      WHERE MigrateFlg = 2
        AND DATEDIFF(MINUTE, ISNULL(processing_heartbeat_at, processing_started_at), SYSUTCDATETIME()) > @staleMinutes
    `;

    const result = await this.newPool.request()
      .input('staleMinutes', sql.Int, staleMinutes)
      .query(query);

    if (result.rowsAffected[0] > 0) {
      logger.info(`[${this.modelName}] Cleaned up ${result.rowsAffected[0]} stale staging records`);
    }
  }
}

module.exports = BaseExtractor;
