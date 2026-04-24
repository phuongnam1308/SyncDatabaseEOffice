const axios = require('axios');
const { NtlmClient } = require('axios-ntlm');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('../../utils/logger');

const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.IGNORE_SSL !== 'true',
  keepAlive: true, // Kích hoạt Keep-Alive để giữ luồng TCP liên tục
  keepAliveMsecs: 10000, // Bắn gói tin "ping" mỗi 10 giây để tránh bị thiết bị mạng cắt do treo rảnh
});

// Cache cookie memory
let _cachedCookie = null;
let _isRefreshingInMemory = false;

/**
 * Đảm bảo bảng lưu trạng thái Auth tồn tại trong Database
 */
async function ensureTableExists(pool) {
  if (!pool) return;
  const query = `
    IF OBJECT_ID('dbo.sync_auth_state', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.sync_auth_state (
            id INT PRIMARY KEY DEFAULT 1,
            cookie_value NVARCHAR(MAX) NULL,
            is_refreshing BIT DEFAULT 0,
            last_refresh_at DATETIME NULL,
            refreshed_by NVARCHAR(255) NULL,
            CONSTRAINT UC_SyncAuth_Id CHECK (id = 1)
        );
        IF NOT EXISTS (SELECT 1 FROM dbo.sync_auth_state WHERE id = 1)
            INSERT INTO dbo.sync_auth_state (id, is_refreshing) VALUES (1, 0);
    END
  `;
  await pool.request().query(query);
}

/**
 * Đọc cookie từ Database
 */
async function getCookieFromDb(pool) {
  if (!pool) return null;
  const res = await pool.request().query('SELECT TOP 1 cookie_value FROM dbo.sync_auth_state WHERE id = 1');
  return res.recordset[0]?.cookie_value || null;
}

/**
 * Đọc cookie từ file auth/cookie.txt (Fallback)
 */
function getCookie() {
  const cookieFilePath = process.env.COOKIE_FILE_PATH || path.join(process.cwd(), 'auth', 'cookie.txt');
  if (!fs.existsSync(cookieFilePath)) return null;
  try {
    const content = fs.readFileSync(cookieFilePath, 'utf8').trim();
    if (_cachedCookie !== content) {
      _cachedCookie = content;
      logger.info(`[SharePointAuth] Đã load Cookie từ file. Độ dài: ${content.length}`);
    }
    return content;
  } catch (err) {
    return null;
  }
}

/**
 * Thực hiện làm mới token bằng cách chạy npm run login ngầm (headless)
 */
/**
 * Làm mới Token với cơ chế Database Lock hỗ trợ chạy đa tiến trình (Multi-terminal)
 */
async function refreshAuth(pool) {
  const terminalName = `Terminal_${process.pid}`;

  if (!pool) {
    logger.warn(`[SharePointAuth] [${terminalName}] Cảnh báo: Không có dbPool, sử dụng lock memory cục bộ.`);
    if (_isRefreshingInMemory) {
      logger.info(`[SharePointAuth] [${terminalName}] Đang có tiến trình login (memory). Chờ...`);
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 3000));
        if (!_isRefreshingInMemory) return true;
      }
      throw new Error('Refresh timeout (memory)');
    }
    _isRefreshingInMemory = true;
  } else {
    await ensureTableExists(pool);


    // 1. Cố gắng giành quyền "khóa" (Atomic Update)
    // Hỗ trợ "Stale Lock": Nếu trạng thái is_refreshing=1 đã quá 10 phút thì cho phép Terminal khác chiếm quyền.
    const lockRes = await pool.request()
      .input('terminal', terminalName)
      .query(`
        UPDATE dbo.sync_auth_state 
        SET is_refreshing = 1, 
            refreshed_by = @terminal,
            last_refresh_at = GETDATE()
        WHERE id = 1 
          AND (is_refreshing = 0 OR DATEDIFF(MINUTE, last_refresh_at, GETDATE()) > 10)
      `);

    if (lockRes.rowsAffected[0] === 0) {
      // 2. Đợi terminal khác làm xong
      logger.info(`[SharePointAuth] [${terminalName}] Đang có terminal khác thực hiện login (DB). Chờ...`);
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const status = await pool.request().query('SELECT is_refreshing, cookie_value FROM dbo.sync_auth_state WHERE id = 1');
        if (status.recordset[0]?.is_refreshing === false) {
          _cachedCookie = status.recordset[0]?.cookie_value;
          return true;
        }
      }
      throw new Error('Refresh timeout (DB)');
    }
  }

  // 3. Thực hiện Login
  try {
    logger.warn(`[SharePointAuth] [${terminalName}] Bắt đầu login...`);
    const isSeaApp = process.execPath.toLowerCase().endsWith('.exe');
    let cmd = isSeaApp ? 'node' : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
    let args = isSeaApp ? [path.join(process.cwd(), 'auth', 'login_playwright.js')] : ['run', 'login'];
    const cookieFilePath = process.env.COOKIE_FILE_PATH || path.join(process.cwd(), 'auth', 'cookie.txt');
    const cookieStatBefore = fs.existsSync(cookieFilePath) ? fs.statSync(cookieFilePath) : null;
    const cookieMtimeBefore = cookieStatBefore?.mtimeMs || 0;

    const loginSuccess = await new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd: process.cwd(), env: { ...process.env, HEADED: 'false' }, shell: true });
      child.on('close', (code) => resolve(code === 0));
      child.on('error', () => resolve(false));
    });

    if (loginSuccess) {
      if (!fs.existsSync(cookieFilePath)) {
        throw new Error(`File cookie không được tạo ra sau login: ${cookieFilePath}`);
      }

      const cookieStatAfter = fs.statSync(cookieFilePath);
      const cookieMtimeAfter = cookieStatAfter?.mtimeMs || 0;
      if (cookieMtimeAfter <= cookieMtimeBefore) {
        throw new Error(
          `File cookie không được làm mới sau login. Có thể tiến trình login đã thất bại nhưng vẫn thoát mã 0: ${cookieFilePath}`
        );
      }
      
      const newCookie = fs.readFileSync(cookieFilePath, 'utf8').trim();
      if (!newCookie || newCookie.length < 50) {
        throw new Error('Nội dung cookie trống hoặc quá ngắn, có thể login thất bại.');
      }

      if (pool) {
        await pool.request()
          .input('val', newCookie)
          .query('UPDATE dbo.sync_auth_state SET cookie_value = @val, last_refresh_at = GETDATE() WHERE id = 1');
      }

      logger.info(`[SharePointAuth] [${terminalName}] ✅ Login thành công. Đã cập nhật Cookie mới.`);
      _cachedCookie = newCookie;
      
      // Đợi một chút để hệ thống SharePoint ổn định sau login (trường hợp load-balance)
      await new Promise(r => setTimeout(r, 10000));
      return true;
    } else {
      throw new Error('Login process exited with non-zero code or failed.');
    }
  } finally {
    // 4. Giải phóng khóa
    if (pool) {
      await pool.request().query('UPDATE dbo.sync_auth_state SET is_refreshing = 0 WHERE id = 1');
    }
    _isRefreshingInMemory = false;
  }
}

