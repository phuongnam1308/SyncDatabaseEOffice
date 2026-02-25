// // models/IncomingDocumentModel.js
// const BaseModel = require('./BaseModel');
// const logger = require('../utils/logger');

// class IncomingDocumentModel extends BaseModel {
//   constructor() {
//     super();
//     this.oldTable = 'VanBanDen';
//     this.oldSchema = 'dbo';
//     this.newTable = 'incomming_documents2';
//     this.newSchema = 'dbo';
//   }

//   async getAllFromOldDb() {
//     try {
//       const query = `
//         SELECT 
//           ID,
//           SoDen,
//           CoQuanGui2,
//           CoQuanGuiText,
//           DonVi,
//           IsLibrary,
//           DoKhan,
//           DoMat,
//           ThoiHanGQ,
//           ItemVBDTCT,
//           ItemVBPH,
//           BanLanhDao,
//           LanhDaoTCT,
//           LanhDaoTCTDaXuLy,
//           LanhDaoTCTDeBiet,
//           LanhDaoVPDN,
//           LinhVuc,
//           LoaiVanBan,
//           NgayDen,
//           NgayTrenVB,
//           SoBan,
//           SoTrang,
//           SoVanBan,
//           TrangThai,
//           TrichYeu,
//           VanBanTraLoi,
//           ChenSo,
//           YKienLanhDao,
//           YKienLanhDaoTCT,
//           YKienLanhDaoVPDN,
//           YKienCuaLDVPChoVanThu,
//           ForwardType,
//           Modified,
//           Created,
//           ModifiedBy,
//           CreatedBy,
//           ModuleId,
//           SiteName,
//           ListName,
//           ItemId,
//           MigrateFlg,
//           YearMonth,
//           MigrateErrFlg,
//           MigrateErrMess,
//           DGPId
//         FROM ${this.oldSchema}.${this.oldTable}
//         ORDER BY ID
//       `;
//       return await this.queryOldDb(query);
//     } catch (error) {
//       logger.error('Lỗi lấy danh sách VanBanDen từ DB cũ:', error);
//       throw error;
//     }
//   }

//   async countOldDb() {
//     return await this.count(this.oldTable, this.oldSchema, true);
//   }

//   async findByBackupId(backupId) {
//     try {
//       const query = `
//         SELECT document_id, id_incoming_bak
//         FROM ${this.newSchema}.${this.newTable}
//         WHERE id_incoming_bak = @backupId
//       `;
//       const result = await this.queryNewDb(query, { backupId });
//       return result.length > 0 ? result[0] : null;
//     } catch (error) {
//       logger.error('Lỗi tìm incoming document theo id_incoming_bak:', error);
//       throw error;
//     }
//   }

//   async findBookDocumentIdBySoDen(soDen) {
//     try {
//       const query = `
//         SELECT book_document_id
//         FROM DiOffice.dbo.book_documents
//         WHERE to_book_code = @soDen AND type_document = 'IncommingDocument'
//       `;
//       const result = await this.newPool.request()
//         .input('soDen', soDen)
//         .query(query);
//       return result.recordset.length > 0 ? result.recordset[0].book_document_id : null;
//     } catch (error) {
//       logger.error('Lỗi tra cứu book_document_id theo SoDen:', error);
//       return null;
//     }
//   }

//   async insertToNewDb(data) {
//     try {
//       const fields = Object.keys(data);
//       const values = fields.map((_, i) => `@param${i}`).join(', ');
//       const query = `
//         INSERT INTO ${this.newSchema}.${this.newTable} 
//         (${fields.join(', ')}) 
//         VALUES (${values})
//       `;

//       const request = this.newPool.request();
//       fields.forEach((field, i) => {
//         request.input(`param${i}`, data[field]);
//       });

//       await request.query(query);
//       return true;
//     } catch (error) {
//       logger.error('Lỗi insert incoming document:', error);
//       throw error;
//     }
//   }

//   async countNewDb() {
//     return await this.count(this.newTable, this.newSchema, false);
//   }
// }

// module.exports = IncomingDocumentModel;

// models/IncomingDocumentModel.js
const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');
const mssql = require('mssql'); // Đảm bảo import mssql nếu chưa có

class IncomingDocumentModel extends BaseModel {
  constructor() {
    super();
    this.oldTable = 'VanBanDen';
    this.oldSchema = 'dbo';
    this.newTable = 'incomming_documents2';
    this.newSchema = 'dbo';
  }

