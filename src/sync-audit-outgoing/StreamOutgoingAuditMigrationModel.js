const BaseModel = require("../../models/BaseModel");
const logger = require("../../utils/logger");
const sql = require('mssql');
const { v4: uuidv4 } = require("uuid");
const bcrypt = require('bcrypt');

const DEFAULT_PASSWORD = process.env.MIGRATION_DEFAULT_PASSWORD || '12345678';
const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10);

class StreamOutgoingAuditSyncModel extends BaseModel {
  constructor(oldDbTable) {
    super();
    this.oldDbSchema = "dbo";
    this.oldDbTable = oldDbTable;
    this.newDbSchema = "dbo";
    this.newDbTable = "audit_sync";
  }

  /* ================= FETCH ================= */

  async fetchBatch({ batch, lastId }) {
    const query = `
      SELECT TOP (@batch) *
      FROM ${this.oldDbSchema}.${this.oldDbTable}
      WHERE (@lastId IS NULL OR ID > @lastId)
      ORDER BY ID ASC
    `;

    return this.queryOldDb(query, {
      batch,
      lastId: lastId || null,
    });
  }

  /* ================= UPSERT ================= */

  async upsertBatch(records) {
    if (!records?.length) return { inserted: 0, updated: 0 };

    const transaction = await this.beginTransaction();

    let inserted = 0;
    let updated = 0;

    try {
      for (const raw of records) {
        try {
          const mapped = await this._mapSingleRecord(raw, transaction);
          if (!mapped) continue;

          const existed = await this._getExistingAuditSync(
            mapped.id_van_ban,
            transaction
          );

          if (existed) {
            await this._update(mapped, transaction);
            updated++;
          } else {
            await this._insert(mapped, transaction);
            inserted++;
          }
        } catch (err) {
          logger.warn(
            `[AuditSync:${this.oldDbTable}] Skip ID=${raw?.ID}: ${err.message}`
          );
        }
      }

      await this.commitTransaction(transaction);

      return { inserted, updated };
    } catch (error) {
      await this.rollbackTransaction(transaction);
      throw error;
    }
  }

  /* ================= MAP ================= */

  async _mapSingleRecord(record, transaction) {
    if (!record?.ID || !record?.IDVanBan) return null;

    const documentId = await this._getNewDocumentId(
      record.IDVanBan,
      transaction
    );

    if (!documentId) return null;

    const user_id = await this._mapUserName(record.NguoiXuLy, transaction);
    const userName = this._extractDisplayName(record.NguoiXuLy);

    return {
      id_van_ban: String(record.ID),
      document_id: documentId,
      time: this._parseDate(record.NgayTao),
      action_code: record.HanhDong || null,
      display_name: userName,
      user_id: user_id,
    };
  }

  /* ================= EXIST CHECK ================= */

  async _getExistingAuditSync(idVanBan, transaction) {
    const query = `
      SELECT TOP 1 id
      FROM camunda.dbo.audit_sync
      WHERE id_van_ban = @idVanBan
    `;

    const result = await this.queryNewDbTx(
      query,
      { idVanBan },
      transaction
    );

    return result?.[0] || null;
  }

  async _getNewDocumentId(idVanBan, transaction = null) {
    try {
      if (idVanBan === null || idVanBan === undefined) {
        return { document_id: null, type_document: null };
      }

      const normalizedIdVanBan = String(idVanBan).trim();
      if (!normalizedIdVanBan) {
        return { document_id: null, type_document: null };
      }

      // 1. Tìm OUTGOING trước
      const outgoingQuery = `
        SELECT TOP 1 document_id
        FROM camunda.dbo.outgoing_documents2
        WHERE id_outgoing_bak = @idVanBan
      `;

      const outgoing = await this.queryNewDbTx(
        outgoingQuery,
        { idVanBan: normalizedIdVanBan },
        transaction
      );

      if (outgoing?.length) {
        return {
          document_id: outgoing[0].document_id,
          type_document: 'OutgoingDocument',
        };
      }

      // // 2. Nếu không có → tìm INCOMING
      // const incomingQuery = `
      //   SELECT TOP 1 document_id
      //   FROM camunda.dbo.incomming_documents
      //   WHERE id_incomming_bak = @idVanBan
      // `;

      // const incoming = await this.queryNewDbTx(
      //   incomingQuery,
      //   { idVanBan: normalizedIdVanBan },
      //   transaction
      // );

      // if (incoming?.length) {
      //   return {
      //     document_id: incoming[0].document_id,
      //     type_document: 'IncommingDocument',
      //   };
      // }

      // 3. Nếu không có → tìm INCOMING 2
      const incomingQuery2 = `
        SELECT TOP 1 document_id
        FROM camunda.dbo.incomming_documents2
        WHERE id_incomming_bak = @idVanBan
      `;

      const incoming2 = await this.queryNewDbTx(
        incomingQuery2,
        { idVanBan: normalizedIdVanBan },
        transaction
      );

      if (incoming2?.length) {
        return {
          document_id: incoming2[0].document_id,
          type_document: 'IncommingDocument',
        };
      }

      return { document_id: null, type_document: null };

    } catch (error) {
      logger.error(
        `[_getNewDocumentId] Error idVanBan=${idVanBan}: ${error.message}`
      );
      throw error;
    }
  }

  /* ================= INSERT ================= */

  async _insert(data, transaction) {
    if (!data?.document_id?.document_id) {
      logger.warn(
        `[audit_sync] Skip insert vì document_id null | id_van_ban=${data?.id_van_ban}`
      );
      return;
    }

    const query = `
      INSERT INTO camunda.dbo.audit_sync (
        document_id,
        time,
        display_name,
        user_id,
        created_by,
        action_code,
        id_van_ban,
        created_at,
        updated_at,
        type_document,
        table_backups
      )
      VALUES (
        @documentId,
        @time,
        @displayName,
        @userId,
        @createdBy,
        @actionCode,
        @idVanBan,
        GETDATE(),
        GETDATE(),
        @typeDocument,
        @sourceTable
      )
    `;

    await this.queryNewDbTx(
      query,
      {
        documentId: data.document_id.document_id,
        time: data.time,
        displayName: data.display_name,
        userId: data.user_id,
        createdBy: data.user_id,
        actionCode: data.display_name,
        idVanBan: data.id_van_ban,
        typeDocument: data.document_id.type_document,
        sourceTable: this.oldDbTable,
      },
      transaction
    );
  }

  /* ================= UPDATE ================= */

  async _update(data, transaction) {
    const query = `
      UPDATE camunda.dbo.audit_sync
      SET
        time = @time,
        display_name = @displayName,
        user_id = @userId,
        created_by = @userId,
        action_code = @actionCode,
        updated_at = GETDATE()
      WHERE id_van_ban = @idVanBan
    `;

    await this.queryNewDbTx(
      query,
      {
        time: data.time,
        displayName: data.display_name,
        userId: data.user_id,
        userId: data.user_id,
        actionCode: data.display_name,
        idVanBan: data.id_van_ban,
      },
      transaction
    );
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

module.exports = StreamOutgoingAuditSyncModel;