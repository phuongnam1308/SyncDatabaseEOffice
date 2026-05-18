const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('../../utils/logger');

const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.IGNORE_SSL !== 'true',
  keepAlive: true,
  keepAliveMsecs: 10000,
  maxSockets: 10,       // Giới hạn số kết nối đồng thời tránh quá tải SharePoint
  maxFreeSockets: 5,
});

// ═══════════════════════════════════════════════════════════════════
//  MODULE-LEVEL STATE
// ═══════════════════════════════════════════════════════════════════

// Cookie memory cache + timestamp
let _cachedCookie = null;
let _cookieLoadedAt = 0;           // Epoch ms khi cookie được load vào memory
const COOKIE_MEMORY_TTL_MS = 25 * 60 * 1000; // Cookie memory cache TTL: 25 phút

// Dedup: 1 Promise duy nhất cho toàn bộ quá trình refresh (tránh N workers cùng refresh)
let _refreshPromise = null;

// URL-level download cache: tránh download cùng URL ảnh/file nhiều lần
// Key: URL (chuẩn hóa) -> Value: Buffer hoặc Error sentinel
const _downloadCache = new Map();
const DOWNLOAD_CACHE_MAX = 2000;

// Danh sách URL đã xác nhận là 404/folder (không retry)
const _permanentFailSet = new Set();
const PERMANENT_FAIL_MAX = 5000;

// ═══════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Chuẩn hóa URL để làm cache key (bỏ query string)
 */
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}

/**
 * Kiểm tra xem HTML content có phải là trang Login thật sự không
 * (Phân biệt Login page vs trang .aspx news bình thường cũng có text "đăng nhập")
 */
function isLoginPage(htmlSnippet) {
  const s = htmlSnippet.toLowerCase();
  // Các dấu hiệu mạnh: form đăng nhập thực sự
  const strongSignals = [
    'signincontrol_username',
    'id="usernamefield"',
    'id="passwordfield"',
    'type="password"',
    'action="/adfs/',
    '/login.aspx?',
    'fba/pages/login',
    'ms-servicedriven',  // SharePoint FBA login wrapper
  ];
  // Dấu hiệu yếu: có thể xuất hiện trên cả bài viết bình thường
  const weakSignals = ['đăng nhập', 'sign in', 'login.aspx', 'adfs'];

  const strongMatch = strongSignals.some(sig => s.includes(sig));
  if (strongMatch) return true;

  // Chỉ coi là login page nếu có ít nhất 2 dấu hiệu yếu cùng lúc
  const weakMatches = weakSignals.filter(sig => s.includes(sig)).length;
  return weakMatches >= 2;
}

/**
 * Kiểm tra xem URL redirect (302) có phải là Folder/View (không phải bài viết)
 */
function isFolderRedirect(location) {
  const loc = location.toLowerCase();
  return (
    loc.includes('thumbnails.aspx') ||
    loc.includes('allitems.aspx') ||
    loc.includes('/forms/') ||
    loc.includes('viewnews.aspx') ||
    loc.includes('dispform.aspx') ||
    loc.includes('newform.aspx') ||
    loc.includes('editform.aspx')
  );
}

// ═══════════════════════════════════════════════════════════════════
//  DATABASE HELPERS
// ═══════════════════════════════════════════════════════════════════

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

async function getCookieFromDb(pool) {
  if (!pool) return null;
  try {
    const res = await pool.request().query('SELECT TOP 1 cookie_value, last_refresh_at FROM dbo.sync_auth_state WHERE id = 1');
    const row = res.recordset[0];
    if (!row?.cookie_value) return null;

    // Kiểm tra cookie DB còn hạn không (< 25 phút kể từ last_refresh_at)
    if (row.last_refresh_at) {
      const ageMs = Date.now() - new Date(row.last_refresh_at).getTime();
      if (ageMs > COOKIE_MEMORY_TTL_MS) {
        logger.warn(`[SharePointAuth] Cookie trong DB đã quá ${Math.round(ageMs / 60000)} phút. Cần làm mới.`);
        return null; // Buộc refresh
      }
    }
    return row.cookie_value;
  } catch (err) {
    logger.warn(`[SharePointAuth] Không đọc được cookie từ DB: ${err.message}`);
    return null;
  }
}

