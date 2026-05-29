# Hướng dẫn chạy và giải thích luồng hoạt động `meeting-sync2`

Thư mục `meeting-sync2` là một module đảm nhiệm chức năng **Đồng bộ Lịch họp** từ hệ thống cũ (SharePoint - bảng `AllUserData`) sang hệ thống mới (`app_tancang` - bảng `meetings` và các bảng liên quan).

---

## 1. Module này làm nhiệm vụ gì?
Sau khi áp dụng logic clone, module này hoạt động với một quy trình xử lý rất lớn (pipeline) cho mỗi lịch họp được tìm thấy ở DB cũ:
- **Ánh xạ dữ liệu cơ bản**: Lấy Tên cuộc họp, Ngày giờ, Địa điểm, Trạng thái. Tính toán lại giờ theo múi giờ Việt Nam (cộng thêm 7 tiếng).
- **Xử lý Người dùng**: Tự động tìm kiếm và đối chiếu `chairman_id` (Người chủ trì), `created_by` (Người tạo), `secretary_id` (Thư ký).
- **Tạo Phòng họp**: Tự động nhận diện phòng họp, nếu không thấy sẽ fallback về phòng họp mặc định.
- **Tạo Đơn vị tổ chức (`meeting_units`)**: Phân tích thông tin người tham gia hoặc đơn vị và tạo các đơn vị tổ chức nếu chưa có.
- **Thêm Người tham gia (`meeting_participants`)**: Trích xuất người tham gia và cấp quyền cứng cho họ (Role).
- **Tạo Họp Trực Tuyến**: Nhận diện các lịch họp có ghi chú `zoom`, `online` hoặc `hybrid` để tạo các bản ghi họp trực tuyến.
- **Ghi log Audit**: Tạo lịch sử thao tác (Audit trail) cho việc phê duyệt/tạo lịch họp.

---

## 2. Các file cấu hình quan trọng
Trong thư mục `src/meeting-sync2/`, có 3 file cấu hình bạn cần quan tâm:
1. **`mapping.json`**: Chứa toàn bộ cấu hình ánh xạ trường (field mapping) giữa bảng cũ (`AllUserData`) và bảng mới (`meetings`). Nơi bạn có thể sửa ID phòng mặc định, user mặc định.
2. **`config.js`**: Nơi chứa code xử lý và logic chuyển đổi ngày giờ, format mapping, parse trạng thái...
3. **`required_process_roles.json`**: Khai báo mã quy trình và các quyền (roles) mặc định cấp cho tài khoản khi họ tham gia vào quy trình lịch họp.

---

## 3. Cách chạy (Execute) chi tiết

Vì dự án của bạn sử dụng `SyncManager` (đăng ký qua `SyncModelRegistry.js`), việc chạy module này được thực hiện thông qua hệ thống API hoặc giao diện quản lý.

### Cách 1: Chạy qua Dashboard / Giao diện (Khuyên dùng)
1. Đảm bảo server đang chạy (`npm start` trong terminal đã bật sẵn).
2. Mở trình duyệt và truy cập vào **Dashboard Đồng Bộ** của hệ thống (thường ở `http://localhost:3000` hoặc port bạn đang cấu hình).
3. Tìm đến module có tên là **"Đồng bộ lịch họp 2"** (Key: `STREAM_MEETING_SYNC2_MIGRATION`).
4. Bấm nút **Chạy** (Sync / Start).
5. Hệ thống sẽ bắt đầu chạy quá trình đồng bộ và hiển thị thanh tiến trình.

### Cách 2: Chạy qua Postman / Gọi API trực tiếp
1. Khởi động hệ thống (`npm start`).
2. Mở ứng dụng Postman (hoặc dùng terminal `curl`).
3. Gửi một request **POST** tới endpoint quản lý đồng bộ. 
   - Endpoint thường là: `http://localhost:<PORT>/api/sync/STREAM_MEETING_SYNC2_MIGRATION/start` (Hãy thay đổi `<PORT>` cho khớp với project của bạn).
4. Bạn có thể mở file `routes/index.js` hoặc `SyncManagerController.js` trong code để tra chính xác URL API kích hoạt nếu cấu hình có thay đổi.

### Cách 3: Chạy thử trong Code (Debug mode)
Nếu bạn muốn debug trực tiếp trong code, bạn có thể tạo một file `test-sync.js` ở thư mục gốc:
```javascript
const StreamMeetingSync2Model = require('./src/meeting-sync2/models/StreamMeetingSync2Model');

(async () => {
    const syncModel = new StreamMeetingSync2Model();
    await syncModel.initialize();
    
    // Chạy logic đồng bộ
    await syncModel.run();
    console.log("Hoàn tất!");
})();
```
Sau đó chạy bằng lệnh: `node test-sync.js`

---

## 4. Lưu ý khi chạy

- **Quá trình chạy lâu**: Vì module này có logic cực kỳ phức tạp (mỗi lịch họp gọi nhiều vòng truy vấn SQL để tạo User, Audit, Phòng họp, Phân quyền), việc chạy cho vài nghìn dòng có thể mất thời gian (vài phút đến chục phút).
- Trước khi chạy lệnh đồng bộ, **hãy chắc chắn bạn đã chạy lệnh `node clone.js`** để copy hoàn toàn logic từ module cũ sang file Model mới.
