const fs = require('fs');
const path = require('path');
const logger = require('../../../utils/logger');

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_REDIRECTS = 6;
const AUTH_FAILURE_STATUSES = new Set([401, 403]);
const DEFAULT_AUTH_COOKIES = ['FedAuth', 'rtFa'];
const LOGIN_PAGE_MARKERS = [
  '__VIEWSTATE',
  '__EVENTVALIDATION',
  'signInControl',
  '/_forms/default.aspx',
  'ctl00$PlaceHolderMain$signInControl$UserName'
];

class SharePointFbaClient {
  constructor(options = {}) {
    this.loginUrl = String(options.loginUrl || '').trim();
    this.baseUrl = String(options.baseUrl || '').trim();
    this.username = String(options.username || '').trim();
    this.password = String(options.password || '');

    this.usernameField = options.usernameField || 'UserName';
    this.passwordField = options.passwordField || 'password';
    this.submitField = options.submitField || 'login';
    this.submitValue = options.submitValue || 'Dang nhap';
    this.acceptLanguage = options.acceptLanguage || 'en-US,en;q=0.9';
    this.initialCookies = String(options.initialCookies || '').trim();
    this.extraHeaders = options.extraHeaders || {};
    this.authCookieMode = String(options.authCookieMode || 'any').trim().toLowerCase();
    this.userAgent =
      options.userAgent ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    this.timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
    this.requestRetries = Math.max(0, Number(options.requestRetries ?? 2));
    this.retryDelayMs = Math.max(0, Number(options.retryDelayMs ?? 800));
    this.extraFormFields = options.extraFormFields || {};
    this.authCookieNames = Array.isArray(options.authCookieNames) && options.authCookieNames.length
      ? options.authCookieNames
      : DEFAULT_AUTH_COOKIES;

    this.cookieJar = new Map();
    this._loginInFlight = null;
    this.seedCookiesFromHeader(this.initialCookies);

    if (!this.loginUrl) {
      throw new Error('[SharePointFbaClient] loginUrl is required');
    }
    if (!this.username) {
      throw new Error('[SharePointFbaClient] username is required');
    }
    if (!this.password) {
      throw new Error('[SharePointFbaClient] password is required');
    }
    if (typeof fetch !== 'function') {
      throw new Error('[SharePointFbaClient] Global fetch is unavailable. Use Node.js 18+');
    }
  }

  seedCookiesFromHeader(cookieHeader) {
    if (!cookieHeader) return;

    const parts = String(cookieHeader)
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean);

