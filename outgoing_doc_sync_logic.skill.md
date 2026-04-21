# Agent Skill: Đồng bộ Văn bản đi/Ban hành (Outgoing Doc Sync)
Tài liệu này mô tả chính xác luồng xử lý hiện tại của module `src/sync-outgoing-document` để đồng bộ dữ liệu từ DB cũ (`VanBanBanHanh`) sang DB mới (`outgoing_documents`) theo mô hình incremental + staging + aggregate sync.

## 1) Phạm vi và file nguồn chuẩn
- `src/sync-outgoing-document/controllers/StreamOutgoingMigrationController.js`
- `src/sync-outgoing-document/services/StreamOutgoingMigrationService.js`
- `src/sync-outgoing-document/models/StreamOutgoingIncrementalModel.js`
- `src/sync-outgoing-document/models/StreamOutgoingMigrationModel.js`
- Helper liên quan:
  - `src/helpers/MigrationHelper.js`
  - `src/sync-audit/SyncAuditModel.js`
  - `src/sync-audit/SyncOutgoingAuditModel.js`

## 2) Kiến trúc dữ liệu
- **Source (DB cũ):** `dbo.VanBanBanHanh`
- **Staging (DB mới):** `dbo.outgoing_documents_sync`
- **Main target (DB mới):** `dbo.outgoing_documents`
- **Thực thể liên quan được đồng bộ kèm:**
  - `audit` (gộp từ 46 bảng `LuanChuyenVanBan*`)
  - `outgoing_assignment`
  - `outgoing_current_state`
  - `document_comments` (parse từ HTML ý kiến)
  - file + file relation thông qua `FileService.uploadAndInsert`

## 3) Ý nghĩa trạng thái staging
- `MigrateFlg = 0`: chưa xử lý
- `MigrateFlg = 2`: đang xử lý (claimed)
- `MigrateFlg = 1`: xử lý thành công
- `MigrateErrFlg = 1`: lỗi xử lý
- `MigrateErrMess`: message lỗi hoặc trạng thái tạm (`Processing...`)

## 4) Luồng tổng thể end-to-end
### Giai đoạn A - Initialize
1. Khởi tạo pool DB, đảm bảo staging table tồn tại (`ensureStagingTableExists`).
2. Đảm bảo bảng `outgoing_documents` có đủ cột bắt buộc (self-healing schema bằng `ALTER TABLE IF NOT EXISTS`).
3. Khởi tạo:
   - `StreamOutgoingMigrationModel` để map/upsert bản ghi chính.
   - `FileService` để lưu file.
   - 46 instance `SyncOutgoingAuditModel` (mỗi bảng audit cũ một model).
4. Danh sách comment table có khai báo nhưng đang **không bật** (đoạn khởi tạo `SyncCommentModel` đang comment).

### Giai đoạn B - Hút dữ liệu old -> staging (`getList`)
1. Normalize cursor đầu vào:
   - Nếu nhận `1970-01-01...` hoặc rỗng, nội bộ đổi về `2999-12-31T23:59:59.999Z`.
   - Luồng này chạy theo hướng **DESC về quá khứ** (`__sync_time < lastSyncTime`).
2. Filter phân đoạn theo `Created`:
   - `SYNC_START_DATE`, `SYNC_END_DATE` (multi-terminal theo time range).
3. Cleanup record treo:
   - Trước khi hút mới, reset các record `MigrateFlg = 2` về `0`.
4. Đếm tổng cần sync (`countListFromOldDb`) và ghi `sync_jobs.total_to_sync`.
5. Fetch theo batch (`STAGING_FETCH_BATCH_SIZE`, default 2000), chạy song song theo `STAGING_PARALLEL_BATCHES` (default 3).
6. Mỗi batch thực hiện `syncOldToStaging` trong `withTransactionRetry(maxRetries=5)`:
   - Upsert theo khóa `ID` (update nếu tồn tại, insert nếu chưa).
