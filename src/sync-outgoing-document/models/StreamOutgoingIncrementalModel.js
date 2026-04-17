const logger = require('../../../utils/logger');
const dbUtils = require('../../../utils/dbUtils');
const sql = require('mssql');
const { v4: uuidv4 } = require("uuid");
const SyncCommentModel = require('../../sync-document-comment/SyncCommentModel');
const SyncOutgoingAuditModel = require('../../sync-audit/SyncOutgoingAuditModel');
const StreamOutgoingMigrationModel = require('./StreamOutgoingMigrationModel');
const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const FileService = require('../../sync-file-copy/Fileuploadservice');
const { downloadFile: spDownload } = require('../../sync-file-copy/SharePointAuthService');
const {
  CATEGORY_RELEASE_DV,
  CATEGORY_RELEASE_TCT,
  CATEGORY_OUTGOING
} = require('../../sync-audit/SyncAuditModel');

/**
 * Phát hiện MIME type từ magic bytes — thay thế package file-type (ESM-only)
 */
function detectFileType(buffer) {
  if (!buffer || buffer.length < 4) return { mime: 'application/octet-stream', ext: 'bin' };
  const b = buffer;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { mime: 'application/pdf', ext: 'pdf' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { mime: 'image/gif', ext: 'gif' };
  if (b[0] === 0x42 && b[1] === 0x4D) return { mime: 'image/bmp', ext: 'bmp' };
  if (b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04) {
    const s = buffer.slice(0, 200).toString('latin1');
    if (s.includes('word/')) return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' };
    if (s.includes('xl/')) return { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' };
    if (s.includes('ppt/')) return { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx' };
    return { mime: 'application/zip', ext: 'zip' };
  }
  if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return { mime: 'application/msword', ext: 'doc' };
  if (b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21) return { mime: 'application/x-rar-compressed', ext: 'rar' };
  return { mime: 'application/octet-stream', ext: 'bin' };
}
const DEFAULT_SYNC_TIME = '9999-12-31T23:59:59.999Z';

// Lọc bản ghi cũ hơn ngưỡng này. Đặt trong .env với key SYNC_MIN_DATE.
// Để lấy toàn bộ lịch sử, hãy đặt thành: 1753-01-01T00:00:00.000Z
const SYNC_MIN_DATE = process.env.SYNC_MIN_DATE || '2026-01-01T00:00:00.000Z';

const AUDIT_TABLES = [
  'LuanChuyenVanBan',
  'LuanChuyenVanBan_ATPC',
  'LuanChuyenVanBan_CLL',
  'LuanChuyenVanBan_CNTT',
  'LuanChuyenVanBan_CT',
  'LuanChuyenVanBan_CVTC',
  'LuanChuyenVanBan_DonVi',
  'LuanChuyenVanBan_DVHH',
  'LuanChuyenVanBan_DVKT',
  'LuanChuyenVanBan_GNVT',
  'LuanChuyenVanBan_HC',
  'LuanChuyenVanBan_HT',
  'LuanChuyenVanBan_ICDLB',
  'LuanChuyenVanBan_ICDST',
  'LuanChuyenVanBan_KHDT',
  'LuanChuyenVanBan_KHKD',
  'LuanChuyenVanBan_KTVT',
  'LuanChuyenVanBan_KVTC',
  'LuanChuyenVanBan_MKT',
  'LuanChuyenVanBan_NPL',
  'LuanChuyenVanBan_QLCT',
  'LuanChuyenVanBan_QSBV',
  'LuanChuyenVanBan_SNPL',
  'LuanChuyenVanBan_TC',
  'LuanChuyenVanBan_TC189',
  'LuanChuyenVanBan_TCCT',
  'LuanChuyenVanBan_TCHP',
  'LuanChuyenVanBan_TCIDI',
  'LuanChuyenVanBan_TCLD',
  'LuanChuyenVanBan_TCMT',
  'LuanChuyenVanBan_TCO',
  'LuanChuyenVanBan_TCOT',
  'LuanChuyenVanBan_TCPC',
  'LuanChuyenVanBan_TCPH',
  'LuanChuyenVanBan_TCTT',
  'LuanChuyenVanBan_TTDDC',
  'LuanChuyenVanBan_TTDTC',
  'LuanChuyenVanBan_VP',
  'LuanChuyenVanBan_VPMB',
  'LuanChuyenVanBan_VPTNB',
  'LuanChuyenVanBan_VTB',
  'LuanChuyenVanBan_VTT',
  'LuanChuyenVanBan_XDCT',
  'LuanChuyenVanBan_xdsm',
  'LuanChuyenVanBan_XNCG',
  'LuanChuyenVanBan_YTE'
];

const COMMENT_TABLES = [
  'Comments',
  'Comments_ATPC',
  'Comments_CLL',
  'Comments_CNTT',
  'Comments_CT',
  'Comments_CVTC',
  'Comments_DonVi',
  'Comments_DVHH',
  'Comments_DVKT',
  'Comments_GNVT',
  'Comments_HC',
  'Comments_HT',
  'Comments_ICDLB',
  'Comments_ICDST',
  'Comments_KHDT',
  'Comments_KHKD',
  'Comments_KTVT',
  'Comments_KVTC',
  'Comments_MKT',
  'Comments_NPL',
  'Comments_QLCT',
  'Comments_QSBV',
  'Comments_SNPL',
  'Comments_TC',
  'Comments_TC189',
  'Comments_TCCT',
  'Comments_TCHP',
  'Comments_TCIDI',
  'Comments_TCLD',
  'Comments_TCMT',
  'Comments_TCO',
  'Comments_TCOT',
  'Comments_TCPC',
  'Comments_TCPH',
  'Comments_TCTT',
  'Comments_TTDDC',
  'Comments_TTDTC',
  'Comments_VP',
  'Comments_VPMB',
  'Comments_VPTNB',
  'Comments_VTB',
  'Comments_VTT',
  'Comments_XDCT',
  'Comments_xdsm',
  'Comments_XNCG',
  'Comments_YTE'
];

class OutGoingDocumentModel extends BaseIncrementalSyncInterface {
  /**
   * Configures source/staging tables and nested migration models for outgoing incremental sync.
   */
  constructor() {
    super({ modelName: 'STREAM_OUTGOING_INCREMENTAL' });
    this.newDbName = process.env.NEW_DB_NAME;
    this.oldDbSchema = 'dbo';
    this.oldDbTable = 'VanBanBanHanh';
    this.newDbSchema = 'dbo';
    this.newTableSync = 'outgoing_documents_sync';

    this._syncAuditModel = [];
    this._syncCommentModel = [];
    this._outGoingMigrationModels = null;
    this._fileService = null;
    this.partitionColumn = 'NgayBanHanh'; // Cột nghiệp vụ để chia dải dữ liệu
  }

  /**
   * Initializes DB pools and dependent audit/comment/document models.
   * @returns {Promise<void>}
   */
  async initialize() {
    await super.initialize();
    await this.ensureStagingTableExists();

    try {
      await this.queryNewDb(`
        -- 1. Đảm bảo bảng chính tồn tại
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'outgoing_documents')
        BEGIN
            CREATE TABLE dbo.outgoing_documents (
                id INT IDENTITY(1,1) PRIMARY KEY,
                document_id VARCHAR(100) NOT NULL UNIQUE
            );
        END

        -- 2. Bổ sung các cột tiêu chuẩn và mở rộng
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'status_code')
            ALTER TABLE dbo.outgoing_documents ADD status_code VARCHAR(20) DEFAULT '1' NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'sender_unit')
            ALTER TABLE dbo.outgoing_documents ADD sender_unit VARCHAR(100) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'drafter')
            ALTER TABLE dbo.outgoing_documents ADD drafter VARCHAR(100) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'document_type')
            ALTER TABLE dbo.outgoing_documents ADD document_type VARCHAR(100) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'urgency_level')
            ALTER TABLE dbo.outgoing_documents ADD urgency_level VARCHAR(100) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'private_level')
            ALTER TABLE dbo.outgoing_documents ADD private_level VARCHAR(100) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'document_field')
            ALTER TABLE dbo.outgoing_documents ADD document_field VARCHAR(100) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'report_signer')
            ALTER TABLE dbo.outgoing_documents ADD report_signer VARCHAR(100) NULL;

        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'type_doc')
            ALTER TABLE dbo.outgoing_documents ADD type_doc INT DEFAULT 1 NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'bpmn_version')
            ALTER TABLE dbo.outgoing_documents ADD bpmn_version VARCHAR(24) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'vieweds')
            ALTER TABLE dbo.outgoing_documents ADD vieweds NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'know_receivers')
            ALTER TABLE dbo.outgoing_documents ADD know_receivers NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'type_of_process')
            ALTER TABLE dbo.outgoing_documents ADD type_of_process VARCHAR(100) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'replaced_documents')
            ALTER TABLE dbo.outgoing_documents ADD replaced_documents NVARCHAR(MAX) NULL;

        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'reply_incoming_doc')
            ALTER TABLE dbo.outgoing_documents ADD reply_incoming_doc NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'internal_receiving_dept_old')
            ALTER TABLE dbo.outgoing_documents ADD internal_receiving_dept_old NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'from_create_draf')
            ALTER TABLE dbo.outgoing_documents ADD from_create_draf BIT DEFAULT 0 NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'replaced')
            ALTER TABLE dbo.outgoing_documents ADD replaced BIT DEFAULT 0 NOT NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'sign_type')
            ALTER TABLE dbo.outgoing_documents ADD sign_type BIT NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'id_outgoing_bak')
            ALTER TABLE dbo.outgoing_documents ADD id_outgoing_bak NVARCHAR(255) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'tb_bak')
            ALTER TABLE dbo.outgoing_documents ADD tb_bak BIT DEFAULT 0 NOT NULL;

        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'report_document_symbol')
            ALTER TABLE dbo.outgoing_documents ADD report_document_symbol NVARCHAR(255) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'to_book_text_symbols')
            ALTER TABLE dbo.outgoing_documents ADD to_book_text_symbols NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'viewers')
            ALTER TABLE dbo.outgoing_documents ADD viewers NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'deadline_reply')
            ALTER TABLE dbo.outgoing_documents ADD deadline_reply DATETIME2 NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'abstract_note')
            ALTER TABLE dbo.outgoing_documents ADD abstract_note NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'recipient_ids')
            ALTER TABLE dbo.outgoing_documents ADD recipient_ids NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'internal_receiving_unit')
            ALTER TABLE dbo.outgoing_documents ADD internal_receiving_unit NVARCHAR(255) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'created_at')
            ALTER TABLE dbo.outgoing_documents ADD created_at DATETIME2 NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'updated_at')
            ALTER TABLE dbo.outgoing_documents ADD updated_at DATETIME2 NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'draft_signer')
            ALTER TABLE dbo.outgoing_documents ADD draft_signer NVARCHAR(255) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'book_document_id')
            ALTER TABLE dbo.outgoing_documents ADD book_document_id NVARCHAR(255) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'status')
            ALTER TABLE dbo.outgoing_documents ADD status INT DEFAULT 1 NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'code_commanders')
            ALTER TABLE dbo.outgoing_documents ADD code_commanders NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'commanders')
            ALTER TABLE dbo.outgoing_documents ADD commanders NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'current_note')
            ALTER TABLE dbo.outgoing_documents ADD current_note NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'to_book')
            ALTER TABLE dbo.outgoing_documents ADD to_book INT NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'release_no')
            ALTER TABLE dbo.outgoing_documents ADD release_no NVARCHAR(255) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'release_date')
            ALTER TABLE dbo.outgoing_documents ADD release_date DATETIME2 NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'text_symbols')
            ALTER TABLE dbo.outgoing_documents ADD text_symbols NVARCHAR(255) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'doc_work_files')
            ALTER TABLE dbo.outgoing_documents ADD doc_work_files NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'doc_proposal')
            ALTER TABLE dbo.outgoing_documents ADD doc_proposal NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'doc_draft')
            ALTER TABLE dbo.outgoing_documents ADD doc_draft NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'doc_attachments')
            ALTER TABLE dbo.outgoing_documents ADD doc_attachments NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'doc_recall')
            ALTER TABLE dbo.outgoing_documents ADD doc_recall NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'doc_replacement')
            ALTER TABLE dbo.outgoing_documents ADD doc_replacement NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'doc_answer')
            ALTER TABLE dbo.outgoing_documents ADD doc_answer NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'external_receiving_unit')
            ALTER TABLE dbo.outgoing_documents ADD external_receiving_unit NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'internal_receiving_dept')
            ALTER TABLE dbo.outgoing_documents ADD internal_receiving_dept NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'processor')
            ALTER TABLE dbo.outgoing_documents ADD processor NVARCHAR(255) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'files')
            ALTER TABLE dbo.outgoing_documents ADD files NVARCHAR(MAX) NULL;

        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'send_id_bak_bef_test')
            ALTER TABLE dbo.outgoing_documents ADD send_id_bak_bef_test NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'status_code_bak_bef_test')
            ALTER TABLE dbo.outgoing_documents ADD status_code_bak_bef_test NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'drafter_bak_bef_test')
            ALTER TABLE dbo.outgoing_documents ADD drafter_bak_bef_test NVARCHAR(MAX) NULL;

        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'stage_status')
            ALTER TABLE dbo.outgoing_documents ADD stage_status NVARCHAR(50) NULL;

        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'table_backups')
            ALTER TABLE dbo.outgoing_documents ADD table_backups NVARCHAR(MAX) NULL;
      `);
      logger.info('[OutGoingDocumentModel] Checked and added missing columns (reply_incoming_doc, sign_type, table_backups...) for dbo.outgoing_documents');
    } catch (err) {
      logger.warn(`[OutGoingDocumentModel] Failed to alter table outgoing_documents schema: ${err.message}`);
    }

    this._syncAuditModel = [];
    this._syncCommentModel = [];

    this._outGoingMigrationModels = new StreamOutgoingMigrationModel();
    await this._outGoingMigrationModels.initialize();

    // Khởi tạo FileService một lần với pool đã sẵn sàng
    this._fileService = new FileService(this.newPool);

    for (const table of AUDIT_TABLES) {
      const model = new SyncOutgoingAuditModel(table);
      await model.initialize();
      this._syncAuditModel.push(model);
    }

    // for (const table of COMMENT_TABLES) {
    //   const model = new SyncCommentModel(table);
    //   await model.initialize();
    //   this._syncCommentModel.push(model);
    // }

    logger.info(
      `[OutGoingDocumentModel] Initialized with auditTables=${this._syncAuditModel.length}, commentTables=${this._syncCommentModel.length}`
    );
  }

  /**
   * Alias cho getCount để đồng nhất với SyncHandlerModel.
   */
  async getCount(lastSyncTime, lastSyncId = 0) {
    return this.countListFromOldDb(lastSyncTime, lastSyncId);
  }

  /**
   * Đếm tổng số bản ghi cần đồng bộ.
   */
  async countListFromOldDb(lastSyncTime, lastSyncId = 0) {
    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);

    const syncTimeExpr = this.getSyncTimeExpression();
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
          -- Phân đoạn dữ liệu theo cột nghiệp vụ
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
      -- Chỉ lấy bản ghi từ năm 2026 trở đi (Nếu SYNC_MIN_DATE được bật)
      AND __sync_time >= '${SYNC_MIN_DATE}'
    `;

    const rows = await this.queryOldDb(query, {
      lastSyncTime: normalizedLastSyncTime,
      lastSyncId: normalizedLastSyncId,
      startDate: process.env.SYNC_START_DATE || null,
      endDate: process.env.SYNC_END_DATE || null
    });

    return Number(rows?.[0]?.total || 0);
  }

  /**
   * Tự động tạo bảng staging `outgoing_documents_sync` trong DB mới nếu chưa tồn tại.
   * Clone cấu trúc từ `VanBanBanHanh` (DB cũ) qua SELECT TOP 0 * INTO.
   */
  async ensureStagingTableExists() {
    const table = this.getStagingTableRef();

    const query = `
      IF OBJECT_ID('${table}', 'U') IS NOT NULL
          DROP TABLE ${table};

      CREATE TABLE ${table} (
        -- Source columns (raw from VanBanBanHanh / old DB)
        ID                          NVARCHAR(255)   NOT NULL,
        Title                       NVARCHAR(MAX),
        BanLanhDao                  NVARCHAR(MAX),
        ChenSo                      NVARCHAR(MAX),
        TrangThai                   NVARCHAR(MAX),
        IsLibrary                   NVARCHAR(MAX),
        DoKhan                      NVARCHAR(MAX),
        DoMat                       NVARCHAR(MAX),
        DonVi                       NVARCHAR(MAX),
        Files                       NVARCHAR(MAX),
        ChucVu                      NVARCHAR(MAX),
        DocNum                      NVARCHAR(MAX),
        NguoiSoanThaoText           NVARCHAR(MAX),
        FolderLocation              NVARCHAR(MAX),
        HoSoXuLyLink                NVARCHAR(MAX),
        InfoVBDi                    NVARCHAR(MAX),
        ItemVBPH                    NVARCHAR(MAX),
        LoaiBanHanh                 NVARCHAR(MAX),
        LoaiVanBan                  NVARCHAR(MAX),
        NoiLuuTru                   NVARCHAR(MAX),
        NoiNhan                     NVARCHAR(MAX),
        NgayBanHanh                 NVARCHAR(MAX),
        NgayHieuLuc                 NVARCHAR(MAX),
        NgayHoanTat                 NVARCHAR(MAX),
        NguoiKyVanBan               NVARCHAR(MAX),
        NguoiKyVanBanText           NVARCHAR(MAX),
        PhanCong                    NVARCHAR(MAX),
        TraLoiVBDen                 NVARCHAR(MAX),
        SoBan                       NVARCHAR(MAX),
        SoTrang                     NVARCHAR(MAX),
        SoVanBan                    NVARCHAR(MAX),
        SoVanBanText                NVARCHAR(MAX),
        TrichYeu                    NVARCHAR(MAX),
        BanLanhDaoTCT               NVARCHAR(MAX),
        YKien                       NVARCHAR(MAX),
        YKienChiHuy                 NVARCHAR(MAX),
        ModuleId                    NVARCHAR(MAX),
        SiteName                    NVARCHAR(MAX),
        ListName                    NVARCHAR(MAX),
        ItemId                      NVARCHAR(MAX),
        YearMonth                   NVARCHAR(MAX),
        Modified                    NVARCHAR(MAX),
        Created                     NVARCHAR(MAX),
        ModifiedBy                  NVARCHAR(MAX),
        CreatedBy                   NVARCHAR(MAX),
        MigrateFlg                  NVARCHAR(MAX),
        MigrateErrFlg               NVARCHAR(MAX),
        MigrateErrMess              NVARCHAR(MAX),
        LoaiMoc                     NVARCHAR(MAX),
        KySoFiles                   NVARCHAR(MAX),
        DGPId                       NVARCHAR(MAX),
        Workflow                    NVARCHAR(MAX),
        IsKyQuyChe                  NVARCHAR(MAX),
        DocSignType                 NVARCHAR(MAX),
        IsConverting                NVARCHAR(MAX),
        CodeItemId                  NVARCHAR(MAX),

        -- Mapped/output columns (từ StreamOutgoingMigrationModel)
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
        reply_incoming_doc         NVARCHAR(MAX),
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
        processor                   NVARCHAR(MAX),
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
        table_backups                NVARCHAR(MAX),
        send_id_bak_bef_test        NVARCHAR(MAX),
        status_code_bak_bef_test    NVARCHAR(MAX),
        drafter_bak_bef_test        NVARCHAR(MAX),
        stage_status               NVARCHAR(50),
        curStatusCode              NVARCHAR(10),

        CONSTRAINT PK_outgoing_documents_sync PRIMARY KEY (ID)
      );
      `;

    await this.queryNewDb(query);
  }

  /**
   * Resolves fully-qualified staging table reference in NEW DB.
   * @returns {string}
   */
  getStagingTableRef() {
    if (this.newDbName) {
      return `${this.newDbName}.${this.newDbSchema}.${this.newTableSync}`;
    }
    return `${this.newDbSchema}.${this.newTableSync}`;
  }

  /**
   * Validates and escapes one dynamic source column name.
   * @param {string} column
   * @returns {string}
   */
  sanitizeColumnName(column) {
    if (!/^[A-Za-z0-9_]+$/.test(column)) {
      throw new Error(`Invalid column name from source: ${column}`);
    }
    return `[${column}]`;
  }

  /**
   * Converts arbitrary datetime input to stable ISO cursor format.
   * @param {string|Date|null|undefined} value
   * @returns {string}
   */
  normalizeSyncTime(value) {
    if (!value || value === '1970-01-01T00:00:00.000Z') return DEFAULT_SYNC_TIME;
    const dateValue = new Date(value);
    if (Number.isNaN(dateValue.getTime())) return DEFAULT_SYNC_TIME;
    return dateValue.toISOString();
  }

  /**
   * Extracts row-level sync timestamp used for cursor advancement.
   * @param {object} row
   * @returns {string|null}
   */
  extractRowSyncTime(row) {
    const raw = row?.__sync_time || row?.Modified || row?.Created || row?.NgayTao || row?.updated_at || null;
    if (!raw) return null;
    const dateValue = new Date(raw);
    if (Number.isNaN(dateValue.getTime())) return null;
    return dateValue.toISOString();
  }

  /**
   * Extracts row-level sync id used as tie-breaker for same timestamp.
   * @param {object} row
   * @returns {number}
   */
  extractRowSyncId(row) {
    return Number(row?.__sync_id || row?.ID || 0);
  }

  /**
   * Compares two cursors and returns true when (aTime,aId) is ahead of (bTime,bId).
   * @param {string} aTime
   * @param {number} aId
   * @param {string} bTime
   * @param {number} bId
   * @returns {boolean}
   */
  isCursorAhead(aTime, aId, bTime, bId) {
    const ta = new Date(aTime || DEFAULT_SYNC_TIME).getTime();
    const tb = new Date(bTime || DEFAULT_SYNC_TIME).getTime();
    if (ta < tb) return true; // Trong DESC sync, thời gian nhỏ hơn (cũ hơn) là "đi trước" (tiến về quá khứ)
    if (ta > tb) return false;
    return Number(aId || 0) < Number(bId || 0);
  }

  /**
   * Returns SQL expression that normalizes source sync time across supported columns.
   * @returns {string}
   */
  getSyncTimeExpression() {
    return `
      COALESCE(
        TRY_CONVERT(datetime2, Modified),
        TRY_CONVERT(datetime2, Created)
      )
    `;
  }

  /**
 * Tìm một bản ghi đầy đủ trong bảng staging theo ID.
 * @param {string|number} id - ID của bản ghi cần tìm
 * @param {object} [transaction] - SQL Transaction (nếu có)
 * @returns {Promise<object|null>} Bản ghi đầy đủ hoặc null nếu không tìm thấy
 */
  async getByIdFromStaging(id, transaction = null) {
    if (!id) {
      throw new Error('[getByIdFromStaging] id là bắt buộc.');
    }

    const stagingTableRef = this.getStagingTableRef();

    const query = `
      SELECT TOP 1 *
      FROM ${stagingTableRef}
      WHERE ID = @id
    `;

    const rows = await this.queryNewDbTx(
      query,
      { id: String(id).trim() },
      transaction
    );

    return rows?.[0] || null;
  }

  /**
   * Tìm một bản ghi đầy đủ trong bảng VanBanBanHanh (old DB) theo ID.
   * @param {string|number} id - ID của bản ghi cần tìm
   * @returns {Promise<object|null>} Bản ghi đầy đủ hoặc null nếu không tìm thấy
   */
  async getByIdFromOldDb(id) {
    if (!id) {
      throw new Error('[getByIdFromOldDb] id là bắt buộc.');
    }

    const query = `
      SELECT TOP 1 *
      FROM ${this.oldDbSchema}.${this.oldDbTable}
      WHERE ID = @id
    `;

    const rows = await this.queryOldDb(
      query,
      { id: String(id).trim() }
    );

    return rows?.[0] || null;
  }

  /**
   * Lấy danh sách bản ghi kèm phân trang.
   */
  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0, limit = null, offset = 0) {
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
        -- Chỉ lấy bản ghi từ năm 2026 trở đi
        AND __sync_time >= '${SYNC_MIN_DATE}'
      ) AS t
      WHERE __page_rn > @offset
      ${limit ? `AND __page_rn <= (@offset + @limit)` : ''}
      ORDER BY __page_rn
    `;

    logger.info(`[OutGoingDoc.fetchListFromOldDb] Fetching: lastSyncTime=${lastSyncTime}, lastSyncId=${lastSyncId}, limit=${limit}, offset=${offset}`);
    const results = await this.queryOldDb(query, {
      lastSyncTime,
      lastSyncId: Number(lastSyncId || 0),
      limit: limit ? Number(limit) : null,
      offset: Number(offset || 0),
      startDate: process.env.SYNC_START_DATE || null,
      endDate: process.env.SYNC_END_DATE || null
    });
    logger.info(`[OutGoingDoc.fetchListFromOldDb] Fetched ${results?.length || 0} rows.`);
    return results;
  }

  /**
   * Upserts source rows into staging table so process phase can read deterministic snapshots.
   * @param {object[]} rows
   * @param {{transaction?: object}} [context]
   * @returns {Promise<{stagedCount:number}>}
   */
  async syncOldToStaging(rows, { transaction } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { stagedCount: 0 };
    }

    const columns = Object.keys(rows[0] || {}).filter((column) => {
      return !String(column).startsWith('__') && !['_sync_time_val', '_sync_id_val'].includes(column);
    });
    if (!columns.length) {
      return { stagedCount: 0 };
    }

    if (!columns.includes('ID')) {
      throw new Error('Staging sync requires source column "ID"');
    }

    const safeColumns = columns.map((column) => this.sanitizeColumnName(column));
    const nonIdColumns = columns.filter((column) => column !== 'ID');
    const safeNonIdColumns = nonIdColumns.map((column) => this.sanitizeColumnName(column));
    const stagingTableRef = this.getStagingTableRef();

    for (const row of rows) {
      const rawId = row?.ID;
      if (rawId == null || String(rawId).trim() === '') {
        throw new Error('Row ID is required for staging');
      }

      const params = {};
      for (const column of columns) {
        params[column] = row[column];
      }

      const updateClause = safeNonIdColumns
        .map((columnName, idx) => `${columnName} = @${nonIdColumns[idx]}`)
        .join(', ');

      const query = `
        IF EXISTS (SELECT 1 FROM ${stagingTableRef} WHERE ID = @ID)
        BEGIN
          ${nonIdColumns.length > 0 ? `
          UPDATE ${stagingTableRef}
          SET ${updateClause}
          WHERE ID = @ID;` : `
          SELECT 1 AS noop;`}
        END
        ELSE
        BEGIN
          INSERT INTO ${stagingTableRef} (${safeColumns.join(', ')})
          VALUES (${columns.map((column) => `@${column}`).join(', ')});
        END
      `;

      const existing = await this.queryNewDbTx(`SELECT 1 FROM ${stagingTableRef} WHERE ID = @ID`, { ID: rawId }, transaction);
      const isUpdate = existing && existing.length > 0;

      await this.queryNewDbTx(query, params, transaction);
      logger.info(`  └─ [Staging] ID: ${rawId} | Action: ${isUpdate ? 'UPDATE' : 'INSERT'}`);
    }

    return { stagedCount: rows.length };
  }

  /**
   * Lấy danh sách bản ghi và đẩy vào Staging dùng cơ chế Iterative Batching.
   */
  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    if (!syncJobId) {
      throw new Error('syncJobId is required');
    }

    const STAGING_PARALLEL_BATCHES = Number(process.env.STAGING_PARALLEL_BATCHES || 3);
    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);

    const batchSize = Number(process.env.STAGING_FETCH_BATCH_SIZE || 2000);
    const stagingTableRef = this.getStagingTableRef();

    // Cleanup stale records
    try {
      await this.queryNewDb(`
        UPDATE ${stagingTableRef}
        SET MigrateFlg = 0, MigrateErrMess = 'Reset from stale processing'
        WHERE MigrateFlg = 2
      `);
    } catch (cleanupErr) {
      logger.warn(`[OutGoingDoc] Cleanup stale records failed: ${cleanupErr.message}`);
    }

    // 1. Đếm tổng và cập nhật Dashboard
    const totalCount = await this.countListFromOldDb(normalizedLastSyncTime, normalizedLastSyncId);
    logger.info(`[OutGoingDoc] Tổng số bản ghi cần sync: ${totalCount} (LastTime: ${normalizedLastSyncTime}, LastId: ${normalizedLastSyncId})`);

    await this.queryNewDb(`UPDATE sync_jobs SET total_to_sync = @total WHERE job_id = @jobId`, {
      total: totalCount,
      jobId: syncJobId
    });

    const numIterations = Math.ceil(totalCount / batchSize);
    let totalStaged = 0;
    let nextSyncTime = normalizedLastSyncTime;
    let nextSyncId = normalizedLastSyncId;

    // Helper for parallel fetching
    const fetchAndStage = async (iteration) => {
      const begin = iteration * batchSize;
      const rows = await this.fetchListFromOldDb(
        normalizedLastSyncTime,
        normalizedLastSyncId,
        batchSize,
        begin
      );
      if (!rows || rows.length === 0) return { rowsCount: 0, stagedCount: 0 };

      const stageResult = await dbUtils.withTransactionRetry(this.newPool, async (transaction) => {
        return await this.syncOldToStaging(rows, { transaction });
      }, { maxRetries: 5 });

      return { rowsCount: rows.length, stagedCount: Number(stageResult?.stagedCount || 0), lastRow: rows[rows.length - 1] };
    };

    // 2. Chạy vòng lặp song song
    const executing = new Set();
    const results = [];

    for (let i = 0; i < numIterations; i++) {
      const task = fetchAndStage(i);
      results.push(task);
      executing.add(task);
      task.finally(() => executing.delete(task));

      if (executing.size >= STAGING_PARALLEL_BATCHES) {
        await Promise.race(executing);
      }
    }

    const batchResults = await Promise.all(results);
    for (const res of batchResults) {
      if (!res || res.rowsCount === 0) continue;
      totalStaged += res.stagedCount;

      const rowTime = this.extractRowSyncTime(res.lastRow);
      const rowId = this.extractRowSyncId(res.lastRow);
      if (rowTime && this.isCursorAhead(rowTime, rowId, nextSyncTime, nextSyncId)) {
        nextSyncTime = rowTime;
        nextSyncId = rowId;
      }
    }

    logger.info(`🔥 [OutGoingDoc] Hoàn tất hút dữ liệu về Staging. Staged=${totalStaged}/${totalCount}. LastSyncTime: ${nextSyncTime}, LastSyncId: ${nextSyncId}`);

    // Fix Bug #3: Đếm số bản ghi THỰC TẾ trong staging chưa xử lý
    // FIX: Phải lọc theo dải ngày của instance này (SYNC_START_DATE/SYNC_END_DATE)
    // để tránh đếm nhầm records của các terminal khác đang chạy song song.
    let pendingCount = 0;
    try {
      const pendingRes = await this.queryNewDb(`
        SELECT COUNT(1) AS cnt FROM ${stagingTableRef}
        WHERE ISNULL(MigrateFlg, 0) = 0
          AND ISNULL(MigrateErrFlg, 0) = 0
          AND (${this.partitionColumn} >= @startDate OR @startDate IS NULL)
          AND (${this.partitionColumn} <= @endDate   OR @endDate IS NULL)
      `, {
        startDate: process.env.SYNC_START_DATE || null,
        endDate: process.env.SYNC_END_DATE || null
      });
      pendingCount = Number(pendingRes?.[0]?.cnt || 0);
    } catch (e) {
      logger.warn(`[OutGoingDoc] Không đếm được pending staging: ${e.message}`);
      pendingCount = totalStaged;
    }
    logger.info(`[OutGoingDoc] Pending records trong Staging có thể xử lý: ${pendingCount} (range: ${process.env.SYNC_START_DATE || 'ALL'} → ${process.env.SYNC_END_DATE || 'ALL'})`);

    return {
      syncJobId,
      rows: [],
      totalCount: pendingCount,
      stagedCount: totalStaged,
      sourceLastSyncTime: normalizedLastSyncTime,
      sourceLastSyncId: normalizedLastSyncId,
      lastSyncTime: nextSyncTime,
      lastSyncId: nextSyncId
    };
  }

  /**
   * Reads persisted sync job state from sync_jobs table.
   * @param {string} syncJobId
   * @returns {Promise<object|null>}
   */
  async getSyncJobState(syncJobId) {
    if (!syncJobId) {
      throw new Error('syncJobId is required');
    }

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

  /**
   * Processes one staged item for a sync job inside a DB transaction.
   * @param {string} syncJobId
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async processOne(syncJobId, options = {}) {
    if (!syncJobId) {
      throw new Error('syncJobId is required');
    }

    let jobState;
    try {
      jobState = await this.getSyncJobState(syncJobId);
    } catch (error) {
      throw error;
    }

    let rowData = null;
    let transaction = null;

    try {
      const stagingTableRef = this.getStagingTableRef();

      rowData = await this.fetchOneFromStaging();

      if (!rowData) {
        if (!this._finishedLogged) {
          logger.info(`[OutGoingDoc] Không còn dữ liệu trong staging cho job ${syncJobId}`);
          this._finishedLogged = true;
        }
        await this.finalizeProcessingCursor(syncJobId);
        return {
          syncJobId,
          processed: false,
          done: true
        };
      }

      const rowId = rowData.ID || null;
      const current = Number(jobState?.total_processed || 0) + 1;
      logger.info(`[OutGoingDoc] Process ${current}: record ID=${rowId}`);

      // --- BƯỚC MỚI: Tải file từ SharePoint (NGOÀI giao dịch SQL) ---
      const preparedFiles = await this.prepareFilesFromSharePoint(rowData);

      transaction = new sql.Transaction(this.newPool);
      await transaction.begin();

      const result = await this.processRowData(rowData, { transaction, preparedFiles });

      // Update counters in sync_jobs
      await this.queryNewDbTx(
        `UPDATE sync_jobs
         SET total_processed = ISNULL(total_processed, 0) + 1,
             total_success   = ISNULL(total_success, 0) + 1
         WHERE job_id = @syncJobId`,
        { syncJobId },
        transaction
      );

      // Mark staging row as processed successfully
      await this.queryNewDbTx(
        `UPDATE ${stagingTableRef} WITH (ROWLOCK) SET MigrateFlg = 1, MigrateErrFlg = 0, MigrateErrMess = NULL WHERE ID = @ID`,
        { ID: rowId },
        transaction
      );

      await transaction.commit();

      return {
        syncJobId,
        processed: true,
        done: false,
        rowId,
        result
      };
    } catch (error) {
      if (transaction) {
        try {
          await transaction.rollback().catch(() => { });
        } catch (rollbackError) { }
      }

      if (rowData && rowData.ID) {
        try {
          const stagingTableRef = this.getStagingTableRef();
          await this.queryNewDb(`UPDATE ${stagingTableRef} SET MigrateErrFlg = 1, MigrateErrMess = @Err WHERE ID = @ID`, { ID: rowData.ID, Err: String(error.message).slice(0, 1000) });
        } catch (updateErr) { }
      }

      logger.error(`[OutGoingDoc.processOne] Failed row ID=${rowData?.ID}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Cập nhật cursor (last_sync_time, last_sync_id) lên MAX(Modified)
   */
  async finalizeProcessingCursor(syncJobId) {
    try {
      const stagingTableRef = this.getStagingTableRef();
      const res = await this.queryNewDb(`
        SELECT
          MAX(Modified) AS maxTime,
          MAX(TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), ''))) AS maxId
        FROM ${stagingTableRef}
        WHERE ISNULL(MigrateFlg, 0) = 1
          AND (${this.partitionColumn} >= @startDate OR @startDate IS NULL)
          AND (${this.partitionColumn} <= @endDate OR @endDate IS NULL)
      `, {
        startDate: process.env.SYNC_START_DATE || null,
        endDate: process.env.SYNC_END_DATE || null
      });
      if (res?.[0]?.maxTime) {
        const finalTime = new Date(res[0].maxTime).toISOString();
        const finalId = Number(res[0].maxId || 0);
        await this.queryNewDb(
          `UPDATE sync_jobs
           SET last_sync_time = @t,
               last_sync_id   = @id
           WHERE job_id = @jobId`,
          { t: finalTime, id: finalId, jobId: syncJobId }
        );
        logger.info(`[OutGoingDoc] Cursor finalized for partition: last_sync_time=${finalTime}, last_sync_id=${finalId}`);
      } else {
        logger.info(`[OutGoingDoc] finalizeProcessingCursor: không có bản ghi đã xử lý trong phân đoạn, cursor giữ nguyên.`);
      }
    } catch (err) {
      logger.warn(`[OutGoingDoc.finalizeProcessingCursor] Lỗi khi finalize cursor: ${err.message}`);
    }
  }

  /**
   * Reads one deterministic row from staging using atomic claim.
   */
  async fetchOneFromStaging() {
    try {
      const stagingTableRef = this.getStagingTableRef();
      const query = `
      WITH CTE AS (
        SELECT TOP (1) *
        FROM ${stagingTableRef} WITH (UPDLOCK, READPAST, ROWLOCK)
        WHERE ISNULL(MigrateFlg, 0) = 0
          AND ISNULL(MigrateErrFlg, 0) = 0
          -- Lọc theo dải ngày của partitionColumn để chia tải giữa các Worker
          AND (${this.partitionColumn} >= @startDate OR @startDate IS NULL)
          AND (${this.partitionColumn} <= @endDate OR @endDate IS NULL)
        ORDER BY TRY_CONVERT(datetime2, Modified) DESC,
                 TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), '')) DESC
      )
      UPDATE CTE
      SET MigrateFlg = 2,
          MigrateErrMess = 'Processing...'
      OUTPUT inserted.*
      `;

      const rows = await this.queryNewDb(query, {
        startDate: process.env.SYNC_START_DATE || null,
        endDate: process.env.SYNC_END_DATE || null
      });
      return rows?.length ? rows[0] : null;
    } catch (error) {
      logger.error(`[OutGoingDoc.fetchOneFromStaging] Failed to fetch: ${error.message}`);
      throw error;
    }
  }

  /**
   * Validates and applies one outgoing row into destination aggregates.
   * @param {object} rowData
   * @param {{transaction?: object}} [context]
   * @returns {Promise<{action:string,backupId:string,affected:number}>}
   */
  async processRowData(rowData, { transaction, preparedFiles = [] } = {}) {
    if (!rowData) {
      throw new Error('rowData is required');
    }
    logger.info(`[OutGoingDoc.processRowData] Processing ID: ${rowData.ID}`);

    const backupId = String(rowData.ID || '').trim();
    if (!backupId) {
      throw new Error('Invalid document ID from staging');
    }

    const res = await this.upsertDocumentAggregateById(rowData, { transaction, preparedFiles });
    const affected = Number(res?.affected || 0);

    if (affected === 0) {
      throw new Error(`Document was not inserted or updated for ID=${backupId}`);
    }

    return {
      action: res?.action || 'upsert',
      backupId,
      affected
    };
  }
  /**
   * Tải các file đính kèm từ SharePoint về bộ nhớ (NGOÀI Transaction SQL).
   */
  async prepareFilesFromSharePoint(oldRecord) {
    const files = oldRecord?.Files || '';
    if (!files) return [];

    const baseUrl = (process.env.BASE_URL || "").replace(/\/$/, "");
    if (!baseUrl) return [];

    const parts = files.split('|').filter(Boolean);
    if (parts.length === 0) return [];

    let filesToPath = [];
    const firstPartIsLikelyFile = /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|bmp|txt|zip|rar)$/i.test(parts[0]);

    if (firstPartIsLikelyFile) {
      filesToPath.push(parts[0]);
    } else {
      const directory = parts[0];
      const names = parts.slice(1);
      for (const name of names) {
        if (!name) continue;
        filesToPath.push(directory.endsWith('/') ? `${directory}${name}` : `${directory}/${name}`);
      }
    }

    const preparedResults = [];
    for (const relativePath of filesToPath) {
      try {
        if (!relativePath.includes('/')) continue;
        const fullUrl = `${baseUrl}${relativePath}`;
        const fileName = relativePath.substring(relativePath.lastIndexOf('/') + 1);

        logger.info(`[OutGoingDoc][prepareFiles] Đang tải: ${fileName}`);
        const buffer = await spDownload(fullUrl, this.newPool); // Truyền Pool để lock đa tiến trình

        if (buffer && buffer.length > 0) {
          preparedResults.push({ buffer, fileName, relativePath });
        }
      } catch (err) {
        logger.error(`[OutGoingDoc][prepareFiles] Lỗi tải file ${relativePath}: ${err.message}`);
      }
    }
    return preparedResults;
  }

  /**
   * Ghi dữ liệu file vào database (TRONG Transaction SQL).
   */
  async applyPreparedFiles(preparedFiles, oldRecord, newDocumentRecord, transaction) {
    if (!Array.isArray(preparedFiles) || preparedFiles.length === 0) return true;

    for (const fileItem of preparedFiles) {
      const { buffer, fileName, relativePath } = fileItem;
      const fileType = detectFileType(buffer);
      const mimeType = fileType.mime;

      const fileIdBak = uuidv4();
      const fileRecord = {
        file_name: fileName,
        file_path: relativePath,
        mime_type: mimeType,
        created_by: newDocumentRecord?.drafter || null,
        version: 1,
        id_bak: fileIdBak,
        table_bak: 'VanBanBanHanh',
        type_doc: newDocumentRecord?.type_doc || null,
        isBak: 1
      };

      const relationRecord = {
        object_type: 'docDraft',
        object_id: String(newDocumentRecord?.id),
        object_id_bak: oldRecord?.ID,
        file_id_bak: fileIdBak,
        table_bak: 'VanBanBanHanh',
        type_doc: 'docDraft',
      };

      await this._fileService.uploadAndInsert({
        fileBuffer: buffer,
        originalName: fileName,
        mimeType,
        fileRecord,
        relationRecord,
        folder: 'outgoing',
        localFolder: 'outgoing',
        transaction // Dùng chung TX
      });
    }
    return true;
  }

  async ThemFileDinhKem(oldRecord, newDocumentRecord) {
    const prepared = await this.prepareFilesFromSharePoint(oldRecord);
    return await this.applyPreparedFiles(prepared, oldRecord, newDocumentRecord, null);
  }

  /**
   * Upserts one outgoing document and its related audit/comment entities.
   * @param {object} oldRecord
   * @param {{transaction?: object}} [context]
   * @returns {Promise<{action:string,affected:number}>}
   */
  async upsertDocumentAggregateById(oldRecord, { transaction, preparedFiles = [] } = {}) {
    if (!oldRecord) {
      return { action: 'none', affected: 0 };
    }
    const id = String(oldRecord?.ID || '').trim();
    logger.info(`[AggregateSync][START] Outgoing Aggregate ID: ${id}`);
    try {
      const oldDbRecord = id
        ? await this.getByIdFromOldDb(id).catch(err => {
          logger.warn(`[upsertDocumentAggregateById] Không lấy được old record ID=${id}: ${err.message}`);
          return null;
        })
        : null;
      if (!this._outGoingMigrationModels) {
        throw new Error(`[upsertDocumentAggregateById] Model not initialized for ID=${id}`);
      }

      let totalAffected = 0;

      const _timeStep1 = Date.now();
      const documentResult = await this._outGoingMigrationModels.processSingleRecord(
        oldRecord,
        transaction
      );
      logger.info(`[PERF] STEP 1 (Document) took ${Date.now() - _timeStep1}ms for ID=${id}`);

      if (!documentResult || documentResult.affected === 0) {
        return { action: 'none', affected: 0 };
      }
      logger.info(
        `[AggregateSync][Document] documentId=${documentResult.documentId} action=${documentResult?.action} affected=${documentResult?.affected}`
      );

      totalAffected += Number(documentResult.affected || 0);
      const documentId = documentResult.documentId;
      const stagingRecord = documentId
        ? await this.getByIdFromStaging(id, transaction).catch(err => {
          logger.warn(`[upsertDocumentAggregateById] Không lấy được staging record ID=${id}: ${err.message}`);
          return null;
        })
        : null;
      if (!documentId) {
        return {
          action: documentResult.action || 'upsert',
          affected: Number(totalAffected || 0)
        };
      }
      const drafter = documentResult.drafter;
      /* ====== Thêm file (Đã tải trước) ====== */
      const _timeStep2 = Date.now();
      await this.applyPreparedFiles(preparedFiles, oldRecord, { id: documentId, type_doc: stagingRecord?.type_doc, drafter }, transaction);
      logger.info(`[PERF] STEP 2 (Files DB) took ${Date.now() - _timeStep2}ms for ID=${id}`);

      /* ====== Phân tách bình luận từ HTML (Ý kiến lãnh đạo SP cũ) ====== */
      const _timeStep3 = Date.now();
      try {
        let totalParsedComments = 0;
        if (oldRecord?.YKien) {
          totalParsedComments += await this._outGoingMigrationModels.helper.parseAndInsertHtmlComments(
            oldRecord.YKien, documentId, id, 'VanBanBanHanh', 'YKien', transaction
          );
        }
        if (oldRecord?.YKienChiHuy) {
          totalParsedComments += await this._outGoingMigrationModels.helper.parseAndInsertHtmlComments(
            oldRecord.YKienChiHuy, documentId, id, 'VanBanBanHanh', 'YKienChiHuy', transaction
          );
        }
        if (oldRecord?.YKienLanhDao) {
          totalParsedComments += await this._outGoingMigrationModels.helper.parseAndInsertHtmlComments(
            oldRecord.YKienLanhDao, documentId, id, 'VanBanBanHanh', 'YKienLanhDao', transaction
          );
        }
        if (oldRecord?.YKienLanhDaoTCT) {
          totalParsedComments += await this._outGoingMigrationModels.helper.parseAndInsertHtmlComments(
            oldRecord.YKienLanhDaoTCT, documentId, id, 'VanBanBanHanh', 'YKienLanhDaoTCT', transaction
          );
        }
        if (oldRecord?.YKienLanhDaoVPDN) {
          totalParsedComments += await this._outGoingMigrationModels.helper.parseAndInsertHtmlComments(
            oldRecord.YKienLanhDaoVPDN, documentId, id, 'VanBanBanHanh', 'YKienLanhDaoVPDN', transaction
          );
        }
        if (oldRecord?.YKienCuaLDVPChoVanThu) {
          totalParsedComments += await this._outGoingMigrationModels.helper.parseAndInsertHtmlComments(
            oldRecord.YKienCuaLDVPChoVanThu, documentId, id, 'VanBanBanHanh', 'YKienCuaLDVPChoVanThu', transaction
          );
        }
        if (totalParsedComments > 0) {
          logger.info(`  └─ [ParsedHTMLComments] Extracted ${totalParsedComments} comments from HTML fields.`);
        }
      } catch (htmlCommentErr) {
        logger.warn(`[upsertDocumentAggregateById] Lỗi parse HTML YKien ID=${id}: ${htmlCommentErr.message}`);
      }
      logger.info(`[PERF] STEP 3 (HTML Comments) took ${Date.now() - _timeStep3}ms for ID=${id}`);

      // ══════════════════════════════════════════════════════════════
      // AGGREGATED AUDIT SYNC: Gộp tất cả audit từ các bảng và xử lý theo thứ tự thời gian
      // ══════════════════════════════════════════════════════════════
      const _timeStep4 = Date.now();
      const auditModels = this._syncAuditModel || [];
      if (auditModels.length > 0) {
        try {
          const auditTableNames = auditModels.map(m => m.oldDbTable);
          const firstModel = auditModels[0];

          // Lấy tất cả audit từ tất cả các bảng, đã được sắp xếp chronologically bên trong method này
          const allRawAudits = await firstModel.fetchAllAuditsAcrossTables(
            id,
            auditTableNames,
            [CATEGORY_RELEASE_DV, CATEGORY_RELEASE_TCT, CATEGORY_OUTGOING] // Categories cho văn bản đi
          );

          if (allRawAudits.length > 0) {
            // Tạo map để tìm nhanh model xử lý dựa trên tên bảng
            const modelMap = new Map(auditModels.map(m => [m.oldDbTable, m]));

            for (const rawAudit of allRawAudits) {
              const tableName = rawAudit.__source_table;
              const model = modelMap.get(tableName) || firstModel;

              try {
                const result = await model.processSingleRecord(rawAudit, documentId, transaction, drafter);
                if (!result) continue;

                logger.info(
                  `[AggregateSync][Audit] table=${tableName} documentId=${documentId} inserted=${result?.inserted || 0} updated=${result?.updated || 0}`
                );
                totalAffected += Number(result.inserted || 0);
                totalAffected += Number(result.updated || 0);
              } catch (auditErr) {
                logger.warn(
                  `[upsertDocumentAggregateById] Audit migrate failed table=${tableName} ID=${id}: ${auditErr.message}`
                );
              }
            }
          }
        } catch (error) {
          logger.warn(
            `[upsertDocumentAggregateById] Aggregated fetch audit failed for ID=${id}: ${error.message}`
          );
        }
      }
      logger.info(`[PERF] STEP 4 (Audits) took ${Date.now() - _timeStep4}ms for ID=${id}`);

      // ══════════════════════════════════════════════════════════════
      // AUTO-CREATE AUDIT: Nếu document_id chưa có audit nào → tạo 1 bản ghi CREATE
      // ══════════════════════════════════════════════════════════════
      try {
        const existingAudit = await this.queryNewDbTx(
          `SELECT TOP 1 id FROM ${process.env.NEW_DB_NAME}.dbo.audit WHERE document_id = @docId`,
          { docId: documentId },
          transaction
        );

        if (!existingAudit || existingAudit.length === 0) {
          // Lấy thông tin người tạo từ bản ghi cũ
          const creatorName = oldRecord.CreatedBy || oldRecord.NguoiSoanThaoText || oldRecord.NguoiSoanThao || '';
          const parsedDate = this.helper
            ? this.helper.parseDate(oldRecord.Created)
            : null;
          const createdDate = parsedDate || new Date();

          // Resolve creator ID qua MigrationHelper.mapUserName
          // Ưu tiên dùng drafter (người đã tạo văn bản), nếu không có mới dùng Máy Văn Thư làm dự phòng
          let creatorId = drafter || process.env.VANTHU_USER_ID;
          let displayName = creatorName;

          if (this.helper && creatorName && !creatorId) {
            try {
              const cleanName = this.helper.extractDisplayName
                ? this.helper.extractDisplayName(creatorName)
                : creatorName;
              displayName = cleanName || creatorName;
              const resolvedId = await this.helper.mapUserName(cleanName, transaction);
              if (resolvedId) creatorId = resolvedId;
            } catch (mapErr) {
              logger.warn(`[AutoCreateAudit] mapUserName failed for "${creatorName}": ${mapErr.message}`);
            }
          }

          // Xác định type_document dựa trên loại
          const typeDoc = 'OutgoingDocument';

          const insertQuery = `
          INSERT INTO ${process.env.NEW_DB_NAME}.dbo.audit (
            document_id, [time], user_id, display_name,
            action_code, details, origin_id, created_by,
            receiver, receiver_unit, group_, roleProcess,
            [action], stage_status, created_at, updated_at,
            type_document, table_backups
          ) VALUES (
            @document_id, @time, @user_id, @display_name,
            @action_code, @details, @origin_id, @created_by,
            @receiver, @receiver_unit, @group_, @roleProcess,
            @action, @stage_status, @created_at, GETDATE(),
            @type_document, @table_backups
          )
        `;

          await this.queryNewDbTx(insertQuery, {
            document_id: documentId,
            time: createdDate || new Date(),
            user_id: creatorId,
            display_name: displayName || null,
            action_code: 'CREATE',
            details: JSON.stringify({ note: 'Tạo văn bản (tự động tạo từ migration)', isTransferOption: false }),
            origin_id: `auto_create_${String(oldRecord.ID || '').substring(0, 80)}`,
            created_by: creatorId,
            receiver: creatorId,
            receiver_unit: null,
            group_: null,
            roleProcess: 'VANTHU',
            action: 'Tạo văn bản',
            stage_status: 'DA_XU_LY',
            created_at: createdDate || new Date(),
            type_document: typeDoc,
            table_backups: 'auto_create'
          }, transaction);

          logger.info(`[AutoCreateAudit] Created initial CREATE audit for documentId=${documentId} creator=${displayName}`);
          totalAffected++;
        }
      } catch (autoAuditErr) {
        logger.warn(`[AutoCreateAudit] Failed for documentId=${documentId}: ${autoAuditErr.message}`);
      }

      // for (const commentModel of this._syncCommentModel || []) {
      //   try {
      //     const rawComments = await commentModel.fetchByDocumentId(id);
      //
      //     if (!Array.isArray(rawComments) || !rawComments.length) {
      //       continue;
      //     }
      //
      //     for (const rawComment of rawComments) {
      //       try {
      //         const result = await commentModel.processSingleRecord(rawComment, documentId, transaction);
      //         if (!result) continue;
      //         logger.info(
      //           `[AggregateSync][Comment] table=${commentModel?.oldDbTable} documentId=${documentResult.documentId} inserted=${result?.inserted || 0} updated=${result?.updated || 0}`
      //         );
      //         totalAffected += Number(result.inserted || 0);
      //         totalAffected += Number(result.updated || 0);
      //       } catch (error) {
      //         logger.warn(
      //           `[upsertDocumentAggregateById] Comment migrate failed table=${commentModel?.oldDbTable} ID=${id}: ${error.message}`
      //         );
      //       }
      //     }
      //   } catch (error) {
      //     logger.warn(
      //       `[upsertDocumentAggregateById] Fetch comment failed table=${commentModel?.oldDbTable} ID=${id}: ${error.message}`
      //     );
      //   }
      // }
      // logic xu

      return {
        action: documentResult.action || 'upsert',
        affected: Number(totalAffected || 0)
      };
    } catch (error) {
      logger.error(`[AggregateSync][ERROR] Thất bại xử lý tích hợp cũ-mới cho bản ghi ID=${id} - Lỗi: ${error.message}`);
      throw error;
    }
  }
}

module.exports = OutGoingDocumentModel;
