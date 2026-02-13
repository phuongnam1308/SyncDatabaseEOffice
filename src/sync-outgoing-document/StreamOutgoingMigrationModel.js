const BaseModel = require("../../models/BaseModel");
const logger = require("../../utils/logger");
const sql = require('mssql');
const { v4: uuidv4 } = require("uuid");
const bcrypt = require('bcrypt');

const DEFAULT_PASSWORD = process.env.MIGRATION_DEFAULT_PASSWORD || '12345678';
const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10);

/**
 * StreamOutgoingMigrationModel
 *
 * Model xử lý migration văn bản đi theo batch
 * - Lấy data từ DB cũ
 * - Map và clean data (tích hợp tất cả logic từ các service cũ)
 * - Insert trực tiếp vào DB mới với transaction
 *
 * Không sử dụng bảng trung gian (outgoing_documents2)
 */
class StreamOutgoingMigrationModel extends BaseModel {
  constructor() {
    super();
    this.oldDbSchema = "dbo";
    this.oldDbTable = "VanBanBanHanh";
    this.newDbSchema = "dbo";
    this.newDbTable = "outgoing_documents_sync";
  }

  /**
   * Lấy trạng thái migration
   * @returns {Promise<Object>}
   */
  async getStatus() {
    try {
      // Đếm tổng số trong DB cũ
      const countOldQuery = `
        SELECT COUNT(*) AS total
        FROM ${this.oldDbSchema}.${this.oldDbTable}
      `;
      const oldResult = await this.queryOldDb(countOldQuery);
      const totalInOldDb = oldResult[0]?.total || 0;

      // Đếm tổng số đã migrate trong DB mới
      const countNewQuery = `
        SELECT COUNT(*) AS total
        FROM camunda.${this.newDbSchema}.${this.newDbTable}
        WHERE table_backup = 'stream_migration'
      `;
      const newResult = await this.queryNewDbTx(countNewQuery);
      const totalInNewDb = newResult[0]?.total || 0;

      // Lấy ID cuối cùng đã migrate
      const lastIdQuery = `
        SELECT TOP 1 id_outgoing_bak
        FROM camunda.${this.newDbSchema}.${this.newDbTable}
        WHERE table_backup = 'stream_migration'
        ORDER BY createdAt DESC
      `;
      const lastIdResult = await this.queryNewDbTx(lastIdQuery);
      const lastMigratedId = lastIdResult[0]?.id_outgoing_bak || null;

      return {
        totalInOldDb,
        totalInNewDb,
        remaining: totalInOldDb - totalInNewDb,
        lastMigratedId,
      };
    } catch (error) {
      logger.error("[StreamOutgoingMigrationModel.getStatus] Error:", error);
      throw error;
    }
  }

  /**
   * Lấy batch từ DB cũ
   *
   * @param {Object} options
   * @param {number} options.batch - Số lượng bản ghi
   * @param {string|null} options.lastId - ID cuối cùng đã xử lý
   * @returns {Promise<Array>} Danh sách records
   */
  async fetchBatchFromOldDb({ batch, lastId = null }) {
    try {
      let query = `
        SELECT TOP (@batch)
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
            LoaiMoc, KySoFiles, DGPId, Workflow,
            IsKyQuyChe, DocSignType, IsConverting,
            TrangThai
        FROM ${this.oldDbSchema}.${this.oldDbTable}
        WHERE 1=1
      `;

      const params = { batch };

      // Quan trọng: check null chứ không check truthy
      if (lastId !== null && lastId !== undefined) {
        query += ` AND CAST(ID AS BIGINT) > @lastId`;
        params.lastId = lastId;
      }

      query += ` ORDER BY CAST(ID AS BIGINT) ASC`;

      const records = await this.queryOldDb(query, params);

      logger.debug(
        `[fetchBatchFromOldDb] lastId=${lastId} → fetched ${records.length}`,
      );

      return records;
    } catch (error) {
      logger.error("[fetchBatchFromOldDb] Error:", error);
      throw error;
    }
  }