7. Sau khi hút xong:
   - Tính `pendingCount` thực tế trong staging (`MigrateFlg=0`, `MigrateErrFlg=0`, có filter theo partition).
   - Trả về thông tin cursor + số bản ghi staging.

### Giai đoạn C - Process từng record staging (`processOne`)
1. Claim 1 record bằng query CTE + `UPDLOCK, ROWLOCK`, set `MigrateFlg=2`.
2. Nếu không còn record:
   - finalize cursor cho job (`finalizeProcessingCursor`) từ record đã thành công trong partition.
   - trả `done=true`.
3. Nếu có record:
   - Tải file SharePoint **ngoài transaction SQL** (`prepareFilesFromSharePoint`) để tránh giữ lock DB khi mạng chậm.
   - Mở transaction (`withTransactionRetry maxRetries=5`) và xử lý aggregate:
     - upsert outgoing_documents
     - insert file + relation
     - parse HTML comments
     - sync toàn bộ audit
     - auto-create audit nếu không có audit nào
   - update `sync_jobs.total_processed`, `total_success`
   - close staging: `MigrateFlg=1`, `MigrateErrFlg=0`, `MigrateErrMess=NULL`
4. Nếu lỗi:
   - staging record rollback trạng thái về `MigrateFlg=0`, `MigrateErrFlg=1`, lưu message lỗi.

## 5) Logic mapping document chính (`StreamOutgoingMigrationModel`)
### 5.1 Key và cơ chế upsert
- Bản ghi mới generate `document_id` random theo timestamp + random.
- Upsert xác định bằng `id_outgoing_bak = oldRecord.ID`:
  - tồn tại -> update
  - chưa tồn tại -> insert

### 5.2 Mapping trường nghiệp vụ chính
- `status_code`, `stage_status`, `bpmn_version`, `type_of_process`:
  - lấy từ `helper.mapStatus(oldRecord.TrangThai)`
  - default fallback:
    - `statusCode = "2"`
    - `bpmnVersion = "SOANTHAO_PHATHANH_VBD"`
    - `stageStatus = "DA_XU_LY"`
    - `curStatusCode = "1"`
- `document_field`:
  - `processDocumentField(LinhVuc)`
  - fallback `DEFAULT_DOCUMENT_FIELD` hoặc `vn-bn-hnh-chnh`
- `document_type`:
  - `processDocumentType(LoaiVanBan || LoaiBanHanh)`
- `urgency_level`, `private_level`:
  - từ `DoKhan`, `DoMat`
- `sender_unit`:
  - `mapSenderUnitId(DonVi)`; fallback `DEFAULT_RECEIVER_UNIT_ID`
- `drafter`:
  - `mapUserDrafter(NguoiSoanThaoText || CreatedBy)`; fallback `VANTHU_USER_ID`
- `report_signer`:
  - map từ `NguoiKyVanBanText`
- `book_document_id`, `to_book`:
  - từ `mapBookDocument(SoVanBan || SoVanBanText, { drafter, senderUnit, privateLevel })`
- `release_no` = `Title`
- `release_date` = `NgayBanHanh`
- `abstract_note` = `TrichYeu`
- `reply_incoming_doc` = `TraLoiVBDen`
- `created_at` = `Created || NgayTao`
- `updated_at` = `Modified || NgayTao`
- `text_symbols` = `"dữ liệu văn bản đi đồng bộ <timestamp>"`
- flags bổ sung:
  - `type_doc=1`, `sign_type=mapBit(DocSignType)`, `from_create_draf=0`, `replaced=0`, `tb_bak=1`, `table_backups='outgoing_documents_sync'`

### 5.3 Logic tách và map `NoiNhan`
- Input được tách bằng `splitStringSplitBySemicolon` (hỗ trợ cả format SharePoint `;#`).
- Với mỗi item:
  1. Nếu map được đơn vị (`mapSenderUnitId`) -> thêm vào `internal_receiving_dept`.
  2. Đồng thời query users theo Department/organization_name LIKE tên đơn vị để bổ sung `know_receivers`.
  3. Nếu không map được đơn vị, thử map user (`mapUserName`):
     - map được -> thêm vào `know_receivers`
     - không map được -> thêm vào `external_receiving_unit`
