# 🚢 SNP - ĐỒNG BỘ DỮ LIỆU - SOURCE CODE ⚓

Đây là mã nguồn hệ thống đồng bộ dữ liệu EOffice chuyên dụng cho Tân Cảng. Dự án đã tích hợp mã hóa bảo mật (Obfuscation) và quy trình đóng gói ứng dụng Windows chuyên nghiệp.

## 🛠 Yêu cầu phát triển
*   **Node.js**: Phiên bản 18 trở lên.
*   **Tiền xử lý**: Cần cài thư viện Chrome để module `playwright` có thể chạy tự động đăng nhập.

## 🚀 Các lệnh vận hành quan trọng (Scripts)

### 1. Đăng nhập & Lấy Session (Quan trọng nhất)
Trước khi chạy bất kỳ tiến trình đồng bộ nào, bạn cần đảm bảo đã có session đăng nhập hợp lệ:
```powershell
npm run login
```
*Lệnh này sẽ tự động bật Chrome, đăng nhập và lưu Cookie vào file `auth/storageState.json`.*

### 2. Phát triển & Chạy thử
```powershell
npm run all
```
*Lệnh này sẽ tự động chạy Login sau đó bật Server đồng bộ (`npm start`).*

### 3. Đóng gói mã hóa (Build Webpack)
Để tạo ra sản phẩm không lộ code nguồn:
```powershell
npm run build
```
*Kết quả sẽ nằm trong thư mục `dist`. Toàn bộ code đã được mã hóa/ẩn giấu logic.*

### 4. Tạo bộ cài Windows (EXE)
Để tạo ra file thực thi duy nhất mang đi máy khác:
```powershell
npm run build:exe
```
*Tệp `.exe` sẽ được sinh ra trong `dist/`. Đã cài đặt tự bật trình duyệt khi chạy.*

## 📦 Cấu trúc thư mục đóng gói (Portable)
Sau khi build, bạn chỉ cần gửi thư mục `dist/` đi. Bên trong bao gồm:
1.  **`SNP - DONG BO DU LIEU.exe`**: File ứng dụng chính.
2.  **`.env`**: File cấu hình Database và Hostname.
3.  **`auth/`**: Thư mục chứa session đăng nhập (Người nhận sẽ không cần login lại).
4.  **`setup_domain.bat`**: Script cấu hình tên miền `SNP-DongBoDuLieu`.
5.  **`HUONG_DAN.md`**: Bản hướng dẫn sử dụng tiếng Việt cho người dùng cuối.

## 🎨 Tên miền & Thương hiệu
*   **Hostname**: Hệ thống được cấu hình mặc định chạy tại `http://SNP-DongBoDuLieu:3021`.
*   **Port**: Cổng mặc định là `3021`.
*   **Tài liệu API**: Truy cập `/swagger` để xem toàn bộ tài liệu API offline.

---
**⚓ Đội ngũ phát triển SNP - ĐỒNG BỘ DỮ LIỆU**