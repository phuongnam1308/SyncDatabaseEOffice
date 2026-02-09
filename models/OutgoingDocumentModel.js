// // models/OutgoingDocumentModel.js
// const BaseModel = require('./BaseModel');
// const logger = require('../utils/logger');
// const DataSanitizer = require('../utils/dataSanitizer');

// class OutgoingDocumentModel extends BaseModel {
//   constructor() {
//     super();
//     this.oldTable = 'VanBanBanHanh';
//     this.oldSchema = 'dbo';
//     this.newTable = 'outgoing_documents';
//     this.newSchema = 'dbo';
//   }

//   async getAllFromOldDb() {
//     try {
//       const query = `
//         SELECT 
//           ID,
//           Title,
//           BanLanhDao,
//           ChenSo,
//           TrangThai,
//           IsLibrary,
//           DoKhan,
//           DoMat,
//           DonVi,
//           Files,
//           ChucVu,
//           DocNum,
//           NguoiSoanThaoText,
//           FolderLocation,
//           HoSoXuLyLink,
//           InfoVBDi,
//           ItemVBPH,
//           LoaiBanHanh,
//           LoaiVanBan,
//           NoiLuuTru,
//           NoiNhan,
//           NgayBanHanh,
//           NgayHieuLuc,
//           NgayHoanTat,
//           NguoiKyVanBan,
//           NguoiKyVanBanText,
//           PhanCong,
//           TraLoiVBDen,
//           SoBan,
//           SoTrang,
//           SoVanBan,
//           SoVanBanText,
//           TrichYeu,
//           BanLanhDaoTCT,
//           YKien,
//           YKienChiHuy,
//           ModuleId,
//           SiteName,
//           ListName,
//           ItemId,
//           YearMonth,
//           Modified,
//           Created,
//           ModifiedBy,
//           CreatedBy,
//           MigrateFlg,
//           MigrateErrFlg,
//           MigrateErrMess,
//           LoaiMoc,
//           KySoFiles,
//           DGPId,
//           Workflow,
//           IsKyQuyChe,
//           DocSignType,
//           IsConverting,
//           CodeItemId
//         FROM ${this.oldSchema}.${this.oldTable}
//         ORDER BY ID
//       `;
//       return await this.queryOldDb(query);
//     } catch (error) {
//       logger.error('Lỗi lấy danh sách VanBanBanHanh từ DB cũ:', error);
//       throw error;
//     }
//   }

//   async countOldDb() {
//     return await this.count(this.oldTable, this.oldSchema, true);
//   }

//   async findByBackupId(backupId) {
//     try {
//       const query = `
//         SELECT id, document_id, id_outgoing_bak
//         FROM ${this.newSchema}.${this.newTable}
//         WHERE id_outgoing_bak = @backupId
//       `;
//       const result = await this.queryNewDb(query, { backupId });
//       return result.length > 0 ? result[0] : null;
//     } catch (error) {
//       logger.error('Lỗi tìm outgoing document theo id_outgoing_bak:', error);
//       throw error;
//     }
//   }

//   async findBookDocumentIdBySoVanBan(soVanBan) {
//     try {
//       const query = `
//         SELECT book_document_id
//         FROM camunda.dbo.book_documents
//         WHERE to_book_code = @soVanBan AND type_document = 'OutGoingDocument'
//       `;
//       const result = await this.newPool.request()
//         .input('soVanBan', soVanBan)
//         .query(query);
//       return result.recordset.length > 0 ? result.recordset[0].book_document_id : null;
//     } catch (error) {
//       logger.error('Lỗi tra cứu book_document_id theo SoVanBan:', error);
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
//       logger.error('Lỗi insert outgoing document:', error);
//       throw error;
//     }
//   }

//   async countNewDb() {
//     return await this.count(this.newTable, this.newSchema, false);
//   }
// }

// module.exports = OutgoingDocumentModel;
// models/OutgoingDocument2Model.js
const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');
const DataSanitizer = require('../utils/dataSanitizer');

class OutgoingDocument2Model extends BaseModel {
  constructor() {
    super();
    this.oldTable = 'VanBanBanHanh';
    this.oldSchema = 'dbo';
    this.newTable = 'outgoing_documents2';
    this.newSchema = 'dbo';
  }

  async getAllFromOldDb() {
    try {
      const query = `
        SELECT 
          ID,
          Title,
          BanLanhDao,
          ChenSo,
          TrangThai,
          IsLibrary,
          DoKhan,
          DoMat,
          DonVi,
          Files,
          ChucVu,
          DocNum,
          NguoiSoanThaoText,
          FolderLocation,
          HoSoXuLyLink,
          InfoVBDi,
          ItemVBPH,
          LoaiBanHanh,
          LoaiVanBan,
          NoiLuuTru,
          NoiNhan,
          NgayBanHanh,
          NgayHieuLuc,
          NgayHoanTat,
          NguoiKyVanBan,
          NguoiKyVanBanText,
          PhanCong,
          TraLoiVBDen,
          SoBan,
          SoTrang,
          SoVanBan,
          SoVanBanText,
          TrichYeu,
          BanLanhDaoTCT,
          YKien,
          YKienChiHuy,
          ModuleId,
          SiteName,
          ListName,
          ItemId,
          YearMonth,
          Modified,
          Created,
          ModifiedBy,
          CreatedBy,
          MigrateFlg,
          MigrateErrFlg,
          MigrateErrMess,
          LoaiMoc,
          KySoFiles,
          DGPId,
          Workflow,
          IsKyQuyChe,
          DocSignType,
          IsConverting,
          CodeItemId
        FROM ${this.oldSchema}.${this.oldTable}
        ORDER BY ID
      `;
      return await this.queryOldDb(query);
    } catch (error) {
      logger.error('Lỗi lấy danh sách VanBanBanHanh từ DB cũ:', error);
      throw error;
    }
  }