- Kết quả:
  - `internal_receiving_dept`, `internal_receiving_unit`, `internal_receiving_dept_old`: JSON mảng unit ids
  - `know_receivers`: JSON mảng user ids
  - `vieweds`: copy từ `know_receivers`
  - `external_receiving_unit`: chuỗi text ngăn bởi `; `

## 6) Đồng bộ file đính kèm
### 6.1 Parse nguồn file từ cột `Files`
- Chuỗi được split bởi `|`.
- Nếu phần tử đầu trông như tên file (`.pdf/.doc/.docx/...`) -> coi là path file trực tiếp.
- Nếu không -> phần tử đầu là thư mục, các phần tử sau là file name => ghép path.

### 6.2 Download trước, ghi DB sau
- Download bằng `SharePointAuthService.downloadFile(fullUrl, pool)` trước transaction.
- Trong transaction:
  - Detect mime bằng magic bytes (`detectFileType`)
  - tạo `fileRecord` và `relationRecord`
  - gọi `FileService.uploadAndInsert(...)`
- Relation dùng:
  - `object_type = 'docDraft'`
  - `object_id = outgoing_documents.id`
  - `object_id_bak = VanBanBanHanh.ID`
  - `table_bak = 'VanBanBanHanh'`

## 7) Parse comment HTML từ văn bản cũ
- Parse các trường:
  - `YKien`
  - `YKienChiHuy`
  - `YKienLanhDao`
  - `YKienLanhDaoTCT`
  - `YKienLanhDaoVPDN`
  - `YKienCuaLDVPChoVanThu`
- `MigrationHelper.parseAndInsertHtmlComments`:
  - regex tách cặp header/content từ HTML cũ
  - tách user + thời điểm từ header
  - map user sang user id nếu có
  - insert vào `document_comments`
  - có tự thêm cột kỹ thuật nếu thiếu (`table_bak`, `user_id_bak`, ...)

## 8) Đồng bộ audit tổng hợp (46 bảng luân chuyển)
1. Gọi `fetchAllAuditsAcrossTables`:
   - union tất cả bảng `LuanChuyenVanBan*`
   - lọc `VBId = oldDocumentId`
   - category cho văn bản đi:
     - `Phát hành văn bản ĐV`
     - `Phát hành văn bản TCT`
     - `Văn bản đi`
   - sort tăng dần theo thời gian + ID (chronological)
2. Mỗi raw audit được route về model theo `__source_table`.
3. `SyncAuditModel.processSingleRecord`:
   - map action/receiver/role/stage
   - expand receiver thành nhiều record audit nếu cần
   - upsert vào bảng `audit`
   - cập nhật ngược `outgoing_documents.status_code` nếu status mới cao hơn
4. `SyncOutgoingAuditModel` (override) đồng bộ thêm:
   - `outgoing_assignment`
   - `outgoing_current_state`

## 9) Auto-create audit khi văn bản chưa có lịch sử
- Sau khi sync xong, nếu chưa có record trong `audit` theo `document_id`:
  - tạo 1 audit `action_code='CREATE'`
  - `roleProcess='VANTHU'`
  - `stage_status='DA_XU_LY'`
  - details ghi chú “tự động tạo từ migration”
- Mục tiêu: đảm bảo tài liệu luôn có mốc audit khởi tạo cho BPMN/state tracking.

## 10) Cơ chế cursor và hoàn tất job
- Khi staging hết dữ liệu khả dụng trong partition:
  - lấy `MAX(Modified)` và `MAX(ID)` từ record `MigrateFlg=1`
  - cập nhật `sync_jobs.last_sync_time`, `sync_jobs.last_sync_id`
- Nếu partition chưa xử lý record nào thành công thì giữ nguyên cursor cũ.

## 11) Cơ chế chống lỗi, idempotent, concurrency
- **Idempotent theo source ID:**
  - staging PK `ID`
  - main upsert key `id_outgoing_bak`
