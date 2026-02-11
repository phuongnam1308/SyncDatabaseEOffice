const BaseModel = require("./BaseModel");
const logger = require("../utils/logger");
const DataSanitizer = require("../utils/dataSanitizer");
const { v4: uuidv4 } = require("uuid");

class OutgoingDocument2Model extends BaseModel {
  constructor() {
    super();
    this.oldTable = "VanBanBanHanh";
    this.oldSchema = "dbo";
    this.newTable = "outgoing_documents2";
    this.newSchema = "dbo";
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
      logger.error("Lỗi lấy danh sách VanBanBanHanh từ DB cũ:", error);
      throw error;
    }
  }

  async getBatchFromOldDb({ offset, limit, lastSyncDate }) {
    const sql = `
    SELECT 
      ID, Title, BanLanhDao, ChenSo, TrangThai, IsLibrary,
      DoKhan, DoMat, DonVi, Files, ChucVu, DocNum,
      NguoiSoanThaoText, FolderLocation, HoSoXuLyLink,
      InfoVBDi, ItemVBPH, LoaiBanHanh, LoaiVanBan,
      NoiLuuTru, NoiNhan, NgayBanHanh, NgayHieuLuc,
      NgayHoanTat, NguoiKyVanBan, NguoiKyVanBanText,
      PhanCong, TraLoiVBDen, SoBan, SoTrang,
      SoVanBan, SoVanBanText, TrichYeu,
      BanLanhDaoTCT, YKien, YKienChiHuy,
      ModuleId, SiteName, ListName, ItemId,
      YearMonth, Modified, Created, ModifiedBy, CreatedBy,
      MigrateFlg, MigrateErrFlg, MigrateErrMess,
      LoaiMoc, KySoFiles, DGPId, Workflow,
      IsKyQuyChe, DocSignType, IsConverting, CodeItemId
    FROM ${this.oldSchema}.${this.oldTable}
    ${lastSyncDate ? "WHERE Modified > ?" : ""}
    ORDER BY Modified DESC, ID DESC
    OFFSET ? ROWS
    FETCH NEXT ? ROWS ONLY
  `;

    const params = [];
    if (lastSyncDate) params.push(lastSyncDate);
    params.push(offset, limit);

    return this.oldDb.query(sql, params);
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
      logger.error("Lỗi tìm outgoing document theo id_outgoing_bak:", error);
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
      const result = await this.newPool
        .request()
        .input("soVanBan", soVanBan)
        .query(query);
      return result.recordset.length > 0
        ? result.recordset[0].book_document_id
        : null;
    } catch (error) {
      logger.error("Lỗi tra cứu book_document_id theo SoVanBan:", error);
      return null;
    }
  }

  async insertToNewDb(data) {
    try {
      // Apply record mapping to transform field names and values
      const mappedData = await this._mapRecord(data);
      
      // Loại bỏ các cột identity (auto-increment) - SQL Server sẽ tự generate
      const identityColumns = ["id", "ID", "document_id", "DocumentId"];

      let fields = Object.keys(mappedData).filter(
        (f) => !identityColumns.includes(f),
      );
      const values = fields.map((_, i) => `@param${i}`).join(", ");
      const query = `
        INSERT INTO ${this.newSchema}.${this.newTable} 
        (${fields.join(", ")}) 
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
        TrangThai: 80,
      };

      fields.forEach((field, i) => {
        // CRITICAL: Use DataSanitizer to handle 'NULL' strings and type conversions
        let value = DataSanitizer.sanitizeValue(mappedData[field], field);

        // apply truncation for known columns (but only for strings, not after conversion to int/null)
        if (typeof value === "string" && truncateMap[field]) {
          const max = truncateMap[field];
          if (value.length > max) {
            value = value.substring(0, max);
          }
          value = value.trim();
        } else if (typeof value === "string" && value.length > 100) {
          // safety catch-all: truncate any unlisted string field > 100 chars
          value = value.substring(0, 100).trim();
        }

        const valueType = DataSanitizer.getTypeString(value);
        const len = typeof value === "string" ? value.length : null;
        const preview = DataSanitizer.formatPreview(value);

        logger.info(
          `[OutgoingDocumentModel.insertToNewDb] param${i} -> ${field} | type=${valueType} | len=${len} | preview=${preview}`,
        );

        request.input(`param${i}`, value);
      });

      await request.query(query);
      logger.info(
        `[OutgoingDocumentModel.insertToNewDb] Successfully inserted record with ${fields.length} fields`,
      );
      return true;
    } catch (error) {
      logger.error("Lỗi insert outgoing document:", error);
      throw error;
    }
  }

  async updateInNewDb(data) {
    try {
      // Apply record mapping to transform field names and values
      const mappedData = await this._mapRecord(data);
      
      // Giả sử data có id_outgoing_bak để identify record cần update
      const { id_outgoing_bak, ...updateFields } = mappedData;

      // Nếu không có id_outgoing_bak, trả về 0 để trigger INSERT trong sync logic
      if (!id_outgoing_bak) {
        return 0;
      }

      const fields = Object.keys(updateFields);
      const setClauses = fields
        .map((field, i) => `${field} = @param${i}`)
        .join(", ");

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
        const len = typeof value === "string" ? value.length : null;
        const preview = DataSanitizer.formatPreview(value);

        logger.info(
          `[OutgoingDocumentModel.updateInNewDb] param${i} -> ${field} | type=${valueType} | len=${len} | preview=${preview}`,
        );

        request.input(`param${i}`, value);
      });
      request.input("backupId", id_outgoing_bak);

      const result = await request.query(query);
      // Trả về số hàng được ảnh hưởng
      return result.rowsAffected[0] || 0;
    } catch (error) {
      logger.error("Lỗi update outgoing document:", error);
      throw error;
    }
  }

  async checkSyncAction(oldRecord) {
  // 1. Tìm record bên DB mới
  const existed = await this.findByBackupId(oldRecord.ID);

  // 2. Nếu chưa tồn tại → INSERT
  if (!existed) {
    return {
      action: 'insert',
      reason: 'NOT_EXIST_IN_NEW_DB'
    };
  }

  // 3. Có tồn tại → so sánh Modified
  const oldModified = oldRecord.Modified
    ? new Date(oldRecord.Modified)
    : null;

  const newModified = existed.Modified
    ? new Date(existed.Modified)
    : null;

  // Nếu DB mới chưa có Modified → UPDATE
  if (!newModified && oldModified) {
    return {
      action: 'update',
      reason: 'NEW_DB_HAS_NO_MODIFIED'
    };
  }

  // Nếu DB cũ update mới hơn → UPDATE
  if (
    oldModified &&
    newModified &&
    oldModified.getTime() > newModified.getTime()
  ) {
    return {
      action: 'update',
      reason: 'OLD_DB_NEWER_THAN_NEW_DB'
    };
  }

  // Ngược lại → SKIP
  return {
    action: 'skip',
    reason: 'NEW_DB_IS_NEWER_OR_EQUAL'
  };
  }

  async countNewDb() {
    return await this.count(this.newTable, this.newSchema, false);
  }

  _normalizeText(text) {
    if (!text || typeof text !== 'string') return '';

    const normalized = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .trim();
    const words = normalized.split(/\s+/);
    const processed = words.map(word => {
      if (!word) return '';
      const noVowel = word.replace(/[aeiouy]/g, '');
      if (noVowel.length < 2) {
        const firstChar = word[0];
        const firstVowel = word.match(/[aeiouy]/)?.[0] || '';
        return (firstChar + firstVowel).substring(0, 2);
      }
      return noVowel;
    });

    return processed.join('-');
  }

  async _getSourceId(code) {
    try {
      const query = `
        SELECT TOP 1 id
        FROM camunda.dbo.crm_sources
        WHERE code = @code
      `;
      const result = await this.queryNewDb(query, { code });
      return result.length > 0 ? result[0].id : null;
    } catch (error) {
      logger.error(`[OutgoingDocumentModel._getSourceId] Lỗi lấy source_id cho code ${code}:`, error);
      return null;
    }
  }

  // Helper: Kiểm tra và insert source data nếu chưa tồn tại
  async _checkOrInsertSourceData(sourceId, value, title) {
    try {
      if (!sourceId || !value) return null;

      // Check xem đã tồn tại chưa
      const checkQuery = `
        SELECT TOP 1 id, value
        FROM camunda.dbo.crm_source_data
        WHERE source_id = @sourceId AND value = @value
      `;
      const existing = await this.queryNewDb(checkQuery, { sourceId, value });
      
      if (existing.length > 0) {
        logger.info(`[OutgoingDocumentModel._checkOrInsertSourceData] Value "${value}" đã tồn tại cho source_id ${sourceId}`);
        return existing[0].value;
      }

      // Insert mới
      const id = uuidv4();
      const insertQuery = `
        INSERT INTO camunda.dbo.crm_source_data (id, source_id, title, value, createdAt, updatedAt)
        VALUES (@id, @sourceId, @title, @value, GETDATE(), GETDATE())
      `;
      
      const insertParams = {
        id,
        sourceId,
        title: title || value,
        value
      };

      await this.queryNewDb(insertQuery, insertParams);
      logger.info(`[OutgoingDocumentModel._checkOrInsertSourceData] Inserted new source_data: value="${value}" for source_id=${sourceId}`);
      return value;
    } catch (error) {
      logger.error(`[OutgoingDocumentModel._checkOrInsertSourceData] Lỗi check/insert source_data:`, error);
      return null;
    }
  }

  // Xử lý LoaiBanHanh (S19 - Document Type)
  async _processDocumentType(value) {
    try {
      if (typeof value !== 'string' || value.trim() === '') {
        return null;
      }

      // Trích xuất phần sau dấu #
      const hashIndex = value.indexOf('#');
      let extracted = '';
      if (hashIndex !== -1 && hashIndex < value.length - 1) {
        extracted = value.substring(hashIndex + 1);
      } else {
        extracted = value;
      }

      extracted = extracted.trim().replace(/\s+/g, '');
      
      if (!extracted) return null;

      // Lấy source_id cho S19 (Document Type)
      const sourceId = await this._getSourceId('S19');
      if (!sourceId) {
        logger.warn('[OutgoingDocumentModel._processDocumentType] Không tìm thấy source_id cho code S19');
        return extracted;
      }

      // Check/insert vào crm_source_data
      const result = await this._checkOrInsertSourceData(sourceId, extracted, extracted);
      return result;
    } catch (error) {
      logger.error('[OutgoingDocumentModel._processDocumentType] Lỗi xử lý document type:', error);
      return null;
    }
  }

  // Xử lý DoKhan (S20 - Urgency Level)
  async _processUrgencyLevel(value) {
    try {
      if (typeof value !== 'string' || value.trim() === '') {
        return null;
      }

      let normalized = this._normalizeText(value);
      
      if (!normalized) return null;

      // Lấy source_id cho S20 (Urgency Level)
      const sourceId = await this._getSourceId('S20');
      if (!sourceId) {
        logger.warn('[OutgoingDocumentModel._processUrgencyLevel] Không tìm thấy source_id cho code S20');
        return normalized;
      }

      // Chỉnh title: giữ nguyên giá trị gốc với chuẩn hóa không dấu
      const title = value.trim();
      
      // Check/insert vào crm_source_data
      const result = await this._checkOrInsertSourceData(sourceId, normalized, title);
      return result;
    } catch (error) {
      logger.error('[OutgoingDocumentModel._processUrgencyLevel] Lỗi xử lý urgency level:', error);
      return null;
    }
  }

  // Xử lý DoMat (S21 - Private Level)
  async _processPrivateLevel(value) {
    try {
      if (typeof value !== 'string' || value.trim() === '') {
        return null;
      }

      let normalized = this._normalizeText(value);
      
      if (!normalized) return null;

      // Lấy source_id cho S21 (Private Level)
      const sourceId = await this._getSourceId('S21');
      if (!sourceId) {
        logger.warn('[OutgoingDocumentModel._processPrivateLevel] Không tìm thấy source_id cho code S21');
        return normalized;
      }

      // Chỉnh title: giữ nguyên giá trị gốc với chuẩn hóa không dấu
      const title = value.trim();
      
      // Check/insert vào crm_source_data
      const result = await this._checkOrInsertSourceData(sourceId, normalized, title);
      return result;
    } catch (error) {
      logger.error('[OutgoingDocumentModel._processPrivateLevel] Lỗi xử lý private level:', error);
      return null;
    }
  }

  async _mapRecord(record) {
    const mapped = {};

    for (const [key, value] of Object.entries(record)) {
      if (key === 'LoaiBanHanh') {
        // Xử lý LoaiBanHanh với check vào crm_sources/crm_source_data (S19)
        const documentType = await this._processDocumentType(value);
        mapped['document_type'] = documentType;
      }
      else if (key === 'DoKhan') {
        // Xử lý DoKhan với check vào crm_sources/crm_source_data (S20)
        const urgencyLevel = await this._processUrgencyLevel(value);
        mapped['urgency_level'] = urgencyLevel;
      }
      else if (key === 'DoMat') {
        // Xử lý DoMat với check vào crm_sources/crm_source_data (S21)
        const privateLevel = await this._processPrivateLevel(value);
        mapped['private_level'] = privateLevel;
      }
      else if (key === 'DonVi') {
        if (Array.isArray(value) && value.length > 0) {
          mapped['sender_unit'] = value[0];
        } else if (typeof value === 'string') {
          mapped['sender_unit'] = value;
        } else {
          mapped['sender_unit'] = value;
        }
      }
      else if (key === 'Workflow' && value && !mapped['bpmn_version']) {
        mapped['bpmn_version'] = 'VAN_BAN_DI';
      }
      else {
        mapped[key] = value;
      }
    }
    return mapped;
  }


}

module.exports = OutgoingDocument2Model;
