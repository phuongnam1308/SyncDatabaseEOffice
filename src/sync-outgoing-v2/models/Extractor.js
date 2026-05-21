const BaseExtractor = require('../../sync-base/BaseExtractor');
const logger = require('../../../utils/logger');
const sql = require('mssql');

/**
 * Extractor for outgoing documents (VanBanBanHanh → outgoing_documents_sync_{instanceId})
 */
class Extractor extends BaseExtractor {
  constructor() {
    super({
      modelName: 'OUTGOING_EXTRACTOR',
      oldDbTable: 'VanBanBanHanh',
      oldDbSchema: 'dbo',
      stagingTableBaseName: 'outgoing_documents_sync',
      partitionColumn: 'Created'
    });
  }

  /**
   * Helper to get effective sync time handling epoch reset
   */
  _getEffectiveSyncTime(lastSyncTime) {
    const defaultSyncTime = '2999-12-31T23:59:59.999Z';
    const lastSyncDate = new Date(lastSyncTime);
    const isDateValid = !isNaN(lastSyncDate.getTime());
    const isValidTime = lastSyncTime && 
                        lastSyncTime !== '1970-01-01T00:00:00.000Z' &&
                        isDateValid &&
                        lastSyncDate.getFullYear() > 2000;
    
    return isValidTime ? lastSyncTime : defaultSyncTime;
  }

