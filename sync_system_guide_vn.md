# Hướng dẫn Kỹ thuật Hệ thống Đồng bộ EOffice (Sync System Guide)

Tài liệu này cung cấp hướng dẫn chi tiết về cấu trúc, logic xử lý và cách kiểm tra dữ liệu cho từng module trong hệ thống đồng bộ dữ liệu EOffice.

---

## 1. Kiến trúc Tổng quan (System Architecture)

Hệ thống sử dụng mô hình **Staging First** (Đệm dữ liệu qua bảng tạm) để đảm bảo hiệu năng và khả năng phục hồi:

1.  **Source (Nguồn)**: CSDL SharePoint cũ (thường là `WSS_Content_eoffice` hoặc `WSS_Content_eoffice_khkd`).
2.  **Staging (Bảng tạm)**: Dữ liệu được đưa vào các bảng có hậu tố `_sync_staging` hoặc `_temp` trong CSDL mới.
3.  **Destination (Đích)**: Dữ liệu được transform và upsert vào các bảng nghiệp vụ chính (mẫu: `inbox_documents`, `meetings`, `users`, ...).

---

## 2. Chi tiết từng Module

### 2.1. Module Văn bản đến (Incoming Document)
- **Thư mục code**: `src/sync-incoming-document/`
- **File chính**: `models/SyncIncomingDocumentModel.js`
- **Luồng dữ liệu**:
    - Nguồn: `AllUserData` (ListId của VB Đến).
    - Tạm: `inbox_document_sync_staging`.
    - Đích: `inbox_documents`.
- **Mối quan hệ**: `id_document_bak` = `tp_ID` (CSDL cũ).
- **Cách kiểm tra lỗi**:
    ```sql
    -- Kiểm tra số lượng bản ghi đã về bảng tạm
    SELECT COUNT(*) FROM inbox_document_sync_staging;

    -- Kiểm tra bản ghi chưa được chuyển sang bảng chính
    SELECT * FROM inbox_document_sync_staging s
    WHERE NOT EXISTS (SELECT 1 FROM inbox_documents d WHERE d.id_document_bak = CAST(s.ID AS NVARCHAR));
    ```

### 2.2. Module Văn bản đi (Outgoing Document)
- **Thư mục code**: `src/sync-outgoing-document/`
- **File chính**: `models/StreamOutgoingIncrementalModel.js`
- **Luồng dữ liệu**:
    - Nguồn: `AllUserData` (ListId của VB Đi).
    - Tạm: `outgoing_document_sync_staging`.
    - Đích: `out_going_documents`, `audit`.
- **Logic đặc biệt**: Đồng bộ kèm theo Audit (nhật ký xử lý) của văn bản.

### 2.3. Module Lịch lãnh đạo (TGD Schedule)
- **Thư mục code**: `src/sync-tgd-schedule/`
- **File chính**: `migrate/StreamTgdScheduleMigrationModel.js`
- **Luồng dữ liệu**:
    - Nguồn: `AllUserData` (ListId Lịch lãnh đạo).
    - Tạm: `tgd_schedule_sync_staging`.
    - Đích: `leadership_schedules`.
- **Logic**: Xử lý phân loại lịch (cá nhân/đơn vị) và map người chủ trì.

### 2.4. Module Hộ chiếu (Passport)
- **Thư mục code**: `src/sync-passport/`
- **File chính**: `migrate/StreamPassportMigrationModel.js`
- **Luồng dữ liệu**:
    - Nguồn: `AllUserData` (List mượn hộ chiếu).
    - Tạm: `passport_borrow_request_sync_staging`.
    - Đích: `passports`, `passport_borrow_requests`.
- **Verification**:
    ```sql
    -- Kiểm tra mapping hộ chiếu
    SELECT p.id, p.passport_number, b.request_date
    FROM passports p
    JOIN passport_borrow_requests b ON p.id = b.passport_id;
    ```

