# ⚓ SNP - ĐỒNG BỘ DỮ LIỆU - HƯỚNG DẪN VẬN HÀNH 🚢

Chào mừng đồng chí đến với hệ thống đồng bộ dữ liệu EOffice phiên bản Portable. Hệ thống này được thiết kế để hoạt động ổn định, bảo mật và hoàn toàn Offline trong môi trường quân cảng.

---

## 1. 📋 Yêu cầu hệ thống
*   **Hệ điều hành**: Windows 10 / Windows 11.
*   **Trình duyệt**: Google Chrome (Cần thiết để module Playwright tự động đăng nhập).
*   **Kết nối**: Đảm bảo máy tính có thể "thông" tới địa chỉ IP của Database SQL Server mục tiêu.

---

## 2. 🚀 Cài đặt siêu tốc (Chỉ 1 Click)

> [!IMPORTANT]
> **Tự động hóa quyền Admin**: File cài đặt mới đã được tích hợp công nghệ "Self-Elevation". Đồng chí không cần phải chuột phải chọn "Run as administrator".

1.  Mở thư mục chứa bộ cài (thường là `snp_sync`).
2.  Nháy đúp chuột trái vào file **`install.bat`**.
3.  Nếu Windows hiện bảng hỏi quyền (UAC), hãy chọn **Yes**.
4.  Chờ trong giây lát cho đến khi thông báo **"⚓ CAI DAT THANH CONG!"** hiện ra.

---

## 3. ☸️ Khởi động & Vận hành

Sau khi cài đặt, một phím tắt hình **Mỏ neo vàng Tân Cảng** sẽ xuất hiện ngoài Desktop:
👉 **`SNP - DONG BO DU LIEU`**

Khi đồng chí nháy đúp vào biểu tượng này:
- 🟢 **Terminal**: Một cửa sổ đen (Terminal) sẽ hiện ra để duy trì máy chủ. **Tuyệt đối không tắt cửa sổ này.**
- 🔵 **Dashboard**: Trình duyệt Chrome sẽ tự động bật lên và đưa đồng chí tới Bảng điều khiểu tại: `http://localhost:3025/api/sync-manager-src/dashboard`.
- 🔒 **Single Instance**: Nếu đồng chí lỡ tay mở 2 lần, hệ thống sẽ tự động đóng bản mở sau để bảo vệ dữ liệu.

---

## 4. 📊 Các tính năng chính

### 📈 Bảng điều khiển (Dashboard)
- Theo dõi trạng thái đồng bộ của các module: Passport, Lịch họp, Xe, Công tác...
- Nút **"Chạy"**: Kích hoạt tiến trình đồng bộ ngay lập tức.
- Nút **"Dừng"**: Tạm dừng để kiểm tra cấu hình.

### 📘 Tài liệu API (Swagger Offline)
- Truy cập: `http://localhost:3025/swagger`
- Xem hướng dẫn chi tiết các cổng kết nối (Dành cho kỹ thuật viên).

---

## 5. 🛠 Xử lý sự cố (Troubleshooting)

> [!TIP]
> **Cấu hình Database**: Nếu Dashboard không hiện dữ liệu, hãy mở file `.env` tại thư mục cài đặt (`C:\SNP_DongBoDuLieu\.env`) để kiểm tra lại IP/User/Password của SQL Server.

> [!WARNING]
> **Mất hình ảnh biểu tượng**: Nếu phím tắt ngoài Desktop bị trắng, hãy chạy ứng dụng một lần, hệ thống sẽ tự động "chữa lành" và hiện lại mỏ neo vàng.

---
*Chúc đồng chí hoàn thành xuất sắc nhiệm vụ đồng bộ dữ liệu quân cảng!* ⚓✨🏆