  /**
   * Get total count of records in old DB for the current date range and cursor
   */
  async getTotalCount(lastSyncTime, lastSyncId = 0) {
    const syncTimeExpr = this.getSyncTimeExpression();

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

    const effectiveSyncTime = this._getEffectiveSyncTime(lastSyncTime);

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
   * Override fetchBatchFromOldDb for outgoing-specific logic
   */
  async fetchBatchFromOldDb(lastSyncTime, lastSyncId = 0, batchSize = 1000, offset = 0) {
    const syncTimeExpr = this.getSyncTimeExpression();

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

    const effectiveSyncTime = this._getEffectiveSyncTime(lastSyncTime);

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
   * countListFromOldDb - Đếm tổng số bản ghi từ CSDL cũ (VanBanBanHanh)
   */
  async countListFromOldDb(lastSyncTime, lastSyncId = 0) {
    const syncTimeExpr = this.getSyncTimeExpression();
    const effectiveSyncTime = this._getEffectiveSyncTime(lastSyncTime);

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
          AND (${this.partitionColumn} >= @startDate OR @startDate IS NULL)
          AND (${this.partitionColumn} <= @endDate OR @endDate IS NULL)
      )
      SELECT COUNT(1) AS total
      FROM source_rows
      WHERE (
        __sync_time < @lastSyncTime
        OR (
          __sync_time = @lastSyncTime
          AND ISNULL(__sync_id_num, 9223372036854775807) < @lastSyncId
        )
      )
      AND __sync_time >= @syncMinDate
    `;

    try {
      const results = await this.oldPool.request()
        .input('lastSyncTime', sql.DateTime2, effectiveSyncTime)
        .input('lastSyncId', sql.BigInt, Number(lastSyncId || 0))
        .input('startDate', sql.DateTime2, process.env.SYNC_START_DATE || null)
        .input('endDate', sql.DateTime2, process.env.SYNC_END_DATE || null)
        .input('syncMinDate', sql.DateTime2, process.env.SYNC_MIN_DATE || '1753-01-01T00:00:00.000Z')
        .query(query);

      return Number(results.recordset?.[0]?.total || 0);
    } catch (error) {
      logger.error(`[${this.modelName}] countListFromOldDb failed: ${error.message}`);
      return 0;
    }
  }

  /**
   * Override ensureStagingTableExists - tự định nghĩa cấu trúc bảng
   * thay vì SELECT * INTO từ DB cũ (không hoạt động khi DB cũ ở server khác)
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
          ID                          BIGINT           NOT NULL,
          Title                       NVARCHAR(150),
          BanLanhDao                  NVARCHAR(1000),
          ChenSo                      BIT,
          TrangThai                   NVARCHAR(100),
          IsLibrary                   BIT,
          DoKhan                      NVARCHAR(50),
          DoMat                       NVARCHAR(50),
          DonVi                       NVARCHAR(MAX),
          Files                       NVARCHAR(4000),
          ChucVu                      NVARCHAR(255),
          DocNum                      NVARCHAR(50),
          NguoiSoanThaoText           NVARCHAR(255),
          FolderLocation              NVARCHAR(500),
          HoSoXuLyLink                NVARCHAR(500),
          InfoVBDi                    NVARCHAR(150),
          ItemVBPH                    NVARCHAR(500),
          LoaiBanHanh                 NVARCHAR(255),
          LoaiVanBan                  NVARCHAR(255),
          NoiLuuTru                   NVARCHAR(1000),
          NoiNhan                     NVARCHAR(1000),
          NgayBanHanh                 DATE,
          NgayHieuLuc                 DATE,
          NgayHoanTat                 DATE,
          NguoiKyVanBan               NVARCHAR(255),
          NguoiKyVanBanText           NVARCHAR(255),
          PhanCong                    BIT,
          TraLoiVBDen                 NVARCHAR(2000),
          SoBan                       INT,
          SoTrang                     INT,
          SoVanBan                    NVARCHAR(255),
          SoVanBanText                NVARCHAR(255),
          TrichYeu                    NVARCHAR(4000),
          BanLanhDaoTCT               NVARCHAR(4000),
          YKien                       NVARCHAR(MAX),
          YKienChiHuy                 NVARCHAR(MAX),
          ModuleId                    INT,
          SiteName                    VARCHAR(50),
          ListName                    NVARCHAR(50),
          ItemId                      INT,
          YearMonth                   VARCHAR(20),
          Modified                    DATETIME,
          Created                     DATETIME,
          ModifiedBy                  UNIQUEIDENTIFIER,
          CreatedBy                   UNIQUEIDENTIFIER,
          MigrateFlg                  INT,
          MigrateErrFlg               INT,
          MigrateErrMess              NVARCHAR(MAX),
          LoaiMoc                     NVARCHAR(200),
          KySoFiles                   NVARCHAR(MAX),
          DGPId                       INT,
          Workflow                    NVARCHAR(255),
          IsKyQuyChe                  BIT,
          DocSignType                 SMALLINT,
          IsConverting                BIT,
          CodeItemId                  BIGINT,
          -- Mapped columns
          document_id                 NVARCHAR(MAX),
          status_code                 NVARCHAR(MAX),
          sender_unit                 NVARCHAR(MAX),
          drafter                     NVARCHAR(MAX),
          document_type               NVARCHAR(MAX),
          urgency_level               NVARCHAR(MAX),
          private_level               NVARCHAR(MAX),
          document_field              NVARCHAR(MAX),
          report_signer               NVARCHAR(MAX),
          report_document_symbol      NVARCHAR(MAX),
          to_book_text_symbols        NVARCHAR(MAX),
          viewers                     NVARCHAR(MAX),
          deadline_reply              NVARCHAR(MAX),
          abstract_note               NVARCHAR(MAX),
          recipient_ids               NVARCHAR(MAX),
          internal_receiving_unit     NVARCHAR(MAX),
          reply_incoming_doc          NVARCHAR(MAX),
          created_at                  NVARCHAR(MAX),
          updated_at                  NVARCHAR(MAX),
          draft_signer                NVARCHAR(MAX),
          book_document_id            NVARCHAR(MAX),
          status                      NVARCHAR(MAX),
          code_commanders             NVARCHAR(MAX),
          commanders                  NVARCHAR(MAX),
          current_note                NVARCHAR(MAX),
          to_book                     NVARCHAR(MAX),
          release_no                  NVARCHAR(MAX),
          release_date                NVARCHAR(MAX),
          text_symbols                NVARCHAR(MAX),
          doc_work_files              NVARCHAR(MAX),
          doc_proposal                NVARCHAR(MAX),
          doc_draft                   NVARCHAR(MAX),
          doc_attachments             NVARCHAR(MAX),
          doc_recall                  NVARCHAR(MAX),
          doc_replacement             NVARCHAR(MAX),
          doc_answer                  NVARCHAR(MAX),
          external_receiving_unit     NVARCHAR(MAX),
          internal_receiving_dept     NVARCHAR(MAX),
          processor                   NVARCHAR(255),
          type_doc                    NVARCHAR(MAX),
          bpmn_version                NVARCHAR(MAX),
          vieweds                     NVARCHAR(MAX),
          know_receivers              NVARCHAR(MAX),
          type_of_process             NVARCHAR(MAX),
          replaced_documents          NVARCHAR(MAX),
          id_outgoing_bak             NVARCHAR(MAX),
          internal_receiving_dept_old NVARCHAR(MAX),
          sign_type                   NVARCHAR(MAX),
          from_create_draf            NVARCHAR(MAX),
          replaced                    NVARCHAR(MAX),
          tb_bak                      NVARCHAR(MAX),
          table_backups               NVARCHAR(MAX),
          send_id_bak_bef_test        NVARCHAR(MAX),
          status_code_bak_bef_test    NVARCHAR(MAX),
          drafter_bak_bef_test        NVARCHAR(MAX),
          processing_owner            NVARCHAR(255),
          processing_started_at       DATETIME2,
          processing_heartbeat_at     DATETIME2,
          stage_status                NVARCHAR(50),
          curStatusCode               NVARCHAR(10),
          __sync_time                 DATETIME2,
          __sync_id                   BIGINT,
          CONSTRAINT PK_outgoing_documents_sync_${instanceId} PRIMARY KEY (ID)
        );
      END
    `;

    await this.newPool.request().query(query);
    await this._ensureStagingColumns(stagingTable);
    logger.info(`[${this.modelName}] Staging table ${stagingTable} ensured (self-defined schema)`);
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

  /**
   * Sync batch of rows to staging table using IF EXISTS UPDATE ... ELSE INSERT
   * (matching the original StreamOutgoingIncrementalModel approach)
   */
  async syncBatchToStaging(rows, instanceId, transaction = null) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { stagedCount: 0 };
    }

    const stagingTable = this.getStagingTableName(instanceId);
    const internalColumns = new Set(['MigrateFlg', 'MigrateErrFlg', 'MigrateErrMess', '_sync_time_val', '_sync_id_val']);

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

module.exports = Extractor;
