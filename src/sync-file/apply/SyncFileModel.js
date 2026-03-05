const BaseModel = require("../../../models/BaseModel");
const logger = require("../../../utils/logger");
const sql = require('mssql');

class SyncFileModel extends BaseModel {
  constructor() {
    super();
    this.syncSchema = "dbo";
    this.syncTable = "file_documents_sync";
    this.mainSchema = "dbo";
    this.mainTable = "file_documents";
  }

  /**
   * Override initialize: kết nối DB xong tự động tạo bảng trung gian nếu chưa có.
   */
  async initialize() {
    await super.initialize();
    await this.ensureStagingTableExists();
  }

  /**
   * Tự động tạo bảng `file_documents_sync` trong DB mới nếu chưa tồn tại.
   * Bảng này không clone từ DB cũ mà tạo explicit vì đây là bảng trung gian
   * nội bộ trong DB mới (không có bảng nguồn tương ứng bên DB cũ).
   */
  async ensureStagingTableExists() {
    try {
      const newDbName = process.env.NEW_DB_NAME;
      const tableRef  = newDbName
        ? `[${newDbName}].[${this.syncSchema}].[${this.syncTable}]`
        : `[${this.syncSchema}].[${this.syncTable}]`;

      await this.queryNewDb(`
        IF OBJECT_ID('${tableRef}', 'U') IS NULL
        BEGIN
          CREATE TABLE ${tableRef} (
            id            BIGINT IDENTITY(1,1) PRIMARY KEY,
            document_id   NVARCHAR(255)  NULL,
            file_name     NVARCHAR(500)  NULL,
            file_path     NVARCHAR(1000) NULL,
            file_size     BIGINT         NULL,
            file_type     NVARCHAR(100)  NULL,
            status        INT            NOT NULL DEFAULT 0,
            created_at    DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
            updated_at    DATETIME2      NOT NULL DEFAULT SYSDATETIME()
          );
        END
      `);
      console.log(`[SyncFileModel] ensureStagingTableExists OK: "${tableRef}"`);
    } catch (err) {
      console.error(`[SyncFileModel] ensureStagingTableExists thất bại: ${err.message}`);
      throw err;
    }
  }

  async getStatus() {
    try {
      const countSyncQuery = `
        SELECT COUNT(*) AS total
        FROM ${process.env.NEW_DB_NAME}.${this.syncSchema}.${this.syncTable}
      `;
      const syncResult = await this.queryNewDbTx(countSyncQuery);
      const totalInSync = syncResult[0]?.total || 0;

      const countMainQuery = `
        SELECT COUNT(*) AS total
        FROM ${process.env.NEW_DB_NAME}.${this.mainSchema}.${this.mainTable}
      `;
      const mainResult = await this.queryNewDbTx(countMainQuery);
      const totalInMain = mainResult[0]?.total || 0;

      return {
        totalInSync,
        totalInMain,
        remaining: totalInSync - totalInMain,
      };
    } catch (error) {
      logger.error("[SyncFileModel.getStatus] Error:", error);
      throw error;
    }
  }
}

module.exports = SyncFileModel;