### 2.5. Module Lịch họp (Meeting)
- **Thư mục code**: `src/sync-meeting/`
- **File chính**: `migrate/StreamMeetingMigrationModel.js`
- **Luồng dữ liệu**:
    - Nguồn: `AllUserData` (List Lịch họp).
    - Tạm: `meeting_sync_staging`.
    - Đích: `meetings`.
- **Đặc điểm**:
    - Map phòng họp từ tên text sang `meeting_rooms` ID.
    - Tạo tự động bản ghi `online_meetings` nếu địa điểm có chứa chữ "Zoom".
    - Tạo Audit mặc định cho quy trình phê duyệt lịch.

### 2.6. Module Điều phối xe (Car Booking)
- **Thư mục code**: `src/sync-car-booking/`
- **File chính**: `migrate/StreamCarBookingMigrationModel.js`
- **Luồng dữ liệu**:
    - Nguồn: `AllUserData` (List Đăng ký xe) + `CodeItem`.
    - Tạm: `car_booking_sync_staging`.
    - Đích: `vehicle_registrations` (Master), `vehicle_registration_assignments` (Detail).
- **Cách kiểm tra**:
    ```sql
    -- Kiểm tra điều phối xe có bị trống lái xe/xe không
    SELECT id, driver_ids, car_ids FROM vehicle_registrations WHERE vehicle_state = 'CHO_DIEU_PHOI';
    ```

### 2.7. Module Tin tức (News)
- **Thư mục code**: `src/sync-news-aspx-page/`
- **File chính**: `models/StreamNewsAspxPageIncrementalModel.js`
- **Cơ chế**: Download file `.aspx` từ SharePoint -> Parse nội dung HTML lấy JSON -> Upsert vào bảng `news`.
- **Lưu ý**: Cần cấu hình `RAW_DOWNLOAD_DIR` để lưu file vật lý.

### 2.8. Module Người dùng & Phòng ban
- **User**: `src/sync-user/migrate/StreamUserMigrationModel.js`
    - Đích: `users`. Map mã nhân viên và tài khoản login.
- **Department**: `src/sync-department/migrate/Streamdepartmentmigrationmodel.js`
    - Đích: `organization_units`. Tách mã phòng ban từ chuỗi `FullName`.

---

## 3. Quy trình Kiểm tra & Xử lý sự cố (Troubleshooting)

### 3.1. Các bước kiểm tra khi dữ liệu không về
1.  **Kiểm tra Job trên Dashboard**: Xem job có trạng thái `Running` hay `Error` không.
2.  **Kiểm tra Log File**: Xem file trong thư mục `logs/` để tìm lỗi SQL (Ví dụ: "Invalid column name", "Deadlock").
3.  **Kiểm tra Bảng Tạm (Staging)**:
    - Nếu bảng tạm trống: Lỗi kết nối CSDL nguồn hoặc sai ListId.
    - Nếu bảng tạm có dữ liệu nhưng bảng chính trống: Lỗi mapping trong `processRowData`.

### 3.2. Câu lệnh SQL hữu ích cho Quản trị viên
```sql
-- 1. Xem nhật ký các đợt đồng bộ gần nhất
SELECT TOP 20 * FROM sync_jobs ORDER BY created_at DESC;

-- 2. Tìm các bản ghi bị lỗi (nếu có lưu log lỗi vào bảng phụ)
SELECT job_id, message FROM sync_job_logs WHERE level = 'ERROR';

-- 3. Xoá trắng dữ liệu đồng bộ (CẨN THẬN)
-- DELETE FROM inbox_documents WHERE id_document_bak IS NOT NULL;
-- DELETE FROM sync_jobs WHERE model_name = 'SYNC_INCOMING_DOCUMENT';
```

### 3.3. Xử lý lỗi "Invalid column name"
Hệ thống có cơ chế **Self-Healing**. Nếu gặp lỗi này, hãy khởi động lại ứng dụng Node.js. Models sẽ tự động chạy hàm `ensureStagingTableExists()` và `ensureTargetColumnsExist()` để bổ sung các cột thiếu vào CSDL.

