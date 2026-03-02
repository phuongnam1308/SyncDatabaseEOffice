const path = require('path');
const mime = require('mime-types');
const logger = require('../../../utils/logger');
const SharePointFbaClient = require('../../sync-file/sharepoint/SharePointFbaClient');

/**
 * Dong bo file cho outgoing:
 * 1) Lay danh sach path file tu cot Files (he thong cu)
 * 2) Dang nhap SharePoint va tai file binary
 * 3) Upload file sang API he thong moi voi object_type + object_id moi
 */
class OutgoingFileSyncService {
  constructor() {
    this.enabled = this.toBoolean(process.env.OUTGOING_FILE_SYNC_ENABLED, true);
    this.strictMode = this.toBoolean(process.env.OUTGOING_FILE_SYNC_STRICT, false);
    this.fileRetryCount = Math.max(1, Number(process.env.OUTGOING_FILE_RETRY_COUNT || 5));
    this.fileRetryDelayMs = Math.max(0, Number(process.env.OUTGOING_FILE_RETRY_DELAY_MS || 800));

    this.sharePointBaseUrl = String(process.env.SHAREPOINT_BASE_URL || '').trim();
    this.uploadUrl = String(process.env.NEW_APP_FILE_UPLOAD_URL || '').trim();
    this.uploadToken = String(process.env.NEW_APP_FILE_UPLOAD_TOKEN || '').trim();
    this.objectType = String(process.env.NEW_APP_FILE_OBJECT_TYPE || 'docDraft').trim();
    this.acceptLanguage = String(process.env.NEW_APP_FILE_UPLOAD_ACCEPT_LANGUAGE || 'en-US,en;q=0.9,vi;q=0.8').trim();
    this.userAgent = String(
      process.env.NEW_APP_FILE_UPLOAD_USER_AGENT ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
    ).trim();

    this.sharePointClient = null;

    if (this.enabled) {
      this.sharePointClient = new SharePointFbaClient({
        loginUrl: process.env.SHAREPOINT_LOGIN_URL,
        username: process.env.SHAREPOINT_USERNAME,
        password: process.env.SHAREPOINT_PASSWORD,
        usernameField: process.env.SHAREPOINT_LOGIN_USERNAME_FIELD || 'ctl00$PlaceHolderMain$signInControl$UserName',
        passwordField: process.env.SHAREPOINT_LOGIN_PASSWORD_FIELD || 'ctl00$PlaceHolderMain$signInControl$password',
        submitField: process.env.SHAREPOINT_LOGIN_SUBMIT_FIELD || 'ctl00$PlaceHolderMain$signInControl$login',
        submitValue: process.env.SHAREPOINT_LOGIN_SUBMIT_VALUE || 'Đăng nhập',
        userAgent: process.env.SHAREPOINT_USER_AGENT || this.userAgent,
        acceptLanguage: process.env.SHAREPOINT_ACCEPT_LANGUAGE || 'en-US,en;q=0.9',
        initialCookies: process.env.SHAREPOINT_INITIAL_COOKIES || '',
        timeoutMs: Number(process.env.SHAREPOINT_TIMEOUT_MS || 30000),
        authCookieNames: this.parseCsvEnv(process.env.SHAREPOINT_AUTH_COOKIE_NAMES) || ['FedAuth', 'rtFa'],
        extraFormFields: this.parseUrlEncodedObject(process.env.SHAREPOINT_EXTRA_FORM_FIELDS),
        extraHeaders: this.parseUrlEncodedObject(process.env.SHAREPOINT_EXTRA_HEADERS)
      });
    }
  }

  toBoolean(value, defaultValue = false) {
    if (value == null || value === '') return defaultValue;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    return defaultValue;
  }

  parseCsvEnv(value) {
    if (!value || typeof value !== 'string') return null;
    const items = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return items.length > 0 ? items : null;
  }

  parseUrlEncodedObject(value) {
    if (!value || typeof value !== 'string') return {};
    const params = new URLSearchParams(value);
    const output = {};
    for (const [key, val] of params.entries()) {
      output[key] = val;
    }
    return output;
  }