- **Retry deadlock/lock contention:**
  - `withTransactionRetry(..., maxRetries=5)`
- **Multi-terminal safe:**
  - chia partition theo `Created` + filter `SYNC_START_DATE/SYNC_END_DATE`
  - claim record bằng `UPDLOCK, ROWLOCK`
- **Không giữ transaction khi tải file từ mạng**
- **Có cleanup record treo (`MigrateFlg=2`) trước vòng staging**

## 12) Biến môi trường quan trọng
- `NEW_DB_NAME`, `OLD_DB_NAME`
- `SYNC_MIN_DATE` (default hiện tại: `2026-01-01T00:00:00.000Z`)
- `SYNC_START_DATE`, `SYNC_END_DATE` (chia partition chạy nhiều terminal)
- `STAGING_FETCH_BATCH_SIZE` (default 2000)
- `STAGING_PARALLEL_BATCHES` (default 3)
- `BASE_URL` (ghép URL SharePoint tải file)
- `STATUS_MAP_OUTGOING`
- `DEFAULT_DOCUMENT_FIELD`, `DEFAULT_RECEIVER_UNIT_ID`, `VANTHU_USER_ID`

## 13) API test đang có
- `testGetList(lastSyncTime?, syncJobId?)`
  - tạo/reuse job, chạy hút staging, trả count đối soát.
- `testProcessOne(syncJobId)`
  - xử lý đúng 1 record staging.

## 14) Checklist vận hành khuyến nghị
1. Chạy `testGetList` để nạp staging theo partition.
2. Gọi `testProcessOne` lặp lại tới khi `done=true`.
3. Theo dõi:
   - `sync_jobs` (`total_to_sync`, `total_processed`, `total_success`, `total_errors`)
   - staging flags (`MigrateFlg`, `MigrateErrFlg`, `MigrateErrMess`)
4. Nếu có lỗi SharePoint/file, record sẽ ở trạng thái error và cần xử lý retry riêng.

## 15) Lưu ý mở rộng sau này
- Nếu bật sync từ bảng `Comments_*`, cần mở lại khối khởi tạo `_syncCommentModel`.
- Khi thêm bảng audit mới, phải bổ sung vào mảng `AUDIT_TABLES` để không bỏ sót lịch sử luân chuyển.
- Mọi thay đổi mapping status nên cập nhật đồng bộ ở `STATUS_MAP_OUTGOING` để tránh sai stage/status_code.

## 16) Luồng SyncManager khi thao tác nút trên Dashboard
### 16.1 Endpoint dashboard và realtime
- Màn hình dashboard: `GET /api/sync-manager-src/dashboard`
- Realtime trạng thái: `GET /api/sync-manager-src/events` (SSE)
- Nút global trên header/action bar:
  - `POST /api/sync-manager-src/start` với `reset=false|true`
- Nút theo từng dòng module:
  - `POST /api/sync-manager-src/models/:modelName/start`
  - `POST /api/sync-manager-src/jobs/:jobId/pause`
  - `POST /api/sync-manager-src/jobs/:jobId/resume`
  - `GET /api/sync-manager-src/jobs/:jobId` (xem chi tiết)

### 16.2 Mapping nút giao diện -> hành vi backend
1. **Chạy tất cả các đối tượng** (`triggerSync(false)`)
   - Gọi `SyncManagerService.start(false)`.
   - Service chạy tuần tự qua toàn bộ model đã đăng ký (`for ... await waitForJobCompletion`).
2. **Chạy lại toàn bộ** (`triggerSync(true)`)
   - Gọi `SyncManagerService.start(true)`.
   - Mỗi model khi tạo job sẽ reset state (`lastSyncTime`, `lastSyncId`, `totalSynced`).
3. **Chạy một module** (`startModel(modelName,false)`)
   - Gọi `SyncManagerService.startModel(modelName,{reset:false})`.
4. **Chạy lại module** (`startModel(modelName,true)`)
   - Gọi `SyncManagerService.startModel(modelName,{reset:true})`.
