import { Injectable } from '@nestjs/common';
import * as sql from 'mssql';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';

@Injectable()
export class MigrationService {
  constructor() {
    this.storageRoot = './physical_storage'; // Thư mục lưu file mới
  }

  async migrateFiles() {
    try {
      // 1. Kết nối tới SharePoint DB
      const pool = await sql.connect(config);

      // 2. Lấy danh sách file (Metadata) - Chỉ lấy bản đã Publish (Level = 1)
      const filesRequest = await pool.request().query(`
        SELECT Id, LeafName, DirName, Size 
        FROM [dbo].[AllDocs] 
        WHERE Level = 1 AND HasStream = 1
      `);

      for (const file of filesRequest.recordset) {
        const { Id, LeafName, DirName, Size } = file;
        // Tạo đường dẫn vật lý mới (giữ nguyên cấu trúc thư mục nếu cần)
        const targetFolder = path.join(this.storageRoot, DirName);
        if (!fs.existsSync(targetFolder)) {
          fs.mkdirSync(targetFolder, { recursive: true });
        }
        // Để tránh trùng lặp, dùng Id làm tên file
        const targetPath = path.join(targetFolder, `${Id}_${LeafName}`);

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

        // 5. Kiểm tra Size
        writeStream.on('finish', () => {
          const stats = fs.statSync(targetPath);
          if (stats.size !== Size) {
            console.warn(`File size mismatch: ${LeafName}`);
          }
        });

        // 6. Lưu Metadata vào CSDL mới của bạn tại đây
        // await this.newDb.save({ fileName: LeafName, path: targetPath, ... });

        console.log(`Đã đồng bộ: ${LeafName}`);
      }
    } catch (err) {
      console.error('Lỗi Migration:', err);
    }
  }
}