  async countOldDb() {
    return await this.count(this.oldTable, this.oldSchema, true);
  }

  async findByBackupId(backupId) {
    try {
      const query = `
        SELECT id, document_id, id_outgoing_bak
        FROM ${this.newSchema}.${this.newTable}
        WHERE id_outgoing_bak = @backupId
      `;
      const result = await this.queryNewDb(query, { backupId });
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      logger.error('Lỗi tìm outgoing document theo id_outgoing_bak:', error);
      throw error;
    }
  }

  async findBookDocumentIdBySoVanBan(soVanBan) {
    try {
      const query = `
        SELECT book_document_id
        FROM camunda.dbo.book_documents
        WHERE to_book_code = @soVanBan AND type_document = 'OutGoingDocument'
      `;
      const result = await this.newPool.request()
        .input('soVanBan', soVanBan)
        .query(query);
      return result.recordset.length > 0 ? result.recordset[0].book_document_id : null;
    } catch (error) {
      logger.error('Lỗi tra cứu book_document_id theo SoVanBan:', error);
      return null;
    }
  }

  async insertToNewDb(data) {
    try {
      // Loại bỏ các cột identity (auto-increment) - SQL Server sẽ tự generate
      const identityColumns = ['id', 'ID', 'document_id', 'DocumentId'];
      
      let fields = Object.keys(data).filter(f => !identityColumns.includes(f));
      const values = fields.map((_, i) => `@param${i}`).join(', ');
      const query = `
        INSERT INTO ${this.newSchema}.${this.newTable} 
        (${fields.join(', ')}) 
        VALUES (${values})
      `;

      const request = this.newPool.request();
      // Map of known string length limits
      const truncateMap = {
        document_type: 20,
        urgency_level: 64,
        private_level: 64,
        to_book: 50,
        Title: 255,
        DonVi: 255,
        NguoiSoanThaoText: 80,
        FolderLocation: 80,
        HoSoXuLyLink: 80,
        files: 255,
        BanLanhDaoTCT: 100,
        YKien: 100,
        YKienChiHuy: 100,
        InfoVBDi: 80,
        ItemVBPH: 80,
        NoiNhan: 80,
        NoiLuuTru: 80,
        ChucVu: 80,
        NguoiKyVanBanText: 80,
        NguoiKyVanBan: 20,
        TrichYeu: 100,
        BanLanhDao: 80,
        LoaiBanHanh: 80,
        TrangThai: 80
      };

      fields.forEach((field, i) => {
        // CRITICAL: Use DataSanitizer to handle 'NULL' strings and type conversions
        let value = DataSanitizer.sanitizeValue(data[field], field);

        // apply truncation for known columns (but only for strings, not after conversion to int/null)
        if (typeof value === 'string' && truncateMap[field]) {
          const max = truncateMap[field];
          if (value.length > max) {
            value = value.substring(0, max);
          }
          value = value.trim();
        } else if (typeof value === 'string' && value.length > 100) {
          // safety catch-all: truncate any unlisted string field > 100 chars
          value = value.substring(0, 100).trim();
        }

        const valueType = DataSanitizer.getTypeString(value);
        const len = typeof value === 'string' ? value.length : null;
        const preview = DataSanitizer.formatPreview(value);

        logger.info(`[OutgoingDocumentModel.insertToNewDb] param${i} -> ${field} | type=${valueType} | len=${len} | preview=${preview}`);

        request.input(`param${i}`, value);
      });

      await request.query(query);
      logger.info(`[OutgoingDocumentModel.insertToNewDb] Successfully inserted record with ${fields.length} fields`);
      return true;
    } catch (error) {
      logger.error('Lỗi insert outgoing document:', error);
      throw error;
    }
  }

  async updateInNewDb(data) {
    try {
      // Giả sử data có id_outgoing_bak để identify record cần update
      const { id_outgoing_bak, ...updateFields } = data;
      
      // Nếu không có id_outgoing_bak, trả về 0 để trigger INSERT trong sync logic
      if (!id_outgoing_bak) {
        return 0;
      }

      const fields = Object.keys(updateFields);
      const setClauses = fields.map((field, i) => `${field} = @param${i}`).join(', ');
      
      const query = `
        UPDATE ${this.newSchema}.${this.newTable}
        SET ${setClauses}, updated_at = GETDATE()
        WHERE id_outgoing_bak = @backupId
      `;

      const request = this.newPool.request();
      fields.forEach((field, i) => {
        // Use DataSanitizer to handle 'NULL' strings and type conversions
        const value = DataSanitizer.sanitizeValue(updateFields[field], field);
        
        const valueType = DataSanitizer.getTypeString(value);
        const len = typeof value === 'string' ? value.length : null;
        const preview = DataSanitizer.formatPreview(value);
        
        logger.info(`[OutgoingDocumentModel.updateInNewDb] param${i} -> ${field} | type=${valueType} | len=${len} | preview=${preview}`);
        
        request.input(`param${i}`, value);
      });
      request.input('backupId', id_outgoing_bak);

      const result = await request.query(query);
      // Trả về số hàng được ảnh hưởng
      return result.rowsAffected[0] || 0;
    } catch (error) {
      logger.error('Lỗi update outgoing document:', error);
      throw error;
    }
  }

  async countNewDb() {
    return await this.count(this.newTable, this.newSchema, false);
  }
}

module.exports = OutgoingDocument2Model;