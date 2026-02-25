// models/OutgoingDocumentDeleteModel.js
const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');

class OutgoingDocumentDeleteModel extends BaseModel {
  constructor() {
    super();
    this.oldTable = 'VanBanBanHanhDelete';
    this.oldSchema = 'dbo';
    this.newTable = 'outgoing_documents';
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
      logger.error('Lỗi lấy danh sách VanBanBanHanhDelete từ DB cũ:', error);
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
      logger.error('Lỗi tìm outgoing document delete theo id_outgoing_bak:', error);
      throw error;
    }
  }

  async findBookDocumentIdBySoVanBan(soVanBan) {
    try {
      const query = `
        SELECT book_document_id
        FROM DiOffice.dbo.book_documents
        WHERE to_book_code = @soVanBan AND type_document = 'OutGoingDocument'
      `;
      const result = await this.newPool.request()
        .input('soVanBan', soVanBan)
        .query(query);
      return result.recordset.length > 0 ? result.recordset[0].book_document_id : null;
    } catch (error) {
      logger.error('Lỗi tra cứu book_document_id theo SoVanBan (Delete):', error);
      return null;
    }
  }

  async insertToNewDb(data) {
    try {
      const fields = Object.keys(data);
      const values = fields.map((_, i) => `@param${i}`).join(', ');
      const query = `
        INSERT INTO ${this.newSchema}.${this.newTable} 
        (${fields.join(', ')}) 
        VALUES (${values})
      `;

      const request = this.newPool.request();
      fields.forEach((field, i) => {
        request.input(`param${i}`, data[field]);
      });

      await request.query(query);
      return true;
    } catch (error) {
      logger.error('Lỗi insert outgoing document delete:', error);
      throw error;
    }
  }

  async countNewDb() {
    return await this.count(this.newTable, this.newSchema, false);
  }
}

module.exports = OutgoingDocumentDeleteModel;