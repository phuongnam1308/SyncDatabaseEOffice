// services/IncomingFileMigrationService.js
const path = require('path');
const crypto = require('crypto');
const mime = require('mime-types');

class IncomingFileMigrationService {
  constructor(model) {
    this.model = model;
  }

  parseFiles(files) {
    // Files thường dạng: file1.pdf|file2.docx
    return files.split('|').map(f => f.trim()).filter(Boolean);
  }

  async migrate() {
    const rows = await this.model.getOldFiles();
    let total = 0;

    for (const r of rows) {
      const fileList = this.parseFiles(r.Files);

      for (const fileName of fileList) {
        const ext = path.extname(fileName);
        const mimeType = mime.lookup(ext) || 'application/octet-stream';

        const data = {
          id: crypto.randomUUID(),
          file_name: fileName,
          file_path: fileName, // nếu có folder riêng thì sửa tại đây
          mime_type: mimeType,
          file_size: 0,
          description: r.TrichYeu,
          is_directory: 0,
          parent_id: null,
          created_by: r.CreatedBy,
          created_at: r.Created,
          updated_at: r.Modified,
          status: 1,
          version: 1,
          is_signed_file: 0,
          number_of_signed_file: 0,
          storage_path: fileName,
          storage_type: 'filesystem',
          isNumbered: r.ChenSo,
          typeSize: r.SoTrang,
          id_bak: r.ID,
          table_bak: 'VanBanDen',
          type_doc: r.LoaiVanBan,
          isBak: 1
        };

        await this.model.insertFile(data);
        total++;
      }
    }

    return {
      success: true,
      totalInserted: total
    };
  }
}

module.exports = IncomingFileMigrationService;
