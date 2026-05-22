const BaseExtractor = require('../../sync-base/BaseExtractor');
const logger = require('../../../utils/logger');
const sql = require('mssql');

/**
 * Extractor for Draft Documents from SNP.CodeItem
 * (same database as VanBanBanHanh but different schema)
 *
 * Mapping:
 * - CodeItemID (SharePoint list) → ID (SNP.CodeItem)
 * - ID (SharePoint list) → SPItemID (SNP.CodeItem)
 */
class DraftDocumentExtractor extends BaseExtractor {
  constructor() {
    super({
      modelName: 'DRAFT_DOCUMENT_EXTRACTOR',
      oldDbTable: 'CodeItem',
      oldDbSchema: 'SNP',
      stagingTableBaseName: 'draft_documents_sync',
      partitionColumn: 'Modified'
    });
  }

  /**
   * Get cursor comparison direction
   * Draft documents use DESC (newer records first)
   */
  getCursorDirection() {
    return 'DESC';
  }

  /**
   * Get total count of records in old DB for the current date range and cursor
   */
  async getTotalCount(lastSyncTime, lastSyncId = 0) {
    const syncTimeExpr = this.getSyncTimeExpression();
    const defaultSyncTime = '2999-12-31T23:59:59.999Z';

    const query = `
      SELECT COUNT(1) AS cnt
      FROM ${this.oldDbSchema}.${this.oldDbTable}
      WHERE 1=1
        AND (${this.partitionColumn} >= @startDate OR @startDate IS NULL)
        AND (${this.partitionColumn} <= @endDate OR @endDate IS NULL)
        AND (
          ${syncTimeExpr} < @lastSyncTime
          OR (
            ${syncTimeExpr} = @lastSyncTime
            AND TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), '')) < @lastSyncId
          )
        )
        AND ${syncTimeExpr} >= @syncMinDate
    `;

    const lastSyncDate = new Date(lastSyncTime);
    const isDateValid = !isNaN(lastSyncDate.getTime());
    const isValidTime = lastSyncTime &&
                        lastSyncTime !== '1970-01-01T00:00:00.000Z' &&
                        isDateValid &&
                        lastSyncDate.getFullYear() > 2000;

    const effectiveSyncTime = isValidTime ? lastSyncTime : defaultSyncTime;

    try {
      const results = await this.oldPool.request()
        .input('lastSyncTime', sql.DateTime2, effectiveSyncTime)
        .input('lastSyncId', sql.BigInt, lastSyncId)
        .input('startDate', sql.DateTime2, process.env.SYNC_START_DATE || null)
        .input('endDate', sql.DateTime2, process.env.SYNC_END_DATE || null)
        .input('syncMinDate', sql.DateTime2, process.env.SYNC_MIN_DATE || '1753-01-01T00:00:00.000Z')
        .query(query);

      return Number(results.recordset?.[0]?.cnt || 0);
    } catch (error) {
      logger.error(`[${this.modelName}] getTotalCount failed: ${error.message}`);
      return 0;
    }
  }

