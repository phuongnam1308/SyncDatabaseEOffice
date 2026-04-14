# Hướng dẫn Chạy Debug Tin tức (Tan-Cang-2) - V2

Tôi đã cập nhật bộ công cụ chẩn đoán để:
1. **Gọi trực tiếp hàm Login (Playwright)**: Không qua `npm run login` để tránh lỗi shell và xem được log chi tiết hơn.
2. **Tư vấn giải pháp**: Nếu script báo lỗi 404 hoặc 401/403, bộ công cụ sẽ gợi ý ngay giải pháp cần làm.
3. **Kiểm tra MinIO**: Đảm bảo các biến môi trường cấu hình kho ảnh được cấu hình đúng.

## 1. Chuẩn bị (Môi trường máy tính bạn copy ra)
Đảm bảo bạn đã cài đặt các thư viện cần thiết:
```bash
npm install axios axios-ntlm mssql dotenv playwright uuid form-data winston
```
*Ghi chú: Nếu lần đầu chạy Playwright báo lỗi thiếu trình duyệt, hãy chạy:*
```bash
npx playwright install chrome
```

## 2. Các file cần thiết
Copy sang máy test (thư mục gốc dự án):
- `.env`
- `package.json`
- `auth/` (Toàn bộ)
- `src/sync-news-aspx-page/` (Toàn bộ)
- `src/sync-file-copy/SharePointAuthService.js`
- `utils/logger.js`

## 3. Chạy Diagnostic
Mở terminal tại thư mục gốc của dự án và chạy:
```bash
node src/sync-news-aspx-page/debug_url_diagnostic.js
```

## 4. Xử lý các tình huống lỗi thường gặp

### Lỗi 404 (Không tìm thấy trang)
- Đây là lỗi thực tế nhất bạn đang gặp: `tan-cang-2.aspx` không tồn tại trên link đó.
- **Cách sửa**: 
  - Thử kiểm tra tên file (Case sensitive): `Tan-Cang-2.aspx` hoặc `TANCANG-2.aspx`.
  - Kiểm tra xem bài viết đã bị xóa khỏi SharePoint chưa.
  - Thử mở link trực tiếp bằng trình duyệt trên máy đó.

### Lỗi Login Failed
- Đảm bảo `CHROME_PATH` trong `.env` trỏ đúng vào file `chrome.exe` trên máy đang test.
- Nếu chạy ngầm (Headless) bị chặn, hãy set `HEADED=true` trong `.env` để xem quá trình login diễn ra như thế nào.

### Lỗi Empty Title/Content (Dữ liệu trống)
- Nếu tải thành công nhưng bóc tách không được, nghĩa là cấu trúc HTML của trang bài viết này khác với các bài trước. 
- Hãy gửi cho tôi file `tintucraw/debug_tan_cang_2.aspx.html` để tôi cập nhật bộ lọc (Selector).
