const logger = require("../../utils/logger");
const SyncStateRepository = require("../sync-manager/SyncStateRepository");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require('bcryptjs');

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs').promises; // Use promise-based fs
const path = require('path');
const { ROLES_DEFAULT } = require('../config');
const DEFAULT_PASSWORD = process.env.MIGRATION_DEFAULT_PASSWORD || '12345678';
const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10);

class MigrationHelper {
  constructor(dbQueryFn, queryOldDbFn = null) {
    this.queryNewDbTx = dbQueryFn;
    this.queryOldDb = queryOldDbFn;
    this.mapStatus = this.mapStatusOutgoing.bind(this);
    this.deptCache = new Map(); // Local cache for department IDs
    this.customSenderUnitCache = new Map(); // Local cache for custom sender unit IDs
  }

  async ensureUsersTbBakColumnExists(transaction = null) {
    try {
      const dbName = process.env.NEW_DB_NAME;
      if (!dbName) return;

      await this.queryNewDbTx(
        `
        IF NOT EXISTS (
            SELECT 1
            FROM ${dbName}.INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'users' AND COLUMN_NAME = 'tb_bak'
        )
        BEGIN
            ALTER TABLE [${dbName}].[dbo].[users] ADD tb_bak INT DEFAULT 0;
        END
        `,
        {},
        transaction
      );
    } catch (err) {
      logger.warn(`[MigrationHelper] ensureUsersTbBakColumnExists failed: ${err.message}`);
    }
  }

  isCreatableUsername(username) {
    if (username === null || username === undefined) return false;
    return String(username).trim().length > 3;
  }

  /**
   * Đảm bảo các cột kỹ thuật tồn tại trong bảng (Self-healing schema)
   * @param {string} dbName
   * @param {string} tableName
   * @param {Object} columnsMap { columnName: dataType }
   */
  async ensureColumnsExist(dbName, tableName, columnsMap, transaction = null) {
    try {
      const dbPrefix = dbName ? `${dbName}.` : "";

      for (const [colName, dataType] of Object.entries(columnsMap)) {
        const checkQuery = `
          SELECT 1 FROM ${dbName || 'dbo'}.INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = @tableName
            AND COLUMN_NAME = @colName
        `;

        const exists = await this.queryNewDbTx(checkQuery, { tableName, colName }, transaction);

        if (!exists || exists.length === 0) {
          logger.info(`[MigrationHelper] Dang khoi tao cot thieu: ${tableName}.${colName} (${dataType})`);
          const alterQuery = `ALTER TABLE ${dbPrefix}dbo.${tableName} ADD [${colName}] ${dataType}`;
          await this.queryNewDbTx(alterQuery, {}, transaction);
        }
      }
    } catch (err) {
      logger.error(`[MigrationHelper] ensureColumnsExist failed for ${tableName}: ${err.message}`);
    }
  }

  /**
   * Lấy danh sách cột thực tế từ Database cũ (Source)
   */
  async getExistingColumnsSource(dbName, tableName, schema = 'dbo') {
    try {
      if (!this.queryOldDb) return new Set();

      const query = `
        SELECT COLUMN_NAME
        FROM ${dbName}.INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = @tableName
        AND TABLE_SCHEMA = @schema
      `;

      const result = await this.queryOldDb(query, { tableName, schema });
      return new Set(result.map(r => r.COLUMN_NAME.toLowerCase()));
    } catch (err) {
      logger.warn(`[MigrationHelper] getExistingColumnsSource Error: ${err.message}`);
      return new Set();
    }
  }

  /**
   * Kiểm tra sự tồn tại của một bảng trong Database cũ
   */
  async checkTableExistsSource(dbName, tableName, schema = 'dbo') {
    try {
      if (!this.queryOldDb) return false;
      const query = `
        SELECT 1 FROM ${dbName}.INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME = @tableName AND TABLE_SCHEMA = @schema
      `;
      const result = await this.queryOldDb(query, { tableName, schema });
      return result.length > 0;
    } catch (err) {
      return false;
    }
  }

  safeString(value) {
    if (value == null) return null;
    const str = String(value).trim();
    if (str === "" || str.toUpperCase() === "NULL") return null;
    return str;
  }

  mapBit(value) {
    if (value == null) return 0;
    const s = String(value).trim();
    if (s === "1" || s.toLowerCase() === "true") return 1;
    return 0;
  }

  cleanText(text) {
    if (!text || typeof text !== "string") return "";
    return text.trim().replace(/\s+/g, " ");
  }

  parseDate(date) {
    if (!date) return null;

    try {
      if (date instanceof Date) {
        return isNaN(date.getTime()) ? null : date;
      }

      if (typeof date === "number") {
        const parsed = new Date(
          date > 1e12 ? date : date * 1000
        );
        return isNaN(parsed.getTime()) ? null : parsed;
      }

      if (typeof date !== "string") return null;

      const trimmed = date.trim();
      if (!trimmed) return null;

      const dotNetMatch =
        trimmed.match(/^\/Date\((\d+)\)\/$/i);
      if (dotNetMatch?.[1]) {
        const parsed = new Date(
          Number(dotNetMatch[1])
        );
        return isNaN(parsed.getTime()) ? null : parsed;
      }

      if (/^\d{10,13}$/.test(trimmed)) {
        const numeric = Number(trimmed);
        const parsed = new Date(
          trimmed.length === 13
            ? numeric
            : numeric * 1000
        );
        return isNaN(parsed.getTime()) ? null : parsed;
      }

      if (
        /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(
          trimmed
        )
      ) {
        const [datePart, timePart] = trimmed.split(/[ T]/);
        const [year, month, day] = datePart.split("-").map(Number);
        const [hour = 0, minute = 0, second = 0] = (timePart || "")
          .split(":")
          .map((part) => Number(part || 0));

        const parsed = new Date(
          Date.UTC(year, month - 1, day, hour, minute, second) - 7 * 60 * 60 * 1000
        );
        return isNaN(parsed.getTime()) ? null : parsed;
      }

      const vnDatePattern =
        /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
      const vnMatch = trimmed.match(vnDatePattern);
      if (vnMatch) {
        const day = Number(vnMatch[1]);
        const month = Number(vnMatch[2]);
        const year = Number(vnMatch[3]);
        const hour = Number(vnMatch[4] || 0);
        const minute = Number(vnMatch[5] || 0);
        const second = Number(vnMatch[6] || 0);

        const parsed = new Date(
          Date.UTC(year, month - 1, day, hour, minute, second) - 7 * 60 * 60 * 1000
        );

        if (
          parsed.getUTCFullYear() === year &&
          parsed.getUTCMonth() === month - 1 &&
          parsed.getUTCDate() === day
        ) {
          return parsed;
        }
      }

      const parsed = new Date(trimmed);
      return isNaN(parsed.getTime()) ? null : parsed;

    } catch {
      return null;
    }
  }

  parseDateNonSubSeven(date) {
    if (date === null || date === undefined || date === '') {
      return null;
    }

    try {
      // Date instance
      if (date instanceof Date) {
        return isNaN(date.getTime()) ? null : date;
      }

      // timestamp number
      if (typeof date === 'number') {
        const parsed = new Date(
          date > 1e12 ? date : date * 1000
        );

        return isNaN(parsed.getTime())
          ? null
          : parsed;
      }

      // only support string below
      if (typeof date !== 'string') {
        return null;
      }

      const trimmed = date.trim();

      if (!trimmed) {
        return null;
      }

      // NULL string
      if (
        trimmed.toLowerCase() === 'null' ||
        trimmed.toLowerCase() === 'undefined'
      ) {
        return null;
      }

      // .NET Date: /Date(1534726800000)/
      const dotNetMatch = trimmed.match(
        /^\/Date\((\d+)\)\/$/i
      );

      if (dotNetMatch?.[1]) {
        const parsed = new Date(
          Number(dotNetMatch[1])
        );

        return isNaN(parsed.getTime())
          ? null
          : parsed;
      }

      // unix timestamp string
      if (/^\d{10,13}$/.test(trimmed)) {
        const numeric = Number(trimmed);

        const parsed = new Date(
          trimmed.length === 13
            ? numeric
            : numeric * 1000
        );

        return isNaN(parsed.getTime())
          ? null
          : parsed;
      }

      /**
       * yyyy-MM-dd
       * yyyy-MM-dd HH:mm
       * yyyy-MM-dd HH:mm:ss
       */
      const isoMatch = trimmed.match(
        /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/
      );

      if (isoMatch) {
        const year = Number(isoMatch[1]);
        const month = Number(isoMatch[2]);
        const day = Number(isoMatch[3]);
        const hour = Number(isoMatch[4] || 0);
        const minute = Number(isoMatch[5] || 0);
        const second = Number(isoMatch[6] || 0);

        const parsed = new Date(
          year,
          month - 1,
          day,
          hour,
          minute,
          second
        );

        // validate invalid date
        if (
          parsed.getFullYear() === year &&
          parsed.getMonth() === month - 1 &&
          parsed.getDate() === day
        ) {
          return parsed;
        }

        return null;
      }

      /**
       * dd/MM/yyyy
       * dd-MM-yyyy
       * dd/MM/yyyy HH:mm:ss
       */
      const vnMatch = trimmed.match(
        /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
      );

      if (vnMatch) {
        const day = Number(vnMatch[1]);
        const month = Number(vnMatch[2]);
        const year = Number(vnMatch[3]);
        const hour = Number(vnMatch[4] || 0);
        const minute = Number(vnMatch[5] || 0);
        const second = Number(vnMatch[6] || 0);

        const parsed = new Date(
          year,
          month - 1,
          day,
          hour,
          minute,
          second
        );

        if (
          parsed.getFullYear() === year &&
          parsed.getMonth() === month - 1 &&
          parsed.getDate() === day
        ) {
          return parsed;
        }

        return null;
      }

      /**
       * Aug 20 2018 1:55PM
       * Aug 20 2018 4:59PM
       */
      const englishDate = new Date(trimmed);

      if (!isNaN(englishDate.getTime())) {
        return englishDate;
      }

      return null;

    } catch {
      return null;
    }
  }

