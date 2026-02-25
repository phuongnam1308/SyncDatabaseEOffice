const FileMigrationModel = require('./FileMigrationModel');
const BaseModel = require("../../../models/BaseModel");

class StreamFileMigrationModel extends BaseModel {
    constructor() {
        super();
        //WSS_Content_eoffice_khkd
        this.dbName = 'camunda';
        this.oldDbSchema = "dbo";
        this.oldDbTable = "AllDocs";
        this.newDbSchema = "dbo";
        this.newDbTable = "all_docs_sync";
        this.storageRoot = './physical_storage'; // Thư mục lưu file mới
        this.helper = new MigrationHelper(this.queryNewDbTx.bind(this));
        
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