  /**
   * Map và clean batch data
   * Tích hợp tất cả logic từ:
   * - OutgoingDocumentMappingService
   * - OutgoingTextNormalizeSyncService
   * - FormatOutgoing2Service
   * - DrafterMigrationService
   * - MappingBookDocOutgoingService
   * - OutgoingSenderUnitSyncService
   * - OutgoingBpmnVersionSyncService
   *
   * @param {Array} records - Danh sách records từ DB cũ
   * @returns {Promise<Array>} Danh sách records đã được map
   */
  async mapAndCleanBatch(records) {
    try {
      const mappedRecords = [];

      for (const record of records) {
        try {
          // Map từng record
          const mapped = await this._mapSingleRecord(record);
          mappedRecords.push(mapped);
        } catch (error) {
          logger.warn(
            `[mapAndCleanBatch] Skip record ID=${record.ID}:`,
            error.message,
          );
          // Skip record lỗi, không throw để tiếp tục
        }
      }

      logger.debug(
        `[mapAndCleanBatch] Mapped ${mappedRecords.length}/${records.length} records`,
      );

      return mappedRecords;
    } catch (error) {
      logger.error(
        "[StreamOutgoingMigrationModel.mapAndCleanBatch] Error:",
        error,
      );
      throw error;
    }
  }

