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
   * getSyncTimeExpression - Fallback nhiều kiểu dữ liệu, ưu tiên Modified, Created, NgayBanHanh
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
        TRY_CONVERT(datetime2, [NgayBanHanh], 105),
        TRY_CONVERT(datetime2, [NgayBanHanh], 120),
        TRY_CONVERT(datetime2, [NgayBanHanh], 121),
        TRY_CONVERT(datetime2, Modified),
        TRY_CONVERT(datetime2, Created),
        TRY_CONVERT(datetime2, [NgayBanHanh]),
        '2026-01-01T00:00:00.000Z'
      )
    `.trim();
  }

  /**
   * getPartitionColumnExpression - Ưu tiên Created, Modified cho partition column an toàn
   */
  getPartitionColumnExpression() {
    return `
      COALESCE(
        TRY_CONVERT(datetime2, [Created], 121),
        TRY_CONVERT(datetime2, [Modified], 121),
        TRY_CONVERT(datetime2, [NgayBanHanh], 121),
        TRY_CONVERT(datetime2, [Created]),
        TRY_CONVERT(datetime2, [Modified]),
        TRY_CONVERT(datetime2, [NgayBanHanh]),
        '2026-01-01T00:00:00.000Z'
      )
    `.trim();
  }

  /**
   * Helper to get effective sync time handling epoch reset
   */
  _getEffectiveSyncTime(lastSyncTime) {
    const defaultSyncTime = '1753-01-01T00:00:00.000Z';
    const lastSyncDate = new Date(lastSyncTime);
    const isDateValid = !isNaN(lastSyncDate.getTime());
    const isValidTime = lastSyncTime && 
                        lastSyncTime !== '1970-01-01T00:00:00.000Z' &&
                        isDateValid &&
                        lastSyncDate.getFullYear() > 1000 &&
                        lastSyncTime !== '2999-12-31T23:59:59.999Z' &&
                        lastSyncTime !== '2100-01-01T00:00:00.000Z';
    
    let effectiveSyncTime = isValidTime ? lastSyncTime : defaultSyncTime;

    // Guard: chặn cursor tương lai để tránh skip toàn bộ data
    const maxAllowed = new Date(Date.now() + 8 * 60 * 60 * 1000);
    if (new Date(effectiveSyncTime) > maxAllowed) {
      logger.warn(`[${this.modelName}] Cursor tương lai bị reset về DEFAULT: ${effectiveSyncTime}`);
      effectiveSyncTime = defaultSyncTime;
    }

    return effectiveSyncTime;
  }

  /**
   * Get total count of records in old DB for the current date range and cursor
   */
  async getTotalCount(lastSyncTime, lastSyncId = 0) {
    const syncTimeExpr = this.getSyncTimeExpression();
    const partitionExpr = this.getPartitionColumnExpression();

    // =========================================================================
    // KHỐI GHI ĐÈ ĐỂ TEST SYNC 1 VĂN BẢN DUY NHẤT
    // =========================================================================
    // Hướng dẫn: Gán ID văn bản cũ (ví dụ: '123') cho testDocId để chỉ sync đúng 1 bản ghi này.
    // Hoặc cấu hình qua biến môi trường TEST_SINGLE_DOC_ID ở file .env
    // =========================================================================
    const testDocId = process.env.TEST_SINGLE_DOC_ID || null; // ví dụ: '123'
    // =========================================================================

    let query = `
      SELECT COUNT(1) AS cnt
      FROM ${this.oldDbSchema}.${this.oldDbTable}
      WHERE 1=1
        AND (${partitionExpr} >= @startDate OR @startDate IS NULL)
        AND (${partitionExpr} <= @endDate OR @endDate IS NULL)
        AND (
          @lastSyncTime = '1753-01-01T00:00:00.000Z'
          OR ${syncTimeExpr} > @lastSyncTime
          OR (
            ${syncTimeExpr} = @lastSyncTime
            AND TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), '')) > @lastSyncId
          )
        )
        AND ${syncTimeExpr} >= @syncMinDate
    `;

    if (testDocId) {
      query = query.replace('WHERE 1=1', `WHERE 1=1 AND ID = @testDocId`);
    }

    const effectiveSyncTime = this._getEffectiveSyncTime(lastSyncTime);

    try {
      const request = this.oldPool.request();
      if (testDocId) {
        request.input('testDocId', sql.NVarChar, testDocId);
      }
      const results = await request
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
    const partitionExpr = this.getPartitionColumnExpression();

    // =========================================================================
    // KHỐI GHI ĐÈ ĐỂ TEST SYNC 1 VĂN BẢN DUY NHẤT
    // =========================================================================
    // Hướng dẫn: Gán ID văn bản cũ (ví dụ: '123') cho testDocId để chỉ sync đúng 1 bản ghi này.
    // Hoặc cấu hình qua biến môi trường TEST_SINGLE_DOC_ID ở file .env
    // =========================================================================
    const testDocId = process.env.TEST_SINGLE_DOC_ID || null; // ví dụ: '123'
    // =========================================================================

    let query = `
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

    if (testDocId) {
      query = query.replace('WHERE 1=1', `WHERE 1=1 AND ID = @testDocId`);
    }

    const effectiveSyncTime = this._getEffectiveSyncTime(lastSyncTime);

    logger.info(`[${this.modelName}] Fetching batch: lastSyncTime=${effectiveSyncTime}, lastSyncId=${lastSyncId}, limit=${batchSize}, offset=${offset}`);

    try {
      const request = this.oldPool.request();
      if (testDocId) {
        request.input('testDocId', sql.NVarChar, testDocId);
      }
      const results = await request
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
    const partitionExpr = this.getPartitionColumnExpression();
    const effectiveSyncTime = this._getEffectiveSyncTime(lastSyncTime);

    // =========================================================================
    // KHỐI GHI ĐÈ ĐỂ TEST SYNC 1 VĂN BẢN DUY NHẤT
    // =========================================================================
    // Hướng dẫn: Gán ID văn bản cũ (ví dụ: '123') cho testDocId để chỉ sync đúng 1 bản ghi này.
    // Hoặc cấu hình qua biến môi trường TEST_SINGLE_DOC_ID ở file .env
    // =========================================================================
    const testDocId = process.env.TEST_SINGLE_DOC_ID || null; // ví dụ: '123'
    // =========================================================================

    let query = `
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

    if (testDocId) {
      query = query.replace('WHERE 1=1', `WHERE 1=1 AND ID = @testDocId`);
    }

    try {
      const request = this.oldPool.request();
      if (testDocId) {
        request.input('testDocId', sql.NVarChar, testDocId);
      }
      const results = await request
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


}

module.exports = Extractor;