5. **Dừng tạm thời** (`pauseJob(jobId)`)
   - Gọi `SyncManagerService.pauseJob(jobId)`, đặt `pauseRequested=true`, `status=PAUSE_REQUESTED`.
   - Job chuyển hẳn sang `PAUSED` ở checkpoint trong vòng `runJob`.
6. **Tiếp tục** (`resumeJob(jobId)`)
   - Gọi `SyncManagerService.resumeJob(jobId)`, status `RESUMING -> RUNNING`.
   - Khi resume, service reset `totalToSync=null` để đếm/pull lại snapshot pending mới.

### 16.3 Điều kiện enable/disable nút ngay trên UI
- Nút global `Chạy tất cả` / `Chạy lại toàn bộ` bị disable khi `data.isRunning = true`.
- Nút dòng module:
  - `Chạy` / `Lại` chỉ bật khi model status thuộc `IDLE | COMPLETED | FAILED | CRASHED`.
  - `Dừng` chỉ bật khi job status hiện tại là `RUNNING | RESUMING`.
  - `Tiếp` chỉ bật khi model status hoặc job status là `PAUSED`.
- UI không tự suy diễn `CRASHED` theo timeout heartbeat; trạng thái lấy từ backend.

## 17) Ràng buộc quan trọng cho module Outgoing khi chạy qua SyncManager
### 17.1 Ràng buộc đăng ký model và tên hiển thị
- Outgoing được đăng ký từ `SyncModelRegistry` với key kỹ thuật `STREAM_OUTGOING_INCREMENTAL`.
- Label chạy thực tế trên dashboard: `Đồng bộ văn bản đi` (hoặc kèm hậu tố instance khi chạy đa instance).
- `SyncManagerService.startModel()` nhận `modelName` đúng theo label đã register.

### 17.2 Ràng buộc trạng thái vòng đời job
- Không thể start khi model đang bận (`RUNNING | PAUSE_REQUESTED | RESUMING`).
- Nếu model đang `PAUSED` và còn `activeJobId`, gọi start mới sẽ bị chặn (phải Resume đúng job paused).
- `pauseJob` chỉ hợp lệ khi job đang thuộc nhóm running-like status.
- `resumeJob` chỉ hợp lệ khi job status chính xác là `PAUSED`.

### 17.3 Ràng buộc tích hợp incremental adapter (SyncHandlerModel)
- `getList(lastSyncTime, syncJobId, lastSyncId)` bắt buộc có `syncJobId`.
- Adapter dùng `stagedCount` (không dùng pending sau hút) để tạo số item ảo cho vòng process.
- Khi resume sau restart:
  - dùng `cursor.totalProcessed` để khôi phục `nextIndex`, tránh chạy lại từ đầu batch ảo.
  - khi `take <= 0` sẽ xóa snapshot prepared job để lần sau rebuild lại qua `getList`.

### 17.4 Ràng buộc dữ liệu outgoing trong pha process
- `processOne(syncJobId)` bắt buộc có `syncJobId`.
- Chỉ claim bản ghi có `MigrateFlg=0`, `MigrateErrFlg=0`, theo filter partition `SYNC_START_DATE/SYNC_END_DATE`.
- Pause là cơ chế cooperative: job dừng ở checkpoint vòng batch (không cắt ngang transaction đang xử lý dở).
- Khi staging cạn:
  - `processOne` trả `done=true`
  - gọi `finalizeProcessingCursor` để chốt `sync_jobs.last_sync_time`, `last_sync_id`.

### 17.5 Ràng buộc chạy song song nhiều instance/terminal
- Outgoing thuộc nhóm module cho phép chạy song song theo instance.
- Để tránh đụng nhau:
  - bắt buộc chia partition ngày bằng `SYNC_START_DATE` / `SYNC_END_DATE`
  - mỗi worker claim row bằng `UPDLOCK, ROWLOCK, READPAST`
  - cleanup `MigrateFlg=2` stale records thực hiện trong chính partition của instance hiện tại.