  mapStatusOutgoing(trangThai) {
    const safeTrangThai = this.safeString(trangThai);
    const defaultResult = {
      statusCode: "2",
      bpmnVersion: 'SOANTHAO_PHATHANH_VBD',
      stageStatus: 'DA_XU_LY',
      curStatusCode: "1"
    };

    if (!safeTrangThai || !process.env.STATUS_MAP_OUTGOING) {
      return defaultResult;
    }

    try {
      const statusMap = JSON.parse(process.env.STATUS_MAP_OUTGOING);
      if (Array.isArray(statusMap)) {
        for (const mapping of statusMap) {
          if (Array.isArray(mapping.trangthais)) {
            for (const t of mapping.trangthais) {
              if (safeTrangThai.toLowerCase().includes(t.toLowerCase())) {
                return {
                  statusCode: mapping.status_code || defaultResult.statusCode,
                  bpmnVersion: mapping.bpmn_version || defaultResult.bpmnVersion,
                  stageStatus: mapping.stage_status || defaultResult.stageStatus,
                  curStatusCode: mapping.curStatusCode || defaultResult.curStatusCode
                };
              }
            }
          }
        }
      }
    } catch (e) {
      logger.warn(`[MigrationHelper] Error parsing STATUS_MAP_OUTGOING: ${e.message}`);
    }

    return defaultResult;
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

  /**
   * Mạnh tay hơn normalizeText: dùng để làm key duy nhất chống trùng lặp
   * Ví dụ: "Phòng Kế Toán" -> "phong_ke_toan"
   */
  normalizeUnitName(text) {
    if (!text || typeof text !== "string") return "";

    // 1. Bỏ dấu tiếng Việt
    let str = this.removeVietnameseTones(text.trim());

    // 2. Chuyển lowercase
    str = str.toLowerCase();

    // 3. Thay thế ký tự đặc biệt (bao gồm cả -, và space dư thừa) thành '_'
    // Giữ lại chữ cái và số
    str = str.replace(/[^a-z0-9]/g, "_");

    // 4. Gom nhiều dấu '_' liên tiếp thành 1
    str = str.replace(/_+/g, "_");

    // 5. Trim '_' ở đầu và cuối
    str = str.replace(/^_+|_+$/g, "");

    return str || "_";
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

  async processDocumentField(value) {
    try {
      if (typeof value !== "string" || value.trim() === "") {
        return null;
      }

      const normalized = this.normalizeText(value);
      if (!normalized) return null;

      const sourceId = await this.getSourceId("S19");
      if (!sourceId) {
        logger.warn("[processDocumentField] Không tìm thấy source_id cho S19");
        return normalized;
      }

      const title = value.trim();
      const result = await this.checkOrInsertSourceData(sourceId, normalized, title);
      return result;
    } catch (error) {
      logger.error("[processDocumentField] Error:", error);
      return null;
    }
  }

  splitStringSplitBySemicolon(input) {
    if (!input || typeof input !== 'string') {
      return [];
    }

    // Hỗ trợ định dạng SharePoint Multi-lookup: id;#name;#id;#name
    if (input.includes(";#")) {
      const parts = input.split(/;#?|#;/).map(p => p.trim()).filter(Boolean);
      const names = [];
      // Trong chuỗi id;#name;#id;#name, tên thường nằm ở các vị trí lẻ (1, 3, 5...)
      // Tuy nhiên có trường hợp chỉ có tên hoặc format lạ, ta ưu tiên lấy các chuỗi không phải ID số
      for (const p of parts) {
        if (!/^\d+$/.test(p)) {
          names.push(p);
        }
      }
      if (names.length > 0) return names;
      return parts;
    }

    return input
      .split(';')
      .map(item => item.trim())
      .filter(Boolean);
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

  /**
   * Đảm bảo schema của bảng organization_units có cột normalized_name và index UX.
   */
  async _ensureOrganizationUnitsSchema(transaction = null) {
    if (this._schemaReady) return;

    try {
      const dbName = process.env.NEW_DB_NAME;
      const checkColumn = `
        IF NOT EXISTS (
          SELECT * FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = 'organization_units' AND COLUMN_NAME = 'normalized_name'
        )
        BEGIN
          ALTER TABLE ${dbName}.dbo.organization_units ADD normalized_name NVARCHAR(255) NULL;
        END

        IF NOT EXISTS (
          SELECT * FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = 'organization_units' AND COLUMN_NAME = 'tb_bak'
        )
        BEGIN
          ALTER TABLE ${dbName}.dbo.organization_units ADD tb_bak INT DEFAULT 0;
        END
      `;
      await this.queryNewDbTx(checkColumn, {}, transaction);

      const checkIndex = `
        IF NOT EXISTS (
          SELECT * FROM sys.indexes
          WHERE name = 'UX_org_unit_name' AND object_id = OBJECT_ID('organization_units')
        )
        BEGIN
          -- Xóa duplicates nếu có trước khi tạo UNIQUE INDEX (optional but recommended)
          -- Ở đây mình chỉ tạo index, nếu có duplicate SQL sẽ báo lỗi, giúp admin biết để dọn.
          CREATE UNIQUE INDEX UX_org_unit_name ON ${dbName}.dbo.organization_units (normalized_name) WHERE normalized_name IS NOT NULL;
        END
      `;
      await this.queryNewDbTx(checkIndex, {}, transaction);

      this._schemaReady = true;
    } catch (err) {
      logger.error(`[_ensureOrganizationUnitsSchema] Lỗi: ${err.message}`);
    }
  }

  async mapSenderUnitId(value, transaction = null) {
    try {
      const originalName = this.processSenderUnit(value);
      if (!originalName) return null;

      const normalizedKey = this.normalizeUnitName(originalName);

      // 1. Check local cache
      if (this.deptCache.has(normalizedKey)) {
        return this.deptCache.get(normalizedKey);
      }

      // 2. Ensure schema
      await this._ensureOrganizationUnitsSchema(transaction);

      // 3. Stricter Check in New DB (Search by normalized name first)
      const selectByNormalized = `
        SELECT TOP 1 id FROM ${process.env.NEW_DB_NAME}.dbo.organization_units 
        WHERE normalized_name = @normalizedKey OR LTRIM(RTRIM(name)) = @originalName
      `;
      let existing = await this.queryNewDbTx(selectByNormalized, { normalizedKey, originalName }, transaction);

      if (existing?.length) {
        const foundId = existing[0].id;
        this.deptCache.set(normalizedKey, foundId);
        return foundId;
      }

      // 4. Try Old DB (to map existing records)
      if (this.queryOldDb) {
        const oldDept = await this.queryOldDb(
          `SELECT TOP 1 ID, ParentID, Title, Code FROM ${process.env.OLD_DB_NAME}.dbo.Department WHERE LTRIM(RTRIM(Title)) = @name`,
          { name: originalName }
        );

        if (oldDept?.length) {
          const dept = oldDept[0];
          // Check by backup ID
          const existedByBak = await this.queryNewDbTx(
            `SELECT TOP 1 id FROM ${process.env.NEW_DB_NAME}.dbo.organization_units WHERE Id_backups = @oldId`,
            { oldId: dept.ID },
            transaction
          );

          if (existedByBak?.length) {
            const foundId = existedByBak[0].id;
            this.deptCache.set(normalizedKey, foundId);
            return foundId;
          }

          // Not found even by backup ID -> Sync from old info (allowed)
          const newId = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
          // ... (Insert logic omitted for brevity, but I'll keeping it robust)
          try {
            await this.queryNewDbTx(
              `INSERT INTO ${process.env.NEW_DB_NAME}.dbo.organization_units (id, name, normalized_name, code, status, created_at, updated_at, Id_backups, table_backups, tb_bak)
               VALUES (@id, @name, @normalizedKey, @code, 1, GETDATE(), GETDATE(), @oldId, 'stream_migration', 1)`,
              {
                id: newId,
                name: dept.Title.trim(),
                normalizedKey,
                code: dept.Code || normalizedKey,
                oldId: dept.ID
              },
              transaction
            );
            this.deptCache.set(normalizedKey, newId);
            return newId;
          } catch (err) {
            // Conflict check
            const retry = await this.queryNewDbTx(selectByNormalized, { normalizedKey, originalName }, transaction);
            return retry?.[0]?.id || null;
          }
        }
      }

      // 5. Completely new (allowed in incoming/outgoing modules as per user)
      const newId = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
      try {
        await this.queryNewDbTx(
          `INSERT INTO ${process.env.NEW_DB_NAME}.dbo.organization_units (id, name, normalized_name, code, status, created_at, updated_at, table_backups, tb_bak)
           VALUES (@id, @name, @normalizedKey, @code, 1, GETDATE(), GETDATE(), 'stream_migration', 1)`,
          {
            id: newId,
            name: originalName,
            normalizedKey,
            code: normalizedKey
          },
          transaction
        );
        this.deptCache.set(normalizedKey, newId);
        return newId;
      } catch (err) {
        const finalRetry = await this.queryNewDbTx(selectByNormalized, { normalizedKey, originalName }, transaction);
        return finalRetry?.[0]?.id || null;
      }
    } catch (error) {
      logger.error(`[mapSenderUnitId] Error value="${value}": ${error.message}`);
      return null;
    }
  }

  async mapCustomSenderUnitId(value, transaction = null) {
    try {
      const originalName = this.processSenderUnit(value);
      if (!originalName) return null;

      const normalizedKey = this.normalizeUnitName(originalName);

      // 1. Check local cache
      if (!this.customSenderUnitCache) {
        this.customSenderUnitCache = new Map();
      }
      if (this.customSenderUnitCache.has(normalizedKey)) {
        return this.customSenderUnitCache.get(normalizedKey);
      }

      const dbName = process.env.NEW_DB_NAME || 'dbo';

      // 2. Check in New DB (Search by code/normalizedKey or name/originalName in custom_sender_units)
      const selectQuery = `
        SELECT TOP 1 id, mpath FROM [${dbName}].[dbo].[custom_sender_units] 
        WHERE code = @normalizedKey OR LTRIM(RTRIM(name)) = @originalName
      `;
      let existing = await this.queryNewDbTx(selectQuery, { normalizedKey, originalName }, transaction);

      if (existing?.length) {
        const foundId = existing[0].id;
        this.customSenderUnitCache.set(normalizedKey, foundId);
        return foundId;
      }

      // Default values for custom_sender_units
      const newId = uuidv4();
      const creatorId = process.env.MIGRATION_CREATOR_ID || 'system_migration';
      const creatorName = 'System Migration';

      // 3. Try Old DB (to find Parent or other attributes from old Department)
      let oldDeptParentId = null;
      let oldDeptCode = null;

      if (this.queryOldDb) {
        const oldDept = await this.queryOldDb(
          `SELECT TOP 1 ID, ParentID, Title, Code FROM ${process.env.OLD_DB_NAME}.dbo.Department WHERE LTRIM(RTRIM(Title)) = @name`,
          { name: originalName }
        );

        if (oldDept?.length) {
          const dept = oldDept[0];
          oldDeptCode = dept.Code || null;

          // Check if there's an existing parent in custom_sender_units
          if (dept.ParentID) {
            const parentDept = await this.queryOldDb(
              `SELECT TOP 1 Title FROM ${process.env.OLD_DB_NAME}.dbo.Department WHERE ID = @parentId`,
              { parentId: dept.ParentID }
            );
            if (parentDept?.length) {
              const parentName = parentDept[0].Title;
              const parentNormalizedKey = this.normalizeUnitName(parentName);

              // Find parent in new DB
              const selectParentQuery = `
                SELECT TOP 1 id, mpath FROM [${dbName}].[dbo].[custom_sender_units] 
                WHERE code = @parentNormalizedKey OR LTRIM(RTRIM(name)) = @parentName
              `;
              const parentExisted = await this.queryNewDbTx(selectParentQuery, { parentNormalizedKey, parentName }, transaction);
              if (parentExisted?.length) {
                oldDeptParentId = parentExisted[0].id;
                // Compute mpath: parent.mpath + '.' + newId
                const parentMpath = parentExisted[0].mpath || parentExisted[0].id;
                const mpath = `${parentMpath}.${newId}`;

                await this.queryNewDbTx(
                  `INSERT INTO [${dbName}].[dbo].[custom_sender_units] 
                    (id, name, code, parent_id, mpath, created_by, created_by_name, status, created_at, updated_at)
                   VALUES 
                    (@id, @name, @code, @parentId, @mpath, @createdBy, @createdByName, 1, GETDATE(), GETDATE())`,
                  {
                    id: newId,
                    name: originalName,
                    code: oldDeptCode || normalizedKey,
                    parentId: oldDeptParentId,
                    mpath: mpath,
                    createdBy: creatorId,
                    createdByName: creatorName
                  },
                  transaction
                );
                this.customSenderUnitCache.set(normalizedKey, newId);
                return newId;
              }
            }
          }
        }
      }

      // 4. Insert Completely new or without Parent resolved yet
      const defaultMpath = newId;
      try {
        await this.queryNewDbTx(
          `INSERT INTO [${dbName}].[dbo].[custom_sender_units] 
            (id, name, code, parent_id, mpath, created_by, created_by_name, status, created_at, updated_at)
           VALUES 
            (@id, @name, @code, NULL, @mpath, @createdBy, @createdByName, 1, GETDATE(), GETDATE())`,
          {
            id: newId,
            name: originalName,
            code: oldDeptCode || normalizedKey,
            mpath: defaultMpath,
            createdBy: creatorId,
            createdByName: creatorName
          },
          transaction
        );
        this.customSenderUnitCache.set(normalizedKey, newId);
        return newId;
      } catch (err) {
        const finalRetry = await this.queryNewDbTx(selectQuery, { normalizedKey, originalName }, transaction);
        return finalRetry?.[0]?.id || null;
      }
    } catch (error) {
      logger.error(`[mapCustomSenderUnitId] Error value="${value}": ${error.message}`);
      return null;
    }
  }

  /**
   * Ánh xạ Tên chủ đề sang ID (GUID), tự động tạo mới nếu chưa tồn tại.
   * Chống trùng lặp tuyệt đối bằng cách kiểm tra tên trong DB.
   */
  async getOrCreateTopic(topicName, topicMap, transaction = null) {
    if (!topicName || typeof topicName !== 'string') return null;

    const normalizedName = topicName.trim();
    if (!normalizedName) return null;
    const lowerName = normalizedName.toLowerCase();

    // 1. Kiểm tra trong cache để tăng tốc xử lý
    const safeTopicMap = topicMap || {};
    if (safeTopicMap[lowerName]) {
      return safeTopicMap[lowerName];
    }

    try {
      // 1.5 Đảm bảo Schema bảng topics có tb_bak (Self-healing on call)
      const checkBakQuery = `
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'topics' AND COLUMN_NAME = 'tb_bak')
            ALTER TABLE dbo.topics ADD tb_bak INT DEFAULT 0;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'topics' AND COLUMN_NAME = 'href')
            ALTER TABLE dbo.topics ADD href NVARCHAR(255) NULL;
      `;
      await this.queryNewDbTx(checkBakQuery, {}, transaction);

      // 2. Kiểm tra trùng lặp trong Database
      const selectQuery = `
        SELECT TOP 1 id
        FROM dbo.topics
        WHERE LTRIM(RTRIM(name)) = @name
      `;
      const result = await this.queryNewDbTx(selectQuery, { name: normalizedName }, transaction);

      if (result?.length) {
        const existingId = result[0].id;
        if (topicMap) topicMap[lowerName] = existingId;
        return existingId;
      }

      // 3. Tạo mới nếu chưa tồn tại (Dùng UUID cho uniqueidentifier)
      const id = uuidv4();
      const insertQuery = `
        INSERT INTO dbo.topics (
            id, name, display_order, status, requires_approval,
            created_at, updated_at, tb_bak
        )
        VALUES (
            @id, @name, 0, 1, 0,
            GETDATE(), GETDATE(), 1
        )
      `;

      await this.queryNewDbTx(insertQuery, { id, name: normalizedName }, null); // Không dùng transaction chung

      if (topicMap) topicMap[lowerName] = id;
      // logger.info(`[getOrCreateTopic] Đã tự động tạo Danh mục mới: "${normalizedName}" (ID: ${id})`);
      return id;

    } catch (error) {
      logger.error(`[getOrCreateTopic] Lỗi ánh xạ Danh mục "${topicName}": ${error.message}`);
      return null;
    }
  }

  async mapUserName(userIdOrName, transaction = null) {
    try {
      if (!userIdOrName || typeof userIdOrName !== 'string') {
        return userIdOrName;
      }
      if (userIdOrName === 'migservice')
        return 'b23406e3-5c75-41d3-91e0-1654293ae6b2';

      const trimmed = userIdOrName.trim();
      if (!trimmed) return userIdOrName;

      const isIdFormat = /^\d+$/.test(trimmed) || /^[0-9a-f-]{32,}$/i.test(trimmed);
      if (isIdFormat) {
        const checkNewQuery = `SELECT TOP 1 id FROM ${process.env.NEW_DB_NAME}.dbo.users WHERE id = @id OR id_user_bak = @id`;
        const existedNew = await this.queryNewDbTx(checkNewQuery, { id: trimmed }, transaction);
        if (existedNew?.length) return existedNew[0].id;
        return trimmed;
      }

      if (!/[a-zA-ZÀ-ỹ]/.test(trimmed)) return userIdOrName;

      const displayName = this.extractDisplayName(trimmed);
      if (!displayName) return userIdOrName;

      const selectQuery = `SELECT TOP 1 id FROM ${process.env.NEW_DB_NAME}.dbo.users WHERE name = @name OR id = @name`;
      const existing = await this.queryNewDbTx(selectQuery, { name: displayName }, transaction);
      if (existing?.length) return existing[0].id;

      // [RESTORED] Tìm trong DB cũ nếu không thấy ở DB mới
      if (this.queryOldDb) {
        const oldRows = await this.queryOldDb(
          `SELECT TOP 1 * FROM dbo.PersonalProfile WHERE FullName = @name OR AccountID = @name OR StaffID = @name`,
          { name: displayName }
        );
        if (oldRows?.length > 0) {
          const migrator = await this._getUserMigrator();
          if (migrator) {
            const syncRes = await migrator.upsertUserById(oldRows[0], transaction);
            if (syncRes?.id) return syncRes.id;
          }
        }
      }

      logger.warn(`[mapUserName] User "${userIdOrName}" not found. Returning NULL.`);
      return null;
    } catch (error) {
      logger.warn(`[mapUserName] Error for "${userIdOrName}":`, error.message);
      return null;
    }
  }

  /**
   * MỚI: Hàm đồng bộ và ánh xạ User từ DB cũ nếu chưa có ở DB mới.
   */
  async syncAndMapUser(userIdOrName, transaction = null) {
    try {
      if (!userIdOrName || typeof userIdOrName !== 'string') return userIdOrName;
      const trimmed = userIdOrName.trim();
      if (!trimmed) return userIdOrName;

      // logger.info(`[syncAndMapUser] Searching for: "${trimmed}"`);

      // 1. Tìm trong DB mới (theo ID, Username, hoặc Name)
      const checkNewQuery = `
        SELECT TOP 1 id FROM ${process.env.NEW_DB_NAME}.dbo.users
        WHERE id = @val OR username = @val OR name = @val OR code_nd = @val OR id_user_bak = @val
      `;
      const existedNew = await this.queryNewDbTx(checkNewQuery, { val: trimmed }, transaction);
      if (existedNew?.length) {
        // logger.info(`[syncAndMapUser] Found in New DB: ${trimmed} -> ${existedNew[0].id}`);
        return existedNew[0].id;
      }

      // [RESTORED] Tìm trong DB cũ nếu không thấy ở DB mới
      if (this.queryOldDb) {
        const oldRows = await this.queryOldDb(
          `SELECT TOP 1 * FROM dbo.PersonalProfile WHERE FullName = @val OR AccountID = @val OR StaffID = @val`,
          { val: trimmed }
        );
        if (oldRows?.length > 0) {
          const migrator = await this._getUserMigrator();
          if (migrator) {
            const syncRes = await migrator.upsertUserById(oldRows[0], transaction);
            if (syncRes?.id) return syncRes.id;
          }
        }
      }

      logger.warn(`[syncAndMapUser] User "${trimmed}" not found. Returning NULL.`);
      return null;
    } catch (error) {
      logger.error(`[syncAndMapUser] Error: ${error.message}`);
      return null;
    }
  }

  /**
   * MỚI: Cấu hình ánh xạ người dùng cho Passport một cách chặt chẽ.
   * Chỉ tìm kiếm trong DB mới và KHÔNG bao giờ tự tạo người dùng nếu thiết sót.
   * Cố gắng tìm bằng AuthorAccount, AuthorName, EditorAccount, EditorName.
   */
  async strictUserResolver(rowData, transaction = null) {
    const recordId = rowData.ID || rowData.tp_ID || 'Unknown';
    // logger.info(`[strictUserResolver] --- START STRICT RESOLVING USER (Record ID: ${recordId}) ---`);

    const selectQuery = `
      SELECT TOP 1 id, name, username, code_nd
      FROM ${process.env.NEW_DB_NAME}.dbo.users
      WHERE name = @val OR username = @val OR code_nd = @val OR id_user_bak = @val
    `;

    // --- STEP 1: AuthorAccount ---
    if (rowData.AuthorAccount) {
      const account = this.extractAccountOnly(rowData.AuthorAccount);
      // logger.info(`[strictUserResolver] STEP 1: Checking AuthorAccount "${rowData.AuthorAccount}" -> Extracted: "${account}"`);
      const res = await this.queryNewDbTx(selectQuery, { val: account }, transaction);
      if (res?.length) {
        // logger.info(`[strictUserResolver] >> SUCCESS: Found UID ${res[0].id} (${res[0].name})`);
        return res[0].id;
      }
    }

    // --- STEP 2: AuthorName ---
    if (rowData.AuthorName) {
      const cleanName = this.extractDisplayName(rowData.AuthorName);
      // logger.info(`[strictUserResolver] STEP 2: Checking AuthorName "${rowData.AuthorName}" -> Clean: "${cleanName}"`);
      const res = await this.queryNewDbTx(selectQuery, { val: cleanName }, transaction);
      if (res?.length) {
        // logger.info(`[strictUserResolver] >> SUCCESS: Found UID ${res[0].id} (${res[0].name})`);
        return res[0].id;
      }
    }

    // --- STEP 3: EditorAccount ---
    if (rowData.EditorAccount) {
      const account = this.extractAccountOnly(rowData.EditorAccount);
      // logger.info(`[strictUserResolver] STEP 3: Checking EditorAccount "${rowData.EditorAccount}" -> Extracted: "${account}"`);
      const res = await this.queryNewDbTx(selectQuery, { val: account }, transaction);
      if (res?.length) {
        // logger.info(`[strictUserResolver] >> SUCCESS: Found UID ${res[0].id} (${res[0].name})`);
        return res[0].id;
      }
    }

    // --- STEP 4: EditorName ---
    if (rowData.EditorName) {
      const cleanName = this.extractDisplayName(rowData.EditorName);
      // logger.info(`[strictUserResolver] STEP 4: Checking EditorName "${rowData.EditorName}" -> Clean: "${cleanName}"`);
      const res = await this.queryNewDbTx(selectQuery, { val: cleanName }, transaction);
      if (res?.length) {
        // logger.info(`[strictUserResolver] >> SUCCESS: Found UID ${res[0].id} (${res[0].name})`);
        return res[0].id;
      }
    }

    logger.warn(`[strictUserResolver] !! ALL STEPS FAILED for Record ${recordId}. Returning NULL.`);
    return null;
  }

  /**
   * Hàm mới chuyên dành cho Meeting: Tìm kiếm bằng LIKE và KHÔNG tự tạo user mới.
   */
  async mapUserWithLikeSearch(userIdOrName, transaction = null) {
    try {
      if (!userIdOrName || typeof userIdOrName !== 'string') return userIdOrName;
      const trimmed = userIdOrName.trim();
      if (!trimmed) return userIdOrName;

      // 1. Tìm thông thường (Khớp ID hoặc chính xác tên)
      const coreName = this.extractCoreName(trimmed);
      if (!coreName) return null;

      const selectQuery = `
            SELECT TOP 1 id, name, username
            FROM ${process.env.NEW_DB_NAME}.dbo.users
            WHERE name = @name OR id = @name OR username = @name
          `;
      const existing = await this.queryNewDbTx(selectQuery, { name: coreName }, transaction);
      if (existing?.length) {
        //   logger.info(`[mapUserWithLikeSearch] KHỚP CHÍNH XÁC: "${coreName}" -> User: ${existing[0].name} (ID: ${existing[0].id})`);
        return existing[0].id;
      }

      // 2. Nếu không thấy, tìm kiếm bằng LIKE
      const likeQuery = `
            SELECT TOP 1 id, name, username
            FROM ${process.env.NEW_DB_NAME}.dbo.users
            WHERE name LIKE '%' + @name + '%'
          `;
      const likeResult = await this.queryNewDbTx(likeQuery, { name: coreName }, transaction);
      if (likeResult?.length) {
        //   logger.info(`[mapUserWithLikeSearch] KHỚP LIKE: "${coreName}" -> User: ${likeResult[0].name} (ID: ${likeResult[0].id})`);
        return likeResult[0].id;
      }

      logger.warn(`[mapUserWithLikeSearch] KHÔNG TÌM THẤY: "${coreName}". Trả về null.`);
      return null;
    } catch (err) {
      logger.error(`[mapUserWithLikeSearch] Lỗi: ${err.message}`);
      return null;
    }
  }

  /**
   * DÀNH RIÊNG CHO PASSPORT: Giải quyết User theo mức độ ưu tiên:
   * 1. UserId (id_user_bak hoặc id)
   * 2. LoginName (tách account) -> username hoặc code_nd
   * 3. Email (tách prefix) -> email_user hoặc code_nd
   * 4. FullName (extract name) -> name
   */
  async passportUserResolver(identityObj, transaction = null) {
    if (!identityObj) return null;

    // Mapping SharePoint fields to standard identities
    const userId = identityObj.UserId || identityObj.AuthorId;
    const loginName = identityObj.LoginName || identityObj.AuthorAccount;
    const email = identityObj.Email || identityObj.AuthorEmail;
    const fullName = identityObj.FullName || identityObj.AuthorName || identityObj.AuthorFullName || identityObj.name_passport_request;

    const db = process.env.NEW_DB_NAME || 'DiOffice';

    // ★ BƯỚC ƯU TIÊN 1: Tìm bằng Email đầy đủ (So khớp email_user) theo yêu cầu mới
    if (email && typeof email === 'string' && email.includes('@')) {
      const emailQuery = `SELECT TOP 1 id FROM [${db}].[dbo].[users] WHERE LTRIM(RTRIM(email_user)) = @email`;
      const emailRes = await this.queryNewDbTx(emailQuery, { email: email.trim() }, transaction);
      if (emailRes?.length) return emailRes[0].id;
    }

    const selectQuery = `
      SELECT TOP 1 id, name, username, code_nd
      FROM [${db}].[dbo].[users]
      WHERE id = @val
         OR id_user_bak = @val
         OR username = @val
         OR code_nd = @val
         OR email_user = @val
         OR name = @val
    `;

    // 1. Theo UserId
    if (userId) {
      const val = String(userId).trim();
      if (val) {
        const res = await this.queryNewDbTx(selectQuery, { val }, transaction);
        if (res?.length) return res[0].id;
      }
    }

    // 2. Theo LoginName (Account)
    if (loginName) {
      const account = this.extractAccountOnly(loginName);
      if (account) {
        const res = await this.queryNewDbTx(selectQuery, { val: account }, transaction);
        if (res?.length) return res[0].id;
      }
    }

    // 3. Theo Email (Prefix)
    if (email) {
      const prefix = this.extractEmailPrefix(email);
      if (prefix) {
        const res = await this.queryNewDbTx(selectQuery, { val: prefix }, transaction);
        if (res?.length) return res[0].id;
      }
    }


    // 4. Theo FullName
    if (fullName) {
      const cleanName = this.extractDisplayName(fullName);
      if (cleanName) {
        const res = await this.queryNewDbTx(selectQuery, { val: cleanName }, transaction);
        if (res?.length) return res[0].id;

        // Bonus: Try without suffix mapping if still not found
        const namePart = cleanName.split(/\s*[-–—(]\s*/)[0].trim();
        if (namePart !== cleanName) {
          const res2 = await this.queryNewDbTx(selectQuery, { val: namePart }, transaction);
          if (res2?.length) return res2[0].id;
        }
      }
    }

    return null;
  }

  /**
   * MỚI: Hàm giải quyết User "siêu cấp" với 6 bước ưu tiên.
   * Chuyên dùng cho Meeting để tìm Creator/Chairman.
   */
  async robustUserResolver(rowData, transaction = null) {
    const defaultVanthuId = process.env.VANTHU_USER_ID || 'eac9bcb6-efcd-4b23-a656-dd351037a138';
    const selectQuery = `
      SELECT TOP 1 id, name, username, code_nd
      FROM ${process.env.NEW_DB_NAME || 'DiOffice'}.dbo.users
      WHERE name = @val OR username = @val OR code_nd = @val OR id_user_bak = @val
    `;

    // --- STEP 1: AuthorAccount ---
    if (rowData.AuthorAccount) {
      const account = this.extractAccountOnly(rowData.AuthorAccount);
      const res = await this.queryNewDbTx(selectQuery, { val: account }, transaction);
      if (res?.length) return res[0].id;
    }

    // --- STEP 2: AuthorName ---
    if (rowData.AuthorName) {
      const cleanName = this.extractDisplayName(rowData.AuthorName);
      const res = await this.queryNewDbTx(selectQuery, { val: cleanName }, transaction);
      if (res?.length) return res[0].id;
    }

    // --- STEP 3: nvarchar4 (Chairman Name with LIKE) ---
    const chairmanSrc = rowData.nvarchar4 || rowData.Organizer;
    if (chairmanSrc) {
      const cleanName = (typeof this.cleanTitleFromName === 'function')
        ? this.cleanTitleFromName(chairmanSrc)
        : chairmanSrc.split(/\s*[-–—(]\s*/)[0].trim();
      const likeQuery = `SELECT TOP 1 id FROM ${process.env.NEW_DB_NAME || 'DiOffice'}.dbo.users WHERE name LIKE '%' + @name + '%'`;
      const res = await this.queryNewDbTx(likeQuery, { name: cleanName }, transaction);
      if (res?.length) return res[0].id;
    }

    return defaultVanthuId;
  }

  extractAccountOnly(value) {
    if (!value || typeof value !== 'string') return value;
    const lastPipe = value.lastIndexOf('|');
    if (lastPipe !== -1) return value.substring(lastPipe + 1).trim();
    return value.trim();
  }

  extractEmailPrefix(value) {
    if (!value || typeof value !== 'string') return value;
    const atIndex = value.indexOf('@');
    if (atIndex !== -1) return value.substring(0, atIndex).trim();
    return value.trim();
  }

  extractDisplayName(value) {
    if (!value || typeof value !== 'string') return value;
    // Bỏ các tiền tố như "Võ Phương Châm - MKT" -> "Võ Phương Châm"
    const clean = value.split(/\s*[-–—(]\s*/)[0].trim();
    return clean.replace(/^(Đ\/c\.|Đ\/c|Ông|Bà|Anh|Chị|Đồng chí|Đại tá|Thượng tá)\s+/i, "").trim();
  }

  cleanTitleFromName(value) {
    if (!value || typeof value !== 'string') return value;
    const clean = value
      .replace(/^(PTGĐ|GĐ|Trưởng phòng|Phó phòng|Đ\/c|Ông|Bà|Anh|Chị|Đồng chí|Đại tá|Thượng tá)\s+/i, "")
      .split(/\s*[-–—(]\s*/)[0] // Lấy phần trước dấu gạch ngang hoặc ngoặc
      .trim();
    return clean;
  }

  extractCoreName(value) {
    let name = this.extractDisplayName(value);
    if (!name) return null;
    // Loại bỏ tiền tố danh xưng Việt Nam
    name = name.replace(/^(Đ\/c\.|Đ\/c|Ông|Bà|Anh|Chị|Đồng chí)\s+/i, "").trim();
    return name;
  }

  normalizeVietnameseText(value) {
    if (value == null) return '';
    return String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .trim()
      .toLowerCase();
  }

  async findUserByIdentity(identity, transaction = null) {
    const value = this.safeString(identity);
    if (!value) return null;

    try {
      const query = `
        SELECT TOP 1 id, name, username, code_nd, id_user_bak, email_user
        FROM ${process.env.NEW_DB_NAME}.dbo.users
        WHERE id = @val
           OR id_user_bak = @val
           OR username = @val
           OR code_nd = @val
           OR email_user = @val
           OR name = @val
      `;

      const result = await this.queryNewDbTx(query, { val: value }, transaction);
      return result?.length ? result[0] : null;
    } catch (error) {
      logger.warn(`[findUserByIdentity] Error for "${value}": ${error.message}`);
      return null;
    }
  }

  async resolvePassportAuditActor(auditItem = {}, transaction = null) {
    const userId = await this.passportUserResolver(auditItem, transaction);
    const fullName = this.extractDisplayName(auditItem.FullName || '');
    const account = this.extractAccountOnly(auditItem.LoginName || '');
    return {
      id: userId,
      displayName: fullName || account || auditItem.Email || 'Unknown',
      username: account,
      code_nd: this.extractEmailPrefix(auditItem.Email) || account,
      matched: !!userId
    };
  }

  buildPassportAuditMetaFromNtext2(auditItem = {}) {
    const rawValue = this.safeString(auditItem.Value) || '';
    const normalized = this.normalizeVietnameseText(rawValue);
    const compact = normalized.replace(/\s+/g, ' ');

    if (!rawValue) {
      return {
        role: 'NGUOI_XU_LY',
        roleProcess: 'NGUOI_XU_LY',
        actionCode: 'COMMENT',
        fromNodeId: null,
        toNodeId: null,
        actionLabel: null,
        curStatusCode: 'COMMENT',
        stageStatus: 'DA_XU_LY',
        details: null
      };
    }

    const approvePatterns = [
      'dong y',
      'nhat tri',
      'phe duyet',
      'duyet',
      'chap thuan',
      'tao dieu kien',
      'dong y giai quyet',
      'dong y voi de nghi',
      'approve'
    ];

    const rejectPatterns = [
      'tu choi',
      'khong dong y',
      'reject'
    ];

    const handoverPatterns = [
      'xac nhan muon',
      'da nhan hc',
      'nhan tra ho chieu',
      'da tra',
      'da hoan tra',
      'hoan tra ho chieu',
      'da nhan lai',
      'da nhan ho chieu',
      'da nop lai',
      'nhan lai ho chieu',
      'tct da nhan ho chieu',
      'van phong tct da nhan ho chieu',
      'da nhan ngay',
      'da nhan lai ngay',
      'nhan ho chieu moi',
      'tra lai ho chieu',
      'tra lai nguoi lao dong',
      'ho chieu het han',
      'ho chieu sap het han'
    ];

    const hasAnyPattern = (patterns) => patterns.some((pattern) => compact.includes(pattern));

    if (hasAnyPattern(rejectPatterns)) {
      return {
        role: 'CHI_HUY_DON_VI',
        roleProcess: 'CHI_HUY_DON_VI',
        actionCode: 'REJECT',
        fromNodeId: 'Gateway_0rbwxs6',
        toNodeId: 'Gateway_0rbwxs6',
        actionLabel: 'Từ chối',
        curStatusCode: 'REJECT',
        stageStatus: 'DA_XU_LY',
        details: rawValue
      };
    }

    if (
      hasAnyPattern(approvePatterns)
    ) {
      return {
        role: 'CHI_HUY_DON_VI',
        roleProcess: 'CHI_HUY_DON_VI',
        actionCode: 'APPROVE',
        fromNodeId: 'Gateway_0rbwxs6',
        toNodeId: 'Gateway_0fkk071',
        actionLabel: 'Phê duyệt',
        curStatusCode: 'APPROVE',
        stageStatus: 'DA_XU_LY',
        details: rawValue
      };
    }

    if (compact.includes('chuyen xu ly')) {
      return {
        role: 'NGUOI_XU_LY',
        roleProcess: 'NGUOI_XU_LY',
        actionCode: 'COMMENT',
        fromNodeId: 'Gateway_0rbwxs6',
        toNodeId: null,
        actionLabel: rawValue.length > 255 ? rawValue.substring(0, 255) : rawValue,
        curStatusCode: 'COMMENT',
        stageStatus: 'DA_XU_LY',
        details: rawValue
      };
    }

    if (compact.includes('chuyen tiep') || compact.includes('forward')) {
      return {
        role: 'CHI_HUY_DON_VI',
        roleProcess: 'CHI_HUY_DON_VI',
        actionCode: 'FORWARD',
        fromNodeId: 'Gateway_0rbwxs6',
        toNodeId: 'Gateway_0fkk071',
        actionLabel: 'Chuyển tiếp',
        curStatusCode: 'FORWARD',
        stageStatus: 'DA_XU_LY',
        details: rawValue
      };
    }

    if (normalized.includes('huy') || normalized.includes('thu hoi') || normalized === 'cancel') {
      return {
        role: 'NGUOI_XU_LY',
        roleProcess: 'NGUOI_XU_LY',
        actionCode: 'CANCEL',
        fromNodeId: 'Gateway_0rbwxs6',
        toNodeId: 'EndEvent_1',
        actionLabel: normalized.includes('thu hoi') ? 'Thu hồi' : 'Hủy phiếu',
        curStatusCode: 'CANCEL',
        stageStatus: 'DA_XU_LY',
        details: rawValue
      };
    }

    if (hasAnyPattern(handoverPatterns)) {
      return {
        role: 'NGUOI_XU_LY',
        roleProcess: 'NGUOI_XU_LY',
        actionCode: 'COMMENT',
        fromNodeId: null,
        toNodeId: null,
        actionLabel: rawValue.length > 255 ? rawValue.substring(0, 255) : rawValue,
        curStatusCode: 'COMMENT',
        stageStatus: 'DA_XU_LY',
        details: rawValue
      };
    }

    return {
      role: 'NGUOI_XU_LY',
      roleProcess: 'NGUOI_XU_LY',
      actionCode: 'COMMENT',
      fromNodeId: null,
      toNodeId: null,
      actionLabel: rawValue.length > 255 ? rawValue.substring(0, 255) : rawValue,
      curStatusCode: 'COMMENT',
      stageStatus: 'DA_XU_LY',
      details: rawValue
    };
  }

  /**
   * Chuyên dùng để ánh xạ trường người soạn thảo/người ký.
   * Ưu tiên tìm theo ID backup, sau đó mới dùng đến logic mapUserName (tên/sync).
   */
  async mapUserDrafter(userIdOrName, transaction = null) {
    if (!userIdOrName) return null;
    const trimmed = String(userIdOrName).trim();
    if (!trimmed) return null;

    // 1. Thử tìm nhanh theo mã id_user_bak hoặc ID thật (dùng hàm chuyên biệt)
    const user = await this.findUserByBakId(trimmed, transaction);
    if (user) return user.id;

    // 2. Không thấy thì dùng logic mapUserName (xử lý tên, sync từ old DB...)
    return await this.mapUserName(trimmed, transaction);
  }

  /**
   * Tìm kiếm user dựa trên id_user_bak hoặc id hiện tại.
   * Lấy đầy đủ các cột theo yêu cầu.
   */
  async findUserByBakId(bakId, transaction = null) {
    if (!bakId) return null;
    try {
      const query = `
        SELECT id, password, name, avatar, code_nd, username, email_user, phone_number_user, [position], leader, address_user, description, [role], roles_by_process, organization_name, organization_code, organization_type, orders, birthday, gender, identification_card, contact_time, parent, wso2_user_id, keycloak_user_id, status, name_authorized, role_group_source_authorized, created_at, updated_at, contentSignImage, paraphSignImage, author, id_user_bak, AccountID, FullName, Department, DepartmentId, PhongBanID, SimKySo1, SimKySo2, DepartmentManager, IsTCT, ImagePath, SignImage, SignImageSmall, table_backups, id_user_del_bak, paraphSignTransparentImage, contentSignTransparentImage, stampSignImage
        FROM ${process.env.NEW_DB_NAME || 'app_tancang'}.dbo.users
        WHERE id_user_bak = @bakId OR id = @bakId;
      `;
      const result = await this.queryNewDbTx(query, { bakId }, transaction);
      if (result?.length > 0) {
        return result[0];
      }
      return null;
    } catch (error) {
      logger.error(`[findUserByBakId] Lỗi cho bakId "${bakId}":`, error.message);
      return null;
    }
  }

  /**
   * Tìm mã nhân viên (username) dựa trên tên đầy đủ
   * @param {string} fullName Tên đầy đủ (có thể kèm chức danh)
   */
  async findUserCodeByName(fullName) {
    try {
      if (!fullName) return null;
      const displayName = this.extractDisplayName(fullName);
      if (!displayName) return null;

      const query = `
        SELECT TOP 1 username
        FROM ${process.env.NEW_DB_NAME}.dbo.users
        WHERE LTRIM(RTRIM(name)) = @name
           OR LTRIM(RTRIM(username)) = @name
      `;
      const result = await this.queryNewDbTx(query, { name: displayName });
      return result?.length ? result[0].username : null;
    } catch (error) {
      logger.error(`[findUserCodeByName] Lỗi tìm mã NV cho "${fullName}":`, error.message);
      return null;
    }
  }

  /**
   * Tìm ID người dùng dựa trên tên đầy đủ
   */
  async _getUserMigrator() {
    if (this._userMigrator) return this._userMigrator;
    try {
      const StreamUserMigrationModel = require('../sync-user-copy/migrate/StreamUserMigrationModel');
      this._userMigrator = new StreamUserMigrationModel();
      await this._userMigrator.initialize();
      return this._userMigrator;
    } catch (err) {
      logger.error(`[_getUserMigrator] Failed to load UserMigrator: ${err.message}`);
      return null;
    }
  }

  async findUserIdByName(fullName, transaction = null) {
    try {
      if (!fullName) return null;
      const displayName = this.extractDisplayName(fullName);
      if (!displayName) return null;

      // 1. Search in New DB
      const result = await this.queryNewDbTx(
        `SELECT TOP 1 id FROM ${process.env.NEW_DB_NAME}.dbo.users WHERE name = @name OR username = @name OR code_nd = @name`,
        { name: displayName },
        transaction
      );
      if (result?.length) return result[0].id;

      // 2. Search in Old DB to Auto-Sync (ONLY for this specific function)
      if (this.queryOldDb) {
        const oldRows = await this.queryOldDb(
          `SELECT TOP 1 * FROM dbo.PersonalProfile WHERE FullName = @name OR AccountID = @name OR StaffID = @name`,
          { name: displayName }
        );
        if (oldRows?.length > 0) {
          const migrator = await this._getUserMigrator();
          if (migrator) {
            const syncRes = await migrator.upsertUserById(oldRows[0], transaction);
            if (syncRes?.id) return syncRes.id;
          }
        }
      }

      return null;
    } catch (error) {
      logger.error(`[findUserIdByName] Error for "${fullName}":`, error.message);
      return null;
    }
  }

  /**
   * Search user by name WITHOUT creating/syncing.
   * If not found, returns DEFAULT_USER_ID and logs an error to the job.
   */
  async findUserIdByNameOnly(fullName, options = {}, transaction = null) {
    try {
      if (!fullName) return null;
      const displayName = this.extractDisplayName(fullName);
      if (!displayName) return null;

      // 1. Search in New DB
      const query = `
        SELECT TOP 1 id, name
        FROM ${process.env.NEW_DB_NAME}.dbo.users
        WHERE LTRIM(RTRIM(name)) = @name
           OR LTRIM(RTRIM(username)) = @name
           OR LTRIM(RTRIM(code_nd)) = @name
      `;
      const result = await this.queryNewDbTx(query, { name: displayName }, transaction);
      if (result?.length) {
        return result[0].id;
      }

      // 2. Not found -> Log to job error and return default
      const defaultId = process.env.DEFAULT_USER_ID || 'b23406e3-5c75-41d3-91e0-1654293ae6b2';

      const msg = `User lookup failed for "${displayName}". Using default ID.`;
      logger.warn(`[findUserIdByNameOnly] ${msg}`);

      if (options.syncJobId) {
        try {
          await SyncStateRepository.logError(
            options.syncJobId,
            options.recordId || null,
            msg
          );
        } catch (logErr) {
          logger.error(`[findUserIdByNameOnly] Failed to log job error: ${logErr.message}`);
        }
      }

      return defaultId;
    } catch (error) {
      logger.error(`[findUserIdByNameOnly] Lỗi tìm ID cho "${fullName}":`, error.message);
      return process.env.DEFAULT_USER_ID || 'b23406e3-5c75-41d3-91e0-1654293ae6b2';
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

      if (raw.toUpperCase() === "NULL") return null;

      // SharePoint format id;#name
      if (raw.includes(";#")) {
        const parts = raw.split(";#");
        if (parts.length >= 2) {
          raw = parts[1].trim();
        }
      }

      // 🔹 Remove chức danh sau dấu -
      // Hỗ trợ: -, –, —
      raw = raw.split(/\s*[-–—]\s*/)[0].trim();

      // 🔹 Remove nội dung trong ()
      raw = raw.replace(/\(.*?\)/g, "").trim();

      if (!raw) return null;

      return raw;

    } catch {
      return null;
    }
  }

  buildAbbreviatedCode(name) {
    if (!name) return null;
    return this.removeVietnameseTones(name)
      .toLowerCase()
      .split(/\s+/)
      .filter(part => part.length > 0)
      .map(part => part[0])
      .join('');
  }

  buildUsernameFromName(name) {
    return this.buildAbbreviatedCode(name);
  }

  normalizeMeetingRoomName(name) {
    if (!name || typeof name !== 'string') return '';

    return this.removeVietnameseTones(this.cleanText(name))
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  tokenizeMeetingRoomName(name) {
    const normalized = this.normalizeMeetingRoomName(name);
    if (!normalized) return [];

    return normalized
      .replace(/([a-z])(\d)/g, '$1 $2')
      .replace(/(\d)([a-z])/g, '$1 $2')
      .split(/\s+/)
      .filter(Boolean);
  }

  expandMeetingRoomTokens(tokens = []) {
    const expandedTokens = [];
    const tokenMap = new Map([
      ['ht', ['hoi', 'truong']],
      ['htr', ['hoi', 'truong']],
      ['hoitruong', ['hoi', 'truong']],
      ['p', ['phong']],
      ['ph', ['phong']],
      ['phg', ['phong']],
      ['phonghop', ['phong', 'hop']],
      ['phophop', ['phong', 'hop']],
      ['php', ['phong', 'hop']],
      ['meetingroom', ['phong', 'hop']],
      ['room', ['phong']],
      ['mtg', ['meeting']]
    ]);

    for (const token of tokens) {
      if (!token) continue;
      const mapped = tokenMap.get(token);
      if (mapped?.length) {
        expandedTokens.push(...mapped);
      } else {
        expandedTokens.push(token);
      }
    }

    return expandedTokens;
  }

  buildMeetingRoomMatchProfile(name) {
    const originalName = this.cleanText(name);
    const tokens = this.tokenizeMeetingRoomName(originalName);
    const expandedTokens = this.expandMeetingRoomTokens(tokens);
    const normalized = this.normalizeMeetingRoomName(originalName);
    const compact = normalized.replace(/\s+/g, '');
    const canonical = expandedTokens.join(' ').trim();
    const canonicalCompact = canonical.replace(/\s+/g, '');
    const acronym = expandedTokens
      .map((token) => (/^\d+$/.test(token) ? token : token[0]))
      .join('');

    return {
      originalName,
      normalized,
      compact,
      canonical,
      canonicalCompact,
      acronym
    };
  }

  getMeetingRoomMatchScore(inputProfile, existingProfile) {
    if (!inputProfile?.normalized || !existingProfile?.normalized) return 0;

    if (inputProfile.normalized === existingProfile.normalized) return { score: 100, reason: 'normalized_exact' };
    if (inputProfile.compact && inputProfile.compact === existingProfile.compact) return { score: 98, reason: 'compact_exact' };
    if (inputProfile.canonical && inputProfile.canonical === existingProfile.canonical) return { score: 96, reason: 'canonical_exact' };
    if (inputProfile.canonicalCompact && inputProfile.canonicalCompact === existingProfile.canonicalCompact) {
      return { score: 94, reason: 'canonical_compact_exact' };
    }

    if (
      inputProfile.normalized === existingProfile.canonical ||
      inputProfile.canonical === existingProfile.normalized
    ) {
      return { score: 92, reason: 'normalized_canonical_cross' };
    }

    if (
      inputProfile.compact === existingProfile.canonicalCompact ||
      inputProfile.canonicalCompact === existingProfile.compact
    ) {
      return { score: 90, reason: 'compact_canonical_cross' };
    }

    if (!inputProfile.acronym || !existingProfile.acronym) return { score: 0, reason: null };

    if (
      inputProfile.acronym === existingProfile.acronym ||
      inputProfile.compact === existingProfile.acronym ||
      inputProfile.acronym === existingProfile.compact ||
      inputProfile.canonicalCompact === existingProfile.acronym ||
      inputProfile.acronym === existingProfile.canonicalCompact
    ) {
      return { score: 80, reason: 'acronym_match' };
    }

    return { score: 0, reason: null };
  }

  findBestMeetingRoomMatch(roomName, existingRooms = []) {
    const inputProfile = this.buildMeetingRoomMatchProfile(roomName);
    if (!inputProfile.normalized) {
      return { match: null, score: 0, ambiguous: false };
    }

    let bestMatch = null;
    let bestScore = 0;
    let ambiguous = false;

    for (const existingRoom of existingRooms) {
      const { score, reason } = this.getMeetingRoomMatchScore(inputProfile, existingRoom);
      if (score <= 0) continue;

      if (score > bestScore) {
        bestMatch = { ...existingRoom, _matchReason: reason };
        bestScore = score;
        ambiguous = false;
        continue;
      }

      if (score === bestScore && bestMatch && existingRoom.id !== bestMatch.id) {
        if (bestScore < 90) {
          ambiguous = true;
          continue;
        }

        if ((existingRoom.name || '').length < (bestMatch.name || '').length) {
          bestMatch = { ...existingRoom, _matchReason: reason };
        }
      }
    }

    if (!bestMatch) {
      return { match: null, score: 0, ambiguous: false };
    }

    if (ambiguous && bestScore < 90) {
      return { match: null, score: bestScore, ambiguous: true };
    }

    return { match: bestMatch, score: bestScore, ambiguous };
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

      // 0. Ensure schema
      await this.ensureColumnsExist(process.env.NEW_DB_NAME, 'book_documents', { tb_bak: 'INT DEFAULT 0' });

      const selectQuery = `
        SELECT TOP 1 book_document_id AS id, count
        FROM ${process.env.NEW_DB_NAME}.dbo.book_documents
        WHERE LTRIM(RTRIM(name)) = @name
      `;

      let result = await this.queryNewDbTx(selectQuery, { name: normalized });

      if (result?.length > 0) {
        const selectQuery = `
        UPDATE ${process.env.NEW_DB_NAME}.dbo.book_documents
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
        INSERT INTO ${process.env.NEW_DB_NAME}.dbo.book_documents (
          name, [year], status, type_document, sender_unit, private_level, count, created_at, updated_at, created_by, tb_bak
        )
        OUTPUT INSERTED.book_document_id
        VALUES (@name, @year, 1, N'OutGoingDocument', @sender_unit, @private_level, 1, GETDATE(), GETDATE(), @created_by, 1)
      `;

      try {
        const insertResult = await this.queryNewDbTx(insertQuery, {
          name: normalized, year, sender_unit: senderUnit, private_level: privateLevel, created_by: drafter
        });

        logger.warn(`[mapBookDocument] Insert new book document: ${insertResult[0].book_document_id}`);
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
        FROM ${process.env.NEW_DB_NAME}.dbo.crm_sources
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
        FROM ${process.env.NEW_DB_NAME}.dbo.crm_source_data
        WHERE source_id = @sourceId AND value = @value
      `;
      const existing = await this.queryNewDbTx(checkQuery, { sourceId, value });

      if (existing.length > 0) {
        return existing[0].value;
      }

      // 0. Ensure schema
      await this.ensureColumnsExist(process.env.NEW_DB_NAME, 'crm_source_data', { tb_bak: 'INT DEFAULT 0' });

      const id = uuidv4();
      const insertQuery = `
        INSERT INTO ${process.env.NEW_DB_NAME}.dbo.crm_source_data (id, source_id, title, value, createdAt, updatedAt, tb_bak)
        VALUES (@id, @sourceId, @title, @value, GETDATE(), GETDATE(), 1)
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

  async createOnlineMeeting(meetingId, platform, transaction = null) {
    // 0. Ensure schema
    await this.ensureColumnsExist(process.env.NEW_DB_NAME, 'online_meetings', { tb_bak: 'INT DEFAULT 0' });

    const checkQuery = `
      SELECT TOP 1 id
      FROM ${process.env.NEW_DB_NAME}.dbo.online_meetings
      WHERE meeting_id = @meetingId
    `;

    const existed = await this.queryNewDbTx(
      checkQuery,
      { meetingId },
      transaction
    );

    let onlineMeetingId;

    if (existed?.length) {
      onlineMeetingId = existed[0].id;
    } else {

      const insertQuery = `
        INSERT INTO ${process.env.NEW_DB_NAME}.dbo.online_meetings
          (platform, meeting_link, meeting_id, tb_bak)
        OUTPUT INSERTED.id
        VALUES
          (@platform, @meetingLink, @meetingId, 1)
      `;

      const insertResult = await this.queryNewDbTx(
        insertQuery,
        {
          platform,
          meetingLink: 'https://zoom.us/',
          meetingId
        },
        transaction
      );

      onlineMeetingId = insertResult?.[0]?.id;
    }

    // 🔥 UPDATE NGƯỢC LẠI MEETINGS
    if (onlineMeetingId) {
      const updateMeetingQuery = `
        UPDATE ${process.env.NEW_DB_NAME}.dbo.meetings
        SET online_meeting_id = @onlineMeetingId,
            meeting_mode = 'ONLINE'
        WHERE id = @meetingId
      `;

      await this.queryNewDbTx(
        updateMeetingQuery,
        { onlineMeetingId, meetingId },
        transaction
      );
    }

    return onlineMeetingId;
  }

  async createRecurrenceKhong(meetingId, startDate, transaction = null) {

    // 0. Ensure schema
    await this.ensureColumnsExist(process.env.NEW_DB_NAME, 'meeting_recurrences', { tb_bak: 'INT DEFAULT 0' });

    const checkQuery = `
      SELECT TOP 1 id
      FROM ${process.env.NEW_DB_NAME}.dbo.meeting_recurrences
      WHERE meeting_id = @meetingId
    `;

    const existed = await this.queryNewDbTx(
      checkQuery,
      { meetingId },
      transaction
    );

    let recurrenceId;

    if (existed?.length) {

      recurrenceId = existed[0].id;

    } else {

      const insertQuery = `
        INSERT INTO ${process.env.NEW_DB_NAME}.dbo.meeting_recurrences
          (meeting_id, [type], start_date, end_date,
          days_of_week, day_of_month, day_of_year, interval_value, tb_bak)
        OUTPUT INSERTED.id
        VALUES
          (@meetingId, 'KHONG', @startDate, NULL,
          NULL, NULL, NULL, NULL, 1)
      `;

      const insertResult = await this.queryNewDbTx(
        insertQuery,
        { meetingId, startDate },
        transaction
      );

      recurrenceId = insertResult?.[0]?.id;
    }

    return recurrenceId;
  }
  async mapMeetingRoom(roomName, transaction = null) {
    try {
      if (!roomName || typeof roomName !== 'string') {
        return roomName;
      }

      // 🔥 Tách nhiều phòng theo ;
      const roomList = roomName
        .split(';')
        .map(r => this.cleanText(r))
        .filter(Boolean);

      if (!roomList.length) return null;

      // 0. Ensure schema
      await this.ensureColumnsExist(process.env.NEW_DB_NAME, 'meeting_rooms', { tb_bak: 'INT DEFAULT 0' });

      const roomTable = `${process.env.NEW_DB_NAME}.dbo.meeting_rooms`;
      const existingRooms = await this.queryNewDbTx(
        `
          SELECT id, name
          FROM ${roomTable}
          WHERE name IS NOT NULL
        `,
        {},
        transaction
      );
      const existingRoomProfiles = (existingRooms || []).map((existingRoom) => ({
        id: existingRoom.id,
        name: existingRoom.name,
        ...this.buildMeetingRoomMatchProfile(existingRoom.name)
      }));

      const ids = [];
      const seenNormalizedNames = new Set();

      for (const room of roomList) {
        const normalizedRoomName = this.normalizeMeetingRoomName(room);
        if (!normalizedRoomName || seenNormalizedNames.has(normalizedRoomName)) {
          continue;
        }
        seenNormalizedNames.add(normalizedRoomName);

        const { match: matchedRoom, score, ambiguous } = this.findBestMeetingRoomMatch(
          room,
          existingRoomProfiles
        );

        if (matchedRoom?.id) {
          //   logger.info(
          //     `[mapMeetingRoom] Reusing room "${matchedRoom.name}" for "${room}" (score=${score}, reason=${matchedRoom._matchReason || 'unknown'})`
          //   );
          ids.push(matchedRoom.id);
          continue;
        }

        if (ambiguous) {
          logger.warn(`[mapMeetingRoom] Ambiguous room match for "${room}", creating new room skipped exact reuse.`);
        }

        // Chưa có → tạo mới
        const id = uuidv4();

        const insertQuery = `
          INSERT INTO ${roomTable} (
            id,
            name,
            location,
            capacity,
            status,
            stage,
            available_from,
            created_at,
            updated_at,
            total_seating,
            tb_bak
          )
          VALUES (
            @id,
            @name,
            @location,
            @capacity,
            1,
            1,
            NULL,
            SYSUTCDATETIME(),
            SYSUTCDATETIME(),
            @capacity,
            1
          )
        `;

        try {
          await this.queryNewDbTx(
            insertQuery,
            {
              id,
              name: room,
              location: null,
              capacity: 20
            },
            transaction
          );

          logger.warn(`[mapMeetingRoom] Created new room: ${room}`);
          existingRoomProfiles.push({
            id,
            name: room,
            ...this.buildMeetingRoomMatchProfile(room)
          });
          ids.push(id);

        } catch (err) {
          // race condition fallback
          const retry = await this.queryNewDbTx(
            `
              SELECT id, name
              FROM ${roomTable}
              WHERE name IS NOT NULL
            `,
            {},
            transaction
          );

          const retryProfiles = (retry || []).map((item) => ({
            id: item.id,
            name: item.name,
            ...this.buildMeetingRoomMatchProfile(item.name)
          }));
          const { match: retryMatched } = this.findBestMeetingRoomMatch(room, retryProfiles);

          if (retryMatched?.id) {
            existingRoomProfiles.push({
              id: retryMatched.id,
              name: retryMatched.name,
              ...this.buildMeetingRoomMatchProfile(retryMatched.name)
            });
            ids.push(retryMatched.id);
          }
        }
      }

      // 🔥 Nếu hệ thống mày lưu 1 cột string
      return ids.join(',');
    } catch (error) {
      logger.error(`[mapMeetingRoom] Error for roomName "${roomName}":`, error);
      return null;
    }
  }

  // ===========================================================================
  // MINIO UPLOAD
  // Logic: username/password → POST /api/v1/login → token JWT → upload file
  //
  // Config trong .env:
  //   MINIO_URL=https://minio.lifetex.vn   (không có / cuối)
  //   MINIO_BUCKET=tancang
  //   MINIO_USER=admin
  //   MINIO_PASSWORD=yourpassword
  //   MINIO_TOKEN_TTL_MS=3300000           (tuỳ chọn, mặc định 55 phút)
  //
  // Token cache: dùng lại token đến khi hết hạn, tự login lại khi hết.
  // Hàm public: uploadFileWithLogin | uploadFolderWithLogin | uploadFromUrlToMinio
  // ===========================================================================

  /**
   * [PRIVATE] Lấy token MinIO — có cache + kiểm tra TTL.
   *
   * Luồng:
   *   - Cache còn hạn + đúng user/pass → dùng lại, KHÔNG login lại
   *   - Cache hết hạn hoặc chưa có    → login mới → lưu cache kèm expiresAt
   *   - Login thất bại                → xóa cache → throw để hàm gọi xử lý
   *
   * TTL mặc định 55 phút (token MinIO thường sống 60 phút, trừ 5 phút buffer).
   * Override bằng MINIO_TOKEN_TTL_MS trong .env nếu server cấu hình khác.
   *
   * @param {string} username - Tên đăng nhập MinIO Console
   * @param {string} password - Mật khẩu MinIO Console
   * @returns {Promise<string>} Token JWT dùng để upload
   */
  async _getMinioToken(username, password) {
    const now = Date.now();

    // ── Kiểm tra cache ────────────────────────────────────────────────────────
    if (
      this._minioTokenCache &&
      this._minioTokenCache.key === `${username}:${password}` &&
      now < this._minioTokenCache.expiresAt
    ) {
      const remainSec = Math.round((this._minioTokenCache.expiresAt - now) / 1000);
      logger.info(`[MinIO:_getMinioToken] Dùng token cache — còn hạn ${remainSec}s.`);
      return this._minioTokenCache.token;
    }

    // ── Login mới ─────────────────────────────────────────────────────────────
    const minioUrl = (process.env.MINIO_URL || 'https://minio.lifetex.vn').replace(/\/$/, '');
    const loginUrl = `${minioUrl}/api/v1/login`;
    const ttlMs = parseInt(process.env.MINIO_TOKEN_TTL_MS || '') || 55 * 60 * 1000;

    logger.info(`[MinIO:_getMinioToken] Token hết hạn hoặc chưa có — login tại: ${loginUrl}`);

    try {
      const response = await axios.post(
        loginUrl,
        { username, password },
        { headers: { 'Content-Type': 'application/json' } }
      );

      const token = response.data?.token;
      if (!token) {
        // Server trả 200 nhưng không có token trong body
        throw new Error('[MinIO:_getMinioToken] Phản hồi login không chứa token (kiểm tra lại API MinIO).');
      }

      // Lưu cache kèm thời điểm hết hạn
      this._minioTokenCache = {
        key: `${username}:${password}`,
        token,
        expiresAt: now + ttlMs,
      };

      logger.info(`[MinIO:_getMinioToken] Login thành công — token hợp lệ trong ${Math.round(ttlMs / 60000)} phút.`);
      return token;

    } catch (error) {
      // Xóa cache khi login thất bại để lần sau không dùng token cũ
      this._minioTokenCache = null;

      if (error.response) {
        // Lỗi HTTP từ server MinIO (401 sai pass, 500 server lỗi...)
        logger.error(
          `[MinIO:_getMinioToken] Login thất bại — HTTP ${error.response.status}: ` +
          `${JSON.stringify(error.response.data)}`
        );
      } else if (error.request) {
        // Gửi request nhưng không nhận được response (timeout, network...)
        logger.error(`[MinIO:_getMinioToken] Không kết nối được MinIO tại ${loginUrl} — ${error.message}`);
      } else {
        // Lỗi khác (config, logic...)
        logger.error(`[MinIO:_getMinioToken] Lỗi: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * [PRIVATE] Upload một Buffer lên MinIO qua Console API.
   * Không gọi trực tiếp từ ngoài — dùng 3 hàm public bên dưới.
   *
   * Luồng:
   *   - Validate params → build URL upload → POST multipart/form-data
   *   - Nếu server trả 401/403 → xóa cache token → lần sau tự login lại
   *
   * @param {object} params
   * @param {Buffer} params.fileBuffer      - Nội dung file dạng Buffer
   * @param {string} params.filename        - Tên file lưu trên MinIO
   * @param {string} params.token           - Token JWT lấy từ _getMinioToken()
   * @param {string} [params.folderPath=''] - Thư mục đích trong bucket (vd: 'TCSG/van-ban-di')
   * @returns {Promise<object>} Phản hồi từ MinIO API
   */
  async _uploadBufferToMinio({ fileBuffer, filename, token, folderPath = '' }) {
    // ── Validate đầu vào ──────────────────────────────────────────────────────
    if (!fileBuffer) throw new Error('[MinIO:_uploadBufferToMinio] Thiếu fileBuffer.');
    if (!filename) throw new Error('[MinIO:_uploadBufferToMinio] Thiếu filename.');
    if (!token) throw new Error('[MinIO:_uploadBufferToMinio] Thiếu token.');

    const minioUrl = (process.env.MINIO_URL || 'https://minio.lifetex.vn').replace(/\/$/, '');
    const bucket = process.env.MINIO_BUCKET || 'tancang';

    // Build object key: "folderPath/filename" hoặc chỉ "filename" nếu không có folder
    const normalizedFolder = folderPath ? folderPath.replace(/\/$/, '') + '/' : '';
    const objectKey = normalizedFolder + filename;
    const uploadUrl = `${minioUrl}/api/v1/buckets/${bucket}/objects/upload?prefix=${encodeURIComponent(objectKey)}`;

    logger.info(`[MinIO:_uploadBufferToMinio] Uploading → bucket='${bucket}' | key='${objectKey}' | size=${fileBuffer.length} bytes`);

    const form = new FormData();
    form.append('file', fileBuffer, filename);

    try {
      const response = await axios.post(uploadUrl, form, {
        headers: {
          ...form.getHeaders(),
          'token': token,
          'accept': '*/*',
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      logger.info(`[MinIO:_uploadBufferToMinio] Upload OK — key='${objectKey}'`);
      return response.data;

    } catch (error) {
      if (error.response) {
        const status = error.response.status;

        // 401/403: token hết hạn hoặc không hợp lệ → xóa cache để lần sau login lại
        if (status === 401 || status === 403) {
          logger.warn(
            `[MinIO:_uploadBufferToMinio] Token bị từ chối (HTTP ${status}) — ` +
            `xóa cache, sẽ tự login lại lần upload tiếp theo.`
          );
          this._minioTokenCache = null;
        }

        logger.error(
          `[MinIO:_uploadBufferToMinio] Upload thất bại '${objectKey}' — ` +
          `HTTP ${status}: ${JSON.stringify(error.response.data)}`
        );
      } else if (error.request) {
        logger.error(`[MinIO:_uploadBufferToMinio] Không nhận được phản hồi từ MinIO — ${error.message}`);
      } else {
        logger.error(`[MinIO:_uploadBufferToMinio] Lỗi: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * [PUBLIC] Upload một file từ đường dẫn local lên MinIO.
   *
   * Luồng:
   *   1. Lấy credentials (tham số hoặc .env)
   *   2. Kiểm tra file tồn tại
   *   3. Lấy token (cache hoặc login mới)
   *   4. Đọc file → upload
   *
   * @param {object} params
   * @param {string} params.filePath           - Đường dẫn file local cần upload
   * @param {string} [params.username]         - Tên đăng nhập MinIO. Mặc định: MINIO_USER trong .env
   * @param {string} [params.password]         - Mật khẩu MinIO. Mặc định: MINIO_PASSWORD trong .env
   * @param {string} [params.targetFolder='']  - Thư mục đích trong bucket MinIO
   * @returns {Promise<object>} Phản hồi từ MinIO API
   *
   * Ví dụ:
   *   // Dùng .env (khuyến nghị cho migration)
   *   await helper.uploadFileWithLogin({ filePath: '/data/doc.pdf', targetFolder: 'TCSG/vbd' });
   *
   *   // Override credential khi cần
   *   await helper.uploadFileWithLogin({ filePath: '/data/doc.pdf', username: 'u', password: 'p' });
   */
  async uploadFileWithLogin({ filePath, username, password, targetFolder = '' }) {
    logger.info(`[MinIO:uploadFileWithLogin] Bắt đầu — file: '${filePath}' | targetFolder: '${targetFolder || "(root)"}'`);

    try {
      // ── Bước 1: Lấy credentials ───────────────────────────────────────────
      const minioUser = username || process.env.MINIO_USER;
      const minioPass = password || process.env.MINIO_PASSWORD;

      if (!minioUser || !minioPass) {
        throw new Error(
          '[MinIO:uploadFileWithLogin] Thiếu thông tin đăng nhập. ' +
          'Truyền username/password vào hàm hoặc đặt MINIO_USER/MINIO_PASSWORD trong .env'
        );
      }

      // ── Bước 2: Kiểm tra file tồn tại ────────────────────────────────────
      await fs.access(filePath).catch(() => {
        throw new Error(`[MinIO:uploadFileWithLogin] File không tồn tại hoặc không có quyền đọc: '${filePath}'`);
      });

      // ── Bước 3: Lấy token (cache hoặc login mới) ─────────────────────────
      const token = await this._getMinioToken(minioUser, minioPass);

      // ── Bước 4: Đọc file và upload ────────────────────────────────────────
      const fileBuffer = await fs.readFile(filePath);
      const filename = path.basename(filePath);

      logger.info(`[MinIO:uploadFileWithLogin] Đọc file OK — tên: '${filename}' | size: ${fileBuffer.length} bytes`);

      const result = await this._uploadBufferToMinio({
        fileBuffer,
        filename,
        token,
        folderPath: targetFolder,
      });

      logger.info(`[MinIO:uploadFileWithLogin] Hoàn tất — file: '${filePath}'`);
      return result;

    } catch (error) {
      logger.error(`[MinIO:uploadFileWithLogin] Thất bại — file: '${filePath}' | lỗi: ${error.message}`);
      throw error;
    }
  }

  /**
   * [PUBLIC] Upload toàn bộ file trong một thư mục local lên MinIO.
   * Chỉ upload file trực tiếp trong thư mục — KHÔNG đệ quy vào sub-folder.
   * File lỗi sẽ được ghi nhận và tiếp tục, KHÔNG dừng cả batch.
   *
   * Luồng:
   *   1. Lấy credentials
   *   2. Đọc danh sách entries trong thư mục
   *   3. Lấy token 1 lần — mỗi file gọi lại _getMinioToken để tự check TTL
   *   4. Loop từng file: đọc → upload → ghi nhận kết quả
   *   5. Trả về tóm tắt kết quả
   *
   * @param {object} params
   * @param {string} params.localFolderPath    - Đường dẫn thư mục local
   * @param {string} [params.username]         - Tên đăng nhập MinIO. Mặc định: MINIO_USER trong .env
   * @param {string} [params.password]         - Mật khẩu MinIO. Mặc định: MINIO_PASSWORD trong .env
   * @param {string} [params.targetFolder='']  - Thư mục đích trong bucket MinIO
   * @returns {Promise<{success: boolean, totalFiles: number, uploadedCount: number, failedCount: number, failedFiles: Array}>}
   *
   * Ví dụ:
   *   const result = await helper.uploadFolderWithLogin({
   *     localFolderPath: '/data/attachments/2024',
   *     targetFolder: 'TCSG/attachments/2024',
   *   });
   *   console.log(result.message);
   */
  async uploadFolderWithLogin({ localFolderPath, username, password, targetFolder = '' }) {
    logger.info(`[MinIO:uploadFolderWithLogin] Bắt đầu — folder: '${localFolderPath}' | targetFolder: '${targetFolder || "(root)"}'`);

    try {
      // ── Bước 1: Lấy credentials ───────────────────────────────────────────
      const minioUser = username || process.env.MINIO_USER;
      const minioPass = password || process.env.MINIO_PASSWORD;

      if (!minioUser || !minioPass) {
        throw new Error(
          '[MinIO:uploadFolderWithLogin] Thiếu thông tin đăng nhập. ' +
          'Truyền username/password vào hàm hoặc đặt MINIO_USER/MINIO_PASSWORD trong .env'
        );
      }

      // ── Bước 2: Đọc danh sách entries ────────────────────────────────────
      let allEntries;
      try {
        allEntries = await fs.readdir(localFolderPath);
      } catch (readDirError) {
        throw new Error(
          `[MinIO:uploadFolderWithLogin] Không đọc được thư mục '${localFolderPath}' — ${readDirError.message}`
        );
      }

      if (!allEntries.length) {
        logger.warn(`[MinIO:uploadFolderWithLogin] Thư mục rỗng: '${localFolderPath}' — không có gì để upload.`);
        return { success: true, message: 'Thư mục rỗng.', totalFiles: 0, uploadedCount: 0, failedCount: 0, failedFiles: [] };
      }

      logger.info(`[MinIO:uploadFolderWithLogin] Tìm thấy ${allEntries.length} entries trong '${localFolderPath}'.`);

      // ── Bước 3: Lấy token lần đầu ────────────────────────────────────────
      // Mỗi file trong loop đều gọi _getMinioToken → tự check TTL → login lại nếu hết hạn
      let token = await this._getMinioToken(minioUser, minioPass);

      let uploadedCount = 0;
      let failedCount = 0;
      const failedFiles = [];

      // ── Bước 4: Loop từng entry ───────────────────────────────────────────
      for (const entry of allEntries) {
        const entryPath = path.join(localFolderPath, entry);

        // Kiểm tra có phải file không (bỏ qua thư mục con)
        let stat;
        try {
          stat = await fs.stat(entryPath);
        } catch (statError) {
          logger.warn(`[MinIO:uploadFolderWithLogin] Không stat được '${entry}' — bỏ qua. Lỗi: ${statError.message}`);
          continue;
        }

        if (!stat.isFile()) {
          logger.warn(`[MinIO:uploadFolderWithLogin] Bỏ qua '${entry}' (không phải file).`);
          continue;
        }

        try {
          // Check TTL mỗi file — tự login lại nếu token hết hạn giữa batch
          token = await this._getMinioToken(minioUser, minioPass);

          const fileBuffer = await fs.readFile(entryPath);
          await this._uploadBufferToMinio({ fileBuffer, filename: entry, token, folderPath: targetFolder });

          uploadedCount++;
          logger.info(`[MinIO:uploadFolderWithLogin] OK (${uploadedCount}/${allEntries.length}) — '${entry}'`);

        } catch (uploadError) {
          // Ghi nhận lỗi nhưng KHÔNG throw — tiếp tục file tiếp theo
          failedCount++;
          failedFiles.push({ file: entry, error: uploadError.message });
          logger.error(`[MinIO:uploadFolderWithLogin] Lỗi file '${entry}': ${uploadError.message}`);
        }
      }

      // ── Bước 5: Trả về kết quả ────────────────────────────────────────────
      const result = {
        success: failedCount === 0,
        message: `Hoàn tất. Thành công: ${uploadedCount}/${allEntries.length}. Thất bại: ${failedCount}.`,
        totalFiles: allEntries.length,
        uploadedCount,
        failedCount,
        failedFiles,
      };

      if (failedCount > 0) {
        logger.warn(`[MinIO:uploadFolderWithLogin] Danh sách file thất bại: ${JSON.stringify(failedFiles)}`);
      }

      logger.info(`[MinIO:uploadFolderWithLogin] ${result.message}`);
      return result;

    } catch (error) {
      logger.error(`[MinIO:uploadFolderWithLogin] Thất bại nghiêm trọng — folder: '${localFolderPath}' | lỗi: ${error.message}`);
      throw error;
    }
  }

  /**
   * [PUBLIC] Tải file từ URL rồi upload thẳng lên MinIO.
   * Không ghi file tạm xuống đĩa — toàn bộ xử lý trong memory.
   *
   * Luồng:
   *   1. Lấy credentials
   *   2. Lấy token (cache hoặc login mới)
   *   3. GET file từ URL → Buffer
   *   4. Xác định tên file
   *   5. Upload Buffer lên MinIO
   *
   * @param {object} params
   * @param {string} params.url                - URL file cần tải về
   * @param {string} [params.filename]         - Tên file lưu trên MinIO. Nếu bỏ trống, tự lấy từ cuối URL
   * @param {string} [params.username]         - Tên đăng nhập MinIO. Mặc định: MINIO_USER trong .env
   * @param {string} [params.password]         - Mật khẩu MinIO. Mặc định: MINIO_PASSWORD trong .env
   * @param {string} [params.targetFolder='']  - Thư mục đích trong bucket MinIO
   * @returns {Promise<object>} Phản hồi từ MinIO API
   *
   * Ví dụ:
   *   await helper.uploadFromUrlToMinio({
   *     url: 'http://old-server/files/bao-cao.pdf',
   *     filename: 'bao-cao-2024.pdf',      // bỏ qua nếu muốn tự lấy tên từ URL
   *     targetFolder: 'TCSG/van-ban-den',
   *   });
   */
  async uploadFromUrlToMinio({ url, filename, username, password, targetFolder = '' }) {
    logger.info(`[MinIO:uploadFromUrlToMinio] Bắt đầu — url: '${url}' | targetFolder: '${targetFolder || "(root)"}'`);

    try {
      // ── Bước 1: Lấy credentials ───────────────────────────────────────────
      const minioUser = username || process.env.MINIO_USER;
      const minioPass = password || process.env.MINIO_PASSWORD;

      if (!minioUser || !minioPass) {
        throw new Error(
          '[MinIO:uploadFromUrlToMinio] Thiếu thông tin đăng nhập. ' +
          'Truyền username/password vào hàm hoặc đặt MINIO_USER/MINIO_PASSWORD trong .env'
        );
      }

      // ── Bước 2: Lấy token (cache hoặc login mới) ─────────────────────────
      const token = await this._getMinioToken(minioUser, minioPass);

      // ── Bước 3: Tải file từ URL về memory ────────────────────────────────
      logger.info(`[MinIO:uploadFromUrlToMinio] Đang GET file từ: ${url}`);
      let fileBuffer;
      try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        fileBuffer = Buffer.from(response.data);
        logger.info(`[MinIO:uploadFromUrlToMinio] GET OK — kích thước: ${fileBuffer.length} bytes`);
      } catch (getError) {
        if (getError.response) {
          throw new Error(
            `[MinIO:uploadFromUrlToMinio] Tải file từ URL thất bại — ` +
            `HTTP ${getError.response.status}: ${url}`
          );
        }
        throw new Error(`[MinIO:uploadFromUrlToMinio] Không kết nối được URL '${url}' — ${getError.message}`);
      }

      // ── Bước 4: Xác định tên file ─────────────────────────────────────────
      let finalFilename = filename;
      if (!finalFilename) {
        try {
          finalFilename = path.basename(new URL(url).pathname);
        } catch {
          finalFilename = null;
        }
      }

      if (!finalFilename || finalFilename === '/' || finalFilename === '') {
        throw new Error(
          `[MinIO:uploadFromUrlToMinio] Không xác định được tên file từ URL '${url}'. ` +
          `Vui lòng truyền params.filename.`
        );
      }

      logger.info(`[MinIO:uploadFromUrlToMinio] Tên file: '${finalFilename}'`);

      // ── Bước 5: Upload lên MinIO ──────────────────────────────────────────
      const result = await this._uploadBufferToMinio({
        fileBuffer,
        filename: finalFilename,
        token,
        folderPath: targetFolder,
      });

      logger.info(`[MinIO:uploadFromUrlToMinio] Hoàn tất — url: '${url}'`);
      return result;

    } catch (error) {
      if (error.response) {
        logger.error(`[MinIO:uploadFromUrlToMinio] HTTP ${error.response.status}`);
      }
      logger.error(`[MinIO:uploadFromUrlToMinio] Thất bại — url: '${url}' | lỗi: ${error.message}`);
      throw error;
    }
  }

  async createChairmanAndSecretary(
    meetingId,
    chairmanUserId,
    secretaryUserId,
    transaction = null
  ) {
    // 0. Ensure schema
    await this.ensureColumnsExist(process.env.NEW_DB_NAME, 'meeting_units', { tb_bak: 'INT DEFAULT 0' }, transaction);
    await this.ensureColumnsExist(process.env.NEW_DB_NAME, 'meeting_participants', { tb_bak: 'INT DEFAULT 0' }, transaction);

    // ===== CHAIRMAN =====
    if (chairmanUserId) {

      // Check đã tồn tại participant chưa
      const checkChairman = `
        SELECT TOP 1 p.id
        FROM ${process.env.NEW_DB_NAME}.dbo.meeting_participants p
        INNER JOIN ${process.env.NEW_DB_NAME}.dbo.meeting_units u
          ON p.meeting_unit_id = u.id
        WHERE u.meeting_id = @meetingId
          AND p.user_id = @userId
          AND p.participant_role = 'CHAIRMAN'
      `;

      const existed = await this.queryNewDbTx(
        checkChairman,
        { meetingId, userId: chairmanUserId },
        transaction
      );

      if (!existed?.length) {

        // 1️⃣ Tạo unit ảo
        const insertUnitQuery = `
          INSERT INTO ${process.env.NEW_DB_NAME}.dbo.meeting_units
            (meeting_id, unit_id, tb_bak)
          OUTPUT INSERTED.id
          VALUES
            (@meetingId, 'CHAIRMAN_UNIT', 1)
        `;

        const unitResult = await this.queryNewDbTx(
          insertUnitQuery,
          { meetingId },
          transaction
        );

        const unitId = unitResult?.[0]?.id;

        // 2️⃣ Tạo participant
        const insertParticipantQuery = `
          INSERT INTO ${process.env.NEW_DB_NAME}.dbo.meeting_participants
            (meeting_unit_id, user_id, participant_role, participant_state, tb_bak)
          VALUES
            (@unitId, @userId, 'CHAIRMAN', 'DONE', 1)
        `;

        await this.queryNewDbTx(
          insertParticipantQuery,
          { unitId, userId: chairmanUserId },
          transaction
        );
      }
    }

    // ===== SECRETARY =====
    if (secretaryUserId) {

      const checkSecretary = `
        SELECT TOP 1 p.id
        FROM ${process.env.NEW_DB_NAME}.dbo.meeting_participants p
        INNER JOIN ${process.env.NEW_DB_NAME}.dbo.meeting_units u
          ON p.meeting_unit_id = u.id
        WHERE u.meeting_id = @meetingId
          AND p.user_id = @userId
          AND p.participant_role = 'SECRETARY'
      `;

      const existed = await this.queryNewDbTx(
        checkSecretary,
        { meetingId, userId: secretaryUserId },
        transaction
      );

      if (!existed?.length) {

        const insertUnitQuery = `
          INSERT INTO ${process.env.NEW_DB_NAME}.dbo.meeting_units
            (meeting_id, unit_id, tb_bak)
          OUTPUT INSERTED.id
          VALUES
            (@meetingId, 'SECRETARY_UNIT', 1)
        `;

        const unitResult = await this.queryNewDbTx(
          insertUnitQuery,
          { meetingId },
          transaction
        );

        const unitId = unitResult?.[0]?.id;

        const insertParticipantQuery = `
          INSERT INTO ${process.env.NEW_DB_NAME}.dbo.meeting_participants
            (meeting_unit_id, user_id, participant_role, participant_state, tb_bak)
          VALUES
            (@unitId, @userId, 'SECRETARY', 'DONE', 1)
        `;

        await this.queryNewDbTx(
          insertParticipantQuery,
          { unitId, userId: secretaryUserId },
          transaction
        );
      }
    }
  }

  parseActionString(create_by, value) {
    try {
      if (!value || typeof value !== 'string') {
        return {
          action_code: null,
          action: null,
          receiver: create_by ? [create_by] : [],
          receiver_unit: [],
          roleProcess: 'VANTHU',
          stage_status: null,
          type_document: null,
        };
      }

      const clean = value
        .trim()
        .replace(/^[\s"'.,]+/, '')
        .replace(/[\s"'.,]+$/, '');

      if (!clean) {
        return {
          action_code: null,
          action: null,
          receiver: create_by ? [create_by] : [],
          receiver_unit: [],
          roleProcess: 'VANTHU',
          stage_status: null,
          type_document: null,
        };
      }

      let outsideText = clean;
      let insideText = null;

      let actionCode = null;
      let action = null;
      let receiver = [];
      let roleProcess = 'VANTHU';
      let stageStatus = 'DA_XU_LY';
      let receiverUnit = [];
      let typeDocument = null;

      // ===== STEP 2: Extract inside / outside parentheses =====
      try {
        const firstOpenIndex = clean.indexOf('(');
        const lastCloseIndex = clean.lastIndexOf(')');

        if (firstOpenIndex === -1 || lastCloseIndex === -1) {
          outsideText = clean;
        } else if (firstOpenIndex < lastCloseIndex) {
          outsideText = clean.substring(0, firstOpenIndex).trim();
          insideText = clean
            .substring(firstOpenIndex + 1, lastCloseIndex)
            .trim();

          if (!insideText) {
            insideText = null;
          }
        } else {
          outsideText = clean;
          insideText = null;
        }
      } catch (err) {
        logger.warn(`[parseActionString][STEP2] Extract error: ${err.message}`);
        outsideText = clean;
        insideText = null;
      }

      // ===== STEP 3: Clean HTML & split into blocks =====
      let parsedBlocks = [];

      try {
        const targetText = insideText ? insideText : outsideText;

        if (targetText && typeof targetText === 'string') {

          let cleaned = targetText
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/b>/gi, '\n')
            .replace(/<b>/gi, '')
            .replace(/<[^>]*>/g, '')
            .trim();

          const rawBlocks = cleaned.split('\n');

          parsedBlocks = rawBlocks
            .flatMap((line) => {
              const normalized = line.replace(/\s+/g, ' ').trim();
              if (!normalized) return [];

              const colonIndex = normalized.indexOf(':');

              // Không có :
              if (colonIndex === -1) {
                return [normalized];
              }

              const before = normalized.slice(0, colonIndex + 1).trim(); // giữ dấu :
              const after = normalized.slice(colonIndex + 1).trim();

              // Nếu sau : có nội dung → tách
              if (after) {
                return [before, after];
              }

              // Nếu chỉ có label:
              return [before];
            })
            .filter(Boolean);
        }

      } catch (err) {
        logger.warn(`[parseActionString][STEP3] HTML split error: ${err.message}`);
        parsedBlocks = [];
      }

      // ===== STEP 4: Build receiver / receiver_unit / actionCode / action=====
      try {
        let blocksToProcess = [];
        if (!insideText) {
          actionCode = parsedBlocks && parsedBlocks.length
            ? parsedBlocks[0]
            : outsideText || null;

          // loại phần tử đầu (đã dùng làm actionCode)
          blocksToProcess = parsedBlocks && parsedBlocks.length > 1
            ? parsedBlocks.slice(1)
            : [];

        } else {
          actionCode = outsideText || null;
          blocksToProcess = parsedBlocks || [];
        }

        if (actionCode && typeof actionCode === 'string') {
          const acNormalized = actionCode.toLowerCase().trim();
          action = acNormalized;
          if (acNormalized.includes('trình')) {
            actionCode = 'TRINH_KY';
            typeDocument = 'OutgoingDocument';
          } else if (
            acNormalized.includes('chuyển') ||
            acNormalized.includes('phân công') ||
            acNormalized.includes('cập nhật') ||
            acNormalized.includes('đã xem')
          ) {
            actionCode = 'CHUYEN_XU_LY';
          } else if (
            acNormalized.includes('hoàn tất') ||
            acNormalized.includes('hoàn') ||
            acNormalized.includes('đóng')
          ) {
            actionCode = 'HOAN_THANH_VAN_BAN';
            stageStatus = 'HOAN_THANH_VAN_BAN';
          } else if (acNormalized.includes('phát hành')) {
            actionCode = 'BAN_HANH';
            stageStatus = 'DA_BAN_HANH';
          } else if (acNormalized.includes('xóa')) {
            actionCode = 'CREATE';
          } else {
            actionCode = 'CREATE';
            stageStatus = 'DA_XU_LY';
          }
        } else {
          actionCode = 'CREATE';
          stageStatus = 'DA_XU_LY';
        }

        if (Array.isArray(blocksToProcess) && blocksToProcess.length) {
          let currentMode = null;

          for (const raw of blocksToProcess) {
            if (!raw || typeof raw !== 'string') continue;

            const block = raw.trim();
            if (!block) continue;

            const colonIndex = block.indexOf(':');

            if (colonIndex !== -1) {
              const label = block.slice(0, colonIndex).trim();
              const labelNormalized = label.toLowerCase();

              if (labelNormalized.includes('để biết')) {
                roleProcess = 'viewer';
              } else {
                roleProcess = 'processor';
              }

              if (
                labelNormalized.includes('đơn vị xử lý') ||
                labelNormalized.includes('đơn vị')
              ) {
                currentMode = 'unit';
              } else {
                currentMode = 'person';
              }

              const after = block.slice(colonIndex + 1).trim();
              if (after) {
                if (currentMode === 'unit') {
                  receiverUnit.push(after);
                } else {
                  receiver.push(after);
                }
              }

              continue;
            }

            if (currentMode === 'unit') {
              receiverUnit.push(block);
            } else {
              receiver.push(block);
            }
          }
        }

      } catch (err) {
        logger.warn(`[parseActionString][STEP4] Build receiver error: ${err.message}`);
      }

      // ===== STEP 5: Final split & normalize =====
      try {

        const normalizeAndSplit = (arr) => {
          if (!Array.isArray(arr)) return [];

          return arr
            .map(item => {
              if (!item || typeof item !== 'string') return null;

              const colonIndex = item.indexOf(':');
              let cleaned = colonIndex !== -1
                ? item.substring(colonIndex + 1)
                : item;

              return cleaned
                .split(/[.;]/)
                .map(i => i.trim())
                .filter(Boolean);
            })
            .flat()
            .map(i =>
              i
                .replace(/^\d+[\.\)]\s*/, '')
                .trim()
            )
            .filter(i => i && i.length >= 2);
        };

        receiver = normalizeAndSplit(receiver);
        receiverUnit = normalizeAndSplit(receiverUnit);

      } catch (err) {
        logger.warn(`[parseActionString][STEP5] Final normalize error: ${err.message}`);
      }

      // ===== Fallback =====
      if (!receiver.length && !receiverUnit.length && create_by) {
        receiver = [create_by];
      }

      return {
        action_code: actionCode || null,
        action: action || null,
        receiver,
        receiver_unit: receiverUnit,
        roleProcess: roleProcess || 'VANTHU',
        stage_status: stageStatus || 'DA_XU_LY',
        type_document: typeDocument || null,
      };

    } catch (error) {
      logger.warn(`[parseActionString] Error: ${error.message}`);
      return {
        action_code: null,
        action: null,
        receiver: create_by ? [create_by] : [],
        receiver_unit: [],
        roleProcess: 'VANTHU',
        stage_status: null,
        type_document: null,
      };
    }
  }

  _expandMappedRecords(mapped) {
    if (!mapped?.document_id) return [];

    const results = [];

    const receivers = Array.isArray(mapped.receiver)
      ? mapped.receiver.filter(Boolean)
      : mapped.receiver
        ? [mapped.receiver]
        : [];

    const receiverUnits = Array.isArray(mapped.receiver_unit)
      ? mapped.receiver_unit.filter(Boolean)
      : mapped.receiver_unit
        ? [mapped.receiver_unit]
        : [];

    // Tách từng receiver
    for (const r of receivers) {
      results.push({
        ...mapped,
        receiver: r,
        receiver_unit: null,
      });
    }

    // Tách từng receiver_unit
    for (const ru of receiverUnits) {
      results.push({
        ...mapped,
        receiver: null,
        receiver_unit: ru,
      });
    }

    return results;
  }

  /**
   * Ánh xạ dữ liệu từ bản ghi file relation cũ sang cấu trúc mới.
   * @param {object} record - Dữ liệu file relation từ hệ thống cũ.
   * @returns {object|null} Dữ liệu đã được ánh xạ hoặc null nếu thiếu thông tin.
   */
  async mapFileRelations(record) {
    if (!record) return null;

    try {
      const fileId = record.file_id;
      if (!fileId) {
        logger.warn('[mapFileRelations] Bỏ qua vì thiếu file_id:', record);
        return null;
      }

      const objectId = record.object_id;
      if (!objectId) {
        logger.warn('[mapFileRelations] Bỏ qua vì thiếu object_id:', record);
        return null;
      }

      const objectType = record.object_type || 'IncomingDocument';

      // Các trường khác
      const status = (record.status === 0 || record.status === '0') ? 0 : 1;
      const isCertifiedCopy = (record.is_certified_copy === 1 || record.is_certified_copy === '1' || record.is_certified_copy === true) ? 1 : 0;
      const typeDoc = record.type_doc || null;
      const tableBak = record.table_bak || 'FileRelations';

      // ID backup từ hệ thống cũ
      const objectIdBak = record.object_id_bak || record.object_id || null;
      const fileIdBak = record.file_id_bak || record.file_id || null;

      const mapped = {
        object_type: objectType,
        object_id: String(objectId),
        file_id: fileId,
        status: status,
        is_certified_copy: isCertifiedCopy,
        object_id_bak: objectIdBak ? String(objectIdBak) : null,
        file_id_bak: fileIdBak ? String(fileIdBak) : null,
        table_bak: tableBak,
        type_doc: typeDoc,
        created_at: this.parseDate(record.created_at) || null,
      };

      return mapped;

    } catch (error) {
      logger.error(`[mapFileRelations] Lỗi xử lý record:`, record, error);
      return null;
    }
  }

  async documentField(value) {
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

      const sourceId = await this.getSourceId("S21");
      if (!sourceId) {
        logger.warn("[processDocumentField] source_id S21 not found");
        return normalizedValue;
      }

      const result = await this.checkOrInsertSourceData(sourceId, normalizedValue, title);
      return result;
    } catch (error) {
      logger.error("[processDocumentType] Error:", error);
      return null;
    }
  }
  parseStatus(value) {
    const statusStr = String(value || '');
    if (statusStr === '-1') return 3;
    return 1;
  }

  /**
   * Bóc tách các bình luận từ mã HTML cũ của SP (như YKienLanhDao, YKienChiHuy)
   * Tạo bản ghi mới vào thẳng bảng document_comments kèm tb_bak = 1
   */
  async parseAndInsertHtmlComments(htmlString, newDocumentId, oldDocumentId, oldTableName, columnName = null, transaction = null) {
    if (!htmlString || typeof htmlString !== 'string') return 0;

    try {
      const dbName = process.env.NEW_DB_NAME;
      await this.queryNewDbTx(`
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'document_comments' AND COLUMN_NAME = 'table_bak')
            ALTER TABLE ${dbName}.dbo.document_comments ADD table_bak NVARCHAR(255) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'document_comments' AND COLUMN_NAME = 'user_id_bak')
            ALTER TABLE ${dbName}.dbo.document_comments ADD user_id_bak NVARCHAR(255) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'document_comments' AND COLUMN_NAME = 'parent_id_bak')
            ALTER TABLE ${dbName}.dbo.document_comments ADD parent_id_bak NVARCHAR(255) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'document_comments' AND COLUMN_NAME = 'id_comments_bak')
            ALTER TABLE ${dbName}.dbo.document_comments ADD id_comments_bak NVARCHAR(255) NULL;
      `, {}, transaction);
    } catch (err) {
      logger.warn(`[parseAndInsertHtmlComments] Khoi tao tb_bak loi: ${err.message}`);
    }

    let count = 0;
    let commentIndex = 0;
    // Tìm các cụm có dạng: <span ...>Nguyễn Văn Phương - CVP (03/03/2014 13:09)</span>...<div ...>Nội dung</div>
    const regex = /<span[^>]*noidung[^>]*>(.*?)<\/span>[\s\S]*?<div[^>]*noidung[^>]*>([\s\S]*?)<\/div>/gi;
    let match;

    while ((match = regex.exec(htmlString)) !== null) {
      const headerRaw = match[1].replace(/<[^>]+>/g, '').trim();
      const contentRaw = match[2].replace(/<[^>]+>/g, '').trim();

      if (!headerRaw && !contentRaw) continue;

      let userNameExtracted = headerRaw;
      let dateExtracted = null;
      let createdAt = new Date();

      const dateMatch = headerRaw.match(/\(([^)]+)\)$/);
      if (dateMatch) {
        dateExtracted = dateMatch[1];
        userNameExtracted = headerRaw.replace(/\([^)]+\)$/, '').trim();
        const parsedDt = this.parseDateNonSubSeven(dateExtracted);
        if (parsedDt) createdAt = parsedDt;
      }

      const cleanName = this.extractDisplayName(userNameExtracted) || userNameExtracted;
      const userId = await this.mapUserName(cleanName, transaction);
      const commentBackupId = `${String(oldDocumentId)}|${String(oldTableName)}|${String(columnName || 'HTML')}|${commentIndex}`;
      commentIndex += 1;
      const formattedContent = columnName ? `${columnName} : ${contentRaw}` : contentRaw;

      const existingComment = await this.queryNewDbTx(
        `SELECT TOP 1 id FROM ${process.env.NEW_DB_NAME}.dbo.document_comments
         WHERE id_comments_bak = @idCommentsBak
           AND table_bak = @tableBak`,
        {
          idCommentsBak: commentBackupId,
          tableBak: String(oldTableName)
        },
        transaction
      );

      if (existingComment && existingComment.length > 0) {
        const updateQuery = `
          UPDATE ${process.env.NEW_DB_NAME}.dbo.document_comments
          SET
            document_id = @docId,
            user_id = @userId,
            user_name = @userName,
            content = @content,
            [type] = 1,
            is_edited = 0,
            created_at = @createdAt,
            updated_at = GETDATE(),
            user_id_bak = @userIdBak
          WHERE id = @id
        `;

        try {
          await this.queryNewDbTx(updateQuery, {
            id: existingComment[0].id,
            docId: newDocumentId,
            userId: userId || null,
            userIdBak: userId || null,
            userName: cleanName || null,
            content: formattedContent || '',
            createdAt: createdAt,
          }, transaction);
        } catch (updateErr) {
          logger.warn(`[parseAndInsertHtmlComments] Lỗi update comment id_comments_bak=${commentBackupId}: ${updateErr.message}`);
        }
      } else {
        const commentId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
        const insertQuery = `
          INSERT INTO ${process.env.NEW_DB_NAME}.dbo.document_comments (
            id, document_id, parent_id, user_id, user_name, content, [type],
            is_edited, created_at, updated_at, fileId, likes, is_leader_suggestion,
            org_id, id_comments_bak, table_bak, parent_id_bak, user_id_bak
          ) VALUES (
            @id, @docId, NULL, @userId, @userName, @content, 1,
            0, @createdAt, @createdAt, NULL, NULL, 1,
            NULL, @idCommentsBak, @tableBak, NULL, @userIdBak
          )
        `;

        try {
          await this.queryNewDbTx(insertQuery, {
            id: commentId,
            docId: newDocumentId,
            userId: userId || null,
            userIdBak: userId || null,
            userName: cleanName || null,
            content: formattedContent || '',
            createdAt: createdAt,
            idCommentsBak: commentBackupId,
            tableBak: String(oldTableName)
          }, transaction);
          count++;
        } catch (insertErr) {
          logger.warn(`[parseAndInsertHtmlComments] Lỗi insert comment ID=${commentId}: ${insertErr.message}`);
        }
      }
    }

    return count;
  }

  /**
   * Giải quyết ID người dùng từ tên hiển thị (Ví dụ: "Nguyễn Thị Liên - HC" -> "Nguyễn Thị Liên" -> ID)
   * @param {string} fullNameWithUnit Tên đầy đủ kèm đơn vị
   * @param {object} transaction Transaction SQL (nếu có)
   * @returns {Promise<string|null>} ID người dùng từ bảng user_sync
   */
  async resolveUserIdByFullName(fullNameWithUnit, transaction = null, customRoles = null) {
    if (!fullNameWithUnit || typeof fullNameWithUnit !== 'string') return null;

    try {
      // 1. Tách chuỗi theo dấu " - " để lấy tên cơ bản
      const parts = fullNameWithUnit.split(' - ');
      const pureFullName = parts[0].trim();
      if (!pureFullName) return null;

      // 2. Truy vấn bảng log user_sync
      let query = `
        SELECT TOP 1 ID
        FROM [DiOffice].[dbo].[user_sync]
        WHERE FullName = @fullName
      `;
      let result = await this.queryNewDbTx(query, { fullName: pureFullName }, transaction);
      if (result && result.length > 0) {
        return result[0].ID;
      }

      // 3. Nếu không có ở user_sync, tìm trong bảng users (Tìm theo cột name)
      query = `SELECT TOP 1 id FROM [${process.env.NEW_DB_NAME}].[dbo].[users] WHERE name = @fullName`;
      result = await this.queryNewDbTx(query, { fullName: pureFullName }, transaction);
      if (result && result.length > 0) {
        return result[0].id;
      }

      // 4. Tuyệt đối không có -> Chuyển sang tạo Tự Động (Auto-create)
      const { v4: uuidv4 } = require('uuid');
      const newId = uuidv4().toUpperCase();

      // username mượn tạm từ FullName để tạo dummy login
      let tempUsername = pureFullName.toLowerCase().replace(/\s+/g, '_');
      tempUsername = tempUsername.replace(/[àáạảãâầấậẩẫăằắặẳẵ]/g, 'a').replace(/[èéẹẻẽêềếệểễ]/g, 'e').replace(/[ìíịỉĩ]/g, 'i').replace(/[òóọỏõôồốộổỗơờớợởỡ]/g, 'o').replace(/[ùúụủũưừứựửữ]/g, 'u').replace(/[ỳýỵỷỹ]/g, 'y').replace(/đ/g, 'd');
      if (!this.isCreatableUsername(tempUsername)) {
        logger.warn(`[resolveUserIdByFullName] Skip auto-create because username "${tempUsername}" has length <= 3`);
        return null;
      }

      let rolesDefault = customRoles || process.env.ROLES_DEFAULT;
      if (!rolesDefault || rolesDefault.trim() === '') {
        try {
          const { ROLES_DEFAULT } = require('../config');
          rolesDefault = (ROLES_DEFAULT && ROLES_DEFAULT.length > 0) ? JSON.stringify(ROLES_DEFAULT) : '[]';
        } catch (e) {
          rolesDefault = '[]';
        }
      }

      const insertQuery = `
        INSERT INTO [${process.env.NEW_DB_NAME}].[dbo].[users]
        (id, username, code_nd, name, password, avatar, roles_by_process, status, created_at, updated_at, tb_bak)
        VALUES (@id, @username, @username, @fullName, @password, '[]', @roles, 1, GETDATE(), GETDATE(), 1)
      `;
      const password = process.env.DEFAULT_USER_PASSWORD || '$10$mH.NYj.Bapxk4auiGaPKhOfCqUnA8jr1JO5fvP3miKbhIfwU3CVRa';
      await this.ensureUsersTbBakColumnExists(transaction);
      await this.queryNewDbTx(insertQuery, { id: newId, username: tempUsername, fullName: pureFullName, password, roles: rolesDefault }, transaction);

      logger.info(`[resolveUserIdByFullName] Đã tự tạo mới tài khoản (Leader mapping) "${pureFullName}" với id=${newId}`);
      return newId;

    } catch (error) {
      logger.error(`[resolveUserIdByFullName] Lỗi tìm/tạo ID cho "${fullNameWithUnit}": ${error.message}`);
      return null;
    }
  }

  /**
   * Giải quyết ID người dùng từ username/account (ví dụ: "i:0#.f|admembers|spsetup" -> "spsetup" -> ID)
   * Nếu không tìm thấy, sẽ tạo mới một bản ghi rác tạm với username đó.
   * @param {string} accountString Đầu vào là account name (có thể chứa claim của SharePoint)
   * @param {object} transaction
   * @returns {Promise<string|null>} ID người dùng từ bảng users
   */
  async resolveUserIdByAccountName(accountString, transaction = null, customRoles = null) {
    if (!accountString || typeof accountString !== 'string') return null;

    try {
      // 1. Lọc lấy username từ chuỗi claim của SharePoint
      const parts = accountString.split('|');
      const username = parts[parts.length - 1].trim().toLowerCase();
      if (!username) return null;

      // 2. Tìm trong bảng users (Tìm theo username HOẶC code_nd)
      const findQuery = `SELECT TOP 1 id FROM [${process.env.NEW_DB_NAME}].[dbo].[users] WHERE username = @username OR code_nd = @username OR id_user_bak = @username`;
      const findResult = await this.queryNewDbTx(findQuery, { username }, transaction);
      if (findResult && findResult.length > 0) {
        return findResult[0].id;
      }

      // 3. Nếu không có, tạo mới một record cho user này
      const { v4: uuidv4 } = require('uuid');
      const newId = uuidv4().toUpperCase();

      let rolesDefault = customRoles || process.env.ROLES_DEFAULT;
      if (!rolesDefault || rolesDefault.trim() === '') {
        try {
          const { ROLES_DEFAULT } = require('../config');
          rolesDefault = (ROLES_DEFAULT && ROLES_DEFAULT.length > 0) ? JSON.stringify(ROLES_DEFAULT) : '[]';
        } catch (e) {
          rolesDefault = '[]';
        }
      }

      if (!this.isCreatableUsername(username)) {
        logger.warn(`[resolveUserIdByAccountName] Skip auto-create because username "${username}" has length <= 3`);
        return null;
      }

      const insertQuery = `
        INSERT INTO [${process.env.NEW_DB_NAME}].[dbo].[users]
        (id, username, code_nd, name, password, avatar, roles_by_process, status, created_at, updated_at, tb_bak)
        VALUES (@id, @username, @username, @username, @password, '[]', @roles, 1, GETDATE(), GETDATE(), 1)
      `;
      // Mật khẩu mặc định hoặc hash rác
      const password = process.env.DEFAULT_USER_PASSWORD || '$10$mH.NYj.Bapxk4auiGaPKhOfCqUnA8jr1JO5fvP3miKbhIfwU3CVRa';
      await this.ensureUsersTbBakColumnExists(transaction);
      await this.queryNewDbTx(insertQuery, { id: newId, username, password, roles: rolesDefault }, transaction);

      logger.info(`[resolveUserIdByAccountName] Đã tự tạo mới tài khoản "${username}" với id=${newId}`);
      return newId;

    } catch (error) {
      logger.error(`[resolveUserIdByAccountName] Lỗi tìm/tạo ID cho account "${accountString}": ${error.message}`);
      return null; // Rớt về null để caller dùng raw string hoặc null
    }
  }

  /**
   * Giải quyết ID người dùng từ Email.
   * Nếu không tìm thấy, sẽ tạo mới một bản ghi rác tạm.
   */
  async resolveUserIdByEmail(emailString, transaction = null, customRoles = null) {
    if (!emailString || typeof emailString !== 'string' || !emailString.includes('@')) return null;

    try {
      const email = emailString.trim().toLowerCase();
      const prefix = this.extractEmailPrefix(email);

      // 1. Tìm trong bảng users (Tìm theo email_user HOẶC username/code_nd khớp prefix)
      const findQuery = `SELECT TOP 1 id FROM [${process.env.NEW_DB_NAME || 'app_tancang'}].[dbo].[users] WHERE email_user = @email OR username = @prefix OR code_nd = @prefix OR id_user_bak = @prefix`;
      const findResult = await this.queryNewDbTx(findQuery, { email, prefix }, transaction);
      if (findResult && findResult.length > 0) {
        return findResult[0].id;
      }

      // 2. Nếu không có, tạo mới
      const { v4: uuidv4 } = require('uuid');
      const newId = uuidv4().toUpperCase();
      const username = prefix || email.split('@')[0];

      if (!this.isCreatableUsername(username)) {
        return null;
      }

      let rolesDefault = customRoles || process.env.ROLES_DEFAULT;
      if (!rolesDefault || rolesDefault.trim() === '') {
        try {
          const { ROLES_DEFAULT } = require('../config');
          rolesDefault = (ROLES_DEFAULT && ROLES_DEFAULT.length > 0) ? JSON.stringify(ROLES_DEFAULT) : '[]';
        } catch (e) {
          rolesDefault = '[]';
        }
      }

      const insertQuery = `
        INSERT INTO [${process.env.NEW_DB_NAME || 'app_tancang'}].[dbo].[users]
        (id, username, code_nd, name, email_user, password, avatar, roles_by_process, status, created_at, updated_at, tb_bak)
        VALUES (@id, @username, @username, @username, @email, @password, '[]', @roles, 1, GETDATE(), GETDATE(), 1)
      `;
      const password = process.env.DEFAULT_USER_PASSWORD || '$10$mH.NYj.Bapxk4auiGaPKhOfCqUnA8jr1JO5fvP3miKbhIfwU3CVRa';
      await this.ensureUsersTbBakColumnExists(transaction);
      await this.queryNewDbTx(insertQuery, { id: newId, username, email, password, roles: rolesDefault }, transaction);

      logger.info(`[resolveUserIdByEmail] Đã tự tạo mới tài khoản "${username}" (từ email ${email}) với id=${newId}`);
      return newId;
    } catch (error) {
      logger.error(`[resolveUserIdByEmail] Lỗi tìm/tạo ID cho email "${emailString}": ${error.message}`);
      return null;
    }
  }

  /**
   * Giải quyết Tên đơn vị từ mã đơn vị (Ví dụ: "ATPC" -> "Phòng An toàn - Pháp chế")
   * @param {string} unitCode Mã đơn vị (VD: ATPC, HC, NS)
   * @param {object} transaction Transaction SQL
   * @returns {Promise<string|null>} Tên đầy đủ của đơn vị
   */
  async resolveUnitNameByCode(unitCode, transaction = null) {
    if (!unitCode || typeof unitCode !== 'string') return null;

    try {
      const code = unitCode.trim();
      const query = `
        SELECT TOP 1 name
        FROM ${process.env.NEW_DB_NAME}.dbo.organization_units
        WHERE LTRIM(RTRIM(code)) = @code
      `;

      const result = await this.queryNewDbTx(query, { code }, transaction);
      if (result && result.length > 0) {
        return result[0].name;
      }
      return null;
    } catch (error) {
      logger.error(`[resolveUnitNameByCode] Lỗi tìm tên đơn vị cho mã "${unitCode}": ${error.message}`);
      return null;
    }
  }

  async getUserDisplayName(userIdOrName, transaction = null) {
    if (!userIdOrName || typeof userIdOrName !== 'string') return null;

    const trimmed = userIdOrName.trim();
    if (!trimmed) return null;

    try {
      // ── BƯỚC 1: Tìm trong DB mới theo nhiều tiêu chí ──────────────────────
      const newDbQuery = `
        SELECT TOP 1 name
        FROM ${process.env.NEW_DB_NAME}.dbo.users
        WHERE id          = @val
          OR id_user_bak = @val
          OR username    = @val
          OR code_nd     = @val
          OR name        = @val
      `;

      const newResult = await this.queryNewDbTx(newDbQuery, { val: trimmed }, transaction);
      if (newResult?.length) {
        //logger.info(`[getUserDisplayName] Found in New DB: "${trimmed}" -> "${newResult[0].name}"`);
        return newResult[0].name;
      }

      // ── BƯỚC 2: Fallback sang DB cũ (PersonalProfile) ─────────────────────
      if (this.queryOldDb) {
        const oldDbQuery = `
          SELECT TOP 1 FullName
          FROM dbo.PersonalProfile
          WHERE (TRY_CONVERT(uniqueidentifier, @val) IS NOT NULL AND ID = TRY_CONVERT(uniqueidentifier, @val))
            OR AccountID = @val
            OR StaffID   = @val
            OR FullName  = @val
        `;

        const oldResult = await this.queryOldDb(oldDbQuery, { val: trimmed });
        if (oldResult?.length) {
          const name = this.safeString(oldResult[0].FullName);
          //logger.info(`[getUserDisplayName] Found in Old DB: "${trimmed}" -> "${name}"`);
          return name;
        }
      }

      logger.warn(`[getUserDisplayName] Không tìm thấy tên cho: "${trimmed}"`);
      return null;

    } catch (error) {
      logger.error(`[getUserDisplayName] Lỗi cho "${trimmed}": ${error.message}`);
      return null;
    }
  }

  async getUserFieldName(userFieldId) {
    if (!userFieldId || typeof userFieldId !== 'string') return null;

    const trimmed = userFieldId.trim();
    if (!trimmed) return null;

    try {
      if (!this.queryOldDb) {
        logger.warn('[getUserFieldName] queryOldDb chưa được khởi tạo.');
        return null;
      }

      const query = `
        SELECT TOP 1 Name
        FROM ${process.env.OLD_DB_NAME}.dbo.UserField
        WHERE ID = @userFieldId
      `;

      const result = await this.queryOldDb(query, { userFieldId: trimmed });

      if (result?.length) {
        const name = this.safeString(result[0].Name);
        // logger.info(`[getUserFieldName] Found: UserFieldId="${trimmed}" -> Name="${name}"`);
        return name;
      }

      logger.warn(`[getUserFieldName] Không tìm thấy UserField với ID: "${trimmed}"`);
      return null;

    } catch (error) {
      logger.error(`[getUserFieldName] Lỗi cho UserFieldId="${trimmed}": ${error.message}`);
      return null;
    }
  }

  async findDocumentIdByOldId(oldId, scope = 'both', transaction = null) {
    if (!oldId) return null;

    const trimmed = String(oldId).trim();
    if (!trimmed) return null;

    try {
      const db = process.env.NEW_DB_NAME;

      // ── BƯỚC 1: Tìm trong incoming_documents ──────────────────────────────
      if (scope === 'IncommingDocument' || scope === 'both') {
        const incomingQuery = `
          SELECT TOP 1 document_id
          FROM ${db}.dbo.incomming_documents
          WHERE id_incoming_bak    = @oldId
        `;

        const incomingResult = await this.queryNewDbTx(incomingQuery, { oldId: trimmed }, transaction);
        if (incomingResult?.length) {
          const document_id = incomingResult[0].document_id;
          // logger.info(`[findDocumentIdByOldId] Found in incoming_documents: oldId="${trimmed}" -> document_id="${document_id}"`);
          return { document_id, type: 'IncommingDocument' };
        }
      }

      // ── BƯỚC 2: Tìm trong outgoing_documents ──────────────────────────────
      if (scope === 'OutgoingDocument' || scope === 'both') {
        const outgoingQuery = `
          SELECT TOP 1 document_id
          FROM ${db}.dbo.outgoing_documents
          WHERE id_outgoing_bak    = @oldId
        `;

        const outgoingResult = await this.queryNewDbTx(outgoingQuery, { oldId: trimmed }, transaction);
        if (outgoingResult?.length) {
          const document_id = outgoingResult[0].document_id;
          // logger.info(`[findDocumentIdByOldId] Found in outgoing_documents: oldId="${trimmed}" -> document_id="${document_id}"`);
          return { document_id, type: 'OutgoingDocument' };
        }
      }

      logger.warn(`[findDocumentIdByOldId] Không tìm thấy document với oldId="${trimmed}" (scope=${scope})`);
      return {
        document_id: trimmed,
        type: scope
      };

    } catch (error) {
      logger.error(`[findDocumentIdByOldId] Lỗi cho oldId="${trimmed}": ${error.message}`);
      return {
        document_id: trimmed,
        type: scope
      };
    }
  }

  /**
   * Lấy ID đơn vị (parent) của người dùng từ bảng users
   * @param {string} userId - ID người dùng
   * @param {object} transaction
   * @returns {Promise<string|null>} - ID đơn vị hoặc null
   */
  async getUserParentUnit(userId, transaction = null) {
    if (!userId) return null;
    try {
      const db = process.env.NEW_DB_NAME || 'app_tancang';
      const query = `
        SELECT TOP 1 parent 
        FROM [${db}].[dbo].[users] 
        WHERE id = @userId
      `
      const result = await this.queryNewDbTx(query, { userId }, transaction);
      if (result && result.length > 0) {
        const user = result[0];
        if (user.parent) return user.parent;
      }
    } catch (e) {
      logger.warn(`[MigrationHelper] Lỗi khi lấy parent của user ${userId}: ${e.message}`);
    }
    return null;
  }
}

module.exports = MigrationHelper;
