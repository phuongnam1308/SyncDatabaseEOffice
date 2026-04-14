const FileMigrationModel = require('./FileMigrationModel');
const BaseModel = require("../../../models/BaseModel");
const sql = require('mssql');
const path = require('path');
const fs = require('fs');

class StreamFileMigrationModel extends BaseModel {
    constructor() {
        super();
        this.dbName = process.env.NEW_DB_NAME;
        this.oldDbSchema = "dbo";
        this.oldDbTable = "AllDocs";
        this.newDbSchema = "dbo";
        this.newDbTable = "all_docs_sync";
        this.storageRoot = './physical_storage';
    }
  /**
   * Override initialize: kết nối DB xong tự động tạo bảng trung gian nếu chưa có.
   */
  async initialize() {
    await super.initialize();
    await this.ensureStagingTableExists();
  }

  /**
   * Tự động tạo bảng `all_docs_sync` trong DB mới nếu chưa tồn tại.
   */
  async ensureStagingTableExists() {
    try {
      const newDbName = this.dbName || process.env.NEW_DB_NAME;
      const stagingTableRef = newDbName
        ? `[${newDbName}].[${this.newDbSchema}].[${this.newDbTable}]`
        : `[${this.newDbSchema}].[${this.newDbTable}]`;

      const oldDbName = process.env.OLD_DB_NAME;
      const sourceTableRef = oldDbName
        ? `[${oldDbName}].[${this.oldDbSchema}].[${this.oldDbTable}]`
        : `[${this.oldDbSchema}].[${this.oldDbTable}]`;

      await this.queryNewDb(`
        IF NOT EXISTS (
          SELECT 1 FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = '${this.newDbSchema}'
            AND TABLE_NAME   = '${this.newDbTable}'
        )
        BEGIN
          SELECT TOP 0 * INTO ${stagingTableRef} FROM ${sourceTableRef}
        END
      `);
      console.log(`[StreamFileMigrationModel] ensureStagingTableExists OK: "${stagingTableRef}"`);
    } catch (err) {
      console.error(`[StreamFileMigrationModel] ensureStagingTableExists thất bại: ${err.message}`);
      throw err;
    }
  }


  async migrateFiles() {
        try {
            // 1. Đảm bảo đã khởi tạo các Pool từ dbConnection
            if (!this.oldPool) {
                await this.initialize();
            }

            // 2. Lấy danh sách file (Metadata) - Chỉ lấy bản đã Publish (Level = 1)
            const metaTimer = logger.startTimer('[StreamFileMigrationModel] FETCH_METADATA');
            const filesRequest = await this.oldPool.request().query(`
                SELECT Id, LeafName, DirName, Size
                FROM [dbo].[AllDocs]
                WHERE Level = 1 AND HasStream = 1
            `);
            metaTimer.stop(filesRequest.recordset?.length);

            for (const file of filesRequest.recordset) {
                const { Id, LeafName, DirName } = file;
                const fileTimer = logger.startTimer(`[StreamFileMigrationModel] FILE_STREAMING | ${LeafName}`);

                // Tạo đường dẫn vật lý mới
                const targetFolder = path.join(this.storageRoot, DirName);
                if (!fs.existsSync(targetFolder)) {
                    fs.mkdirSync(targetFolder, { recursive: true });
                }
                const targetPath = path.join(targetFolder, LeafName);

                // 3. Truy vấn các mảnh Content (Shreds) từ database cũ
                const contentRequest = new sql.Request(this.oldPool);
                contentRequest.input('docId', sql.UniqueIdentifier, Id);

                const shreds = await contentRequest.query(`
                    SELECT Content FROM [dbo].[DocStreams]
                    WHERE DocId = @docId
                    ORDER BY BSN ASC
                `);

                // 4. Ghi file vật lý
                const writeStream = fs.createWriteStream(targetPath);
                for (const row of shreds.recordset) {
                    writeStream.write(row.Content);
                }
                writeStream.end();

                fileTimer.stop();
                console.log(`[StreamFileMigrationModel] Đã đồng bộ: ${LeafName}`);
            }
        } catch (err) {
            console.error('[StreamFileMigrationModel] Lỗi Migration:', err);
        }
    }
}
module.exports = StreamFileMigrationModel;
