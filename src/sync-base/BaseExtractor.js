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
    if (process.env.DISABLE_ENSURE_SCHEMA === 'true') {
      logger.info(`[${this.modelName}] Skipping ensureStagingTableExists (disabled via environment variable)`);
      return;
    }
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

    if (!this.oldPool) {
      logger.warn(`[${this.modelName}] fetchBatchFromOldDb: Database CŨ (Nguồn) chưa kết nối. Bỏ qua fetch.`);
      return [];
    }

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
   * Lấy và cache kiểu dữ liệu của các cột trong bảng Staging
   */
  async _getStagingColumnTypes(stagingTable) {
    if (!this._schemaCache) this._schemaCache = {};
    if (this._schemaCache[stagingTable]) return this._schemaCache[stagingTable];

    const schemaQuery = `
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @tableName
    `;
    const result = await this.newPool.request()
      .input('tableName', sql.NVarChar, stagingTable)
      .query(schemaQuery);

    const typeMap = {};
    result.recordset.forEach(col => {
      let typeStr = col.DATA_TYPE.toUpperCase();
      if (['VARCHAR', 'NVARCHAR', 'CHAR', 'NCHAR'].includes(typeStr)) {
        if (col.CHARACTER_MAXIMUM_LENGTH === -1) {
          typeStr += '(MAX)';
        } else {
          typeStr += `(${col.CHARACTER_MAXIMUM_LENGTH})`;
        }
      } else if (['DECIMAL', 'NUMERIC'].includes(typeStr)) {
        typeStr += '(38,10)'; // Safe fallback
      }
      typeMap[col.COLUMN_NAME] = typeStr;
    });

    this._schemaCache[stagingTable] = typeMap;
    return typeMap;
  }

  /**
   * Sync batch of rows to staging table using OPENJSON
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
    
    try {
      // 1. Get column types for OPENJSON WITH clause
      const typeMap = await this._getStagingColumnTypes(stagingTable);

      // Datetime-family types that cause implicit conversion errors in OPENJSON.
      // We declare them as NVARCHAR(MAX) in the WITH clause so SQL Server treats
      // the value as a plain string — avoiding "Conversion failed when converting
      // date and/or time from character string" on malformed / out-of-range values.
      const DATETIME_TYPES = new Set(['DATETIME', 'DATETIME2', 'DATE', 'SMALLDATETIME', 'TIME', 'DATETIMEOFFSET']);

      const excludeColumnsLower = new Set(['migrateflg', 'migrateerrflg', 'migrateerrmess']);
      const columns = Object.keys(rows[0] || {}).filter(col => {
        const lower = String(col).toLowerCase();
        return !lower.startsWith('__') && !excludeColumnsLower.has(lower);
      });
      const nonIdColumns = columns.filter(col => String(col).toLowerCase() !== 'id');

      const safeColumns = columns.map(col => this.sanitizeColumnName(col));
      const safeNonIdColumns = nonIdColumns.map(col => this.sanitizeColumnName(col));

      // 3. Build OPENJSON WITH clause
      // ALWAYS use NVARCHAR(MAX) for OPENJSON to prevent parsing crashes.
      // SQL Server's OPENJSON will keep the value as a string; the target staging
      // column is typed correctly so the MERGE INSERT/UPDATE will do the
      // conversion via TRY_CONVERT safely.
      const withDeclarations = columns.map(origCol => {
        const safeCol = this.sanitizeColumnName(origCol);
        // Escape quotes in the original column name for the JSON path
        const jsonPath = origCol.replace(/"/g, '\\"');
        return `[${safeCol}] NVARCHAR(MAX) '$."${jsonPath}"'`;
      }).join(',\n        ');

      // Helper: emit INSERT/UPDATE value expression with safe TRY_CONVERT
      const srcExpr = (safeCol) => {
        const targetType = typeMap[safeCol] || 'NVARCHAR(MAX)';
        const baseType = targetType.split('(')[0].toUpperCase().trim();
        
        // If it's already a string type, no conversion needed, but we MUST truncate
        // it to the column's max length to prevent "String or binary data would be truncated".
        if (['NVARCHAR', 'VARCHAR', 'CHAR', 'NCHAR', 'TEXT', 'NTEXT'].includes(baseType)) {
          const match = targetType.match(/\((\d+)\)/);
          if (match && match[1]) {
            return `LEFT(src.[${safeCol}], ${match[1]})`;
          }
          return `src.[${safeCol}]`;
        }
        
        // For DATETIME-family, use style 127 for ISO 8601 parsing
        if (DATETIME_TYPES.has(baseType)) {
          return `TRY_CONVERT(${targetType}, src.[${safeCol}], 127)`;
        }
        
        // For all other types (INT, UNIQUEIDENTIFIER, etc), use TRY_CONVERT 
        // to return NULL instead of crashing the batch on dirty data.
        return `TRY_CONVERT(${targetType}, src.[${safeCol}])`;
      };

      // 4. Build MERGE clauses
      const insertColumns = safeColumns.map(c => `[${c}]`).join(', ');
      const insertValues = safeColumns.map(c => srcExpr(c)).join(', ');
      let updateSetClause = safeNonIdColumns.map(c => `[${c}] = ${srcExpr(c)}`).join(', ');

      // Always reset staging flags on UPDATE so that modified records get re-processed
      if (updateSetClause) {
        updateSetClause += `, [MigrateFlg] = 0, [MigrateErrFlg] = 0, [MigrateErrMess] = NULL`;
      } else {
        updateSetClause = `[MigrateFlg] = 0, [MigrateErrFlg] = 0, [MigrateErrMess] = NULL`;
      }

      // 5. Create JSON string from rows
      // Sanitize values: convert JS Date objects to ISO strings; null-ify undefined.
      const cleanRows = rows.map(row => {
        const cleanRow = {};
        columns.forEach(col => {
          const val = row[col];
          if (val instanceof Date) {
            // Convert Date objects to ISO 8601 string; null if invalid
            cleanRow[col] = isNaN(val.getTime()) ? null : val.toISOString();
          } else if (typeof val === 'string' && val.trim().toUpperCase() === 'NULL') {
            cleanRow[col] = null;
          } else {
            cleanRow[col] = val === undefined ? null : val;
          }
        });
        return cleanRow;
      });
      const jsonData = JSON.stringify(cleanRows);

      // 6. Final SQL using OPENJSON
      const upsertQuery = `
        MERGE ${stagingTable} AS tgt
        USING (
          SELECT * FROM OPENJSON(@jsonData)
          WITH (
            ${withDeclarations}
          )
        ) AS src
        ON tgt.ID = src.ID
        WHEN MATCHED THEN
          UPDATE SET ${updateSetClause}
        WHEN NOT MATCHED THEN
          INSERT (${insertColumns}) VALUES (${insertValues});
      `;

      // 7. Execute
      const request = transaction ? transaction.request() : this.newPool.request();
      await request
        .input('jsonData', sql.NVarChar(sql.MAX), jsonData)
        .query(upsertQuery);

      logger.info(`[${this.modelName}] Synced ${rows.length} rows to staging table ${stagingTable} via OPENJSON`);
      return { stagedCount: rows.length };
    } catch (error) {
      logger.error(`[${this.modelName}] Failed to sync batch to staging via OPENJSON: ${error.message}`);
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

    if (!this.oldPool) {
      logger.warn(`[${this.modelName}] countOldDbRecords: Database CŨ (Nguồn) chưa kết nối. Trả về 0.`);
      return 0;
    }

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
