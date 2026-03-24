const axios = require('axios');
const { NtlmClient } = require('axios-ntlm');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const logger = require('../../utils/logger');

const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.IGNORE_SSL !== 'true',
});

// Cache cookie trong memory để không đọc file mỗi request
let _cachedCookie = null;

/**
 * Đọc cookie từ file auth/cookie.txt
 * @returns {string|null}
 */
function getCookie() {
  if (_cachedCookie) return _cachedCookie;

  const cookieFilePath = process.env.COOKIE_FILE_PATH || path.join(process.cwd(), 'auth', 'cookie.txt');
  if (!fs.existsSync(cookieFilePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(cookieFilePath, 'utf8').trim();
    _cachedCookie = content;
    return _cachedCookie;
  } catch (err) {
    if (logger && logger.error) {
        logger.error('[SharePointAuth] Không đọc được file cookie:', err.message);
    } else {
        console.error('[SharePointAuth] Không đọc được file cookie:', err.message);
    }
    return null;
  }
}

/**
 * Download file từ SharePoint với cookie xác thực.
 * Tự retry 1 lần nếu nhận 403 (cookie hết hạn → đọc lại file).
 *
 * @param {string} url - URL đầy đủ của file trên SharePoint
 * @returns {Promise<Buffer>}
 */
async function downloadFile(url) {
  const cookie = getCookie();

  const doRequest = () =>
    axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 60000,
      httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Cookie': cookie || '',
      },
      validateStatus: () => true,
    });

  // Gửi request
  let response = await doRequest();

  // Kiểm tra nếu nội dung trả về là trang đăng nhập thì tức là cookie đã hết hạn
  if (response.status === 200 && response.headers['content-type']?.includes('text/html')) {
    const htmlSnippet = Buffer.from(response.data).toString('utf8').substring(0, 5000).toLowerCase();

    const isLoginPage =
        htmlSnippet.includes('signincontrol_username') ||
        htmlSnippet.includes('login.aspx') ||
        htmlSnippet.includes('forms/default.aspx?returnurl=') ||
        htmlSnippet.includes('id="login"');

    if (isLoginPage) {
      // Reset cached cookie so next request re-reads the file
      _cachedCookie = null;
      throw new Error(
        '[SharePointAuth] Tải file thất bại - máy chủ trả về trang đăng nhập thay vì file (Cookie hết hạn). ' +
        'Hãy chạy lại `npm run login` để làm mới cookie.'
      );
    }
    // Nếu không có dấu hiệu form đăng nhập, đó là file ASPX hợp lệ!
  }

  // Nếu gặp 401 hoặc 403, có thể cookie đã lỗi hoặc hết hạn
  if (response.status === 401 || response.status === 403 || response.status === 302) {
    _cachedCookie = null;
    throw new Error(
        `[SharePointAuth] HTTP ${response.status} khi tải: ${url}. Cookie có thể đã hết hạn. Hãy chạy 'npm run login'.`
    );
  }

  if (response.status !== 200) {
    throw new Error(`[SharePointAuth] HTTP ${response.status} khi tải: ${url}`);
  }

  return Buffer.from(response.data);
}

module.exports = { downloadFile };
