# BẢNG MA TRẬN ÁNH XẠ CẤU TRÚC DỮ LIỆU EOFFICE $\leftrightarrow$ DOFFICE (BẢN V3 ĐẦY ĐỦ TẤT CẢ 13 SHEET NỘI DUNG)

> **Dự án:** SyncDatabaseEOffice  
> **Tệp Excel tải về (V3 Đầy Đủ 13 Sheet Chi Tiết):** [Bang_Mapping_Cau_Truc_CSDL_EOffice_DOffice_v3.xlsx](file:///e:/PROJECTS/SyncDatabaseEOffice/scripts/Bang_Mapping_Cau_Truc_CSDL_EOffice_DOffice_v3.xlsx)

---

## 1. TỔNG QUAN MAPPING TẤT CẢ CÁC MODULE TRONG SOURCE CODE (`src/`)

| STT | Phân Hệ / Nghiệp Vụ | Bảng Nguồn (Eoffice / SNP) | Bảng Đích (Doffice) | Trường Vết Backup | Module Sync Source trong `src/` | Trạng Thái Sheet Excel |
|---|---|---|---|---|---|---|
| 1 | **Văn Bản Đến** | `dbo.VanBanDen` | `incomming_documents` | `id_incoming_bak` | `src/sync-incoming-v2`, `sync-incoming-documents` | 📊 **Sheet chi tiết riêng** |
| 2 | **Văn Bản Đi (Ban Hành)** | `dbo.VanBanBanHanh` | `outgoing_documents` | `id_outgoing_bak` | `src/sync-outgoing-v2`, `sync-outgoing-v3` | 📊 **Sheet chi tiết riêng** |
| 3 | **Văn Bản Dự Thảo (Draft)** | `[SNP].[CodeItem]` | `outgoing_documents` | `id_outgoing_bak` (`SPItemID`) | `src/sync-outgoing-v2/models/DraftDocumentExtractor.js` | 📊 **Sheet chi tiết riêng** |
| 4 | **Quy Trình Trình Ký SLA** | `[SNP].[SLAStepDetail]`, `History` | `outgoing_assignment`, `work_items` | `document_id` (`ItemID`) | `src/sync-outgoing-v2`, `sync-outgoing-v3` | 📊 **Sheet chi tiết riêng** |
| 5 | **Lịch Sử Luân Chuyển** | `dbo.LuanChuyenVanBan_*` | `audit` | `id_bak`, `origin_id` | `src/sync-audit`, `sync-audit-meeting` | 📊 **Sheet chi tiết riêng** |
| 6 | **Công Việc & Dự Án** | `TaskVBDen`, `TaskVBDi`, `task_users2` | `task`, `task_users` | `id_task_bak`, `id_taskBackups` | `src/sync-tasks-van-ban-den`, `sync-tasks-van-ban-di` | 📊 **Sheet chi tiết riêng** |
| 7 | **Lịch Họp (Meetings)** | `dbo.Meeting` | `meetings`, `meeting_rooms` | `id_bak` | `src/sync-meeting`, `meeting-sync2` | 📊 **Sheet chi tiết riêng (Mới bổ sung)** |
| 8 | **Mượn Hộ Chiếu (Passport)** | `dbo.PassportBorrowRequest` | `passport_borrow_requests` | `id_bak` | `src/sync-passport` | 📊 **Sheet chi tiết riêng (Mới bổ sung)** |
| 9 | **Đăng Ký Xe (Car Booking)** | `dbo.CarBooking` | `vehicle_registrations` | `id_bak` | `src/sync-car`, `sync-car-booking` | 📊 **Sheet chi tiết riêng (Mới bổ sung)** |
| 10 | **Trang Tin Tức (News)** | `tintucraw`, `SharePoint` | `news`, `news_aspx_new_sync` | `slug`, `id_bak` | `src/sync-news-aspx-page` | 📊 **Sheet chi tiết riêng (Mới bổ sung)** |
| 11 | **Ý Kiến Văn Bản (Comments)** | `dbo.DocumentComments` | `document_comments` | `id_bak` | `src/sync-document-comment` | 📊 **Sheet chi tiết riêng (Mới bổ sung)** |
| 12 | **Người Dùng & Đơn Vị** | `PersonalProfile`, `DonVi` | `users`, `organization_units` | `id_user_bak`, `Id_backups` | `src/sync-user`, `sync-department` | 📊 **Sheet chi tiết riêng** |
| 13 | **File Đính Kèm** | `FilesDen2025`, `FilesDi2026`, `CodeAttach` | `files`, `file_relations` | `id_bak`, `object_id_bak` | `src/sync-file` | 📊 **Sheet chi tiết riêng** |

---

## 2. MA TRẬN CHI TIẾT TẤT CẢ CÁC BẢNG

### 2.1. Phân Hệ Văn Bản Đến (`dbo.VanBanDen` $\rightarrow$ `incomming_documents`)

| Cột Nguồn (Eoffice) | Kiểu Dữ Liệu EO | Cột Đích (Doffice) | Kiểu Dữ Liệu DO | Mô Tả Nghiệp Vụ | Quy Tắc Chuyển Đổi (Transformation Rule) |
|---|---|---|---|---|---|
| `ID` | `numeric / GUID` | **`id_incoming_bak`** | `varchar` | Khóa chính cũ $\rightarrow$ Mã vết backup | Giữ nguyên ID cũ làm vết đối soát |
| `TrichYeu` | `nvarchar(max)` | **`abstract_note`** | `text` | Trích yếu nội dung văn bản đến | Copy trực tiếp text |
| `SoDen` | `nvarchar(50)` | **`incomming_code / to_book_code`** | `varchar(50)` | Số sổ văn bản đến | Chuẩn hóa text |
| `SoVanBan` | `nvarchar(100)` | **`to_book_code`** | `varchar(100)` | Số ký hiệu văn bản | Mapping sổ qua `book_documents` |
| `NgayDen` | `datetime` | **`receive_date`** | `timestamp` | Ngày tiếp nhận văn bản | Convert ISO DateTime |
| `NgayTrenVB` | `datetime` | **`document_date`** | `timestamp` | Ngày ban hành ghi trên VB | Convert ISO DateTime |
| `LoaiVanBan` | `nvarchar(100)` | **`document_type`** | `varchar(100)` | Loại văn bản đến | Mapping mã loại S19 |
| `DoMat` | `nvarchar(50)` | **`private_level`** | `varchar(50)` | Độ mật (Thường, Mật...) | Mapping mã S21 |
| `DoKhan` | `nvarchar(50)` | **`urgency_level`** | `varchar(50)` | Độ khẩn (Thường, Khẩn...) | Mapping mã S20 |
| `CoQuanGui2` / `CoQuanGuiText` | `nvarchar(255)` | **`sender_unit`** | `varchar(64)` | Đơn vị gửi văn bản | Mapping ID `custom_sender_units` |
| `DonVi` | `nvarchar(255)` | **`receiver_unit`** | `varchar(64)` | Đơn vị nhận văn bản | Mapping ID `organization_units` |
| `CreatedBy` | `nvarchar(50)` | **`created_by`** | `varchar(64)` | Tài khoản tạo bản ghi | Mapping User ID Doffice |
| `Created` | `datetime` | **`created_at`** | `timestamp` | Thời điểm tạo bản ghi | Convert ISO DateTime |
| `Files` | `nvarchar(max)` | **`file_relations $\rightarrow$ files`** | `relation` | Danh sách file đính kèm | Chuyển kho file & tạo liên kết `file_relations` |

---

### 2.2. Phân Hệ Văn Bản Đi (Ban Hành) (`dbo.VanBanBanHanh` $\rightarrow$ `outgoing_documents`)

| Cột Nguồn (Eoffice) | Kiểu Dữ Liệu EO | Cột Đích (Doffice) | Kiểu Dữ Liệu DO | Mô Tả Nghiệp Vụ | Quy Tắc Chuyển Đổi (Transformation Rule) |
|---|---|---|---|---|---|
| `ID` | `numeric / GUID` | **`id_outgoing_bak`** | `varchar` | Khóa chính văn bản ban hành | Giữ nguyên ID cũ làm vết đối soát |
| `TrichYeu` | `nvarchar(max)` | **`abstract_note`** | `text` | Trích yếu nội dung văn bản đi | Copy trực tiếp text |
| `SoVanBan` | `nvarchar(100)` | **`to_book_code`** | `varchar(100)` | Số ký hiệu văn bản ban hành | Mapping sổ qua `book_documents` |
| `NgayBanHanh` | `datetime` | **`document_date / promulgate_date`** | `timestamp` | Ngày ký phát hành văn bản | Convert ISO DateTime |
| `NgayHieuLuc` | `datetime` | **`effective_date`** | `timestamp` | Ngày văn bản có hiệu lực | Convert ISO DateTime |
| `LoaiVanBan` | `nvarchar(100)` | **`document_type`** | `varchar(100)` | Loại văn bản ban hành | Mapping mã loại S19 |
| `DoMat` | `nvarchar(50)` | **`private_level`** | `varchar(50)` | Độ mật văn bản | Mapping mã S21 |
| `DoKhan` | `nvarchar(50)` | **`urgency_level`** | `varchar(50)` | Độ khẩn văn bản | Mapping mã S20 |
| `SoBan` | `int` | **`number_of_copies / SoBan`** | `int` | Số bản phát hành | `safeParseInt` |
| `SoTrang` | `int` | **`number_of_pages / SoTrang`** | `int` | Số trang văn bản | `safeParseInt` |
| `CreatedBy` / `NguoiSoanThaoText` | `nvarchar(255)` | **`drafter`** | `varchar(64)` | Người soạn thảo văn bản | Mapping User ID Doffice |
| `NguoiKyVanBanText` | `nvarchar(255)` | **`report_signer`** | `varchar(64)` | Người ký phê duyệt văn bản | Mapping User ID Doffice |
| `Created` | `datetime` | **`created_at`** | `timestamp` | Ngày tạo bản ghi | Convert ISO DateTime |
| `Modified` | `datetime` | **`updated_at`** | `timestamp` | Ngày cập nhật | Convert ISO DateTime |
| `Files` | `nvarchar(max)` | **`file_relations $\rightarrow$ files`** | `relation` | Danh sách file đính kèm VB đi | Tạo `file_relations` & `files` |

---

### 2.3. Phân Hệ Văn Bản Dự Thảo (`[SNP].[CodeItem]` $\rightarrow$ `outgoing_documents`)

| Cột Nguồn (SNP CodeItem) | Kiểu Dữ Liệu EO | Cột Đích (Doffice) | Kiểu Dữ Liệu DO | Mô Tả Nghiệp Vụ | Quy Tắc Chuyển Đổi (Transformation Rule) |
|---|---|---|---|---|---|
| `ID / CodeItemID` | `int / GUID` | **`id_outgoing_bak`** | `varchar` | Khóa chính dự thảo CodeItem | Giữ vết ID cũ từ `SNP.CodeItem` |
| `SPItemID` | `int` | **`id_outgoing_bak`** | `varchar` | Mã SharePoint Item ID | Giữ vết phục vụ sync SharePoint |
| `Subject` | `nvarchar(max)` | **`abstract_note`** | `text` | Trích yếu / Tiêu đề dự thảo | Copy text |
| `LoaiVanBan / LoaiBanHanh` | `nvarchar(255)` | **`document_type`** | `varchar(100)` | Loại dự thảo trình ký | Mapping mã loại S19 |
| `DepartmentId` | `nvarchar(255)` | **`sender_unit`** | `varchar(64)` | Phòng ban soạn thảo | Mapping `organization_units` |
| `Author / CreatedBy` | `nvarchar(255)` | **`drafter`** | `varchar(64)` | Tác giả tạo dự thảo | Mapping User ID Doffice |
| `Approver / ApproverByStep` | `nvarchar(max)` | **`report_signer / receiver`** | `varchar(64)` | Người duyệt theo bước | Mapping User ID Doffice |
| `Created` | `datetime` | **`created_at`** | `timestamp` | Ngày khởi tạo trình ký | Convert ISO DateTime |
| `Modified` | `datetime` | **`updated_at`** | `timestamp` | Ngày cập nhật dự thảo | Convert ISO DateTime |
| `[SNP].[CodeAttach]` | `relation` | **`file_relations $\rightarrow$ files`** | `relation` | File đính kèm dự thảo | Chuyển từ bảng `CodeAttach` |

---

### 2.4. Phân Hệ Quy Trình Trình Ký SLA (`[SNP].[SLAStepDetail]` $\rightarrow$ `outgoing_assignment`, `work_items`)

| Cột Nguồn (SNP SLA) | Kiểu Dữ Liệu EO | Cột Đích (Doffice) | Kiểu Dữ Liệu DO | Mô Tả Nghiệp Vụ | Quy Tắc Chuyển Đổi (Transformation Rule) |
|---|---|---|---|---|---|
| `ItemID` | `int` | **`outgoing_assignment.document_id`** | `varchar(64)` | ID Dự thảo CodeItem | Mapping `document_id` Doffice |
| `Step` | `int` | **`outgoing_assignment.last_audit_id / step`** | `int` | Bước trình ký hiện tại | Thứ tự các bước quy trình |
| `UserID` | `uniqueidentifier` | **`outgoing_assignment.receiver`** | `varchar(64)` | Cán bộ nhận xử lý / ký | Mapping User ID Doffice |
| `CreatedBy` | `uniqueidentifier` | **`outgoing_assignment.created_by`** | `varchar(64)` | Người chuyển bước | Mapping User ID Doffice |
| `StartDate` | `datetime` | **`outgoing_assignment.created_at`** | `timestamp` | Thời điểm bắt đầu bước ký | Convert ISO DateTime |
| `CompletedDate` | `datetime` | **`outgoing_assignment.updated_at`** | `timestamp` | Thời điểm hoàn thành ký | Convert ISO DateTime |
| `UsedSLAMinutes / ActualSLAMinutes` | `numeric` | **`work_items.due_date / duration`** | `numeric` | Thời gian SLA xử lý | Tính hạn xử lý `work_items` |

---

### 2.5. Phân Hệ Lịch Họp (`dbo.Meeting` $\rightarrow$ `meetings`)

| Cột Nguồn (Eoffice) | Kiểu Dữ Liệu EO | Cột Đích (Doffice) | Kiểu Dữ Liệu DO | Mô Tả Nghiệp Vụ | Quy Tắc Chuyển Đổi (Transformation Rule) |
|---|---|---|---|---|---|
| `ID` | `numeric / GUID` | **`meetings.id_bak / id`** | `varchar(64)` | Mã vết lịch họp cũ | Tạo GUID mới `id`, giữ `id_bak` |
| `Title / Subject` | `nvarchar(500)` | **`meetings.title`** | `varchar(500)` | Tiêu đề / Chủ đề cuộc họp | Copy text |
| `StartDate` | `datetime` | **`meetings.started_at`** | `timestamp` | Thời điểm bắt đầu họp | Convert ISO DateTime |
| `EndDate` | `datetime` | **`meetings.ended_at`** | `timestamp` | Thời điểm kết thúc họp | Convert ISO DateTime |
| `RoomID / RoomName` | `nvarchar(255)` | **`meetings.room_ids`** | `varchar(255)` | Địa điểm / Phòng họp | Mapping ID `meeting_rooms` |
| `StageStatus` | `nvarchar(50)` | **`meetings.stage_status`** | `varchar(50)` | Trạng thái phê duyệt lịch họp | Mapping: `DONG_Y_PHE_DUYET`... |
| `Status` | `nvarchar(50)` | **`meetings.status`** | `varchar(50)` | Trạng thái bản ghi (1: Đang mở) | Mapping status Doffice |
| `CreatedBy` | `nvarchar(50)` | **`meetings.created_by`** | `varchar(64)` | Người tạo lịch họp | Mapping User ID Doffice |

---

### 2.6. Phân Hệ Mượn Hộ Chiếu (`dbo.PassportBorrowRequest` $\rightarrow$ `passport_borrow_requests`)

| Cột Nguồn (Eoffice) | Kiểu Dữ Liệu EO | Cột Đích (Doffice) | Kiểu Dữ Liệu DO | Mô Tả Nghiệp Vụ | Quy Tắc Chuyển Đổi (Transformation Rule) |
|---|---|---|---|---|---|
| `ID` | `numeric / GUID` | **`passport_borrow_requests.id_bak / id`** | `varchar(64)` | Mã vết yêu cầu mượn hộ chiếu | Tạo GUID mới `id`, giữ `id_bak` |
| `RequestCode` | `nvarchar(50)` | **`passport_borrow_requests.request_code`** | `varchar(50)` | Mã yêu cầu mượn hộ chiếu | Copy text |
| `TypeRequest` | `nvarchar(50)` | **`passport_borrow_requests.type_request`** | `varchar(50)` | Loại yêu cầu mượn | Copy text |
| `PassportNumber` | `nvarchar(50)` | **`passport_borrow_requests.passport_number`** | `varchar(50)` | Số hộ chiếu | Copy text |
| `Reason` | `nvarchar(max)` | **`passport_borrow_requests.reason`** | `text` | Lý do mượn hộ chiếu | Copy text |
| `Destination` | `nvarchar(255)` | **`passport_borrow_requests.destination`** | `varchar(255)` | Nơi đến / Nước đi công tác | Copy text |
| `BorrowDate` | `datetime` | **`passport_borrow_requests.borrow_date`** | `timestamp` | Ngày mượn hộ chiếu | Convert ISO DateTime |
| `ReturnDate` | `datetime` | **`passport_borrow_requests.return_date`** | `timestamp` | Ngày trả hộ chiếu | Convert ISO DateTime |
| `Status` | `nvarchar(50)` | **`passport_borrow_requests.status`** | `varchar(50)` | Trạng thái duyệt | Mapping: `PENDING`, `IN_USE`... |
| `RequesterID / CreatedBy` | `nvarchar(50)` | **`passport_borrow_requests.requester_id`** | `varchar(64)` | Người yêu cầu mượn | Mapping User ID Doffice |

---

### 2.7. Phân Hệ Đăng Ký Xe (`dbo.CarBooking` $\rightarrow$ `vehicle_registrations`)

| Cột Nguồn (Eoffice) | Kiểu Dữ Liệu EO | Cột Đích (Doffice) | Kiểu Dữ Liệu DO | Mô Tả Nghiệp Vụ | Quy Tắc Chuyển Đổi (Transformation Rule) |
|---|---|---|---|---|---|
| `ID` | `numeric / GUID` | **`vehicle_registrations.id_bak / id`** | `varchar(64)` | Mã vết đăng ký xe cũ | Tạo GUID mới `id`, giữ `id_bak` |
| `RequestCode` | `nvarchar(50)` | **`vehicle_registrations.request_code`** | `varchar(50)` | Mã phiếu đăng ký xe | Copy text |
| `Destination` | `nvarchar(255)` | **`vehicle_registrations.destination`** | `varchar(255)` | Lộ trình / Nơi đến công tác | Copy text |
| `RejectionReason` | `nvarchar(max)` | **`vehicle_registrations.rejection_reason`** | `text` | Lý do từ chối chuyến xe | Copy text |
| `VehicleState` | `nvarchar(50)` | **`vehicle_registrations.vehicle_state`** | `varchar(50)` | Trạng thái chuyến xe | Mapping: `TRONG_TIEN_TRINH`... |
| `Status` | `nvarchar(50)` | **`vehicle_registrations.status`** | `varchar(50)` | Trạng thái bản ghi | `1`: Hoạt động |
| `CreatedBy` | `nvarchar(50)` | **`vehicle_registrations.created_by`** | `varchar(64)` | Cán bộ đăng ký xe | Mapping User ID Doffice |

---

### 2.8. Phân Hệ Trang Tin Tức (`tintucraw`, `SharePoint` $\rightarrow$ `news`, `news_aspx_new_sync`)

| Cột Nguồn (SharePoint/Raw) | Kiểu Dữ Liệu EO | Cột Đích (Doffice) | Kiểu Dữ Liệu DO | Mô Tả Nghiệp Vụ | Quy Tắc Chuyển Đổi (Transformation Rule) |
|---|---|---|---|---|---|
| `ID / Slug` | `nvarchar(255)` | **`news.slug / id_bak`** | `varchar(255)` | Mã định danh bài viết tin tức | Chuẩn hóa URL Slug |
| `Title` | `nvarchar(500)` | **`news.title`** | `varchar(500)` | Tiêu đề bài viết tin tức | Copy text |
| `Content / Body` | `nvarchar(max)` | **`news.content`** | `text` | Nội dung bài viết (HTML) | Clean HTML, rebase image links |
| `Thumbnail` | `nvarchar(500)` | **`news.thumbnail`** | `varchar(500)` | Ảnh đại diện bài viết | Tải ảnh lưu kho file Doffice |
| `TopicID / Category` | `nvarchar(100)` | **`news.topic_id`** | `varchar(64)` | Chuyên mục tin tức | Mapping topic Doffice |
| `CreatedBy` | `nvarchar(50)` | **`news.created_by`** | `varchar(64)` | Tác giả bài viết | Mapping User ID Doffice |
| `Created` | `datetime` | **`news.created_at`** | `timestamp` | Ngày đăng bài tin tức | Convert ISO DateTime |