async function downloadFile(url, pool = null, retryCount = 0, timeoutMs = 600000) {
  // Ưu tiên lấy từ cache memory -> DB -> file
  let cookie = _cachedCookie;
  if (!cookie && pool) {
    cookie = await getCookieFromDb(pool);
  }
  if (!cookie) {
    cookie = getCookie();
  }

  const doRequest = () =>
    axios.get(url, {
      responseType: 'arraybuffer',
      timeout: timeoutMs,
      httpsAgent,
      maxRedirects: 0,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: '*/*',
        Cookie: cookie || '',
      },
      validateStatus: () => true,
    });

  let response = await doRequest();
  let needsRetry = false;

  const contentType = response.headers['content-type'] || '';
  if (contentType.includes('text/html')) {
    const htmlSnippet = Buffer.from(response.data).toString('utf8').substring(0, 5000).toLowerCase();
    const isRequestingBinaryFile = url.toLowerCase().match(/\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|bmp|zip|rar)$/);

    if (
      htmlSnippet.includes('signincontrol_username') ||
      htmlSnippet.includes('login.aspx') ||
      htmlSnippet.includes('id="login"') ||
      htmlSnippet.includes('adfs') ||
      htmlSnippet.includes('sign in') ||
      htmlSnippet.includes('đăng nhập') ||
      htmlSnippet.includes('ms-servicedriven') ||
      htmlSnippet.includes('fba') ||
      isRequestingBinaryFile
    ) {
      if (retryCount === 0) logger.warn(`[SharePointAuth] Phát hiện trang Login (HTML) thay vì File. Cần refresh token.`);
      needsRetry = true;
    }
  }

  if (response.status === 401 || response.status === 403 || response.status === 302) {
    if (retryCount === 0) logger.warn(`[SharePointAuth] HTTP ${response.status} (Auth Error). Cần refresh token.`);
    needsRetry = true;
  }

  if (needsRetry && retryCount < 1) {
    logger.warn(`[SharePointAuth] Token hết hạn khi truy cập ${url}. Đang làm mới...`);
    try {
      _cachedCookie = null; // Clear cache để force load mới
      await refreshAuth(pool);
      return downloadFile(url, pool, retryCount + 1, timeoutMs);
    } catch (err) {
      logger.error('[SharePointAuth] Không thể tự động làm mới token:', err.message);
      throw new Error('Authentication required and auto-refresh failed.');
    }
  }

  // ★ FIX: Khi needsRetry = true nhưng đã retry quá 1 lần rồi → throw error thay vì return HTML buffer
  if (needsRetry && retryCount >= 1) {
    throw new Error(`[SharePointAuth] Download thất bại sau ${retryCount + 1} lần thử. File có thể yêu cầu đăng nhập hoặc không tồn tại: ${url}`);
  }

  if (response.status !== 200) {
    throw new Error(`[SharePointAuth] HTTP ${response.status} khi tải: ${url}`);
  }

  return Buffer.from(response.data);
}

module.exports = { downloadFile, refreshAuth };