  /**
   * Override fetchBatchFromOldDb for SNP.CodeItem-specific logic
   */
  async fetchBatchFromOldDb(lastSyncTime, lastSyncId = 0, batchSize = 1000, offset = 0) {
    const syncTimeExpr = this.getSyncTimeExpression();
    const defaultSyncTime = '2999-12-31T23:59:59.999Z';

    const query = `
      ;WITH source_rows AS (
        SELECT
          *,
          N'SNP.CodeItem' AS __source_table,
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

    const lastSyncDate = new Date(lastSyncTime);
    const isDateValid = !isNaN(lastSyncDate.getTime());
    const isValidTime = lastSyncTime &&
                        lastSyncTime !== '1970-01-01T00:00:00.000Z' &&
                        isDateValid &&
                        lastSyncDate.getFullYear() > 2000;

    const effectiveSyncTime = isValidTime ? lastSyncTime : defaultSyncTime;

    logger.info(`[${this.modelName}] Fetching batch: lastSyncTime=${effectiveSyncTime}, lastSyncId=${lastSyncId}, limit=${batchSize}, offset=${offset}`);

    try {
      const results = await this.oldPool.request()
        .input('lastSyncTime', sql.DateTime2, effectiveSyncTime)
        .input('lastSyncId', sql.BigInt, lastSyncId)
        .input('limit', sql.Int, batchSize)
        .input('offset', sql.Int, offset)
        .input('startDate', sql.DateTime2, process.env.SYNC_START_DATE || null)
        .input('endDate', sql.DateTime2, process.env.SYNC_END_DATE || null)
        .input('syncMinDate', sql.DateTime2, process.env.SYNC_MIN_DATE || '1753-01-01T00:00:00.000Z')
        .query(query);

      const count = results.recordset?.length || 0;
      logger.debug(`[${this.modelName}] Query completed. Row count: ${count}`);

      if (count > 0) {
        const first = results.recordset[0];
        const last = results.recordset[count - 1];
        logger.debug(`[${this.modelName}] Batch range: [${first.__sync_time}, ID=${first.ID}] to [${last.__sync_time}, ID=${last.ID}]`);
      }

      return results.recordset || [];
    } catch (error) {
      logger.error(`[${this.modelName}] fetchBatchFromOldDb failed! Error: ${error.message}`);
      logger.error(`[${this.modelName}] Query Params: lastSyncTime=${effectiveSyncTime}, lastSyncId=${lastSyncId}, startDate=${process.env.SYNC_START_DATE}, endDate=${process.env.SYNC_END_DATE}`);
      throw error;
    }
  }

  /**
   * Override ensureStagingTableExists - tự định nghĩa cấu trúc bảng
   * dựa trên cấu trúc bảng Văn bản dự thảo đã được cung cấp
   */
  async ensureStagingTableExists(instanceId) {
    if (process.env.DISABLE_ENSURE_SCHEMA === 'true') {
      logger.info(`[${this.modelName}] Skipping ensureStagingTableExists (disabled via environment variable)`);
      return;
    }
    const stagingTable = this.getStagingTableName(instanceId);

    const query = `
      IF OBJECT_ID('${stagingTable}', 'U') IS NULL
      BEGIN
        CREATE TABLE ${stagingTable} (
          -- Core fields from SNP.CodeItem
          ID                          BIGINT           NOT NULL,
          Title                       NVARCHAR(50),
          Subject                     NVARCHAR(4000),
          LoaiVanBan                  NVARCHAR(255),
          DepartmentId                INT,
          Status                      SMALLINT,
          StatusText                  NVARCHAR(150),
          WorkflowId                  INT,
          Approver                    UNIQUEIDENTIFIER,
          ApprovedDate                DATETIME,
          Created                     DATETIME,
          CreatedBy                   UNIQUEIDENTIFIER,
          Modified                    DATETIME,
          ModifiedBy                  UNIQUEIDENTIFIER,
          SPItemId                    INT,
          SPListId                    UNIQUEIDENTIFIER,
          SubmitDate                  DATETIME,
          Step                        TINYINT,
          DocumentId                  BIGINT,
          DocumentTitle              NVARCHAR(150),
          Updating                    BIT,
          Locker                      UNIQUEIDENTIFIER,
          TaskId                      BIGINT,
          IsArchived                  BIT,
          IsConverting                BIT,
          ConvertedDate               DATETIME,
          ActionStatus                NVARCHAR(255),
          CBNV                        NVARCHAR(100),
          Content                     NVARCHAR(MAX),
          ChenSo                      BIT,
          DongMoc                     BIT,
          EndLoop                     BIT,
          IsKyQuyChe                  BIT,
          IssuedDate                  DATETIME,
          KyHaiLien                   BIT,
          ReccurencyType              NVARCHAR(255),
          LoaiBanHanh                 NVARCHAR(255),
          LoaiMoc                     NVARCHAR(255),
          NgayDanTau                  DATETIME,
          ParentId                    BIGINT,
          PreviousStep                INT,
          Price                       DECIMAL(18, 0),
          SoVanBanDi                  NVARCHAR(255),
          SoVanBanNum                 INT,
          ThamQuyen                   NVARCHAR(255),
          VBBiThayThe                 NVARCHAR(255),
          YKien                       NVARCHAR(MAX),
          ApproverByStep              UNIQUEIDENTIFIER,
          SPListName                  NVARCHAR(100),
          AssignedToText              NVARCHAR(4000),
          ResourceFormId              INT,
          SiteName                    VARCHAR(50),
          IsDaIn                      BIT,
          IsDaKy                      BIT,
          ChildId                     BIGINT,
          StampWithKey                VARCHAR(255),
          Name                        NVARCHAR(255),
          IsHubSendOut                BIT,
          HubPackageId                BIGINT,
          GoiDauTu                    NVARCHAR(255),
          GoiDuAn                     NVARCHAR(255),
          DonViChuTri                 NVARCHAR(255),
          NgayKyKH                    DATETIME,
          SoKH                        NVARCHAR(500),
          DonViSoanThao               NVARCHAR(255),
          GoiDuAn1                    NVARCHAR(255),
          IsNAS                       INT,
          NAS_MESS                    NVARCHAR(MAX),

          -- Sync metadata
          MigrateFlg                  INT,
          MigrateErrFlg                INT,
          MigrateErrMess               NVARCHAR(MAX),
          processing_owner             NVARCHAR(255),
          processing_started_at        DATETIME2,
          processing_heartbeat_at       DATETIME2,
          __sync_time                 DATETIME2,
          __sync_id                   BIGINT,
          CONSTRAINT PK_${stagingTable}_ID PRIMARY KEY (ID)
        );
      END
    `;

    await this.newPool.request().query(query);
    logger.info(`[${this.modelName}] Staging table ${stagingTable} ensured (self-defined schema based on Văn bản dự thảo)`);
  }

  /**
   * Sync batch of rows to staging table using IF EXISTS UPDATE ... ELSE INSERT
   */
  async syncBatchToStaging(rows, instanceId, transaction = null) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { stagedCount: 0 };
    }

    const stagingTable = this.getStagingTableName(instanceId);
    const internalColumns = new Set(['MigrateFlg', 'MigrateErrFlg', 'MigrateErrMess', '__sync_time_val', '__sync_id_val']);

    const columns = Object.keys(rows[0] || {}).filter(col => !String(col).startsWith('__') && !internalColumns.has(col));
    if (!columns.length) {
      return { stagedCount: 0 };
    }

    if (!columns.includes('ID')) {
      throw new Error('Staging sync requires source column "ID"');
    }

    const safeColumns = columns.map(col => this.sanitizeColumnName(col));
    const nonIdColumns = columns.filter(col => col !== 'ID');
    const safeNonIdColumns = nonIdColumns.map(col => this.sanitizeColumnName(col));

    const request = transaction || this.newPool.request();

    for (const row of rows) {
      const rawId = row?.ID;
      if (rawId == null || String(rawId).trim() === '') {
        throw new Error('Row ID is required for staging');
      }

      const updateClause = safeNonIdColumns
        .map((columnName, idx) => `${columnName} = @${nonIdColumns[idx]}`)
        .join(', ');

      const query = `
        IF EXISTS (SELECT 1 FROM ${stagingTable} WHERE ID = @ID)
        BEGIN
          ${nonIdColumns.length > 0 ? `
          UPDATE ${stagingTable}
          SET ${updateClause},
              MigrateFlg = 0,
              MigrateErrFlg = 0,
              MigrateErrMess = NULL
          WHERE ID = @ID;` : `
          UPDATE ${stagingTable}
          SET MigrateFlg = 0,
              MigrateErrFlg = 0,
              MigrateErrMess = NULL
          WHERE ID = @ID;`}
        END
        ELSE
        BEGIN
          INSERT INTO ${stagingTable} (${safeColumns.join(', ')})
          VALUES (${columns.map((column) => `@${column}`).join(', ')});
        END
      `;

      const subRequest = transaction ? transaction.request() : this.newPool.request();
      for (const column of columns) {
        subRequest.input(column, row[column]);
      }

      await subRequest.query(query);
      logger.info(`  └─ [Staging] ID: ${rawId} | Action: ${safeNonIdColumns.length > 0 ? 'UPSERT' : 'INSERT'}`);
    }

    logger.info(`[${this.modelName}] Synced ${rows.length} rows to staging table ${stagingTable}`);
    return { stagedCount: rows.length };
  }
}

module.exports = DraftDocumentExtractor;