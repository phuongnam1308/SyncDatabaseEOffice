const FileMigrationModel = require('./FileMigrationModel');
const BaseModel = require("../../../models/BaseModel");

class StreamFileMigrationModel extends BaseModel {
    constructor() {
        super();
        //WSS_Content_eoffice_khkd
        this.dbName = process.env.NEW_DB_NAME;
        this.oldDbSchema = "dbo";
        this.oldDbTable = "AllDocs";
        this.newDbSchema = "dbo";
        this.newDbTable = "all_docs_sync";
        this.storageRoot = './physical_storage'; // Thư mục lưu file mới
        this.helper = new MigrationHelper(this.queryNewDbTx.bind(this), this.queryOldDb.bind(this));
        
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
   * Clone cấu trúc từ `AllDocs` (DB cũ) qua IF NOT EXISTS + SELECT TOP 0 * INTO.
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
            // 1. Kết nối tới SharePoint DB
            const pool = await sql.connect( );

            // 2. Lấy danh sách file (Metadata) - Chỉ lấy bản đã Publish (Level = 1)
            const filesRequest = await pool.request().query(`
        SELECT Id, LeafName, DirName, Size 
        FROM [dbo].[AllDocs] 
        WHERE Level = 1 AND HasStream = 1
      `);

            for (const file of filesRequest.recordset) {
                const { Id, LeafName, DirName } = file;

                // Tạo đường dẫn vật lý mới (giữ nguyên cấu trúc thư mục nếu cần)
                const targetFolder = path.join(this.storageRoot, DirName);
                if (!fs.existsSync(targetFolder)) {
                    fs.mkdirSync(targetFolder, { recursive: true });
                }
                const targetPath = path.join(targetFolder, LeafName);

                // 3. Truy vấn các mảnh Content (Shreds) theo thứ tự BSN
                const contentRequest = new sql.Request(pool);
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

                // 5. Lưu Metadata vào CSDL mới của bạn tại đây
                // await this.newDb.save({ fileName: LeafName, path: targetPath, ... });

                console.log(`Đã đồng bộ: ${LeafName}`);
            }
        } catch (err) {
            console.error('Lỗi Migration:', err);
        }
    }
}
module.exports = StreamFileMigrationModel;