  async getAllFromOldDb() {
    try {
      const query = `
        SELECT 
          ID,
          SoDen,
          CoQuanGui2,
          CoQuanGuiText,
          DonVi,
          IsLibrary,
          DoKhan,
          DoMat,
          ThoiHanGQ,
          ItemVBDTCT,
          ItemVBPH,
          BanLanhDao,
          LanhDaoTCT,
          LanhDaoTCTDaXuLy,
          LanhDaoTCTDeBiet,
          LanhDaoVPDN,
          LinhVuc,
          LoaiVanBan,
          NgayDen,
          NgayTrenVB,
          SoBan,
          SoTrang,
          SoVanBan,
          TrangThai,
          TrichYeu,
          VanBanTraLoi,
          ChenSo,
          YKienLanhDao,
          YKienLanhDaoTCT,
          YKienLanhDaoVPDN,
          YKienCuaLDVPChoVanThu,
          ForwardType,
          Modified,
          Created,
          ModifiedBy,
          CreatedBy,
          ModuleId,
          SiteName,
          ListName,
          ItemId,
          MigrateFlg,
          YearMonth,
          MigrateErrFlg,
          MigrateErrMess,
          DGPId
        FROM ${this.oldSchema}.${this.oldTable}
        ORDER BY ID
      `;
      return await this.queryOldDb(query);
    } catch (error) {
      logger.error('Lỗi lấy danh sách VanBanDen từ DB cũ:', error);
      throw error;
    }
  }

  async countOldDb() {
    return await this.count(this.oldTable, this.oldSchema, true);
  }

  async findByBackupId(backupId) {
    try {
      const query = `
        SELECT document_id, id_incoming_bak
        FROM ${this.newSchema}.${this.newTable}
        WHERE id_incoming_bak = @backupId
      `;
      const result = await this.queryNewDb(query, { backupId });
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      logger.error('Lỗi tìm incoming document theo id_incoming_bak:', error);
      throw error;
    }
  }

  async findBookDocumentIdBySoDen(soDen) {
    try {
      const query = `
        SELECT book_document_id
        FROM DiOffice.dbo.book_documents
        WHERE to_book_code = @soDen AND type_document = 'IncommingDocument'
      `;
      const result = await this.newPool.request()
        .input('soDen', soDen)
        .query(query);
      return result.recordset.length > 0 ? result.recordset[0].book_document_id : null;
    } catch (error) {
      logger.error('Lỗi tra cứu book_document_id theo SoDen:', error);
      return null;
    }
  }

  async insertToNewDb(data) {
    try {
      // Danh sách các trường ngày tháng cần clean (từ bảng của bạn)
      const dateFields = [
        'created_at',
        'updated_at',
        'receive_date',      // từ NgayDen
        'to_book_date',      // từ NgayTrenVB
        'document_date',     // nếu có
        'deadline',          // nếu có
        'resolution_deadline', // nếu có
        'deadline_reply'     // ThoiHanGQ nếu là ngày
      ];

      // Clean ngày tháng: chuyển invalid → null (để SQL dùng DEFAULT nếu có)
      dateFields.forEach(field => {
        if (data[field] !== undefined) {
          const val = data[field];
          if (!val || val === '' || val === 'null' || val === '0000-00-00' || val.trim() === '') {
            data[field] = null;
          } else {
            try {
              // Thử convert sang Date object
              const dateObj = new Date(val);
              if (!isNaN(dateObj.getTime())) {
                data[field] = dateObj; // hợp lệ → dùng Date
              } else {
                data[field] = null;    // invalid → null
                logger.warn(`Ngày tháng không hợp lệ cho field ${field}: "${val}" → set null`);
              }
            } catch (e) {
              data[field] = null;
              logger.warn(`Lỗi convert ngày ${field}: "${val}" → set null`);
            }
          }
        }
      });

      const fields = Object.keys(data);

      // Bọc [order] nếu còn dùng (dự phòng)
      const escapedFields = fields.map(field => 
        field.toLowerCase() === 'order' ? '[order]' : field
      ).join(', ');

      const values = fields.map((_, i) => `@param${i}`).join(', ');

      const query = `
        INSERT INTO ${this.newSchema}.${this.newTable} 
        (${escapedFields}) 
        VALUES (${values})
      `;

      const request = this.newPool.request();

      fields.forEach((field, i) => {
        let value = data[field];

        // Xử lý null/undefined an toàn
        if (value === null || value === undefined) {
          request.input(`param${i}`, mssql.NVarChar, null); // hoặc type phù hợp với cột
        } else if (value instanceof Date) {
          // Nếu là Date object → truyền trực tiếp (mssql sẽ convert đúng)
          request.input(`param${i}`, mssql.DateTime2, value);
        } else {
          request.input(`param${i}`, value);
        }
      });

      await request.query(query);

      logger.info(`Insert thành công văn bản ID cũ: ${data.id_incoming_bak || data.ID || 'unknown'}`);
      return true;
    } catch (error) {
      logger.error('Lỗi insert incoming document:', error);
      logger.error('Dữ liệu gây lỗi (JSON):', JSON.stringify(data, (key, val) => {
        if (val instanceof Date) return val.toISOString();
        return val;
      }, 2)); // log chi tiết record lỗi
      throw error;
    }
  }

