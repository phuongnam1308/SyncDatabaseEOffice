const logger = require("../../utils/logger");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require('bcrypt');

const DEFAULT_PASSWORD = process.env.MIGRATION_DEFAULT_PASSWORD || '12345678';
const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10);

class MigrationHelper {
  constructor(dbQueryFn) {
    this.queryNewDbTx = dbQueryFn;
  }

  cleanText(text) {
    if (!text || typeof text !== "string") return "";
    return text.trim().replace(/\s+/g, " ");
  }

  parseDate(date) {
    if (!date) return null;
    try {
      const parsed = new Date(date);
      return isNaN(parsed.getTime()) ? null : parsed;
    } catch {
      return null;
    }
  }

  mapStatus(status) {
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

  normalizeText(text) {
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

  removeVietnameseTones(str) {
    if (!str) return str;
    return str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D");
  }

  async processDocumentType(value) {
    try {
      if (typeof value !== "string") return null;

      let raw = value.trim();
      if (!raw || raw.toUpperCase() === "NULL") {
        return null;
      }

      const hashIndex = raw.indexOf("#");
      if (hashIndex !== -1 && hashIndex < raw.length - 1) {
        raw = raw.substring(hashIndex + 1);
      }

      raw = raw.trim();
      if (!raw) return null;

      const title = raw;
      const normalizedValue = this.removeVietnameseTones(raw).replace(/\s+/g, "");

      if (!normalizedValue) return null;

      const sourceId = await this.getSourceId("S19");
      if (!sourceId) {
        logger.warn("[processDocumentType] source_id S19 not found");
        return normalizedValue;
      }

      const result = await this.checkOrInsertSourceData(sourceId, normalizedValue, title);
      return result;
    } catch (error) {
      logger.error("[processDocumentType] Error:", error);
      return null;
    }
  }

  async processUrgencyLevel(value) {
    try {
      if (typeof value !== "string" || value.trim() === "") {
        return null;
      }

      const normalized = this.normalizeText(value);
      if (!normalized) return null;

      const sourceId = await this.getSourceId("S20");
      if (!sourceId) {
        logger.warn("[processUrgencyLevel] Không tìm thấy source_id cho S20");
        return normalized;
      }

      const title = value.trim();
      const result = await this.checkOrInsertSourceData(sourceId, normalized, title);
      return result;
    } catch (error) {
      logger.error("[processUrgencyLevel] Error:", error);
      return null;
    }
  }

  async processPrivateLevel(value) {
    try {
      if (typeof value !== "string" || value.trim() === "") {
        return null;
      }

      const normalized = this.normalizeText(value);
      if (!normalized) return null;

      const sourceId = await this.getSourceId("S21");
      if (!sourceId) {
        logger.warn("[processPrivateLevel] Không tìm thấy source_id cho S21");
        return normalized;
      }

      const title = value.trim();
      const result = await this.checkOrInsertSourceData(sourceId, normalized, title);
      return result;
    } catch (error) {
      logger.error("[processPrivateLevel] Error:", error);
      return null;
    }
  }

  processSenderUnit(value, maxLength = 255) {
    try {
      if (!value) return null;
      let raw = null;

      if (Array.isArray(value)) {
        if (!value.length) return null;
        raw = value[0];
      } else {
        raw = value;
      }
      if (!raw) return null;

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

      if (trimmed.includes(";#")) {
        const parts = trimmed.split(";#");
        if (parts.length >= 2 && parts[1]) {
          result = parts[1].trim();
        } else {
          return null;
        }
      }

      if (!result) return null;

      if (result.length > maxLength) {
        result = result.substring(0, maxLength);
      }

      return result;
    } catch (err) {
      logger.warn("[processSenderUnit] invalid value:", value);
      return null;
    }
  }

  async mapSenderUnitId(value, transaction = null) {
    try {
      const normalizedName = this.processSenderUnit(value);
      if (!normalizedName) return null;

      const selectQuery = `
        SELECT TOP 1 id
        FROM camunda.dbo.organization_units
        WHERE LTRIM(RTRIM(name)) = @name
          AND status = 1
      `;

      let result = await this.queryNewDbTx(selectQuery, { name: normalizedName }, transaction);

      if (result?.length) {
        return result[0].id;
      }

      const id = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
      const code = normalizedName;

      const insertQuery = `
        INSERT INTO camunda.dbo.organization_units (
          id, name, code, status, created_at, updated_at, table_backups
        )
        VALUES (@id, @name, @code, 1, GETDATE(), GETDATE(), 'stream_migration')
      `;

      try {
        await this.queryNewDbTx(insertQuery, { id, name: normalizedName, code }, transaction);
        logger.warn(`[mapSenderUnitId] Created new organization: ${normalizedName}`);
        return id;
      } catch (insertError) {
        logger.warn(`[mapSenderUnitId] Insert fail, retry select: ${insertError.message}`);
        const retry = await this.queryNewDbTx(selectQuery, { name: normalizedName }, transaction);
        return retry?.length ? retry[0].id : null;
      }
    } catch (error) {
      logger.error(`[mapSenderUnitId] Error value="${value}": ${error.message}`);
      return null;
    }
  }

    async mapUserName(Name, transaction = null) {
    try {
        const displayName = this.extractDisplayName(Name);
        if (!displayName) return null;

        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidPattern.test(displayName)) {
        return displayName;
        }

        const usernameBase = this.buildUsernameFromName(displayName);
        if (!usernameBase) return null;

        const selectQuery = `
        SELECT TOP 1 id
        FROM camunda.dbo.users
        WHERE name = @name OR id = @name
        `;

        const existing = await this.queryNewDbTx(selectQuery, { name: displayName }, transaction);

        if (existing?.length) {
        return existing[0].id;
        }

        const id = uuidv4();
        const username = `${usernameBase}${Math.floor(1000 + Math.random() * 9000)}`;
        const password = await this.hashDefaultPassword();

        const insertQuery = `
        INSERT INTO camunda.dbo.users (
            id, name, username, password, parent, status, created_at, updated_at
        )
        VALUES (@id, @name, @username, @password, @parent, 1, GETDATE(), GETDATE())
        `;

        try {
        await this.queryNewDbTx(insertQuery, {
            id, name: displayName, username, password, parent: '68afb3a1cb36081f0bba5dd6'
        }, transaction);

        logger.warn(`[mapUserName] Created new user: ${displayName} (${username})`);
        return id;
        } catch (err) {
        const retry = await this.queryNewDbTx(selectQuery, { name: displayName }, transaction);
        return retry?.length ? retry[0].id : null;
        }
    } catch (error) {
        logger.warn("[mapUserName] Error:", error);
        return null;
    }
    }

  extractDisplayName(value) {
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

  buildUsernameFromName(name) {
    const base = this.removeVietnameseTones(name)
      .toLowerCase()
      .replace(/\s+/g, "");

    if (!base) return null;
    return base;
  }

  async hashDefaultPassword() {
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
      throw error;
    }
  }

  async mapBookDocument(bookName, { drafter = null, senderUnit = null, privateLevel = null, year = new Date().getFullYear() } = {}) {
    try {
      if (!bookName || typeof bookName !== "string") {
        return null;
      }

      let normalized = bookName.trim();
      if (!normalized || normalized.toUpperCase() === "NULL") {
        return null;
      }

      const hashIndex = normalized.indexOf("#");
      if (hashIndex !== -1) {
        normalized = normalized.substring(hashIndex + 1).trim();
      }

      if (!normalized) return null;

      if (normalized.length > 255) {
        normalized = normalized.substring(0, 255);
      }

      const selectQuery = `
        SELECT TOP 1 book_document_id AS id, count
        FROM camunda.dbo.book_documents
        WHERE LTRIM(RTRIM(name)) = @name
      `;

      let result = await this.queryNewDbTx(selectQuery, { name: normalized });

      if (result?.length > 0) {
      const selectQuery = `
        UPDATE camunda.dbo.book_documents
        SET count = count + 1, updated_at = GETDATE()
        WHERE book_document_id = @id
      `;

      await this.queryNewDbTx(selectQuery, { id: result[0].id });
        return {
          id: result[0].id,
          count: result[0].count
        };
      }

      const insertQuery = `
        INSERT INTO camunda.dbo.book_documents (
          name, [year], status, type_document, sender_unit, private_level, count, created_at, updated_at, created_by
        )
        OUTPUT INSERTED.book_document_id
        VALUES (@name, @year, 1, N'OutGoingDocument', @sender_unit, @private_level, 1, GETDATE(), GETDATE(), @created_by)
      `;

      try {
        const insertResult = await this.queryNewDbTx(insertQuery, {
          name: normalized, year, sender_unit: senderUnit, private_level: privateLevel, created_by: drafter
        });

        return insertResult?.length > 0 ? insertResult[0].book_document_id : null;
      } catch (insertError) {
        logger.warn(`[mapBookDocument] Insert failed, retry select: ${insertError.message}`);
        const retry = await this.queryNewDbTx(selectQuery, { name: normalized });
        return retry?.length > 0 ? retry[0].id : null;
      }
    } catch (error) {
      logger.warn(`[mapBookDocument] Error bookName="${bookName}": ${error.message}`);
      return null;
    }
  }

  async getSourceId(code) {
    try {
      const query = `
        SELECT TOP 1 id
        FROM camunda.dbo.crm_sources
        WHERE code = @code
      `;
      const result = await this.queryNewDbTx(query, { code });
      return result.length > 0 ? result[0].id : null;
    } catch (error) {
      logger.error(`[getSourceId] Error for code ${code}:`, error);
      return null;
    }
  }

  async checkOrInsertSourceData(sourceId, value, title) {
    try {
      if (!sourceId || !value) return null;

      const checkQuery = `
        SELECT TOP 1 id, value
        FROM camunda.dbo.crm_source_data
        WHERE source_id = @sourceId AND value = @value
      `;
      const existing = await this.queryNewDbTx(checkQuery, { sourceId, value });

      if (existing.length > 0) {
        return existing[0].value;
      }

      const id = uuidv4();
      const insertQuery = `
        INSERT INTO camunda.dbo.crm_source_data (id, source_id, title, value, createdAt, updatedAt)
        VALUES (@id, @sourceId, @title, @value, GETDATE(), GETDATE())
      `;

      await this.queryNewDbTx(insertQuery, {
        id, sourceId, title: title || value, value
      });

      logger.debug(`[checkOrInsertSourceData] Inserted new source_data: value="${value}"`);
      return value;
    } catch (error) {
      logger.error("[checkOrInsertSourceData] Error:", error);
      return null;
    }
  }
}

module.exports = MigrationHelper;