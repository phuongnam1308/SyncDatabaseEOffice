const fs = require('fs');
const path = require('path');
const BaseModel = require('../../../models/BaseModel');
const logger = require('../../../utils/logger');
const SharePointFbaClient = require('../sharepoint/SharePointFbaClient');

const DEFAULT_STORAGE_ROOT = path.resolve(process.cwd(), 'physical_storage');
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class StreamFileMigrationModel extends BaseModel {
  constructor() {
    super();
    this.newDbName = process.env.NEW_DB_NAME;

    this.oldDbSchema = 'dbo';
    this.oldDbTable = 'AllDocs';

    this.newDbSchema = 'dbo';
    this.newDbTable = 'all_docs_sync';

    this.storageRoot = process.env.SHAREPOINT_STORAGE_ROOT || DEFAULT_STORAGE_ROOT;
    this.sharePointBaseUrl = String(process.env.SHAREPOINT_BASE_URL || '').trim();
    this._syncTableReady = false;
    this.sharePointClient = null;
  }

  async initialize() {
    await super.initialize();
    this.validateSharePointConfig();

    this.sharePointClient = new SharePointFbaClient({
      loginUrl: process.env.SHAREPOINT_LOGIN_URL,
      username: process.env.SHAREPOINT_USERNAME,
      password: process.env.SHAREPOINT_PASSWORD,
      usernameField: process.env.SHAREPOINT_LOGIN_USERNAME_FIELD || 'ctl00$PlaceHolderMain$signInControl$UserName',
      passwordField: process.env.SHAREPOINT_LOGIN_PASSWORD_FIELD || 'ctl00$PlaceHolderMain$signInControl$password',
      submitField: process.env.SHAREPOINT_LOGIN_SUBMIT_FIELD || 'ctl00$PlaceHolderMain$signInControl$login',
      submitValue: process.env.SHAREPOINT_LOGIN_SUBMIT_VALUE || 'Đăng nhập',
      userAgent: process.env.SHAREPOINT_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      acceptLanguage: process.env.SHAREPOINT_ACCEPT_LANGUAGE || 'en-US,en;q=0.9',
      initialCookies: process.env.SHAREPOINT_INITIAL_COOKIES || '',
      extraHeaders: this.parseExtraFormFields(process.env.SHAREPOINT_EXTRA_HEADERS),
      timeoutMs: Number(process.env.SHAREPOINT_TIMEOUT_MS || 30000),
      requestRetries: Number(process.env.SHAREPOINT_REQUEST_RETRIES || 2),
      retryDelayMs: Number(process.env.SHAREPOINT_RETRY_DELAY_MS || 800),
      authCookieNames: this.parseCsvEnv(process.env.SHAREPOINT_AUTH_COOKIE_NAMES) || ['FedAuth', 'rtFa'],
      authCookieMode: process.env.SHAREPOINT_AUTH_COOKIE_MODE || 'any',
      extraFormFields: this.parseExtraFormFields(process.env.SHAREPOINT_EXTRA_FORM_FIELDS)
    });

    await fs.promises.mkdir(this.storageRoot, { recursive: true });
    logger.info('[StreamFileMigrationModel] Initialized');
  }

  validateSharePointConfig() {
    const required = ['SHAREPOINT_LOGIN_URL', 'SHAREPOINT_USERNAME', 'SHAREPOINT_PASSWORD', 'SHAREPOINT_BASE_URL'];
    const missing = required.filter((name) => !process.env[name] || String(process.env[name]).trim() === '');
    if (missing.length > 0) {
      throw new Error(`[StreamFileMigrationModel] Missing SharePoint env: ${missing.join(', ')}`);
    }
  }

  parseCsvEnv(value) {
    if (!value || typeof value !== 'string') return null;
    const items = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return items.length ? items : null;
  }

  parseExtraFormFields(value) {
    if (!value || typeof value !== 'string') return {};
    const params = new URLSearchParams(value);
    const output = {};
    for (const [key, fieldValue] of params.entries()) {
      output[key] = fieldValue;
    }
    return output;
  }

  sanitizePathSegment(segment) {
    return String(segment || '')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
      .replace(/\.+$/g, '')
      .trim();
  }

  normalizeServerRelativeUrl(dirName, leafName) {
    const safeLeaf = this.sanitizePathSegment(leafName);
    if (!safeLeaf) {
      throw new Error('LeafName is empty');
    }

    const rawDir = String(dirName || '').replace(/\\/g, '/').trim();
    const cleanedDir = rawDir
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment && segment !== '.' && segment !== '..')
      .map((segment) => this.sanitizePathSegment(segment))
      .filter(Boolean)
      .join('/');

    const fullPath = `${cleanedDir}/${safeLeaf}`.replace(/\/{2,}/g, '/');
    return `/${fullPath.replace(/^\/+/, '')}`;
  }

  resolveDownloadUrl(record) {
    const serverRelativeUrl = this.normalizeServerRelativeUrl(record.DirName, record.LeafName);
    const base = this.sharePointBaseUrl.endsWith('/')
      ? this.sharePointBaseUrl
      : `${this.sharePointBaseUrl}/`;

    return {
      serverRelativeUrl,
      downloadUrl: new URL(serverRelativeUrl.replace(/^\/+/, ''), base).toString()
    };
  }

  resolveLocalPath(serverRelativeUrl) {
    const parts = String(serverRelativeUrl || '')
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map((segment) => this.sanitizePathSegment(segment))
      .filter(Boolean);

    return path.join(this.storageRoot, ...parts);
  }

  normalizeLastId(lastId) {
    if (!lastId) return null;
    const value = String(lastId).trim();
    if (!value || value === '0') return null;
    return UUID_REGEX.test(value) ? value : null;
  }

  async getStatus() {
    try {
      const countOldQuery = `
        SELECT COUNT(*) AS total
        FROM ${this.oldDbSchema}.${this.oldDbTable}
        WHERE [Level] = 1 AND HasStream = 1
      `;
      const oldResult = await this.queryOldDb(countOldQuery);
      const totalInOldDb = oldResult[0]?.total || 0;

      await this.ensureSyncTable();

      const countNewQuery = `
        SELECT COUNT(*) AS total
        FROM ${this.newDbSchema}.${this.newDbTable}
      `;
      const newResult = await this.queryNewDbTx(countNewQuery);
      const totalInNewDb = newResult[0]?.total || 0;

      const lastIdQuery = `
        SELECT TOP 1 id_bak
        FROM ${this.newDbSchema}.${this.newDbTable}
        ORDER BY id DESC
      `;
      const lastIdResult = await this.queryNewDbTx(lastIdQuery);
      const lastMigratedId = lastIdResult[0]?.id_bak || null;

      return {
        totalInOldDb,
        totalInNewDb,
        remaining: totalInOldDb - totalInNewDb,
        lastMigratedId
      };
    } catch (error) {
      logger.error('[StreamFileMigrationModel.getStatus] Error:', error);
      throw error;
    }
  }

  async insertBatchToMain({ batch, lastId = null }) {
    try {
      const normalizedLastId = this.normalizeLastId(lastId);
      let query = `
        SELECT TOP (@batch)
          ID,
          DirName,
          LeafName,
          Size,
          TimeLastModified
        FROM ${this.oldDbSchema}.${this.oldDbTable}
        WHERE [Level] = 1
          AND HasStream = 1
      `;

      const params = { batch: Number(batch || 100) };

      if (normalizedLastId) {
        query += ` AND ID > @lastId`;
        params.lastId = normalizedLastId;
      }

      query += ` ORDER BY ID ASC`;
      const records = await this.queryOldDb(query, params);

      logger.info(`[StreamFileMigrationModel] Fetched ${records.length} rows from AllDocs`);
      return records;
    } catch (error) {
      logger.error('[StreamFileMigrationModel.insertBatchToMain] Error:', error);
      throw error;
    }
  }

  async mapAndCleanBatch(records) {
    if (!Array.isArray(records) || records.length === 0) {
      return [];
    }

    const mapped = [];
    for (const row of records) {
      try {
        const { serverRelativeUrl, downloadUrl } = this.resolveDownloadUrl(row);
        const localPath = this.resolveLocalPath(serverRelativeUrl);

        mapped.push({
          ID: String(row.ID || '').trim(),
          DirName: row.DirName,
          LeafName: row.LeafName,
          Size: row.Size != null ? Number(row.Size) : null,
          TimeLastModified: row.TimeLastModified || null,
          serverRelativeUrl,
          downloadUrl,
          localPath
        });
      } catch (error) {
        logger.warn(`[StreamFileMigrationModel.mapAndCleanBatch] Skip row ID=${row?.ID}: ${error.message}`);
      }
    }

    return mapped;
  }

  async ensureSyncTable() {
    if (this._syncTableReady) return;

    const query = `
      IF NOT EXISTS (
        SELECT 1
        FROM sys.objects
        WHERE object_id = OBJECT_ID(N'${this.newDbSchema}.${this.newDbTable}')
          AND type = N'U'
      )
      BEGIN
        CREATE TABLE ${this.newDbSchema}.${this.newDbTable} (
          id INT IDENTITY(1,1) PRIMARY KEY,
          id_bak NVARCHAR(64) NOT NULL UNIQUE,
          server_relative_url NVARCHAR(1024) NOT NULL,
          source_url NVARCHAR(2048) NOT NULL,
          file_name NVARCHAR(512) NOT NULL,
          local_path NVARCHAR(2048) NOT NULL,
          file_size BIGINT NULL,
          modified_at DATETIME2 NULL,
          synced_at DATETIME2 NOT NULL,
          status NVARCHAR(20) NOT NULL,
          error_message NVARCHAR(2000) NULL
        );
      END
    `;

    await this.queryNewDbTx(query);
    this._syncTableReady = true;
  }

  async upsertSyncRecord(record) {
    const query = `
      IF EXISTS (SELECT 1 FROM ${this.newDbSchema}.${this.newDbTable} WHERE id_bak = @idBak)
      BEGIN
        UPDATE ${this.newDbSchema}.${this.newDbTable}
        SET
          server_relative_url = @serverRelativeUrl,
          source_url = @sourceUrl,
          file_name = @fileName,
          local_path = @localPath,
          file_size = @fileSize,
          modified_at = @modifiedAt,
          synced_at = @syncedAt,
          status = @status,
          error_message = @errorMessage
        WHERE id_bak = @idBak;
        SELECT 'updated' AS action;
      END
      ELSE
      BEGIN
        INSERT INTO ${this.newDbSchema}.${this.newDbTable} (
          id_bak,
          server_relative_url,
          source_url,
          file_name,
          local_path,
          file_size,
          modified_at,
          synced_at,
          status,
          error_message
        )
        VALUES (
          @idBak,
          @serverRelativeUrl,
          @sourceUrl,
          @fileName,
          @localPath,
          @fileSize,
          @modifiedAt,
          @syncedAt,
          @status,
          @errorMessage
        );
        SELECT 'inserted' AS action;
      END
    `;

    const result = await this.queryNewDbTx(query, {
      idBak: record.idBak,
      serverRelativeUrl: record.serverRelativeUrl,
      sourceUrl: record.sourceUrl,
      fileName: record.fileName,
      localPath: record.localPath,
      fileSize: record.fileSize,
      modifiedAt: record.modifiedAt,
      syncedAt: record.syncedAt,
      status: record.status,
      errorMessage: record.errorMessage
    });

    return result?.[0]?.action || 'updated';
  }

  async insertBatchToNewDb(records) {
    if (!Array.isArray(records) || records.length === 0) {
      return { inserted: 0, updated: 0 };
    }

    await this.ensureSyncTable();

    let inserted = 0;
    let updated = 0;

    for (const record of records) {
      const idBak = String(record.ID || '').trim();
      if (!idBak) {
        logger.warn('[StreamFileMigrationModel.insertBatchToNewDb] Skip row without ID');
        continue;
      }

      const payload = {
        idBak,
        serverRelativeUrl: record.serverRelativeUrl,
        sourceUrl: record.downloadUrl,
        fileName: String(record.LeafName || '').trim(),
        localPath: record.localPath,
        fileSize: record.Size != null ? Number(record.Size) : null,
        modifiedAt: record.TimeLastModified || null,
        syncedAt: new Date(),
        status: 'SUCCESS',
        errorMessage: null
      };

      try {
        const downloaded = await this.sharePointClient.downloadFile({
          downloadUrl: record.downloadUrl,
          destinationPath: record.localPath
        });
        payload.fileSize = Number(downloaded?.size || payload.fileSize || 0);

        const action = await this.upsertSyncRecord(payload);
        if (action === 'inserted') inserted += 1;
        else updated += 1;
      } catch (error) {
        payload.status = 'ERROR';
        payload.errorMessage = error.message;

        const action = await this.upsertSyncRecord(payload);
        if (action === 'inserted') inserted += 1;
        else updated += 1;

        logger.error(`[StreamFileMigrationModel] Download failed ID=${idBak}: ${error.message}`);
      }
    }

    return { inserted, updated };
  }

  async rollback(options = {}) {
    const { removeFiles = false } = options;

    try {
      await this.ensureSyncTable();

      const rows = await this.queryNewDbTx(`
        SELECT local_path
        FROM ${this.newDbSchema}.${this.newDbTable}
      `);

      await this.queryNewDbTx(`
        DELETE FROM ${this.newDbSchema}.${this.newDbTable}
      `);

      let deletedFiles = 0;
      if (removeFiles && Array.isArray(rows)) {
        for (const row of rows) {
          const target = String(row?.local_path || '');
          if (!target) continue;

          const normalizedTarget = path.resolve(target);
          const normalizedRoot = path.resolve(this.storageRoot);
          if (!normalizedTarget.startsWith(normalizedRoot)) continue;

          try {
            await fs.promises.unlink(normalizedTarget);
            deletedFiles += 1;
          } catch (_) {
            // ignore missing files
          }
        }
      }

      return {
        deletedRows: rows?.length || 0,
        deletedFiles
      };
    } catch (error) {
      logger.error('[StreamFileMigrationModel.rollback] Error:', error);
      throw error;
    }
  }
}

module.exports = StreamFileMigrationModel;