  isConfigured() {
    return Boolean(
      this.sharePointClient &&
        this.sharePointBaseUrl &&
        this.uploadUrl &&
        this.uploadToken &&
        this.objectType
    );
  }

  /**
   * Tach cot Files thanh danh sach path file.
   * Du lieu thuong co dinh dang: /a/b/file1.pdf|/a/b/file2.docx
   */
  parseFilesField(filesValue) {
    if (!filesValue || typeof filesValue !== 'string') return [];
    return filesValue
      .split('|')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  /**
   * Chuyen path tu DB cu thanh URL download day du.
   * Neu da la absolute URL thi giu nguyen.
   */
  buildSharePointFileUrl(filePath) {
    const raw = String(filePath || '').trim();
    if (!raw) throw new Error('Invalid empty file path');

    if (/^https?:\/\//i.test(raw)) {
      return raw;
    }

    const normalized = raw.startsWith('/') ? raw : `/${raw}`;
    return new URL(normalized, this.sharePointBaseUrl).toString();
  }

  /**
   * Lay ten file de gui len API upload.
   * Co decode URI de tranh ten file bi ma hoa %20, %2F...
   */
  getFileNameFromPath(filePath) {
    try {
      const url = /^https?:\/\//i.test(filePath)
        ? new URL(filePath)
        : new URL(this.buildSharePointFileUrl(filePath));
      const baseName = path.posix.basename(url.pathname || '') || `outgoing-file-${Date.now()}`;
      return decodeURIComponent(baseName);
    } catch (_) {
      const fallback = path.posix.basename(String(filePath || '').replace(/\\/g, '/'));
      return fallback || `outgoing-file-${Date.now()}`;
    }
  }

  /**
   * Xac dinh mime-type uu tien theo response download.
   * Neu response khong ro rang thi doan theo phan mo rong file.
   */
  guessMimeType(fileName, downloadedContentType) {
    const raw = String(downloadedContentType || '').toLowerCase().trim();
    if (raw && raw !== 'application/octet-stream') {
      return raw;
    }
    return mime.lookup(fileName) || 'application/octet-stream';
  }

  /**
   * Delay util cho retry backoff.
   */
  async sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Phan loai loi download de quyet dinh bo qua file:
   * - DOWNLOAD_NOT_FOUND/404: bo qua ngay
   * - DOWNLOAD_* khac: bo qua va log canh bao
   */
  classifyDownloadError(error) {
    const code = String(error?.code || '').toUpperCase();
    const status = Number(error?.httpStatus || 0);
    const message = String(error?.message || '').toLowerCase();

    if (code === 'DOWNLOAD_NOT_FOUND' || status === 404) {
      return {
        shouldSkip: true,
        reason: 'FILE_NOT_FOUND'
      };
    }

    if (code.startsWith('DOWNLOAD_') || error?.isDownloadError || message.includes('download')) {
      return {
        shouldSkip: true,
        reason: 'DOWNLOAD_ERROR'
      };
    }

    return {
      shouldSkip: false,
      reason: null
    };
  }

  /**
   * Upload binary file len phan mem moi theo multipart/form-data.
   * object_type va object_id duoc gui dung theo yeu cau nghiep vu.
   */
  async uploadBinaryToNewSystem({ fileBuffer, fileName, mimeType, objectId }) {
    if (typeof FormData !== 'function') {
      throw new Error('FormData is unavailable in current Node runtime');
    }
    if (typeof Blob !== 'function') {
      throw new Error('Blob is unavailable in current Node runtime');
    }

    const form = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType || 'application/octet-stream' });
    form.append('file', blob, fileName);
    form.append('object_type', this.objectType);
    form.append('object_id', String(objectId));

