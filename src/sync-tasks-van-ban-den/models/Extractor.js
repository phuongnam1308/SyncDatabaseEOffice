const BaseExtractor = require('../../sync-base/BaseExtractor');
const logger = require('../../../utils/logger');
const sql = require('mssql');

/**
 * Extractor for incoming tasks (TaskVBDen -> task_sync).
 * Refactored to inherit BaseExtractor (same structure as sync-outgoing-v2).
 */
class Extractor extends BaseExtractor {
  constructor() {
    super({
      modelName: 'TASK_INCOMING_EXTRACTOR',
      oldDbTable: 'TaskVBDen',
      oldDbSchema: 'dbo',
      stagingTableBaseName: 'task_sync',
      partitionColumn: 'Created'
    });

    this.newDbName = process.env.NEW_DB_NAME;
    this.newDbSchema = 'dbo';
  }

  /**
   * Keep backward-compatible staging table name (no instance suffix),
   * because current task loader/process flow still reads dbo.task_sync.
   */
  getStagingTableName() {
    return `${this.newDbName}.${this.newDbSchema}.task_sync`;
  }

  getSyncTimeExpression() {
    return `
      COALESCE(
        TRY_CONVERT(datetime2, Modified),
        TRY_CONVERT(datetime2, Created)
      )
    `;
  }

  sanitizeColumnName(column) {
    if (!/^[A-Za-z0-9_]+$/.test(column)) {
      throw new Error(`Invalid column name from source: ${column}`);
    }
    return `[${column}]`;
  }

  async ensureStagingTableExists() {
    const table = this.getStagingTableName();

    const query = `
      IF OBJECT_ID('${table}', 'U') IS NULL
      BEGIN
        CREATE TABLE ${table} (
          ID                     NVARCHAR(255)   NOT NULL,
          VBId                   NVARCHAR(MAX)   NULL,
          DepartmentId           NVARCHAR(MAX)   NULL,
          ParentId               NVARCHAR(MAX)   NULL,
          Title                  NVARCHAR(MAX)   NULL,
          DanhGia                NVARCHAR(MAX)   NULL,
          DeBaoCao               NVARCHAR(MAX)   NULL,
          DeBiet                 NVARCHAR(MAX)   NULL,
          DeThucHien             NVARCHAR(MAX)   NULL,
          DuocHuy                NVARCHAR(MAX)   NULL,
          DiemChatLuong          NVARCHAR(MAX)   NULL,
          DiemThoiGian           NVARCHAR(MAX)   NULL,
          DiemDanhGia            NVARCHAR(MAX)   NULL,
          StartDate              NVARCHAR(MAX)   NULL,
          DueDate                NVARCHAR(MAX)   NULL,
          CompletedDate          NVARCHAR(MAX)   NULL,
          HoanTatTuDong          NVARCHAR(MAX)   NULL,
          HoSoDuThaoId           NVARCHAR(MAX)   NULL,
          HoSoDuThaoUrl          NVARCHAR(MAX)   NULL,
          HoSoXuLyUrl            NVARCHAR(MAX)   NULL,
          [Percent]              NVARCHAR(MAX)   NULL,
          TrangThai              NVARCHAR(MAX)   NULL,
          Priority               NVARCHAR(MAX)   NULL,
          YKienCuaNguoiGiaiQuyet NVARCHAR(MAX)   NULL,
          YKienChiDao            NVARCHAR(MAX)   NULL,
          ModuleId               NVARCHAR(MAX)   NULL,
          SiteName               NVARCHAR(MAX)   NULL,
          ListName               NVARCHAR(MAX)   NULL,
          ItemId                 NVARCHAR(MAX)   NULL,
          Modified               NVARCHAR(MAX)   NULL,
          Created                NVARCHAR(MAX)   NULL,
          ModifiedBy             NVARCHAR(MAX)   NULL,
          CreatedBy              NVARCHAR(MAX)   NULL,
          MigrateFlg             NVARCHAR(MAX)   NULL,
          MigrateErrFlg          NVARCHAR(MAX)   NULL,
          MigrateErrMess         NVARCHAR(MAX)   NULL,
          ParentTaskID           NVARCHAR(MAX)   NULL,
          id_task_bak            NVARCHAR(MAX)   NULL,
          __sync_time            DATETIME2       NULL,
          __sync_id              BIGINT          NULL,
          CONSTRAINT PK_task_sync PRIMARY KEY (ID)
        );
      END
    `;

    await this.newPool.request().query(query);
    logger.info(`[${this.modelName}] Staging table task_sync ensured`);
  }

