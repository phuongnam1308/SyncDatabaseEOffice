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

// Cache cookie và khóa trạng thái refresh
let _cachedCookie = null;
let _isRefreshing = false;
let _refreshPromise = null;

/**
 * Đọc cookie từ file auth/cookie.txt
 * @returns {string|null}
 */
function getCookie() {
  const cookieFilePath =
    process.env.COOKIE_FILE_PATH || path.join(process.cwd(), 'auth', 'cookie.txt');

  if (!fs.existsSync(cookieFilePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(cookieFilePath, 'utf8').trim();
    if (_cachedCookie !== content) {
      _cachedCookie = content;
      logger.info(`[SharePointAuth] Đã load Cookie mới từ file. Tổng ký tự: ${_cachedCookie.length}`);
      // Lấy đoạn đầu và đoạn cuối để dễ đối chiếu lifetime/thay đổi mà không in rác log quá nhiều
      const preview = _cachedCookie.length > 100 
        ? `${_cachedCookie.substring(0, 50)} ... ${_cachedCookie.substring(_cachedCookie.length - 50)}` 
        : _cachedCookie;
      logger.info(`[SharePointAuth] Raw Token: ${preview}`);
    }
    return _cachedCookie;
  } catch (err) {
    logger.error('[SharePointAuth] Không đọc được file cookie:', err.message);
    return null;
  }
}

/**
 * Thực hiện làm mới token bằng cách chạy npm run login ngầm (headless)
 */
async function refreshAuth() {
  if (_isRefreshing) return _refreshPromise;

  _isRefreshing = true;
  _refreshPromise = new Promise((resolve, reject) => {
    logger.info(
      '[SharePointAuth] Phát hiện Token hết hạn. Đang tự động chạy `npm run login` ngầm...',
    );

    const isSeaApp = process.execPath.toLowerCase().endsWith('.exe');
    let cmd, args;

    if (isSeaApp) {
      // Nếu là file EXE, chúng ta cần chạy chính nó với tham số login (giả sử có hỗ trợ)
      // Hoặc tìm file login.js ở thư mục tài nguyên. Ở đây dùng node là an toàn nhất cho môi trường dev/server.
      cmd = 'node';
      args = [path.join(process.cwd(), 'auth', 'login_playwright.js')];
    } else {
      cmd = 'npm';
      args = ['run', 'login'];
      // Trên Windows npm là file .cmd
      if (process.platform === 'win32') cmd = 'npm.cmd';
    }

    const child = spawn(cmd, args, {
      cwd: process.cwd(),
      env: { ...process.env, HEADED: 'false' }, // Luôn ép chạy ngầm
      shell: true,
    });

    child.on('close', (code) => {
      _isRefreshing = false;
      if (code === 0) {
        logger.info('[SharePointAuth] Tự động làm mới Token THÀNH CÔNG.');
        logger.info('[SharePointAuth] ⏳ Đang đợi 5 phút (300s) để hệ thống SharePoint ổn định phiên mới...');
        setTimeout(() => {
          logger.info('[SharePointAuth] ✓ Đã hết thời gian chờ ổn định. Bắt đầu cho phép tải file.');
          _cachedCookie = null; // Reset để getCookie() đọc lại file mới
          resolve(true);
        }, 300000); // 5 phút
      } else {
        logger.error(`[SharePointAuth] Tự động làm mới Token THẤT BẠI (Exit code ${code}).`);
        reject(new Error('Background login failed'));
      }
    });

    child.on('error', (err) => {
      _isRefreshing = false;
      logger.error('[SharePointAuth] Lỗi khởi tạo trình login:', err.message);
      reject(err);
    });
  });

  return _refreshPromise;
}

/**
 * Download file từ SharePoint với cookie xác thực.
 * Tự động login và retry nếu phát hiện hết hạn.
 */
async function downloadFile(url, retryCount = 0, timeoutMs = 600000) {
  let cookie = getCookie();

  const doRequest = () =>
    axios.get(url, {
      responseType: 'arraybuffer',
      timeout: timeoutMs,
      httpsAgent,
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

  // 1. Kiểm tra nếu trả về trang đăng nhập HTML (Dấu hiệu cookie hết hạn trên SharePoint)
  if (response.status === 200 && response.headers['content-type']?.includes('text/html')) {
    const htmlSnippet = Buffer.from(response.data)
      .toString('utf8')
      .substring(0, 5000)
      .toLowerCase();
    
    // Nếu URL rõ ràng đang trỏ tới một file nhị phân (pdf, doc, xls, png...)
    // Nhưng SharePoint lại trả về text/html, chắc chắn đó là trang Login/Error chặn ở giữa
    const isRequestingBinaryFile = url.toLowerCase().match(/\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|bmp|zip|rar)$/);

    if (
      htmlSnippet.includes('signincontrol_username') ||
      htmlSnippet.includes('login.aspx') ||
      htmlSnippet.includes('id="login"') ||
      htmlSnippet.includes('adfs') ||
      htmlSnippet.includes('sign in') ||
      htmlSnippet.includes('đăng nhập') ||
      isRequestingBinaryFile
    ) {
      needsRetry = true;
    }
  }

  // 2. Kiểm tra mã lỗi HTTP trực tiếp
  if (response.status === 401 || response.status === 403 || response.status === 302) {
    needsRetry = true;
  }

  // Thực hiện Retry nếu cần và chưa quá giới hạn
  if (needsRetry && retryCount < 1) {
    logger.warn(`[SharePointAuth] Token hết hạn khi truy cập ${url}. Đang làm mới...`);
    try {
      await refreshAuth();
      return downloadFile(url, retryCount + 1, timeoutMs); // Đệ quy thử lại với cookie mới
    } catch (err) {
      logger.error('[SharePointAuth] Không thể tự động làm mới token:', err.message);
      throw new Error('Authentication required and auto-refresh failed.');
    }
  }

  if (response.status !== 200) {
    throw new Error(`[SharePointAuth] HTTP ${response.status} khi tải: ${url}`);
  }

  return Buffer.from(response.data);
}

module.exports = { downloadFile, refreshAuth };
