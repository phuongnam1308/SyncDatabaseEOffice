/**
 * SharePointAuthService.js
 * Tải file từ SharePoint On-Premises với xác thực cookie.
 *
 * Cookie được đọc tự động từ file do Playwright/login.js tạo ra.
 *   COOKIE_FILE_PATH=auth/cookie.txt  ← file cookie do login.js tạo ra
 *
 * Cấu hình trong .env:
 *   BASE_URL=https://eoffice.saigonnewport.com.vn
 *   COOKIE_FILE_PATH=auth/cookie.txt
 */

const axios = require('axios');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.IGNORE_SSL !== 'true',
});

// Cache cookie trong memory để không đọc file mỗi request
let _cachedCookie = null;

/**
 * Đọc cookie từ COOKIE_FILE_PATH (file do login.js tạo ra).
 * @returns {string} cookie string dạng "FedAuth=xxx; rtFa=yyy"
 */
function loadCookie() {
  // // Ưu tiên 1: AUTH_COOKIE trong .env (đã bỏ — dùng login.js tự động thay thế)
  // const envCookie = (process.env.AUTH_COOKIE || '').trim();
  // if (envCookie) {
  //   return envCookie;
  // }

  // Đọc cookie từ file do login.js tạo ra
  const cookieFilePath = process.env.COOKIE_FILE_PATH || 'auth/cookie.txt';
  const absPath = path.isAbsolute(cookieFilePath)
    ? cookieFilePath
    : path.join(process.cwd(), cookieFilePath);

  if (fs.existsSync(absPath)) {
    const content = fs.readFileSync(absPath, 'utf8').trim();
    if (content) return content;
  }

  throw new Error(
    '[SharePointAuth] Không tìm thấy cookie xác thực.\n' +
    'Hãy chạy login.js để tạo file cookie: node src/auth/login.js\n' +
    `Đường dẫn cookie file: ${absPath}`
  );
}

/**
 * Lấy cookie (từ cache hoặc đọc lại từ file).
 * @param {boolean} forceReload - Bỏ qua cache, đọc lại từ file
 */
function getCookie(forceReload = false) {
  if (!forceReload && _cachedCookie) return _cachedCookie;
  _cachedCookie = loadCookie();
  return _cachedCookie;
}

/**
 * Download file từ SharePoint với cookie xác thực.
 * Tự retry 1 lần nếu nhận 403 (cookie hết hạn → đọc lại file).
 *
 * @param {string} url - URL đầy đủ của file trên SharePoint
 * @returns {Promise<Buffer>}
 */
async function downloadFile(url) {
  const doRequest = (cookieStr) =>
    axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      httpsAgent,
      headers: {
        Cookie: cookieStr,
        'User-Agent': 'Mozilla/5.0',
        Accept: '*/*',
      },
      validateStatus: () => true,
    });

  // Lần thử đầu
  let cookie   = getCookie();
  let response = await doRequest(cookie);

  // Nếu 403 → cookie hết hạn → xóa cache, đọc lại file và thử 1 lần nữa
  if (response.status === 403) {
    console.warn('[SharePointAuth] Nhận 403 — cookie có thể hết hạn, đọc lại file...');
    _cachedCookie = null;
    cookie   = getCookie(true);
    response = await doRequest(cookie);
  }

  // Nếu status là 200 nhưng trả về HTML → đó là trang đăng nhập, cookie hết hạn
  if (response.status === 200 && response.headers['content-type']?.includes('text/html')) {
    clearCache();
    throw new Error(
      '[SharePointAuth] Tải file thất bại - máy chủ trả về trang đăng nhập (HTML) thay vì file. ' +
      'Cookie có thể đã hết hạn. Hãy chạy lại `node src/auth/login.js`.'
    );
  }

  if (response.status !== 200) {
    throw new Error(`[SharePointAuth] HTTP ${response.status} khi tải: ${url}`);
  }

  return Buffer.from(response.data);
}

/**
 * Xóa cache cookie trong memory (không xóa file).
 */
function clearCache() {
  _cachedCookie = null;
}

module.exports = { downloadFile, getCookie, clearCache };