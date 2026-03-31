const logger = require('../../../utils/logger');
const sql = require('mssql');
const { v4: uuidv4 } = require("uuid");
const SyncCommentModel = require('../../sync-document-comment/SyncCommentModel');
const SyncOutgoingAuditModel = require('../../sync-audit/SyncOutgoingAuditModel');
const StreamOutgoingMigrationModel = require('./StreamOutgoingMigrationModel');
const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const FileService = require('../../sync-file-copy/Fileuploadservice');
const { downloadFile: spDownload } = require('../../sync-file-copy/SharePointAuthService');

/**
 * Phát hiện MIME type từ magic bytes — thay thế package file-type (ESM-only)
 */
function detectFileType(buffer) {
  if (!buffer || buffer.length < 4) return { mime: 'application/octet-stream', ext: 'bin' };
  const b = buffer;
  if (b[0]===0x25&&b[1]===0x50&&b[2]===0x44&&b[3]===0x46) return { mime:'application/pdf', ext:'pdf' };
  if (b[0]===0x89&&b[1]===0x50&&b[2]===0x4E&&b[3]===0x47) return { mime:'image/png', ext:'png' };
  if (b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF)               return { mime:'image/jpeg', ext:'jpg' };
  if (b[0]===0x47&&b[1]===0x49&&b[2]===0x46)               return { mime:'image/gif', ext:'gif' };
  if (b[0]===0x42&&b[1]===0x4D)                             return { mime:'image/bmp', ext:'bmp' };
  if (b[0]===0x50&&b[1]===0x4B&&b[2]===0x03&&b[3]===0x04) {
    const s = buffer.slice(0,200).toString('latin1');
    if (s.includes('word/')) return { mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext:'docx' };
    if (s.includes('xl/'))   return { mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext:'xlsx' };
    if (s.includes('ppt/'))  return { mime:'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext:'pptx' };
    return { mime:'application/zip', ext:'zip' };
  }
  if (b[0]===0xD0&&b[1]===0xCF&&b[2]===0x11&&b[3]===0xE0) return { mime:'application/msword', ext:'doc' };
  if (b[0]===0x52&&b[1]===0x61&&b[2]===0x72&&b[3]===0x21) return { mime:'application/x-rar-compressed', ext:'rar' };
  return { mime:'application/octet-stream', ext:'bin' };
}
const DEFAULT_SYNC_TIME = '9999-12-31T23:59:59.999Z';

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
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'curStatusCode')
            ALTER TABLE dbo.outgoing_documents ADD curStatusCode NVARCHAR(10) NULL;
      `);
      logger.info('[OutGoingDocumentModel] Checked and added missing columns (reply_incoming_doc, sign_type, table_backups...) for dbo.outgoing_documents');
    } catch(err) {
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
   * Tính tổng số bản ghi cần đồng bộ, cap theo COMPLETED_LIMIT nếu có
   */
  async getCount(lastSyncTime, lastSyncId = 0) {
    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);
    const limit = Number(process.env.COMPLETED_LIMIT || 1000);

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
        table_backup                NVARCHAR(MAX),
        send_id_bak_bef_test        NVARCHAR(MAX),
        status_code_bak_bef_test    NVARCHAR(MAX),
        drafter_bak_bef_test        NVARCHAR(MAX),
        stage_status               NVARCHAR(50),
        curStatusCode              NVARCHAR(10),

        CONSTRAINT PK_outgoing_documents_temp PRIMARY KEY (ID)
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
   * Loads incremental source records from OLD DB after current cursor.
   * @param {string} lastSyncTime
   * @param {number} [lastSyncId=0]
   * @returns {Promise<object[]>}
   */
  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0, take = null, offset = null) {
    const syncTimeExpr = this.getSyncTimeExpression();
    const safeTake = Number.isFinite(Number(take)) && Number(take) > 0 ? Number(take) : null;
    const safeOffset = Number.isFinite(Number(offset)) && Number(offset) >= 0 ? Number(offset) : 0;
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
      )
      SELECT
        *,
        ISNULL(__sync_id_num, 0) AS __sync_id
      FROM source_rows
      WHERE (
        __sync_time < @lastSyncTime
        OR (
          __sync_time = @lastSyncTime
          AND ISNULL(__sync_id_num, 9223372036854775807) < @lastSyncId
        )
      )
      ORDER BY
        __sync_time DESC,
        ISNULL(__sync_id_num, 9223372036854775807) DESC,
        ID DESC
      ${safeTake ? 'OFFSET @offset ROWS FETCH NEXT @take ROWS ONLY' : ''}
    `;

    return this.queryOldDb(query, {
      lastSyncTime,
      lastSyncId: Number(lastSyncId || 0),
      ...(safeTake ? { take: safeTake, offset: safeOffset } : {})
    });
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

    const internalColumns = new Set(['__sync_time', '__sync_id', '__sync_id_num']);
    const columns = Object.keys(rows[0] || {}).filter((column) => !internalColumns.has(column));
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

      await this.queryNewDbTx(query, params, transaction);
    }

    return { stagedCount: rows.length };
  }

  /**
   * Builds one staged incremental list for a sync job and returns cursor progression info.
   * @param {string} lastSyncTime
   * @param {string} syncJobId
   * @param {number} [lastSyncId=0]
   * @returns {Promise<object>}
   */
  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    if (!syncJobId) {
      throw new Error('syncJobId is required');
    }

    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);

    const stageBatchSize = 1000; // Giới hạn 1000 bản ghi trước
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
      const rowTime = this.extractRowSyncTime(row);
      const rowId = this.extractRowSyncId(row);
      if (!rowTime) continue;
      if (this.isCursorAhead(rowTime, rowId, nextSyncTime, nextSyncId)) {
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

    const jobState = await this.getSyncJobState(syncJobId);
    const itemIndex = Number(
      options.itemIndex != null
        ? options.itemIndex
        : (jobState?.total_processed || 0)
    );

    const sourceLastSyncTime = this.normalizeSyncTime(
      options.sourceLastSyncTime || options.lastSyncTime || jobState?.last_sync_time || DEFAULT_SYNC_TIME
    );
    const sourceLastSyncId = Number(
      options.sourceLastSyncId != null
        ? options.sourceLastSyncId
        : (jobState?.last_sync_id || 0)
    );

    const transaction = new sql.Transaction(this.newPool);
    await transaction.begin();

    try {
      const rowData = await this.fetchOneFromStaging({
        lastSyncTime: sourceLastSyncTime,
        lastSyncId: sourceLastSyncId,
        itemIndex,
        transaction
      });

      if (!rowData) {
        await transaction.commit();
        return {
          syncJobId,
          itemIndex,
          processed: false,
          done: true
        };
      }

      const result = await this.processRowData(rowData, { transaction });
      await transaction.commit();

      return {
        syncJobId,
        itemIndex,
        processed: true,
        done: false,
        rowId: rowData.ID || null,
        result
      };
    } catch (error) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        logger.error('[OutGoingDocumentModel.processOne] rollback failed:', rollbackError);
      }
      throw error;
    }
  }

  /**
   * Reads one deterministic row from staging based on source cursor and item index.
   * @param {{lastSyncTime:string,lastSyncId?:number,itemIndex:number,transaction?:object}} context
   * @returns {Promise<object|null>}
   */
  async fetchOneFromStaging({ lastSyncTime, lastSyncId = 0, itemIndex, transaction } = {}) {
    const rowNumber = Number(itemIndex || 0) + 1;
    const stagingTableRef = this.getStagingTableRef();
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
        FROM ${stagingTableRef}
      ),
      staged AS (
        SELECT
          *,
          ROW_NUMBER() OVER (
            ORDER BY
              __sync_time DESC,
              ISNULL(__sync_id_num, 9223372036854775807) DESC,
              ID DESC
          ) AS rn
        FROM source_rows
        WHERE (
          __sync_time < @lastSyncTime
          OR (
            __sync_time = @lastSyncTime
            AND ISNULL(__sync_id_num, 9223372036854775807) < @lastSyncId
          )
        )
      )
      SELECT TOP 1 *
      FROM staged
      WHERE rn = @rowNumber
    `;

    const rows = await this.queryNewDbTx(
      query,
      {
        lastSyncTime,
        lastSyncId: Number(lastSyncId || 0),
        rowNumber
      },
      transaction
    );

    if (!rows?.length) {
      return null;
    }

    const row = { ...rows[0] };
    delete row.rn;
    return row;
  }

  /**
   * Validates and applies one outgoing row into destination aggregates.
   * @param {object} rowData
   * @param {{transaction?: object}} [context]
   * @returns {Promise<{action:string,backupId:string,affected:number}>}
   */
  async processRowData(rowData, { transaction } = {}) {
    if (!rowData) {
      throw new Error('rowData is required');
    }

    const backupId = String(rowData.ID || '').trim();
    if (!backupId) {
      throw new Error('Invalid document ID from staging');
    }

    const res = await this.upsertDocumentAggregateById(rowData, { transaction });
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
  // hàm nhận vào bản ghi cũ và mới để thêm file
  async ThemFileDinhKem(oldRecord, newDocumentRecord) {

    const files = oldRecord?.Files || '';

    if (!files) {
      return false;
    }

    try {
      const fileSvc = this._fileService;
      const baseUrl = (process.env.BASE_URL || "").replace(/\/$/, "");
      if (!baseUrl) {
        logger.error('[ThemFileDinhKem][Outgoing] BASE_URL is not configured in .env');
        return false;
      }

      const parts = files.split('|').filter(Boolean);
      if (parts.length === 0) return true;

      let filesToProcess = [];

      // Heuristic to decide parsing strategy based on the format of the first part.
      const firstPartIsLikelyFile = /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|bmp|txt|zip|rar)$/i.test(parts[0]);

      if (firstPartIsLikelyFile) {
        // FORMAT 1: "path/to/file.ext|other_data..."
        filesToProcess.push(parts[0]);
      } else {
        // FORMAT 2: "path/to/dir/|file1.pdf|file2.docx"
        const directory = parts[0];
        const names = parts.slice(1);
        for (const name of names) {
          if (!name) continue;
          const relativePath = directory.endsWith('/') ? `${directory}${name}` : `${directory}/${name}`;
          filesToProcess.push(relativePath);
        }
      }

      for (const relativePath of filesToProcess) {
        if (!relativePath || !relativePath.includes('/')) {
          logger.warn(`[ThemFileDinhKem][Outgoing] Skipping invalid path part: "${relativePath}" for record ${oldRecord?.ID}`);
          continue;
        }

        const fullUrl = `${baseUrl}${relativePath}`;
        const fileName = relativePath.substring(relativePath.lastIndexOf('/') + 1);

        let buffer;
        try {
          buffer = await spDownload(fullUrl);
        } catch (downloadErr) {
          logger.error(`[ThemFileDinhKem][Outgoing] Failed to download file from ${fullUrl}: ${downloadErr.message}`);
          continue;
        }

        const fileType = detectFileType(buffer);
        const mimeType = fileType.mime;

        const fileIdBak = uuidv4();
        const fileRecord = {
          file_name: fileName,
          file_path: relativePath,
          mime_type: mimeType,
          created_by: newDocumentRecord?.drafter,
          version: 1,
          id_bak: fileIdBak,
          table_bak: 'VanBanBanHanh',
          type_doc: newDocumentRecord?.type_doc,
          isBak: 1
        };

        const relationRecord = {
          object_type: 'docDraft',
          object_id: String(newDocumentRecord?.id),  // ID văn bản trong DB mới — NOT NULL
          object_id_bak: oldRecord?.ID,
          file_id_bak: fileIdBak,
          table_bak: 'VanBanBanHanh',
          type_doc: 'docDraft',
        };

        await fileSvc.uploadAndInsert({
          fileBuffer: buffer,
          originalName: fileName,
          mimeType,
          fileRecord,
          relationRecord,
          folder: 'outgoing',
          localFolder: 'outgoing'
        });
      }

      return true;
    } catch (error) {
      logger.error(`[ThemFileDinhKem][Outgoing] Unexpected error while migrating files for record ID ${oldRecord?.ID}: ${error.message}`, { stack: error.stack });
      return false;
    }

}

  /**
   * Upserts one outgoing document and its related audit/comment entities.
   * @param {object} oldRecord
   * @param {{transaction?: object}} [context]
   * @returns {Promise<{action:string,affected:number}>}
   */
  async upsertDocumentAggregateById(oldRecord, { transaction } = {}) {
    if (!oldRecord) {
      return { action: 'none', affected: 0 };
    }
    const id = String(oldRecord.ID || '').trim();
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

    const documentResult = await this._outGoingMigrationModels.processSingleRecord(
      oldRecord,
      transaction
    );

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

    /* ====== thêm file====== */
    try {
      if (oldRecord?.Files) {
        const ok = await this.ThemFileDinhKem(
          oldRecord,
          {
            id: documentId,
            type_doc: stagingRecord?.type_doc
          }
        );

        logger.info(
          `[AggregateSync][Files] documentId=${documentId} migrated=${ok}`
        );
      }
    } catch (fileErr) {
      logger.warn(
        `[upsertDocumentAggregateById] File migrate failed ID=${id}: ${fileErr.message}`
      );
    }

    /* ====== Phân tách bình luận từ HTML (Ý kiến lãnh đạo SP cũ) ====== */
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
        logger.info(`[AggregateSync][ParsedHTMLComments] documentId=${documentId} newly extracted comments=${totalParsedComments}`);
      }
    } catch (htmlCommentErr) {
      logger.warn(`[upsertDocumentAggregateById] Lỗi parse HTML YKien ID=${id}: ${htmlCommentErr.message}`);
    }

    // ══════════════════════════════════════════════════════════════
    // AGGREGATED AUDIT SYNC: Gộp tất cả audit từ các bảng và xử lý theo thứ tự thời gian
    // ══════════════════════════════════════════════════════════════
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
              const result = await model.processSingleRecord(rawAudit, documentId, transaction);
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
        let creatorId = process.env.VANTHU_USER_ID;
        let displayName = creatorName;
        if (this.helper && creatorName) {
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
  }
}

module.exports = OutGoingDocumentModel;