    const response = await fetch(this.uploadUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': this.acceptLanguage,
        Authorization: `Bearer ${this.uploadToken}`,
        'User-Agent': this.userAgent
      },
      body: form
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `[OutgoingFileSyncService] Upload failed HTTP ${response.status}: ${responseText.slice(0, 500)}`
      );
    }

    try {
      return JSON.parse(responseText);
    } catch (_) {
      return { raw: responseText };
    }
  }

  /**
   * Ham tong: dong bo tat ca file cua 1 ban ghi outgoing.
   * - Khong throw neu strictMode=false (chi ghi log loi tung file)
   * - Xu ly tuan tu tung file, co retry theo tung file
   */
  async syncFilesForOutgoing(oldRecord, newOutgoingId, context = {}) {
    if (!this.enabled) {
      return {
        enabled: false,
        skipped: true,
        reason: 'OUTGOING_FILE_SYNC_ENABLED is false'
      };
    }

    if (!this.isConfigured()) {
      const msg = 'Missing required config for outgoing file sync';
      if (this.strictMode) {
        throw new Error(msg);
      }
      return {
        enabled: true,
        skipped: true,
        reason: msg
      };
    }

    const filesValue = oldRecord?.Files || oldRecord?.files || '';
    const filePaths = this.parseFilesField(filesValue);
    if (filePaths.length === 0) {
      return {
        enabled: true,
        skipped: true,
        reason: 'No files in old record'
      };
    }

    const results = [];
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    const syncJobId = context?.syncJobId || null;
    const backupId = String(oldRecord?.ID || oldRecord?.id || '').trim() || null;

    for (const sourcePath of filePaths) {
      const fileName = this.getFileNameFromPath(sourcePath);
      let fileResult = {
        sourcePath,
        downloadUrl: null,
        fileName,
        size: 0,
        attempts: 0,
        status: 'ERROR'
      };

      for (let attempt = 1; attempt <= this.fileRetryCount; attempt += 1) {
        fileResult.attempts = attempt;
        try {
          const downloadUrl = this.buildSharePointFileUrl(sourcePath);
          fileResult.downloadUrl = downloadUrl;
          const downloaded = await this.sharePointClient.downloadFileBuffer({ downloadUrl });
          const mimeType = this.guessMimeType(fileName, downloaded?.contentType);
          const uploadResult = await this.uploadBinaryToNewSystem({
            fileBuffer: downloaded.bytes,
            fileName,
            mimeType,
            objectId: newOutgoingId
          });

          fileResult = {
            sourcePath,
            downloadUrl,
            fileName,
            size: Number(downloaded?.bytes?.length || 0),
            attempts: attempt,
            status: 'SUCCESS',
            uploadResult
          };
          successCount += 1;
          break;
        } catch (error) {
          const downloadError = this.classifyDownloadError(error);
          if (downloadError.shouldSkip) {
            skippedCount += 1;
            fileResult = {
              ...fileResult,
              status: 'SKIPPED',
              reason: downloadError.reason,
              error: error.message
            };
            logger.warn(
              `[OutgoingFileSyncService] Skip file syncJobId=${syncJobId || '-'} backupId=${backupId || '-'} documentId=${newOutgoingId} source=${sourcePath} reason=${downloadError.reason}: ${error.message}`
            );
            break;
          }

          fileResult = {
            ...fileResult,
            status: 'ERROR',
            error: error.message
          };

          const isLastAttempt = attempt >= this.fileRetryCount;
          if (isLastAttempt) {
            failedCount += 1;
            logger.warn(
              `[OutgoingFileSyncService] File sync failed syncJobId=${syncJobId || '-'} backupId=${backupId || '-'} documentId=${newOutgoingId} source=${sourcePath} attempt=${attempt}/${this.fileRetryCount}: ${error.message}`
            );
            break;
          }

          const waitMs = this.fileRetryDelayMs * attempt;
          logger.warn(
            `[OutgoingFileSyncService] File sync retry syncJobId=${syncJobId || '-'} backupId=${backupId || '-'} documentId=${newOutgoingId} source=${sourcePath} attempt=${attempt}/${this.fileRetryCount} waitMs=${waitMs}: ${error.message}`
          );
          await this.sleep(waitMs);
        }
      }

      results.push(fileResult);
    }

    if (failedCount > 0 && this.strictMode) {
      throw new Error(
        `[OutgoingFileSyncService] ${failedCount}/${filePaths.length} files failed for outgoingId=${newOutgoingId}`
      );
    }

    return {
      enabled: true,
      skipped: false,
      total: filePaths.length,
      success: successCount,
      skipped: skippedCount,
      failed: failedCount,
      details: results
    };
  }
}

module.exports = OutgoingFileSyncService;