## 18) Staging tracking columns (ownership + heartbeat)
### 18.1 Ba cột bổ sung trong `outgoing_documents_sync`
- `processing_owner` — `NVARCHAR(255)`, instance/pid của worker đang claim row
- `processing_started_at` — `DATETIME2`, thời điểm worker bắt đầu xử lý
- `processing_heartbeat_at` — `DATETIME2`, timestamp cập nhật định kỳ khi xử lý dài

### 18.2 Claim record trong `fetchOneFromStaging`
- Hint SQL: `WITH (UPDLOCK, ROWLOCK, READPAST)` — bỏ qua row đang bị lock (không blocking/chờ)
- Claim SET đồng thời 4 trường:
  - `MigrateFlg = 2`
  - `processing_owner = <instanceId/pid>`
  - `processing_started_at = SYSUTCDATETIME()`
  - `processing_heartbeat_at = SYSUTCDATETIME()`
- `instanceId` được gán từ `process.env.INSTANCE_ID || `pid_${process.pid}``

### 18.3 Cleanup stale records trong `getList`
- Không reset toàn bộ `MigrateFlg=2` nữa
- Chỉ reset row stale theo ngưỡng thời gian:
  ```
  MigrateFlg = 2
  AND processing_started_at < DATEADD(MINUTE, -@staleMinutes, SYSUTCDATETIME())
  ```
  với `staleMinutes` mặc định = 30 (configurable qua `STAGING_STALE_MINUTES`)
- Khi reset: clear cả `processing_owner`, `processing_started_at`, `processing_heartbeat_at`

### 18.4 Heartbeat định kỳ trong `processOne`
- Timer chạy **ngoài transaction** (`setInterval`, mỗi 5 phút)
- Mỗi tick gọi `updateHeartbeat(rowId)` — cập nhật `processing_heartbeat_at = SYSUTCDATETIME()` cho row đang xử lý
- Timer tự clear khi transaction kết thúc (trong `finally` hoặc `catch` của `processOne`)
- Mục tiêu: record xử lý lâu (nhiều file/audit) không bị cleanup stale coi là treo

### 18.5 Clear tracking trên success/error
- **Success**: `MigrateFlg=1`, xóa `processing_owner`, `processing_started_at`, `processing_heartbeat_at`
- **Error**: `MigrateFlg=0`, `MigrateErrFlg=1`, xóa 3 tracking columns

## 19) Cơ chế retry mở rộng trong `utils/dbUtils.js`
### 19.1 Hàm `isRetryableSqlError(err)`
Nhận diện các lỗi transient của SQL Server:
- Error **1205** — deadlock
- Error **3930** — "transaction is in abort state" / doomed transaction
- Message chứa **"Transaction has been aborted"** (hậu quả deadlock bị nuốt trong connection session)
- Message chứa **"Transaction context in use by other sessions"**
- Message chứa **"Could not continue processing"**

### 19.2 `withTransactionRetry` mở rộng
- Thay `isDeadlock` đơn giản bằng `isRetryableSqlError` để retry được cả error 3930 + "Transaction has been aborted"
- Log message đổi thành `[Deadlock/Doomed]`

### 19.3 Nguyên tắc không nuốt retryable errors
Trong `upsertDocumentAggregateById`, 6 vị trí catch blocks bên trong transaction:
- Nếu `dbUtils.isRetryableSqlError(err)` → `throw err` ngay để toàn transaction được retry
- Các lỗi không retryable (logic/app errors) vẫn log + warn như cũ
- Các vị trí áp dụng:
  1. `getByIdFromOldDb` (line ~1370)
  2. `getByIdFromStaging` (line ~1398)
  3. HTML comments parse loop (line ~1452)
  4. Audit `processSingleRecord` loop (line ~1491)
  5. `fetchAllAuditsAcrossTables` (line ~1498)
  6. Auto-create audit block (line ~1584)

## 20) Biến môi trường mới
- `STAGING_STALE_MINUTES` — ngưỡng (phút) để cleanup coi row là stale (default: 30)
- `INSTANCE_ID` — chuỗi định danh worker, dùng làm `processing_owner` (default: `pid_<pid>`)