  /**
   * Map một record đơn
   * @param {Object} oldRecord - Record từ DB cũ
   * @returns {Promise<Object>} Record đã map
   * @private
   */
  async _mapSingleRecord(oldRecord) {
    try {
      if (!oldRecord?.ID) {
        throw new Error("Old record ID is required");
      }

      const now = new Date();

      /* ===== PRE-CALC ===== */

      const promulgationDate = this._parseDate(oldRecord.NgayBanHanh);
      const effectiveDate = this._parseDate(oldRecord.NgayHieuLuc);

      const documentType = await this._processDocumentType(
        oldRecord.LoaiVanBan || oldRecord.LoaiBanHanh,
      );

      const urgencyLevel = await this._processUrgencyLevel(oldRecord.DoKhan);
      const privateLevel = await this._processPrivateLevel(oldRecord.DoMat);

      const senderUnit = await this._mapSenderUnitId(oldRecord.DonVi);
      const drafter = await this._mapUserName(oldRecord.CreatedBy || oldRecord.NguoiSoanThaoText);
      const reportSigner = await this._mapUserName(oldRecord.NguoiKyVanBanText);

      const year = promulgationDate
        ? new Date(promulgationDate).getFullYear()
        : null;

      const bookDocumentId = await this._mapBookDocument(
        oldRecord.SoVanBan || oldRecord.SoVanBanText,
        {
          drafter,
          senderUnit,
          privateLevel,
          year,
        },
      );

      /* ===== BUILD OBJECT ===== */

      const mapped = {
        document_id: `${Date.now()}${Math.floor(Math.random() * 10000)}`,
        id_outgoing_bak: String(oldRecord.ID),

        code: this._cleanText(oldRecord.SoKyHieu || oldRecord.SoVanBanText),
        abstract_note: this._cleanText(oldRecord.TrichYeu),

        promulgation_date: promulgationDate,
        effective_date: effectiveDate,

        status_code: this._mapStatus(oldRecord.TrangThai),

        document_type: documentType,
        urgency_level: urgencyLevel,
        private_level: privateLevel,

        sender_unit: senderUnit,
        drafter,
        report_signer: reportSigner,

        release_no: this._cleanText(oldRecord.Title),
        release_date: promulgationDate || null,

        bpmn_version: oldRecord.Workflow ? "VAN_BAN_DI" : null,
        type_of_process: oldRecord.Workflow
          ? this._cleanText(oldRecord.Workflow)
          : null,

        book_document_id: bookDocumentId,

        status: "1",
        replaced: 0,
        tb_bak: 0,

        table_backup: "stream_migration",

        created_at: now,
        updated_at: now,
      };

      return mapped;
    } catch (error) {
      logger.error(
        `[_mapSingleRecord] Error ID=${oldRecord?.ID}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Insert batch vào DB mới với transaction
   *
   * @param {Array} records - Danh sách records đã map
   * @returns {Promise<Object>} Kết quả {inserted, updated}
   */
  async insertBatchToNewDb(records) {
    if (!records || records.length === 0) {
      return { inserted: 0, updated: 0 };
    }

    let transaction = null;
    let inserted = 0;
    let updated = 0;

    try {
      // Bắt đầu transaction
      transaction = await this.beginTransaction();

      for (const record of records) {
        try {
          // Kiểm tra xem record đã tồn tại chưa (dựa vào id_outgoing_bak)
          const existingQuery = `
            SELECT id FROM camunda.${this.newDbSchema}.${this.newDbTable}
            WHERE id_outgoing_bak = @oldId AND table_backup = 'stream_migration'
          `;
          const existing = await this.queryNewDbTx(
            existingQuery,
            {
              oldId: record.id_outgoing_bak,
            },
            transaction,
          );

          if (existing && existing.length > 0) {
            // UPDATE
            await this._updateRecord(record, transaction);
            updated++;
          } else {
            // INSERT
            await this._insertRecord(record, transaction);
            inserted++;
          }
        } catch (recordError) {
          logger.warn(
            `[insertBatchToNewDb] Skip record id_outgoing_bak=${record.id_outgoing_bak}:`,
            recordError.message,
          );
          // Skip record lỗi nhưng vẫn tiếp tục với transaction
        }
      }

      // Commit transaction
      await this.commitTransaction(transaction);

      logger.debug(
        `[insertBatchToNewDb] Inserted: ${inserted}, Updated: ${updated}`,
      );

      return { inserted, updated };
    } catch (error) {
      // Rollback nếu có lỗi
      if (transaction) {
        await this.rollbackTransaction(transaction);
        logger.error("[insertBatchToNewDb] Transaction rolled back");
      }

      logger.error(
        "[StreamOutgoingMigrationModel.insertBatchToNewDb] Error:",
        error,
      );
      throw error;
    }
  }

  /**
   * Insert một record vào DB mới
   * @param {Object} record - Record đã map
   * @param {Object} transaction - Transaction object
   * @private
   */
  async _insertRecord(record, transaction) {
    if (!record?.document_id || record.document_id.trim() === "") {
      throw new Error("document_id is required");
    }
    console.log(`Inserting record id_outgoing_bak=${record.id_outgoing_bak}...`);

    const now = new Date();

    const query = `
      INSERT INTO ${this.newDbSchema}.${this.newDbTable} (
        document_id,
        status_code,
        sender_unit,
        abstract_note,
        drafter,
        document_type,
        urgency_level,
        private_level,
        report_signer,
        report_document_symbol,
        deadline_reply,
        book_document_id,
        status,
        release_no,
        release_date,
        text_symbols,
        type_doc,
        bpmn_version,
        type_of_process,
        id_outgoing_bak,
        created_at,
        updated_at,
        replaced,
        table_backup,
        tb_bak
      )
      VALUES (
        @documentId,
        @statusCode,
        @senderUnit,
        @abstractNote,
        @drafter,
        @documentType,
        @urgencyLevel,
        @privateLevel,
        @reportSigner,
        @reportDocumentSymbol,
        @deadlineReply,
        @bookDocumentId,
        @status,
        @releaseNo,
        @releaseDate,
        @textSymbols,
        @typeDoc,
        @bpmnVersion,
        @typeOfProcess,
        @idOutgoingBak,
        @createdAt,
        @updatedAt,
        @replaced,
        @tableBackup,
        @tbBak
      )
    `;

    const params = {
      documentId: record.document_id,
      statusCode: record.status_code ?? "1",
      senderUnit: record.sender_unit ?? null,
      drafter: record.drafter ?? null,
      documentType: record.document_type ?? null,
      urgencyLevel: record.urgency_level ?? null,
      privateLevel: record.private_level ?? null,
      reportSigner: record.report_signer ?? null,
      reportDocumentSymbol: record.report_document_symbol ?? null,
      deadlineReply: record.deadline_reply ?? null,
      bookDocumentId: record.book_document_id ?? null,
      status: record.status ?? 1,
      releaseNo: record.release_no ?? null,
      releaseDate: record.release_date ?? null,
      textSymbols: record.text_symbols ?? null,
      typeDoc: record.type_doc ?? 1,
      bpmnVersion: record.bpmn_version ?? null,
      typeOfProcess: record.type_of_process ?? null,
      idOutgoingBak: record.id_outgoing_bak ?? null,
      createdAt: record.created_at ?? now,
      abstractNote: record.abstract_note ?? null,
      updatedAt: now,
      replaced: record.replaced ?? 0,
      tableBackup: record.table_backup ?? "stream_migration",
      tbBak: record.tb_bak ?? 0,
    };

    await this.queryNewDbTx(query, params, transaction);
  }

  /**
   * Update một record trong DB mới
   * @param {Object} record - Record đã map
   * @param {Object} transaction - Transaction object
   * @private
   */
  async _updateRecord(record, transaction) {
    if (!record?.id_outgoing_bak) {
      throw new Error("document_id is required for update");
    }
    console.log(`Updating record id_outgoing_bak=${record.id_outgoing_bak}...`);

    const query = `
      UPDATE ${this.newDbSchema}.${this.newDbTable}
      SET
        status_code = @statusCode,
        sender_unit = @senderUnit,
        drafter = @drafter,
        document_type = @documentType,
        urgency_level = @urgencyLevel,
        private_level = @privateLevel,
        report_signer = @reportSigner,
        report_document_symbol = @reportDocumentSymbol,
        deadline_reply = @deadlineReply,
        book_document_id = @bookDocumentId,
        status = @status,
        release_no = @releaseNo,
        release_date = @releaseDate,
        text_symbols = @textSymbols,
        type_doc = @typeDoc,
        bpmn_version = @bpmnVersion,
        type_of_process = @typeOfProcess,
        replaced = @replaced,
        abstract_note = @abstractNote,
        updated_at = GETDATE()
      WHERE id_outgoing_bak  = @idOutgoingBak
        AND table_backup = 'stream_migration'
    `;

    const params = {
      statusCode: record.status_code ?? "1",
      senderUnit: record.sender_unit ?? null,
      drafter: record.drafter ?? null,
      documentType: record.document_type ?? null,
      urgencyLevel: record.urgency_level ?? null,
      privateLevel: record.private_level ?? null,
      reportSigner: record.report_signer ?? null,
      reportDocumentSymbol: record.report_document_symbol ?? null,
      deadlineReply: record.deadline_reply ?? null,
      bookDocumentId: record.book_document_id ?? null,
      status: record.status ?? 1,
      releaseNo: record.release_no ?? null,
      releaseDate: record.release_date ?? null,
      textSymbols: record.text_symbols ?? null,
      typeDoc: record.type_doc ?? 1,
      bpmnVersion: record.bpmn_version ?? null,
      typeOfProcess: record.type_of_process ?? null,
      idOutgoingBak: record.id_outgoing_bak ?? null,
      abstractNote: record.abstract_note ?? null,
      replaced: record.replaced ?? 0,
    };

    await this.queryNewDbTx(query, params, transaction);
  }

  /**
   * Rollback migration
   * @param {Object} options - Tùy chọn rollback
   * @returns {Promise<Object>}
   */
  async rollback(options = {}) {
    try {
      const query = `
        DELETE FROM camunda.${this.newDbSchema}.${this.newDbTable}
        WHERE table_backup = 'stream_migration'
      `;

      const result = await this.queryNewDbTx(query);
      const deleted = result.rowsAffected || 0;

      logger.info(
        `[StreamOutgoingMigrationModel.rollback] Deleted ${deleted} records`,
      );

      return { deleted };
    } catch (error) {
      logger.error("[StreamOutgoingMigrationModel.rollback] Error:", error);
      throw error;
    }
  }

  // ========================================================================
  // HELPER METHODS - Tích hợp logic từ các service cũ
  // ========================================================================

  /**
   * Clean text (remove extra spaces, trim)
   * @param {string} text
   * @returns {string}
   * @private
   */
  _cleanText(text) {
    if (!text || typeof text !== "string") return "";
    return text.trim().replace(/\s+/g, " ");
  }

  /**
   * Parse date
   * @param {string|Date} date
   * @returns {Date|null}
   * @private
   */
  _parseDate(date) {
    if (!date) return null;
    try {
      const parsed = new Date(date);
      return isNaN(parsed.getTime()) ? null : parsed;
    } catch {
      return null;
    }
  }

  /**
   * Map status
   * @param {string} status
   * @returns {string}
   * @private
   */
  _mapStatus(status) {
    try {
      if (!status) return 10;
      if (Array.isArray(status)) {
        if (!status.length) return 10;
        status = status[0];
      }
      if (typeof status !== "string") {
        status = String(status);
      }
      const normalized = status.trim().toLowerCase();
      if (!normalized) return 10;
      if (normalized === "phát hành" || normalized === "đã phát hành") {
        return 7;
      }
      if (normalized === "chờ phát hành") {
        return 6;
      }
      return 10;
    } catch (err) {
      logger.warn("[mapStatus] invalid status:", status);
      return 10;
    }
  }

  /**
   * Normalize text (loại bỏ dấu, chuyển về dạng chuẩn)
   * Logic từ OutgoingTextNormalizeSyncService và OutgoingDocumentMappingService
   *
   * @param {string} text
   * @returns {string}
   * @private
   */
  _normalizeText(text) {
    if (!text || typeof text !== "string") return "";

    const normalized = text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .trim();

    const words = normalized.split(/\s+/);
    const processed = words.map((word) => {
      if (!word) return "";
      const noVowel = word.replace(/[aeiouy]/g, "");
      if (noVowel.length < 2) {
        const firstChar = word[0];
        const firstVowel = word.match(/[aeiouy]/)?.[0] || "";
        return (firstChar + firstVowel).substring(0, 2);
      }
      return noVowel;
    });

    return processed.join("-");
  }

  /**
   * Xử lý Document Type (S19)
   * Logic từ OutgoingDocumentMappingService._processDocumentType
   *
   * @param {string} value
   * @returns {Promise<string|null>}
   * @private
   */
  _removeVietnameseTones(str) {
    if (!str) return str;
    return str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D");
  }
  async _processDocumentType(value) {
    try {
      if (typeof value !== "string") return null;

      let raw = value.trim();
      if (!raw || raw.toUpperCase() === "NULL") {
        return null;
      }

      // Lấy phần sau dấu #
      const hashIndex = raw.indexOf("#");
      if (hashIndex !== -1 && hashIndex < raw.length - 1) {
        raw = raw.substring(hashIndex + 1);
      }

      raw = raw.trim();
      if (!raw) return null;

      const title = raw;

      const normalizedValue = this._removeVietnameseTones(raw).replace(
        /\s+/g,
        "",
      );

      if (!normalizedValue) return null;

      const sourceId = await this._getSourceId("S19");
      if (!sourceId) {
        logger.warn("[_processDocumentType] source_id S19 not found");
        return normalizedValue;
      }

      const result = await this._checkOrInsertSourceData(
        sourceId,
        normalizedValue,
        title,
      );

      return result;
    } catch (error) {
      logger.error("[_processDocumentType] Error:", error);
      return null;
    }
  }

  /**
   * Xử lý Urgency Level (S20) với normalize
   * Logic từ OutgoingDocumentMappingService._processUrgencyLevel
   *
   * @param {string} value
   * @returns {Promise<string|null>}
   * @private
   */
  async _processUrgencyLevel(value) {
    try {
      if (typeof value !== "string" || value.trim() === "") {
        return null;
      }

      const normalized = this._normalizeText(value);

      if (!normalized) return null;

      // Lấy source_id cho S20
      const sourceId = await this._getSourceId("S20");
      if (!sourceId) {
        logger.warn("[_processUrgencyLevel] Không tìm thấy source_id cho S20");
        return normalized;
      }

      const title = value.trim();

      // Check/insert vào crm_source_data
      const result = await this._checkOrInsertSourceData(
        sourceId,
        normalized,
        title,
      );
      return result;
    } catch (error) {
      logger.error("[_processUrgencyLevel] Error:", error);
      return null;
    }
  }

  /**
   * Xử lý Private Level (S21) với normalize
   * Logic từ OutgoingDocumentMappingService._processPrivateLevel
   *
   * @param {string} value
   * @returns {Promise<string|null>}
   * @private
   */
  async _processPrivateLevel(value) {
    try {
      if (typeof value !== "string" || value.trim() === "") {
        return null;
      }

      const normalized = this._normalizeText(value);

      if (!normalized) return null;

      // Lấy source_id cho S21
      const sourceId = await this._getSourceId("S21");
      if (!sourceId) {
        logger.warn("[_processPrivateLevel] Không tìm thấy source_id cho S21");
        return normalized;
      }

      const title = value.trim();

      // Check/insert vào crm_source_data
      const result = await this._checkOrInsertSourceData(
        sourceId,
        normalized,
        title,
      );
      return result;
    } catch (error) {
      logger.error("[_processPrivateLevel] Error:", error);
      return null;
    }
  }

  /**
   * Xử lý Sender Unit
   * Logic từ OutgoingDocumentMappingService
   *
   * @param {string|Array} value
   * @returns {string|null}
   * @private
   */

  _processSenderUnit(value, maxLength = 255) {
    try {
      if (!value) return null;
      let raw = null;
      // Nếu array → chỉ lấy phần tử đầu tiên
      if (Array.isArray(value)) {
        if (!value.length) return null;
        raw = value[0];
      } else {
        raw = value;
      }
      if (!raw) return null;
      // Nếu là object dạng lookup
      if (typeof raw === "object") {
        raw = raw.title || raw.name || raw.value || null;
      }
      if (!raw) return null;
      if (typeof raw !== "string") {
        raw = String(raw);
      }
      const trimmed = raw.trim();
      if (!trimmed) return null;
      let result = trimmed;
      // SharePoint multi format: id;#name;#id;#name
      if (trimmed.includes(";#")) {
        const parts = trimmed.split(";#");
        if (parts.length >= 2 && parts[1]) {
          result = parts[1].trim();
        } else {
          return null;
        }
      }
      if (!result) return null; // Giới hạn độ dài theo DB
      if (result.length > maxLength) {
        result = result.substring(0, maxLength);
      }
      return result;
    } catch (err) {
      logger.warn("[processSenderUnit] invalid value:", value);
      return null;
    }
  }

  async _mapSenderUnitId(value, transaction = null) {
    try {
      const normalizedName = await this._processSenderUnit(value);
      if (!normalizedName) return null;

      const selectQuery = `
        SELECT TOP 1 id
        FROM camunda.dbo.organization_units
        WHERE LTRIM(RTRIM(name)) = @name
          AND status = 1
      `;

      let result = await this.queryNewDbTx(
        selectQuery,
        { name: normalizedName },
        transaction,
      );

      if (result?.length) {
        return result[0].id;
      }

      const id = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
      const code = normalizedName;

      const insertQuery = `
        INSERT INTO camunda.dbo.organization_units (
          id,
          name,
          code,
          status,
          created_at,
          updated_at,
          table_backups
        )
        VALUES (
          @id,
          @name,
          @code,
          1,
          GETDATE(),
          GETDATE(),
          'stream_migration'
        )
      `;

      try {
        await this.queryNewDbTx(
          insertQuery,
          {
            id,
            name: normalizedName,
            code,
          },
          transaction,
        );

        logger.warn(
          `[_mapSenderUnitId] Created new organization: ${normalizedName}`,
        );

        return id;
      } catch (insertError) {
        // race condition → thằng khác vừa insert
        logger.warn(
          `[_mapSenderUnitId] Insert fail, retry select: ${insertError.message}`,
        );

        const retry = await this.queryNewDbTx(
          selectQuery,
          { name: normalizedName },
          transaction,
        );

        return retry?.length ? retry[0].id : null;
      }
    } catch (error) {
      logger.error(
        `[_mapSenderUnitId] Error value="${value}": ${error.message}`,
      );
      return null;
    }
  }

  /**
   * Map Drafter
   * Logic từ DrafterMigrationService
   *
   * @param {string} Name
   * @returns {Promise<string|null>}
   * @private
   */
  async _mapUserName(Name, transaction = null) {
    try {
      const displayName = this._extractDisplayName(Name);
      if (!displayName) return null;

      const usernameBase = this._buildUsernameFromName(displayName);
      if (!usernameBase) return null;

      const selectQuery = `
        SELECT TOP 1 id
        FROM camunda.dbo.users
        WHERE name = @name OR id = @name
      `;

      const existing = await this.queryNewDbTx(
        selectQuery,
        { name: displayName },
        transaction,
      );

      if (existing?.length) {
        return existing[0].id;
      }

      const id = uuidv4();
      const username = `${usernameBase}${Math.floor(
        1000 + Math.random() * 9000,
      )}`;

      const password = await this._hashDefaultPassword();

      const insertQuery = `
        INSERT INTO camunda.dbo.users (
          id,
          name,
          username,
          password,
          status,
          table_backups,
          created_at,
          updated_at
        )
        VALUES (
          @id,
          @name,
          @username,
          @password,
          1,
          'stream_migration',
          GETDATE(),
          GETDATE()
        )
      `;

      try {
        await this.queryNewDbTx(
          insertQuery,
          {
            id,
            name: displayName,
            username,
            password,
          },
          transaction,
        );

        logger.warn(
          `[_mapUserName] Created new user: ${displayName} (${username})`,
        );

        return id;
      } catch (err) {
        // race → select lại
        const retry = await this.queryNewDbTx(
          selectQuery,
          { name: displayName },
          transaction,
        );

        return retry?.length ? retry[0].id : null;
      }
    } catch (error) {
      logger.warn("[_mapUserName] Error:", error);
      return null;
    }
  }

  _extractDisplayName(value) {
    try {
      if (!value) return null;

      let raw = value;

      if (Array.isArray(raw)) {
        if (!raw.length) return null;
        raw = raw[0];
      }

      if (typeof raw === "object") {
        raw = raw.title || raw.name || raw.value || null;
      }

      if (!raw) return null;

      if (typeof raw !== "string") {
        raw = String(raw);
      }

      raw = raw.trim();
      if (!raw) return null;

      // format: id;#name
      if (raw.includes(";#")) {
        const parts = raw.split(";#");
        if (parts.length >= 2) {
          raw = parts[1].trim();
        }
      }

      return raw || null;
    } catch {
      return null;
    }
  }

  _buildUsernameFromName(name) {
    const base = this._removeVietnameseTones(name)
      .toLowerCase()
      .replace(/\s+/g, "");

    if (!base) return null;

    return base;
  }

  async _hashDefaultPassword() {
    try {
      if (!DEFAULT_PASSWORD) {
        throw new Error('DEFAULT_PASSWORD is empty');
      }

      if (isNaN(SALT_ROUNDS) || SALT_ROUNDS < 8 || SALT_ROUNDS > 15) {
        throw new Error('Invalid BCRYPT_SALT_ROUNDS');
      }

      const salt = await bcrypt.genSalt(SALT_ROUNDS);
      const hash = await bcrypt.hash(DEFAULT_PASSWORD, salt);

      return hash;
    } catch (error) {
      logger.error('[hashDefaultPassword] Failed:', error.message);
      throw error; // không nuốt lỗi để tránh tạo user password null
    }
  }

  /**
   * Map Book Document
   * Logic từ MappingBookDocOutgoingService
   *
   * @param {string} bookName
   * @returns {Promise<string|null>}
   * @private
   */
  async _mapBookDocument(
    bookName,
    {
      drafter = null,
      senderUnit = null,
      privateLevel = null,
      year = new Date().getFullYear(),
    } = {},
  ) {
    try {
      if (!bookName || typeof bookName !== "string") {
        return null;
      }

      let normalized = bookName.trim();
      if (!normalized || normalized.toUpperCase() === "NULL") {
        return null;
      }

      // Nếu có dấu # thì lấy phần sau
      const hashIndex = normalized.indexOf("#");
      if (hashIndex !== -1) {
        normalized = normalized.substring(hashIndex + 1).trim();
      }

      if (!normalized) return null;

      // Giới hạn theo schema
      if (normalized.length > 255) {
        normalized = normalized.substring(0, 255);
      }

      // 1️⃣ TÌM TRƯỚC
      const selectQuery = `
        SELECT TOP 1 book_document_id AS id
        FROM camunda.dbo.book_documents
        WHERE LTRIM(RTRIM(name)) = @name
      `;

      let result = await this.queryNewDbTx(selectQuery, { name: normalized });

      if (result?.length > 0) {
        return result[0].id;
      }

      // 2️⃣ KHÔNG CÓ → INSERT
      const insertQuery = `
        INSERT INTO camunda.dbo.book_documents (
          name,
          [year],
          status,
          type_document,
          sender_unit,
          private_level,
          count,
          created_at,
          updated_at,
          created_by
        )
        OUTPUT INSERTED.book_document_id
        VALUES (
          @name,
          @year,
          1,
          N'OutGoingDocument',
          @sender_unit,
          @private_level,
          1,
          GETDATE(),
          GETDATE(),
          @created_by
        )
      `;

      try {
        const insertResult = await this.queryNewDbTx(insertQuery, {
          name: normalized,
          year,
          sender_unit: senderUnit,
          private_level: privateLevel,
          created_by: drafter,
        });

        return insertResult?.length > 0
          ? insertResult[0].book_document_id
          : null;
      } catch (insertError) {
        // ⚠ Nếu race condition (record vừa được insert bởi process khác)
        logger.warn(
          `[_mapBookDocument] Insert failed, retry select: ${insertError.message}`,
        );

        const retry = await this.queryNewDbTx(selectQuery, { name: normalized });
        return retry?.length > 0 ? retry[0].id : null;
      }
    } catch (error) {
      logger.warn(
        `[_mapBookDocument] Error bookName="${bookName}": ${error.message}`,
      );
      return null;
    }
  }

  /**
   * Lấy source_id theo code
   * Logic từ OutgoingDocumentMappingService._getSourceId
   *
   * @param {string} code
   * @returns {Promise<string|null>}
   * @private
   */
  async _getSourceId(code) {
    try {
      const query = `
        SELECT TOP 1 id
        FROM camunda.dbo.crm_sources
        WHERE code = @code
      `;
      const result = await this.queryNewDbTx(query, { code });
      return result.length > 0 ? result[0].id : null;
    } catch (error) {
      logger.error(`[_getSourceId] Error for code ${code}:`, error);
      return null;
    }
  }

  /**
   * Kiểm tra và insert source data nếu chưa tồn tại
   * Logic từ OutgoingDocumentMappingService._checkOrInsertSourceData
   *
   * @param {string} sourceId
   * @param {string} value
   * @param {string} title
   * @returns {Promise<string|null>}
   * @private
   */
  async _checkOrInsertSourceData(sourceId, value, title) {
    try {
      if (!sourceId || !value) return null;

      // Check xem đã tồn tại chưa
      const checkQuery = `
        SELECT TOP 1 id, value
        FROM camunda.dbo.crm_source_data
        WHERE source_id = @sourceId AND value = @value
      `;
      const existing = await this.queryNewDbTx(checkQuery, { sourceId, value });

      if (existing.length > 0) {
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
        value,
      };

      await this.queryNewDbTx(insertQuery, insertParams);
      logger.debug(
        `[_checkOrInsertSourceData] Inserted new source_data: value="${value}"`,
      );

      return value;
    } catch (error) {
      logger.error("[_checkOrInsertSourceData] Error:", error);
      return null;
    }
  }

  // ========================================================================
  // TRANSACTION METHODS
  // ========================================================================

  /**
   * Bắt đầu transaction
   * @returns {Promise<Object>} Transaction object
   */
  async beginTransaction() {
    try {
      const transaction = new sql.Transaction(this.newPool);
      await transaction.begin();
      logger.debug("[beginTransaction] Started");
      return transaction;
    } catch (error) {
      logger.error("[beginTransaction] Error:", error);
      throw error;
    }
  }

  async commitTransaction(transaction) {
    try {
      if (!transaction) return;
      await transaction.commit();
      logger.debug("[commitTransaction] Committed");
    } catch (error) {
      logger.error("[commitTransaction] Error:", error);
      throw error;
    }
  }

  async rollbackTransaction(transaction) {
    try {
      if (!transaction) return;
      await transaction.rollback();
      logger.debug("[rollbackTransaction] Rolled back");
    } catch (error) {
      logger.error("[rollbackTransaction] Error:", error);
    }
  }
}

module.exports = StreamOutgoingMigrationModel;