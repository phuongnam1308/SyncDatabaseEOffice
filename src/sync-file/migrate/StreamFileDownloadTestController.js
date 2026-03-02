const path = require('path');
const BaseController = require('../../../controllers/BaseController');
const logger = require('../../../utils/logger');
const SharePointFbaClient = require('../sharepoint/SharePointFbaClient');

class StreamFileDownloadTestController extends BaseController {
  constructor() {
    super();
    this.sharedClient = null;
    this.sharedClientConfigKey = null;
  }

  buildClientConfig() {
    return {
      loginUrl: process.env.SHAREPOINT_LOGIN_URL,
      baseUrl: process.env.SHAREPOINT_BASE_URL,
      username: process.env.SHAREPOINT_USERNAME,
      password: process.env.SHAREPOINT_PASSWORD,
      usernameField: process.env.SHAREPOINT_LOGIN_USERNAME_FIELD,
      passwordField: process.env.SHAREPOINT_LOGIN_PASSWORD_FIELD,
      submitField: process.env.SHAREPOINT_LOGIN_SUBMIT_FIELD,
      submitValue: process.env.SHAREPOINT_LOGIN_SUBMIT_VALUE,
      userAgent: process.env.SHAREPOINT_USER_AGENT,
      acceptLanguage: process.env.SHAREPOINT_ACCEPT_LANGUAGE,
      initialCookies: process.env.SHAREPOINT_INITIAL_COOKIES,
      timeoutMs: Number(process.env.SHAREPOINT_TIMEOUT_MS || 30000),
      requestRetries: Number(process.env.SHAREPOINT_REQUEST_RETRIES || 2),
      retryDelayMs: Number(process.env.SHAREPOINT_RETRY_DELAY_MS || 800),
      authCookieNames: String(process.env.SHAREPOINT_AUTH_COOKIE_NAMES || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      authCookieMode: process.env.SHAREPOINT_AUTH_COOKIE_MODE || 'any',
    };
  }

  getClientConfigKey(config) {
    return JSON.stringify({
      loginUrl: config.loginUrl,
      baseUrl: config.baseUrl,
      username: config.username,
      usernameField: config.usernameField,
      passwordField: config.passwordField,
      submitField: config.submitField,
      submitValue: config.submitValue,
      timeoutMs: config.timeoutMs,
      requestRetries: config.requestRetries,
      retryDelayMs: config.retryDelayMs,
      authCookieNames: config.authCookieNames,
      authCookieMode: config.authCookieMode,
      userAgent: config.userAgent,
      acceptLanguage: config.acceptLanguage
    });
  }

  createClient() {
    const config = this.buildClientConfig();
    const nextKey = this.getClientConfigKey(config);

    // Reuse session client across requests. Recreate only when config changes.
    if (this.sharedClient && this.sharedClientConfigKey === nextKey) {
      return this.sharedClient;
    }

    this.sharedClient = new SharePointFbaClient(config);
    this.sharedClientConfigKey = nextKey;
    return this.sharedClient;
  }

  /**
   * Xac dinh nhom loi download co the bo qua trong API test.
   */
  classifyDownloadError(error) {
    const code = String(error?.code || '').toUpperCase();
    const status = Number(error?.httpStatus || 0);
    if (code === 'DOWNLOAD_NOT_FOUND' || status === 404) {
      return { shouldSkip: true, reason: 'FILE_NOT_FOUND' };
    }
    if (code.startsWith('DOWNLOAD_') || error?.isDownloadError) {
      return { shouldSkip: true, reason: 'DOWNLOAD_ERROR' };
    }
    return { shouldSkip: false, reason: null };
  }

  /**
   * POST /api/file/test-download
   * Body:
   * - downloadPath: "/vanbantct/.../file.pdf" (hoac full URL)
   * - outputPath: "physical_storage/test/file.pdf" (optional)
   */
  testDownloadByPath = this.asyncHandler(async (req, res) => {
    const downloadPath = String(
      req.body?.downloadPath ||
      req.body?.downloadUrl ||
      req.query?.downloadPath ||
      req.query?.downloadUrl ||
      ''
    ).trim();

    if (!downloadPath) {
      return this.badRequest(res, 'downloadPath/downloadUrl la bat buoc');
    }

    const defaultFileName = path.posix.basename(downloadPath.split('?')[0]) || `test-file-${Date.now()}`;
    const outputPath = String(
      req.body?.outputPath ||
      req.query?.outputPath ||
      path.join(process.env.SHAREPOINT_STORAGE_ROOT || './physical_storage', 'test-download', defaultFileName)
    ).trim();

    const client = this.createClient();
    try {
      const result = await client.downloadToFile({
        downloadPathOrUrl: downloadPath,
        outputPath
      });

      return this.success(res, {
        downloadPath,
        downloadUrl: result.downloadUrl,
        responseUrl: result.responseUrl,
        contentType: result.contentType,
        size: result.size,
        savedPath: result.savedPath
      }, 'Test auto-login va sync file thanh cong');
    } catch (error) {
      const downloadError = this.classifyDownloadError(error);
      if (downloadError.shouldSkip) {
        logger.warn(
          `[StreamFileDownloadTestController] Bo qua download path=${downloadPath} reason=${downloadError.reason}: ${error.message}`
        );
        return this.success(res, {
          skipped: true,
          reason: downloadError.reason,
          downloadPath,
          error: error.message
        }, 'Bo qua file do khong tai duoc hoac khong tim thay');
      }
      throw error;
    }
  });
}

module.exports = new StreamFileDownloadTestController();
