# ⚓ SNP SYNC DATABASE EOFFICE - SYSTEM CONTEXT FOR AI

Tài liệu này được thiết kế để giúp Grok (hoặc các AI Agent) hiểu thấu đáo cấu trúc và cơ chế của dự án Đồng bộ Dữ liệu EOffice Tân Cảng (SNP).

## 🚀 1. Tổng quan dự án (Project Overview)
- **Tên dự án**: SNP Sync Database EOffice.
- **Mục tiêu**: Đồng bộ dữ liệu từ SQL Server SharePoint cũ sang Database DiOffice mới.
- **Đặc điểm**: Chạy trong môi trường **Air-gapped** (Mạng nội bộ cách ly), đóng gói dạng **Portable EXE** (SEA - Single Executable Application).

## 🛠 2. Công nghệ cốt lõi (Technology Stack)
- **Runtime**: Node.js 22.x (SEA).
- **Backend**: Express.js + MSSQL (`tedious`).
- **Automation**: Playwright (Giả lập đăng nhập lấy Token).
- **Packaging**: Webpack 5 + Native Node SEA.

## 🏗 3. Kiến trúc đặc trưng (Key Architecture)

### 🛡️ Cơ chế Port 3030 (Single Instance Lock)
Sử dụng cổng **3030** làm "người gác cổng". Nếu bản EXE thứ 2 chạy lên, nó sẽ thấy cổng 3030 đã bị chiếm và tự động thoát để tránh xung đột dữ liệu.

### 🌐 Cổng Dashboard
- **Port 3025**: Cổng chính chạy API và Dashboard tại `http://localhost:3025/api/sync-manager-src/dashboard`.

### 📦 Quy trình Build chuẩn (build:exe)
1. **Swagger**: Tạo tài liệu API offline.
2. **Webpack**: Gộp code vào `dist/app.js`.
3. **SEA**: Tiêm (inject) `sea-prep.blob` vào EXE Node gốc.
4. **Post-Build**: Tự nén biểu tượng mỏ neo vàng chuẩn 256x256 và đóng gói ZIP.

## 📁 4. Sơ đồ thư mục chủ đạo
- `/src`: Chứa core logic (Migration Models/Controllers).
- `/auth`: Logic đăng nhập Playwright.
- `/scripts`: Script build (`post-build.js`, `install.bat`).
- `index.js`: Entry point của hệ thống.

## ⚓ 5. Các lưu ý đặc biệt cho AI
- **Path Resolution**: Luôn dùng `process.execPath` thay vì `__dirname` khi ứng dụng chạy dạng EXE.
- **Self-Healing**: Ứng dụng tự động chữa lành phím tắt Desktop mỗi khi khởi chạy.
- **Offline First**: Không được gọi API từ bên ngoài hoặc tải thêm thư viện khi đang vận hành tại quân cảng.

---
> [!TIP]
> Hãy nhắc Grok đọc file này trước mỗi lần bắt đầu yêu cầu chỉnh sửa dự án.
