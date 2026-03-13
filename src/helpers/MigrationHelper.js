const logger = require("../../utils/logger");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require('bcrypt');

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs').promises; // Use promise-based fs
const path = require('path');
const DEFAULT_PASSWORD = process.env.MIGRATION_DEFAULT_PASSWORD || '12345678';
const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10);

class MigrationHelper {
  constructor(dbQueryFn, queryOldDbFn = null) {
    this.queryNewDbTx = dbQueryFn;
    this.queryOldDb = queryOldDbFn;
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
        const iso = trimmed.includes("T")
          ? trimmed
          : trimmed.replace(" ", "T");
        const parsed = new Date(iso);
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
      }

      const parsed = new Date(trimmed);
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

  splitStringSplitBySemicolon(input) {
    if (!input || typeof input !== 'string') {
      return [];
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

  async mapSenderUnitId(value, transaction = null) {
    try {
      const normalizedName = this.processSenderUnit(value);
      if (!normalizedName) return null;

      const selectQuery = `
        SELECT TOP 1 id
        FROM ${process.env.NEW_DB_NAME}.dbo.organization_units
        WHERE LTRIM(RTRIM(name)) LIKE @name
          AND status = 1
      `;

      let result = await this.queryNewDbTx(
        selectQuery,
        { name: `N'${normalizedName}'` },
        transaction,
      );

      if (result?.length) {
        return result[0].id;
      }

      // ===== SYNC FULL FROM OLD DEPARTMENT =====
      const oldDeptQuery = `
        SELECT TOP 1 *
        FROM ${process.env.OLD_DB_NAME}.dbo.Department
        WHERE LTRIM(RTRIM(Title)) LIKE @name
          AND (Status = 1 OR Status IS NULL)
      `;

      const oldDept = await this.queryOldDb(oldDeptQuery, { name: `N'${normalizedName}'` });
      if (oldDept?.length) {
        const dept = oldDept[0];
        const oldId = dept.ID;

        const existedQuery = `
          SELECT TOP 1 id
          FROM ${process.env.NEW_DB_NAME}.dbo.organization_units
          WHERE Id_backups = @oldId
        `;

        const existed = await this.queryNewDbTx(
          existedQuery,
          { oldId },
          transaction,
        );

        if (existed?.length) {
          return existed[0].id;
        }

        let parentId = null;

        if (dept.ParentID) {
          const parentBackupQuery = `
            SELECT TOP 1 id
            FROM ${process.env.NEW_DB_NAME}.dbo.organization_units
            WHERE Id_backups = @parentOldId
          `;

          const parentExisted = await this.queryNewDbTx(
            parentBackupQuery,
            { parentOldId: dept.ParentID },
            transaction,
          );

          parentId = parentExisted?.length ? parentExisted[0].id : null;
        }

        const newId = `${Date.now()}${Math.floor(Math.random() * 10000)}`;

        const insertFromOldQuery = `
          INSERT INTO ${process.env.NEW_DB_NAME}.dbo.organization_units (
            id,
            name,
            code,
            phone_number,
            address,
            display_order,
            status,
            parentId,
            created_at,
            updated_at,
            Id_backups,
            table_backups
          )
          VALUES (
            @id,
            @name,
            @code,
            @phone,
            @address,
            @displayOrder,
            1,
            @parentId,
            @createdAt,
            @updatedAt,
            @oldId,
            'stream_migration'
          )
        `;

        try {
          await this.queryNewDbTx(
            insertFromOldQuery,
            {
              id: newId,
              name: dept.Title?.trim(),
              code: dept.Code || dept.Title?.trim(),
              phone: dept.PhoneNumber || null,
              address: dept.Address || null,
              displayOrder: dept.Order ?? null,
              parentId,
              createdAt: this.parseDate(dept.Created) ?? new Date(),
              updatedAt: this.parseDate(dept.Modified) ?? this.parseDate(dept.Created) ?? new Date(),
              oldId,
            },
            transaction,
          );

          logger.warn(
            `[mapSenderUnitId] Synced Department: ${dept.Title}, newId=${newId}, oldId=${oldId}`,
          );

          return newId;
        } catch (insertError) {
          // race condition fallback
          const retry = await this.queryNewDbTx(
            existedQuery,
            { oldId },
            transaction,
          );
          return retry?.length ? retry[0].id : null;
        }
      }
      // ===== END SYNC BLOCK =====
      const id = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
      const code = normalizedName;

      const insertQuery = `
        INSERT INTO ${process.env.NEW_DB_NAME}.dbo.organization_units (
          id, name, code, status, created_at, updated_at, table_backups
        )
        VALUES (@id, @name, @code, 1, GETDATE(), GETDATE(), 'stream_migration')
      `;

      try {
        await this.queryNewDbTx(
          insertQuery,
          { id, name: normalizedName, code },
          transaction,
        );
        logger.warn(
          `[mapSenderUnitId] Created new organization: ${normalizedName}, id: ${id}`,
        );
        return id;
      } catch (insertError) {
        logger.warn(
          `[mapSenderUnitId] Insert fail, retry select: ${insertError.message}`,
        );
        const retry = await this.queryNewDbTx(
          selectQuery,
          { name: normalizedName },
          transaction,
        );
        return retry?.length ? retry[0].id : null;
      }
    } catch (error) {
      logger.error(`[mapSenderUnitId] Error value="${value}": ${error.message}`);
      return null;
    }
  }

  async mapUserName(userIdOrName, transaction = null) {
    try {
      if (!userIdOrName || typeof userIdOrName !== 'string') {
        return userIdOrName;
      }
      const trimmed = userIdOrName.trim();
      if (!trimmed) return userIdOrName;
      const isIdFormat =
        /^\d+$/.test(trimmed) ||
        /^[0-9a-f-]{32,}$/i.test(trimmed);
      if (isIdFormat) {
        const checkNewQuery = `
          SELECT TOP 1 id
          FROM ${process.env.NEW_DB_NAME}.dbo.users
          WHERE id = @id
        `;
        const existedNew = await this.queryNewDbTx(
          checkNewQuery,
          { id: trimmed },
          transaction
        );
        if (existedNew?.length) {
          return existedNew[0].id;
        }
        const checkOldQuery = `
          SELECT TOP 1 *
          FROM dbo.PersonalProfile
          WHERE ID = @id
        `;

        const existedOld = await this.queryOldDb(
          checkOldQuery,
          { id: trimmed }
        );
        if (!existedOld?.length) {
          return trimmed;
        }
        if (!this._streamUserMigrationModel) {
          const StreamUserMigrationModel = require('../sync-user-copy/migrate/StreamUserMigrationModel');
          this._streamUserMigrationModel = new StreamUserMigrationModel();
          await this._streamUserMigrationModel.initialize();
        }
        const syncResult =
          await this._streamUserMigrationModel.upsertUserById(
            existedOld[0],
            transaction
          );
        if (!syncResult?.affected) {
          logger.warn(`[mapUserName] Sync user failed ID = ${trimmed}`);
        } else if (syncResult.action === 'inserted') {
          logger.warn(`[mapUserName] Created new userID = ${trimmed}`);
        }

        return trimmed;
      }

      if (!/[a-zA-ZÀ-ỹ]/.test(trimmed)) {
        return userIdOrName;
      }

      const displayName = this.extractDisplayName(trimmed);
      if (!displayName) return userIdOrName;

      const usernameBase = this.buildUsernameFromName(displayName);
      if (!usernameBase) return userIdOrName;

      const selectQuery = `
        SELECT TOP 1 id
        FROM ${process.env.NEW_DB_NAME}.dbo.users
        WHERE name = @name OR id = @name
      `;

      const existing = await this.queryNewDbTx(
        selectQuery,
        { name: displayName },
        transaction
      );

      if (existing?.length) {
        return existing[0].id;
      }

        const id = uuidv4();
        const username = `${usernameBase}${Math.floor(1000 + Math.random() * 9000)}`;
        const password = await this.hashDefaultPassword();

        const insertQuery = `
        INSERT INTO ${process.env.NEW_DB_NAME}.dbo.users (
            id, name, username, password, parent, status, table_backups, created_at, updated_at
        )
        VALUES (@id, @name, @username, @password, @parent, 1, @tableBackups, GETDATE(), GETDATE())
        `;

        try {
        await this.queryNewDbTx(insertQuery, {
            id, name: displayName, username, password, parent: '68afb3a1cb36081f0bba5dd6', tableBackups: 'stream_migration'
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
          name, [year], status, type_document, sender_unit, private_level, count, created_at, updated_at, created_by
        )
        OUTPUT INSERTED.book_document_id
        VALUES (@name, @year, 1, N'OutGoingDocument', @sender_unit, @private_level, 1, GETDATE(), GETDATE(), @created_by)
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

      const id = uuidv4();
      const insertQuery = `
        INSERT INTO ${process.env.NEW_DB_NAME}.dbo.crm_source_data (id, source_id, title, value, createdAt, updatedAt)
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

  async createOnlineMeeting(meetingId, platform, transaction = null) {
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
          (platform, meeting_link, meeting_id)
        OUTPUT INSERTED.id
        VALUES
          (@platform, @meetingLink, @meetingId)
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
          days_of_week, day_of_month, day_of_year, interval_value)
        OUTPUT INSERTED.id
        VALUES
          (@meetingId, 'KHONG', @startDate, NULL,
          NULL, NULL, NULL, NULL)
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
        .map(r => r.trim())
        .filter(Boolean);

      if (!roomList.length) return null;

      const ids = [];

      for (const room of roomList) {

        const selectQuery = `
          SELECT TOP 1 id
          FROM ${process.env.NEW_DB_NAME}.dbo.meeting_rooms
          WHERE name = @name
        `;

        const existing = await this.queryNewDbTx(
          selectQuery,
          { name: room },
          transaction
        );

        if (existing?.length) {
          ids.push(existing[0].id);
          continue;
        }

        // Chưa có → tạo mới
        const id = uuidv4();

        const insertQuery = `
          INSERT INTO ${process.env.NEW_DB_NAME}.dbo.meeting_rooms (
            id,
            name,
            location,
            capacity,
            status,
            stage,
            available_from,
            created_at,
            updated_at,
            total_seating
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
            @capacity
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
          ids.push(id);

        } catch (err) {
          // race condition fallback
          const retry = await this.queryNewDbTx(
            selectQuery,
            { name: room },
            transaction
          );

          if (retry?.length) {
            ids.push(retry[0].id);
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
  const ttlMs    = parseInt(process.env.MINIO_TOKEN_TTL_MS || '') || 55 * 60 * 1000;

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
  if (!filename)   throw new Error('[MinIO:_uploadBufferToMinio] Thiếu filename.');
  if (!token)      throw new Error('[MinIO:_uploadBufferToMinio] Thiếu token.');

  const minioUrl = (process.env.MINIO_URL || 'https://minio.lifetex.vn').replace(/\/$/, '');
  const bucket   = process.env.MINIO_BUCKET || 'tancang';

  // Build object key: "folderPath/filename" hoặc chỉ "filename" nếu không có folder
  const normalizedFolder = folderPath ? folderPath.replace(/\/$/, '') + '/' : '';
  const objectKey        = normalizedFolder + filename;
  const uploadUrl        = `${minioUrl}/api/v1/buckets/${bucket}/objects/upload?prefix=${encodeURIComponent(objectKey)}`;

  logger.info(`[MinIO:_uploadBufferToMinio] Uploading → bucket='${bucket}' | key='${objectKey}' | size=${fileBuffer.length} bytes`);

  const form = new FormData();
  form.append('file', fileBuffer, filename);

  try {
    const response = await axios.post(uploadUrl, form, {
      headers: {
        ...form.getHeaders(),
        'token':  token,
        'accept': '*/*',
      },
      maxContentLength: Infinity,
      maxBodyLength:    Infinity,
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
    const filename   = path.basename(filePath);

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
    let failedCount   = 0;
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
      success:       failedCount === 0,
      message:       `Hoàn tất. Thành công: ${uploadedCount}/${allEntries.length}. Thất bại: ${failedCount}.`,
      totalFiles:    allEntries.length,
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
            (meeting_id, unit_id)
          OUTPUT INSERTED.id
          VALUES
            (@meetingId, 'CHAIRMAN_UNIT')
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
            (meeting_unit_id, user_id, participant_role, participant_state)
          VALUES
            (@unitId, @userId, 'CHAIRMAN', 'DONE')
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
            (meeting_id, unit_id)
          OUTPUT INSERTED.id
          VALUES
            (@meetingId, 'SECRETARY_UNIT')
        `;

        const unitResult = await this.queryNewDbTx(
          insertUnitQuery,
          { meetingId },
          transaction
        );

        const unitId = unitResult?.[0]?.id;

        const insertParticipantQuery = `
          INSERT INTO ${process.env.NEW_DB_NAME}.dbo.meeting_participants
            (meeting_unit_id, user_id, participant_role, participant_state)
          VALUES
            (@unitId, @userId, 'SECRETARY', 'DONE')
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
            actionCode = 'THU_HOI';
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
}

module.exports = MigrationHelper;