function getCookieFromFile() {
  const cookieFilePath = process.env.COOKIE_FILE_PATH || path.join(process.cwd(), 'auth', 'cookie.txt');
  if (!fs.existsSync(cookieFilePath)) return null;
  try {
    const content = fs.readFileSync(cookieFilePath, 'utf8').trim();
    if (content && content !== _cachedCookie) {
      _cachedCookie = content;
      _cookieLoadedAt = Date.now();
      logger.info(`[SharePointAuth] Đã load Cookie từ file. Độ dài: ${content.length}`);
    }
    return content || null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  REFRESH AUTH (với In-flight Dedup)
// ═══════════════════════════════════════════════════════════════════

/**
 * Làm mới token.
 * QUAN TRỌNG: Dùng 1 Promise duy nhất (_refreshPromise) cho tất cả caller đồng thời.
 * N workers cùng phát hiện token expired → chỉ 1 lần login thật sự, N-1 workers đợi.
 */
async function refreshAuth(pool) {
  // Nếu đang có refresh, đợi kết quả của nó thay vì spawn thêm
  if (_refreshPromise) {
    logger.info(`[SharePointAuth] Đang có refresh đang chạy, đợi kết quả...`);
    return _refreshPromise;
  }

  _refreshPromise = _doRefreshAuth(pool).finally(() => {
    _refreshPromise = null; // Giải phóng sau khi xong (dù thành công hay thất bại)
  });

  return _refreshPromise;
}

async function _doRefreshAuth(pool) {
  const terminalName = `PID_${process.pid}`;
  logger.warn(`[SharePointAuth] [${terminalName}] Bắt đầu làm mới token SharePoint...`);

  // DB Lock (nếu có pool)
  if (pool) {
    await ensureTableExists(pool);
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
      // Process khác đang refresh → đợi nó xong
      logger.info(`[SharePointAuth] [${terminalName}] Process khác đang login (DB lock). Đợi...`);
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const status = await pool.request().query(
          'SELECT is_refreshing, cookie_value, last_refresh_at FROM dbo.sync_auth_state WHERE id = 1'
        );
        const row = status.recordset[0];
        if (!row?.is_refreshing) {
          _cachedCookie = row?.cookie_value || null;
          _cookieLoadedAt = Date.now();
          logger.info(`[SharePointAuth] [${terminalName}] Process khác đã login xong. Dùng cookie mới.`);
          return true;
        }
      }
      throw new Error('[SharePointAuth] Timeout chờ DB lock refresh (2 phút).');
    }
  }

  // Thực hiện Login
  try {
    const cookieFilePath = process.env.COOKIE_FILE_PATH || path.join(process.cwd(), 'auth', 'cookie.txt');
    const mtimeBefore = fs.existsSync(cookieFilePath) ? fs.statSync(cookieFilePath).mtimeMs : 0;

    const currentExec = process.execPath;
    const isNode = currentExec.toLowerCase().includes('node.exe') || currentExec.toLowerCase().endsWith('node');
    
    let cmd = isNode ? currentExec : 'node';
    let args = [path.join(process.cwd(), 'auth', 'login_playwright.js')];

    logger.info(`[SharePointAuth] Executing login script: ${cmd} ${args.join(' ')} (CWD: ${process.cwd()})`);

    const loginSuccess = await new Promise((resolve) => {
      const child = spawn(cmd, args, {
        cwd: process.cwd(),
        env: { ...process.env }, 
        shell: false,
        stdio: ['inherit', 'pipe', 'pipe'] // Giữ stdin inherit để an toàn, pipe stdout/err để log
      });

      let output = '';
      child.stdout.on('data', (data) => { output += data.toString(); });
      child.stderr.on('data', (data) => { output += data.toString(); });

      child.on('close', code => {
        if (code !== 0) {
          logger.error(`[SharePointAuth] [${terminalName}] Login failed with code ${code}. Output:\n${output}`);
        }
        resolve(code === 0);
      });
      child.on('error', (err) => {
        logger.error(`[SharePointAuth] [${terminalName}] Spawn error: ${err.message}`);
        resolve(false);
      });
    });

    if (!loginSuccess) {
      throw new Error('Login process exited with non-zero code. Check logs for details.');
    }

    if (!fs.existsSync(cookieFilePath)) {
      throw new Error(`File cookie không tồn tại sau login: ${cookieFilePath}`);
    }

    const mtimeAfter = fs.statSync(cookieFilePath).mtimeMs;
    if (mtimeAfter <= mtimeBefore) {
      throw new Error('File cookie không được cập nhật sau login (có thể login thất bại).');
    }

    const newCookie = fs.readFileSync(cookieFilePath, 'utf8').trim();
    if (!newCookie || newCookie.length < 50) {
      throw new Error('Cookie rỗng hoặc quá ngắn.');
    }

    // Cập nhật cache memory
    _cachedCookie = newCookie;
    _cookieLoadedAt = Date.now();

    // Cập nhật DB
    if (pool) {
      await pool.request()
        .input('val', newCookie)
        .query('UPDATE dbo.sync_auth_state SET cookie_value = @val, last_refresh_at = GETDATE() WHERE id = 1');
    }

    logger.info(`[SharePointAuth] [${terminalName}] ✅ Login thành công. Cookie mới: ${newCookie.length} ký tự.`);

    // Đợi SharePoint ổn định sau login (load-balancer sync)
    await new Promise(r => setTimeout(r, 5000));
    return true;

  } finally {
    if (pool) {
      await pool.request().query('UPDATE dbo.sync_auth_state SET is_refreshing = 0 WHERE id = 1');
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  DOWNLOAD FILE (với Cache + Smart Auth Detection)
// ═══════════════════════════════════════════════════════════════════

/**
 * Tải file từ SharePoint với:
 * - URL dedup cache: không tải lại file đã tải thành công
 * - Permanent fail set: không retry URL đã xác nhận là 404/folder
 * - Smart auth detection: phân biệt login page thật vs trang .aspx news
 * - Single refresh: khi nhiều worker cùng thấy token expired, chỉ login 1 lần
 */
async function downloadFile(url, pool = null, retryCount = 0, timeoutMs = 120000) {
  const cacheKey = normalizeUrl(url);

  // === FAST PATH: URL đã xác nhận thất bại vĩnh viễn (404/folder) ===
  if (_permanentFailSet.has(cacheKey)) {
    throw new Error(`404 Not Found (cached permanent fail): ${url}`);
  }

  // === FAST PATH: Đã có buffer trong cache (Bỏ qua với gọi API) ===
  if (!url.includes('/_api/')) {
    const cached = _downloadCache.get(cacheKey);
    if (cached instanceof Buffer) {
      logger.debug(`[SharePointAuth] Cache hit: ${cacheKey}`);
      return cached;
    }
  }

  // === Lấy cookie (memory → DB → file) ===
  let cookie = null;

  // Kiểm tra cookie memory còn hạn không
  const cookieAgeMs = Date.now() - _cookieLoadedAt;
  if (_cachedCookie && cookieAgeMs < COOKIE_MEMORY_TTL_MS) {
    cookie = _cachedCookie;
  } else {
    if (_cachedCookie) {
      logger.info(`[SharePointAuth] Cookie memory hết hạn (${Math.round(cookieAgeMs / 60000)} phút). Đọc lại từ DB/file.`);
      _cachedCookie = null;
    }
    if (pool) cookie = await getCookieFromDb(pool);
    if (!cookie) cookie = getCookieFromFile();
    if (cookie) {
      _cachedCookie = cookie;
      _cookieLoadedAt = Date.now();
    }
  }

  // === FIX: Tự động thêm ?InitialTabId=Ribbon.Read vào URL .aspx ===
  // SharePoint cần tham số này để render nội dung bài viết thay vì redirect 302.
  // Chỉ thêm nếu URL là .aspx VÀ chưa có query string InitialTabId.
  let actualUrl = url;
  try {
    const parsedUrl = new URL(url);
    const isAspxPage = parsedUrl.pathname.toLowerCase().endsWith('.aspx');
    const hasInitialTabId = parsedUrl.searchParams.has('InitialTabId');
    const isBinaryFile = /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|bmp|zip|rar)$/i.test(parsedUrl.pathname);

    if (isAspxPage && !hasInitialTabId && !isBinaryFile) {
      parsedUrl.searchParams.set('InitialTabId', 'Ribbon.Read');
      actualUrl = parsedUrl.toString();
      logger.debug(`[SharePointAuth] Thêm InitialTabId vào URL: ${actualUrl}`);
    }
  } catch { /* giữ nguyên url nếu parse thất bại */ }

  const response = await axios.get(actualUrl, {
    responseType: 'arraybuffer',
    timeout: timeoutMs,
    httpsAgent,
    maxRedirects: 0,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': url.includes('/_api/') ? 'application/json;odata=verbose' : '*/*', //Nếu có chứa /_api/ thì accept là json, ngược lại là */*
      'Cookie': cookie || '',
    },
    validateStatus: () => true,
  });

  // === BƯỚC 1: Xử lý 302 Redirect ===
  if (response.status === 302) {
    const location = response.headers['location'] || '';

    // 302 → Folder/View: lỗi vĩnh viễn, không retry, không login
    if (isFolderRedirect(location)) {
      logger.warn(`[SharePointAuth] Folder redirect (302 → ${location}). Đánh dấu 404 vĩnh viễn.`);
      _addPermanentFail(cacheKey);
      throw new Error(`404 Not Found - Folder redirect: ${location}`);
    }

    // 302 cho .aspx mà chưa thêm InitialTabId → thử lại với suffix (1 lần duy nhất)
    if (actualUrl === url && url.toLowerCase().includes('.aspx') && retryCount === 0) {
      try {
        const retryUrl = new URL(url);
        retryUrl.searchParams.set('InitialTabId', 'Ribbon.Read');
        logger.warn(`[SharePointAuth] 302 nhận được, thử lại với InitialTabId: ${retryUrl.toString()}`);
        return downloadFile(retryUrl.toString(), pool, retryCount, timeoutMs);
      } catch { /* fall through to auth error */ }
    }

    // 302 → Auth: cần refresh token
    logger.warn(`[SharePointAuth] HTTP 302 Auth redirect. URL: ${url} → ${location}`);
    return _handleAuthError(url, pool, retryCount, timeoutMs, `HTTP 302 redirect to: ${location}`);
  }


  // === BƯỚC 2: Xử lý 401/403 ===
  if (response.status === 401 || response.status === 403) {
    logger.warn(`[SharePointAuth] HTTP ${response.status} Auth Error cho: ${url}`);
    return _handleAuthError(url, pool, retryCount, timeoutMs, `HTTP ${response.status}`);
  }

  // === BƯỚC 3: Xử lý 404 ===
  if (response.status === 404) {
    _addPermanentFail(cacheKey);
    throw new Error(`404 Not Found: ${url}`);
  }

  // === BƯỚC 4: Kiểm tra HTML response cho file binary hoặc trang .aspx ===
  const contentType = response.headers['content-type'] || '';
  if (contentType.includes('text/html')) {
    const htmlSnippet = Buffer.from(response.data).toString('utf8').substring(0, 3000);
    const isRequestingBinary = /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|bmp|zip|rar)$/i.test(url);

    if (isRequestingBinary) {
      // Binary file nhưng nhận được HTML → chắc chắn là login page
      logger.warn(`[SharePointAuth] Nhận HTML khi mong đợi file binary. URL: ${url}. Refresh token.`);
      return _handleAuthError(url, pool, retryCount, timeoutMs, 'HTML response for binary file');
    }

    // .aspx page: chỉ refresh nếu thực sự là login page
    if (isLoginPage(htmlSnippet)) {
      logger.warn(`[SharePointAuth] Phát hiện trang Login thật sự (không phải bài viết). URL: ${url}`);
      return _handleAuthError(url, pool, retryCount, timeoutMs, 'Login page detected');
    }

    // Bình thường: .aspx news page trả về HTML → OK
  }

  // === BƯỚC 5: Các lỗi HTTP khác ===
  if (response.status !== 200) {
    throw new Error(`[SharePointAuth] HTTP ${response.status} khi tải: ${url}`);
  }

  // === THÀNH CÔNG ===
  const buffer = Buffer.from(response.data);

  // Lưu vào cache (chỉ với file nhỏ hơn 5MB và KHÔNG PHẢI là API)
  if (buffer.length < 5 * 1024 * 1024 && !url.includes('/_api/')) {
    _downloadCache.set(cacheKey, buffer);
    // Dọn cache nếu quá lớn
    if (_downloadCache.size > DOWNLOAD_CACHE_MAX) {
      const oldKey = _downloadCache.keys().next().value;
      _downloadCache.delete(oldKey);
    }
  }

  return buffer;
}