---

## 4. Danh mục Bảng dữ liệu theo Thư mục (Folder Mapping)

Dưới đây là danh sách chính xác các bảng được sử dụng trong từng folder module:

### 4.1. `src/sync-incoming-document` (Văn bản đến)
- **Nguồn (Old):** `AllUserData` (Lọc theo `tp_ListId` của VB Đến)
- **Tạm (Staging):** `inbox_document_sync_staging`
- **Đích (New):** `inbox_documents`

### 4.2. `src/sync-outgoing-document` (Văn bản đi)
- **Nguồn (Old):** `AllUserData` (Lọc theo `tp_ListId` của VB Đi)
- **Tạm (Staging):** `outgoing_document_sync_staging`
- **Đích (New):** `out_going_documents`, `audit`

### 4.3. `src/sync-tasks-van-ban-den` (Tác vụ VB Đến)
- **Nguồn (Old):** `TaskVBDen`
- **Tạm (Staging):** `task_sync`
- **Đích (New):** `tasks`, `task_users`, `document_comments`

### 4.4. `src/sync-tasks-van-ban-di` (Tác vụ VB Đi)
- **Nguồn (Old):** `TaskVBDi`
- **Tạm (Staging):** `task_sync_out`
- **Đích (New):** `tasks`, `task_users`, `document_comments`

### 4.5. `src/sync-tgd-schedule` (Lịch lãnh đạo)
- **Nguồn (Old):** `AllUserData` (Lọc theo `tp_ListId` Lịch lãnh đạo)
- **Tạm (Staging):** `tgd_schedule_sync_staging`
- **Đích (New):** `leadership_schedules`

### 4.6. `src/sync-meeting` (Lịch họp)
- **Nguồn (Old):** `AllUserData` (Lọc theo `tp_ListId` Lịch họp)
- **Tạm (Staging):** `meeting_sync_staging`
- **Đích (New):** `meetings`, `online_meetings`

### 4.7. `src/sync-car-booking` (Điều phối xe)
- **Nguồn (Old):** `AllUserData` (Lọc theo `tp_ListId` Đăng ký xe) + `CodeItem`
- **Tạm (Staging):** `car_booking_sync_staging`
- **Đích (New):** `vehicle_registrations`, `vehicle_registration_assignments`

### 4.8. `src/sync-passport` (Mượn hộ chiếu)
- **Nguồn (Old):** `AllUserData` (Lọc theo `tp_ListId` Hộ chiếu)
- **Tạm (Staging):** `passport_borrow_request_sync_staging`
- **Đích (New):** `passports`, `passport_borrow_requests`

### 4.9. `src/sync-news-aspx-page` (Tin tức)
- **Nguồn (Old):** `AllDocs` (File vật lý trên SharePoint)
- **Tạm (Staging):** `news_aspx_pages_temp`
- **Đích (New):** `news`

### 4.10. `src/sync-event` (Sự kiện)
- **Nguồn (Old):** `AllUserData` (Lọc theo `tp_ListId` Sự kiện)
- **Tạm (Staging):** `event_sync_staging`
- **Đích (New):** `events`

### 4.11. `src/sync-user` (Người dùng)
- **Nguồn (Old):** `PersonalProfile`
- **Tạm (Staging):** (Đồng bộ trực tiếp qua Batch)
- **Đích (New):** `users`

### 4.12. `src/sync-department` (Phòng ban)
- **Nguồn (Old):** `PersonalProfile`
- **Tạm (Staging):** `dept_sync`
- **Đích (New):** `organization_units`

### 4.13. `src/sync-document-comment` (Ý kiến xử lý)
- **Nguồn (Old):** Các bảng `Comments_*` (Ví dụ: `Comments_KHKD`, `Comments_HT`)
- **Tạm (Staging):** (Đồng bộ lồng trong các module Document/Task)
- **Đích (New):** `document_comments`

---
*Người soạn: AI Assistant (Antigravity)*
*Ngày cập nhật: 06/04/2026*