  async countNewDb() {
    return await this.count(this.newTable, this.newSchema, false);
  }

    // Đếm số record chưa sync (tb_update = 0 hoặc NULL)
  async countUnsyncedFromTempTable() {
    const query = `
      SELECT COUNT(*) as total 
      FROM DiOffice.dbo.incomming_documents2 
      WHERE tb_update IS NULL OR tb_update = 0
    `;
    const result = await this.queryNewDb(query);
    return result[0]?.total || 0;
  }

  // Lấy record chưa sync
  async getUnsyncedFromTempTable() {
    const query = `
      SELECT * 
      FROM DiOffice.dbo.incomming_documents2 
      WHERE tb_update IS NULL OR tb_update = 0
      ORDER BY id_incoming_bak
    `;
    return await this.queryNewDb(query);
  }

  // Kiểm tra tồn tại trong bảng chính
  async checkExistsInMainTable(id_bak, doc_id) {
    let query = `SELECT 1 FROM DiOffice.dbo.incomming_documents WHERE `;
    const params = {};

    if (doc_id) {
      query += `document_id = @doc_id`;
      params.doc_id = doc_id;
    } else if (id_bak) {
      query += `id_incoming_bak = @id_bak`;
      params.id_bak = id_bak;
    } else {
      return false;
    }

    const result = await this.queryNewDb(query, params);
    return result.length > 0;
  }

  // Insert vào bảng chính
  async insertToMainTable(data) {
    const fields = Object.keys(data);
    const values = fields.map((_, i) => `@p${i}`).join(', ');
    const query = `
      INSERT INTO DiOffice.dbo.incomming_documents 
      (${fields.join(', ')}) 
      VALUES (${values})
    `;

    const request = this.newPool.request();
    fields.forEach((f, i) => {
      request.input(`p${i}`, data[f]);
    });

    await request.query(query);
  }

  // Backup sang table_backups
  async backupToTableBackups(record) {
    // Giả sử bảng backup đã có cấu trúc tương tự incomming_documents2
    const fields = Object.keys(record);
    const values = fields.map((_, i) => `@p${i}`).join(', ');
    const query = `
      INSERT INTO table_backups.incomming_documents_backup 
      (${fields.join(', ')}) 
      VALUES (${values})
    `;

    const request = this.newPool.request();
    fields.forEach((f, i) => request.input(`p${i}`, record[f]));
    await request.query(query);
  }

  // Đánh dấu đã sync
  async markAsSynced(identifier) {
    const query = `
      UPDATE DiOffice.dbo.incomming_documents2 
      SET tb_update = 1, tb_bak = @identifier 
      WHERE id_incoming_bak = @identifier OR document_id = @identifier
    `;
    await this.queryNewDb(query, { identifier });
  }

  // Các hàm count khác
  async countTempTable() {
    return await this.count('incomming_documents2', 'DiOffice.dbo', false);
  }

  async countMainTable() {
    return await this.count('incomming_documents', 'DiOffice.dbo', false);
  }

  async countSynced() {
    const query = `SELECT COUNT(*) as cnt FROM DiOffice.dbo.incomming_documents2 WHERE tb_update = 1`;
    const res = await this.queryNewDb(query);
    return res[0]?.cnt || 0;
  }

}

module.exports = IncomingDocumentModel;