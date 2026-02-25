// models/IncomingDocumentDeleteModel.js
const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');

class IncomingDocumentDeleteModel extends BaseModel {
  constructor() {
    super();
    this.oldTable = 'VanBanDenDelete';
    this.oldSchema = 'dbo';
    this.newTable = 'incomming_documents';
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
      logger.error('Lỗi lấy danh sách VanBanDenDelete từ DB cũ:', error);
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
      logger.error('Lỗi tìm incoming document delete theo id_incoming_bak:', error);
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
      logger.error('Lỗi tra cứu book_document_id theo SoDen (Delete):', error);
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
      logger.error('Lỗi insert incoming document delete:', error);
      throw error;
    }
  }

  async countNewDb() {
    return await this.count(this.newTable, this.newSchema, false);
  }
}

module.exports = IncomingDocumentDeleteModel;