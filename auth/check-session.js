const { downloadFile } = require('../src/sync-file-copy/SharePointAuthService');
const logger = require('../utils/logger');
require('dotenv').config();

async function checkSession() {
  const testUrl = `${process.env.BASE_URL || 'https://eoffice.saigonnewport.com.vn'}/tintuc/Pages/default.aspx`;
  
  logger.info(`[CheckSession] Đang kiểm tra kết nối tới SharePoint: ${testUrl}`);
  
  try {
    // Thử tải trang chủ SharePoint. 
    // Nếu hết hạn, downloadFile() sẽ tự động kích hoạt refreshAuth() nhờ logic mới thêm.
    await downloadFile(testUrl);
    logger.info('[CheckSession] KẾT QUẢ: Session hiện tại HỢP LỆ.');
    process.exit(0);
  } catch (err) {
    logger.error(`[CheckSession] KẾT QUẢ: Session KHÔNG HỢP LỆ hoặc tự động refresh thất bại: ${err.message}`);
    process.exit(1);
  }
}

checkSession();