  async fetchBatchFromOldDb(lastSyncTime, lastSyncId = 0, batchSize = 1000, offset = 0) {
    const syncTimeExpr = this.getSyncTimeExpression();
    const defaultSyncTime = '9999-12-31T23:59:59.999Z';
    const effectiveSyncTime =
      lastSyncTime && lastSyncTime !== '1970-01-01T00:00:00.000Z'
        ? lastSyncTime
        : defaultSyncTime;

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

    const results = await this.oldPool.request()
      .input('lastSyncTime', sql.DateTime2, effectiveSyncTime)
      .input('lastSyncId', sql.BigInt, Number(lastSyncId || 0))
      .input('limit', sql.Int, Number(batchSize || 1000))
      .input('offset', sql.Int, Number(offset || 0))
      .input('startDate', sql.DateTime2, process.env.SYNC_START_DATE || null)
      .input('endDate', sql.DateTime2, process.env.SYNC_END_DATE || null)
      .input('syncMinDate', sql.DateTime2, process.env.SYNC_MIN_DATE || '1753-01-01T00:00:00.000Z')
      .query(query);

    return results.recordset || [];
  }

  async syncBatchToStaging(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { stagedCount: 0 };
    }

    const stagingTable = this.getStagingTableName();
    const internalColumns = new Set(['__page_rn', '__sync_id_num']);
    const columns = Object.keys(rows[0] || {}).filter((column) => !internalColumns.has(column));
    const nonIdColumns = columns.filter((column) => column !== 'ID');
    const safeNonIdColumns = nonIdColumns.map((column) => this.sanitizeColumnName(column));

    for (const row of rows) {
      const params = {};
      for (const column of columns) {
        params[column] = row[column];
      }

      const updateClause = safeNonIdColumns
        .map((columnName, index) => `${columnName} = @${nonIdColumns[index]}`)
        .join(', ');

      const insertColumns = columns.map((column) => this.sanitizeColumnName(column)).join(', ');
      const insertValues = columns.map((column) => `@${column}`).join(', ');

      const query = `
        IF EXISTS (SELECT 1 FROM ${stagingTable} WHERE ID = @ID)
        BEGIN
          ${nonIdColumns.length > 0
            ? `UPDATE ${stagingTable} SET ${updateClause} WHERE ID = @ID;`
            : `SELECT 1 AS noop;`}
        END
        ELSE
        BEGIN
          INSERT INTO ${stagingTable} (${insertColumns})
          VALUES (${insertValues});
        END
      `;

      const request = this.newPool.request();
      for (const [key, value] of Object.entries(params)) {
        request.input(key, value);
      }
      await request.query(query);
    }

    return { stagedCount: rows.length };
  }

  /**
   * Extract and stage all rows using cursor pagination.
   */
  async runExtract() {
    let totalExtracted = 0;
    let lastSyncTime = '9999-12-31T23:59:59.999Z';
    let lastSyncId = 0;

    while (true) {
      const batch = await this.fetchBatchFromOldDb(lastSyncTime, lastSyncId, Number(process.env.EXTRACT_BATCH_SIZE || 1000), 0);
      if (!batch.length) break;

      await this.syncBatchToStaging(batch);
      totalExtracted += batch.length;

      const lastRow = batch[batch.length - 1];
      lastSyncTime = lastRow.__sync_time || lastSyncTime;
      lastSyncId = Number(lastRow.__sync_id || lastSyncId);

      if (batch.length < Number(process.env.EXTRACT_BATCH_SIZE || 1000)) {
        break;
      }
    }

    return { extractedCount: totalExtracted, lastSyncTime, lastSyncId };
  }
}

module.exports = Extractor;
