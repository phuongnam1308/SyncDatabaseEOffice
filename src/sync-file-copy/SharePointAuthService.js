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
const { NtlmClient } = require('axios-ntlm');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.IGNORE_SSL !== 'true',
});

// Cache cookie trong memory để không đọc file mỗi request
let _cachedCookie = null;

/**
 * Download file từ SharePoint với cookie xác thực.
 * Tự retry 1 lần nếu nhận 403 (cookie hết hạn → đọc lại file).
 *
 * @param {string} url - URL đầy đủ của file trên SharePoint
 * @returns {Promise<Buffer>}
 */
async function downloadFile(url) {
  const client = new NtlmClient({
    username: process.env.USERNAME,
    password: process.env.PASSWORD,
    // domain: process.env.DOMAIN || '' // if required
  });

  const doRequest = () =>
    client.request({
      url: url,
      method: 'get',
      responseType: 'arraybuffer',
      timeout: 30000,
      httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: '*/*',
      },
      validateStatus: () => true,
    });

  // Gửi request bằng NTLM. NtlmClient tự lo handshake 401 -> 200
  let response = await doRequest();

  // Kiểm tra nếu nội dung trả về là trang đăng nhập thì tức là cookie đã hết hạn
  if (response.status === 200 && response.headers['content-type']?.includes('text/html')) {
    const htmlSnippet = Buffer.from(response.data).toString('utf8').substring(0, 50000);
    if (htmlSnippet.includes('signInControl_UserName') || htmlSnippet.includes('login.aspx') || htmlSnippet.includes('Forms/default.aspx?ReturnUrl=')) {
      clearCache();
      throw new Error(
        '[SharePointAuth] Tải file thất bại - máy chủ trả về trang đăng nhập thay vì file (Cookie hết hạn). ' +
        'Hãy chạy lại `npm run login` để làm mới cookie.'
      );
    }
    // Nếu không có dấu hiệu form đăng nhập, đó là file ASPX hợp lệ!
  }

  if (response.status !== 200) {
    throw new Error(`[SharePointAuth] HTTP ${response.status} khi tải: ${url}`);
  }

  return Buffer.from(response.data);
}

module.exports = { downloadFile };