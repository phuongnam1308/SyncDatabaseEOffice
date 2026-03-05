const logger = require("../../utils/logger");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require('bcrypt');

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

      // Nếu muốn trả về array thì dùng:
      // return ids;

    } catch (error) {
      logger.warn("[mapMeetingRoom] Error:", error);
      return null;
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
