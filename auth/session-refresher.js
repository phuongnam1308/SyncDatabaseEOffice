require('dotenv').config();
const { downloadFile, refreshAuth } = require('../src/sync-file-copy/SharePointAuthService');
const logger = require('../utils/logger');
const path = require('path');

const CHECK_INTERVAL_MS = 10 * 60 * 1000; // Kiểm tra mỗi 10 phút

async function checkAndRefreshIfNeeded() {
  const testUrl = `${process.env.BASE_URL || 'https://eoffice.saigonnewport.com.vn'}/tintuc/Pages/default.aspx`;
  
  logger.info(`[SessionRefresher] Đang kiểm tra Session định kỳ...`);
  
  try {
    // downloadFile đã có logic tự động refreshAuth() bên trong nếu phát hiện hết hạn.
    // Việc gọi ở đây giúp chúng ta "hớt tay trên" trước khi các job sync lớn bắt đầu.
    await downloadFile(testUrl);
    logger.info('[SessionRefresher] SharePoint Session hiện tại vẫn còn hiệu lực.');
  } catch (error) {
    logger.warn(`[SessionRefresher] Phát hiện Session hết hạn hoặc lỗi: ${error.message}. Đang thử khôi phục...`);
    try {
        await refreshAuth();
        logger.info('[SessionRefresher] SharePoint Session đã được làm mới thành công.');
    } catch (refreshErr) {
        logger.error(`[SessionRefresher] KHÔNG THỂ khôi phục Session: ${refreshErr.message}`);
    }
  }
}

function startSessionRefresher() {
  logger.info('[SessionRefresher] Dịch vụ tự động duy trì Session đã được kích hoạt.');
  logger.info(`[SessionRefresher] Tần suất kiểm tra: ${CHECK_INTERVAL_MS / 60000} phút/lần.`);
  
  // 1. Chạy kiểm tra ngay lập tức khi khởi động.
  checkAndRefreshIfNeeded();

  // 2. Định kỳ kiểm tra.
  setInterval(checkAndRefreshIfNeeded, CHECK_INTERVAL_MS);
}

// Nếu chạy trực tiếp file này (không phải require)
if (require.main === module) {
  startSessionRefresher();
}

module.exports = { startSessionRefresher };
