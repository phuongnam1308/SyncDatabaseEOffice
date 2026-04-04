# 🚢 SNP - ĐỒNG BỘ DỮ LIỆU - HƯỚNG DẪN SỬ DỤNG ⚓

Chào mừng đồng chí đến với hệ thống đồng bộ dữ liệu EOffice phiên bản chuyên nghiệp. Dưới đây là các bước để cài đặt và vận hành phần mềm.

## 1. Yêu cầu hệ thống
*   **Hệ điều hành**: Windows 10 trở lên.
*   **Trình duyệt**: Google Chrome (bắt buộc để chạy module tự động đăng nhập).
*   **Môi trường**: Máy tính có thể kết nối tới Database SQL Server mục tiêu.

## 2. Các bước cài đặt tự động (Khuyên dùng)

Để cài đặt phần mềm vào ổ C và tạo Shortcut ra Desktop chỉ với 1 click:
1.  Vào thư mục `dist`.
2.  Chuột phải vào file **`install.bat`** chọn **"Run as administrator"**.
3.  Chờ thông báo "Cài đặt thành công".

## 3. Khởi động phần mềm
Sau khi cài đặt, bạn chỉ cần kích đúp chuột vào biểu tượng ngoài Desktop:
👉 **`SNP - ĐỒNG BỘ DỮ LIỆU`**

**Điều gì sẽ xảy ra?**
*   Một cửa sổ Terminal sẽ hiện ra để duy trì máy chủ.
*   **Trình duyệt Chrome sẽ tự động bật lên** và đưa bạn thẳng tới Bảng điều khiển (Dashboard) tại địa chỉ: `http://localhost:3021/api/sync-manager-src/dashboard`.

## 4. Các tính năng chính

### 📊 Bảng điều khiển (Dashboard)
Truy cập tại: `http://localhost:3021/api/sync-manager-src/dashboard`
*   Theo dõi tiến trình đồng bộ 24/7 theo thời gian thực (Realtime).
*   Nút **"Chạy"**: Bắt đầu đồng bộ các đối tượng (Passport, Lịch họp, v.v.).
*   Nút **"Dừng"**: Tạm dừng tiến trình nếu cần bảo trì.

### 📘 Tài liệu API (Swagger Offline)
Truy cập tại: `http://localhost:3021/swagger`
*   Xem hướng dẫn chi tiết về các cổng API.
*   **Đặc biệt**: Hoạt động hoàn toàn Offline, không cần internet.

## 5. Lưu ý quan trọng
*   **Không tắt cửa sổ Terminal** khi phần mềm đang chạy.
*   Nếu Dashboard không hiển thị dữ liệu, hãy kiểm tra lại kết nối Database trong file `.env` (nằm tại `C:\SNP_DongBoDuLieu\.env`).
*   File `auth/storageState.json` chứa phiên đăng nhập của bạn, hãy giữ bí mật file này.

---
*Chúc đồng chí hoàn thành xuất sắc nhiệm vụ đồng bộ dữ liệu!*