/**
 * Xử lý lỗi Auth: refresh token 1 lần rồi retry.
 * Nếu đã retry rồi (retryCount >= 1) → throw thay vì loop vô hạn.
 */
async function _handleAuthError(url, pool, retryCount, timeoutMs, reason) {
  if (retryCount >= 1) {
    // Đã refresh 1 lần mà vẫn lỗi → file này thực sự không truy cập được
    const cacheKey = normalizeUrl(url);
    _addPermanentFail(cacheKey);
    throw new Error(`[SharePointAuth] Vẫn lỗi sau khi đã refresh token (${reason}). URL: ${url}`);
  }

  logger.warn(`[SharePointAuth] Token hết hạn (${reason}). Đang làm mới... URL: ${url}`);
  try {
    _cachedCookie = null; // Bắt buộc đọc lại cookie mới
    await refreshAuth(pool);
    return downloadFile(url, pool, retryCount + 1, timeoutMs);
  } catch (err) {
    logger.error(`[SharePointAuth] Không thể làm mới token: ${err.message}`);
    throw new Error(`Authentication required and auto-refresh failed: ${err.message}`);
  }
}

/**
 * Thêm URL vào permanent fail set với giới hạn kích thước
 */
function _addPermanentFail(cacheKey) {
  _permanentFailSet.add(cacheKey);
  if (_permanentFailSet.size > PERMANENT_FAIL_MAX) {
    // Xóa 20% entries cũ nhất (Set duy trì insertion order)
    const toDelete = Math.floor(PERMANENT_FAIL_MAX * 0.2);
    let count = 0;
    for (const key of _permanentFailSet) {
      if (count >= toDelete) break;
      _permanentFailSet.delete(key);
      count++;
    }
  }
}

module.exports = { downloadFile, refreshAuth };