    for (const part of parts) {
      const eqIndex = part.indexOf('=');
      if (eqIndex <= 0) continue;
      const name = part.slice(0, eqIndex).trim();
      const value = part.slice(eqIndex + 1).trim();
      if (!name) continue;
      this.cookieJar.set(name, value);
    }
  }

  buildHeaders(baseHeaders = {}) {
    const headers = {
      ...this.extraHeaders,
      ...baseHeaders,
      'User-Agent': this.userAgent,
      'Accept-Language': this.acceptLanguage
    };
    const cookies = this.cookieHeaderValue();
    if (cookies) {
      headers.Cookie = cookies;
    }
    return headers;
  }

  parseSetCookieHeader(rawHeader) {
    if (!rawHeader) return [];
    if (Array.isArray(rawHeader)) return rawHeader;

    const cookies = [];
    let chunk = '';
    let inExpires = false;

    for (let idx = 0; idx < rawHeader.length; idx += 1) {
      const ch = rawHeader[idx];

      if (ch === ',') {
        const tail = rawHeader.slice(idx + 1);
        const looksLikeCookie = /^\s*[^=;,]+=/i.test(tail);
        if (!inExpires && looksLikeCookie) {
          if (chunk.trim()) cookies.push(chunk.trim());
          chunk = '';
          continue;
        }
      }

      chunk += ch;

      const lowerChunk = chunk.toLowerCase();
      if (lowerChunk.endsWith('expires=')) {
        inExpires = true;
      } else if (inExpires && ch === ';') {
        inExpires = false;
      }
    }

    if (chunk.trim()) cookies.push(chunk.trim());
    return cookies;
  }

  updateCookieJar(headers) {
    if (!headers) return;

    let setCookies = [];
    if (typeof headers.getSetCookie === 'function') {
      setCookies = headers.getSetCookie();
    } else {
      setCookies = this.parseSetCookieHeader(headers.get('set-cookie'));
    }

    for (const setCookie of setCookies) {
      if (!setCookie || typeof setCookie !== 'string') continue;
      const firstPart = setCookie.split(';')[0] || '';
      const eqIndex = firstPart.indexOf('=');
      if (eqIndex <= 0) continue;

      const cookieName = firstPart.slice(0, eqIndex).trim();
      const cookieValue = firstPart.slice(eqIndex + 1).trim();
      if (!cookieName) continue;

      this.cookieJar.set(cookieName, cookieValue);
    }
  }

  cookieHeaderValue() {
    return [...this.cookieJar.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  hasAuthCookies() {
    const names = this.authCookieNames || [];
    if (!names.length) return false;

    if (this.authCookieMode === 'all') {
      return names.every((cookieName) => this.cookieJar.has(cookieName));
    }
    return names.some((cookieName) => this.cookieJar.has(cookieName));
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  isRetryableNetworkError(error) {
    if (!error) return false;
    const name = String(error?.name || '');
    const code = String(error?.code || error?.cause?.code || '');
    const message = String(error?.message || '').toLowerCase();

    return (
      name === 'AbortError' ||
      code === 'UND_ERR_CONNECT_TIMEOUT' ||
      code === 'ETIMEDOUT' ||
      message.includes('aborted') ||
      message.includes('timeout')
    );
  }

  extractHiddenFields(html) {
    const fields = {};
    if (!html || typeof html !== 'string') {
      return fields;
    }

    const inputRegex = /<input\b[^>]*>/gi;
    const allInputs = html.match(inputRegex) || [];

    for (const tag of allInputs) {
      if (!/type\s*=\s*["']?hidden["']?/i.test(tag)) continue;

      const nameMatch = tag.match(/\bname\s*=\s*(["'])(.*?)\1/i);
      const valueMatch = tag.match(/\bvalue\s*=\s*(["'])([\s\S]*?)\1/i);
      if (!nameMatch) continue;

      const name = nameMatch[2];
      const value = valueMatch ? valueMatch[2] : '';
      fields[name] = value;
    }

    return fields;
  }

  async fetchWithTimeout(url, init = {}) {
    let lastError = null;
    const maxAttempt = this.requestRetries + 1;

    for (let attempt = 1; attempt <= maxAttempt; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        return await fetch(url, {
          ...init,
          signal: controller.signal
        });
      } catch (error) {
        lastError = error;
        const canRetry = this.isRetryableNetworkError(error) && attempt < maxAttempt;
        if (!canRetry) {
          break;
        }

        logger.warn(
          `[SharePointFbaClient] Request timeout/network issue, retry ${attempt}/${maxAttempt - 1}: ${url}`
        );
        await this.sleep(this.retryDelayMs * attempt);
      } finally {
        clearTimeout(timer);
      }
    }

    const detail = lastError?.message || 'unknown network error';
    throw new Error(
      `[SharePointFbaClient] Request failed after ${maxAttempt} attempt(s), timeout=${this.timeoutMs}ms, url=${url}, error=${detail}`
    );
  }

  async followRedirectChain(response) {
    let current = response;
    let count = 0;

    while (current && current.status >= 300 && current.status < 400 && count < MAX_REDIRECTS) {
      const location = current.headers.get('location');
      if (!location) break;

      const nextUrl = new URL(location, current.url || this.loginUrl).toString();
      current = await this.fetchWithTimeout(nextUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: this.buildHeaders({
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        })
      });

      this.updateCookieJar(current.headers);
      count += 1;
    }

    return current;
  }

  async performLogin() {
    let pageResponse = await this.fetchWithTimeout(this.loginUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: this.buildHeaders({
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      })
    });
    this.updateCookieJar(pageResponse.headers);
    pageResponse = await this.followRedirectChain(pageResponse);

    if (!pageResponse.ok && pageResponse.status !== 302) {
      throw new Error(`[SharePointFbaClient] Login page GET failed: HTTP ${pageResponse.status}`);
    }

    const pageHtml = await pageResponse.text();
    const hiddenFields = this.extractHiddenFields(pageHtml);

    if (!hiddenFields.__VIEWSTATE || !hiddenFields.__EVENTVALIDATION) {
      throw new Error('[SharePointFbaClient] Cannot find __VIEWSTATE or __EVENTVALIDATION from login page');
    }

    const form = new URLSearchParams();
    Object.entries(hiddenFields).forEach(([name, value]) => form.append(name, value));
    Object.entries(this.extraFormFields).forEach(([name, value]) => {
      if (value != null) form.append(name, String(value));
    });
    form.append(this.usernameField, this.username);
    form.append(this.passwordField, this.password);
    form.append(this.submitField, this.submitValue);

    const postResponse = await this.fetchWithTimeout(this.loginUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: this.buildHeaders({
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Origin: new URL(this.loginUrl).origin,
        Referer: this.loginUrl,
      }),
      body: form.toString()
    });
    this.updateCookieJar(postResponse.headers);

    const finalResponse = await this.followRedirectChain(postResponse);
    if (finalResponse) {
      this.updateCookieJar(finalResponse.headers);
    }

    if (!this.hasAuthCookies()) {
      const availableCookies = [...this.cookieJar.keys()].join(', ');
      throw new Error(
        `[SharePointFbaClient] Login failed: auth cookies check mode=${this.authCookieMode}, expected=${this.authCookieNames.join(', ')}. Current cookies: ${availableCookies || 'none'}`
      );
    }
  }

  async ensureAuthenticated(forceRelogin = false) {
    if (forceRelogin) {
      this.cookieJar.clear();
    } else if (this.hasAuthCookies()) {
      return;
    }

    if (!this._loginInFlight) {
      this._loginInFlight = this.performLogin()
        .then(() => {
          logger.info('[SharePointFbaClient] Login successful');
        })
        .finally(() => {
          this._loginInFlight = null;
        });
    }

    await this._loginInFlight;
  }

  async fetchWithAuth(url, init = {}, options = {}) {
    const { retryOnAuthFailure = true } = options;
    await this.ensureAuthenticated(false);

    const headers = this.buildHeaders(init.headers || {});

    let response = await this.fetchWithTimeout(url, {
      ...init,
      headers
    });
    this.updateCookieJar(response.headers);

    if (retryOnAuthFailure && AUTH_FAILURE_STATUSES.has(response.status)) {
      logger.warn(`[SharePointFbaClient] HTTP ${response.status} detected. Relogin and retry once`);
      await this.ensureAuthenticated(true);

      response = await this.fetchWithTimeout(url, {
        ...init,
        headers: this.buildHeaders(init.headers || {})
      });
      this.updateCookieJar(response.headers);
    }

    return response;
  }

  async downloadFile({ downloadUrl, destinationPath }) {
    if (!downloadUrl) {
      throw new Error('[SharePointFbaClient] downloadUrl is required');
    }
    if (!destinationPath) {
      throw new Error('[SharePointFbaClient] destinationPath is required');
    }

    const result = await this.downloadFileBuffer({ downloadUrl });
    await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.promises.writeFile(destinationPath, result.bytes);
    return {
      size: result.bytes.length,
      contentType: result.contentType
    };
  }

  normalizeDownloadUrl(downloadUrlOrPath) {
    const raw = String(downloadUrlOrPath || '').trim();
    if (!raw) {
      throw new Error('[SharePointFbaClient] downloadUrl/downloadPath is required');
    }

    if (/^https?:\/\//i.test(raw)) {
      return raw;
    }

    if (!this.baseUrl) {
      throw new Error('[SharePointFbaClient] baseUrl is required for relative download path');
    }

    const normalizedPath = raw.startsWith('/') ? raw : `/${raw}`;
    return new URL(normalizedPath, this.baseUrl).toString();
  }

  isLikelyLoginPageHtml(html, responseUrl = '') {
    const text = String(html || '').toLowerCase();
    const url = String(responseUrl || '').toLowerCase();
    if (url.includes('/_forms/default.aspx')) {
      return true;
    }
    return LOGIN_PAGE_MARKERS.every((marker) => text.includes(marker.toLowerCase()));
  }

  /**
   * Tao loi download co metadata de layer tren phan loai:
   * - code/httpStatus/isDownloadError
   * - responseUrl/downloadUrl de log de truy vet.
   */
  createDownloadError(message, {
    code = 'DOWNLOAD_REQUEST_ERROR',
    httpStatus = null,
    responseUrl = null,
    downloadUrl = null
  } = {}) {
    const error = new Error(message);
    error.code = code;
    if (httpStatus != null) {
      error.httpStatus = Number(httpStatus);
    }
    if (responseUrl) {
      error.responseUrl = responseUrl;
    }
    if (downloadUrl) {
      error.downloadUrl = downloadUrl;
    }
    error.isDownloadError = true;
    return error;
  }

  async _attemptDownloadBuffer(downloadUrl) {
    try {
      let response = await this.fetchWithAuth(downloadUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          Accept: '*/*'
        }
      });

      if (response.status >= 300 && response.status < 400) {
        response = await this.followRedirectChain(response);
      }

      if (!response.ok) {
        const httpStatus = Number(response.status || 0);
        const code = httpStatus === 404 ? 'DOWNLOAD_NOT_FOUND' : 'DOWNLOAD_HTTP_ERROR';
        throw this.createDownloadError(
          `[SharePointFbaClient] Download failed: HTTP ${httpStatus}`,
          {
            code,
            httpStatus,
            responseUrl: response.url || null,
            downloadUrl
          }
        );
      }

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
        const html = await response.text();
        if (this.isLikelyLoginPageHtml(html, response.url || '')) {
          const err = this.createDownloadError(
            '[SharePointFbaClient] Download redirected to login page',
            {
              code: 'LOGIN_PAGE_DETECTED',
              responseUrl: response.url || null,
              downloadUrl
            }
          );
          throw err;
        }
        throw this.createDownloadError(
          '[SharePointFbaClient] Download returned HTML content',
          {
            code: 'DOWNLOAD_INVALID_CONTENT',
            responseUrl: response.url || null,
            downloadUrl
          }
        );
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      return {
        bytes,
        contentType: response.headers.get('content-type') || null,
        responseUrl: response.url || null
      };
    } catch (error) {
      if (error?.isDownloadError) {
        throw error;
      }
      throw this.createDownloadError(
        error?.message || '[SharePointFbaClient] Download request failed',
        {
          code: error?.code || 'DOWNLOAD_REQUEST_ERROR',
          downloadUrl
        }
      );
    }
  }

  /**
   * Tai file ve dang buffer de xu ly tiep (vd: upload API moi).
   * Neu phat hien bi da ve trang login thi tu dong relogin va thu lai 1 lan.
   */
  async downloadFileBuffer({ downloadUrl, downloadPathOrUrl }) {
    const normalizedDownloadUrl = this.normalizeDownloadUrl(downloadUrl || downloadPathOrUrl);

    try {
      const result = await this._attemptDownloadBuffer(normalizedDownloadUrl);
      return {
        ...result,
        downloadUrl: normalizedDownloadUrl
      };
    } catch (error) {
      if (error?.code !== 'LOGIN_PAGE_DETECTED') {
        throw error;
      }

      logger.warn('[SharePointFbaClient] Login page detected while downloading, relogin and retry once');
      await this.ensureAuthenticated(true);
      const retryResult = await this._attemptDownloadBuffer(normalizedDownloadUrl);
      return {
        ...retryResult,
        downloadUrl: normalizedDownloadUrl
      };
    }
  }

  async downloadToFile({ downloadPathOrUrl, downloadUrl, outputPath }) {
    if (!outputPath) {
      throw new Error('[SharePointFbaClient] outputPath is required');
    }

    const result = await this.downloadFileBuffer({
      downloadUrl: downloadUrl || null,
      downloadPathOrUrl: downloadPathOrUrl || null
    });

    const finalOutputPath = path.resolve(outputPath);
    await fs.promises.mkdir(path.dirname(finalOutputPath), { recursive: true });
    await fs.promises.writeFile(finalOutputPath, result.bytes);

    return {
      ...result,
      savedPath: finalOutputPath,
      size: Number(result?.bytes?.length || 0)
    };
  }
}

module.exports = SharePointFbaClient;
