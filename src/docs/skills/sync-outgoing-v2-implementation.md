# Skill: Triển khai Outgoing Document Sync V2

## Tổng quan kiến trúc

```
┌─────────────────────────────────────────────────────────────────┐
│                    SyncManagerService                          │
│  (quản lý job, heartbeat, checkpoint, multi-instance)          │
└──────────────────────────────────┬──────────────────────────────┘
                                   │ registers
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SyncOutgoingAdapter                          │
│  Implements BaseIncrementalSyncInterface                        │
│  - getCount() → đếm staging                                    │
│  - getList() → extract OLD→staging                             │
│  - processOne() → load staging→main                            │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SyncOutgoingModel                            │
│  (BaseSyncModel)                                               │
│  - runExtract() → Extractor                                    │
│  - runLoad() → Loader                                          │
└──────────┬──────────────────────────────────┬─────────────────┘
           │                                  │
           ▼                                  ▼
┌──────────────────────┐         ┌──────────────────────┐
│      Extractor       │         │        Loader        │
│ (OLD DB → Staging)  │         │ (Staging → Main DB)  │
│ - fetchBatchFromOldDb│         │ - fetchOneFromStaging│
│ - syncBatchToStaging │         │ - processRecord      │
│ - ensureStagingTable │         │ - markSuccess/Failed │
└──────────────────────┘         └──────────┬───────────┘
                                             │
                                             ▼
                                  ┌──────────────────────┐
                                  │   UpsertHandler      │
                                  │ (Document upsert)    │
                                  │ + Files              │
                                  │ + Audits             │
                                  │ + HTML Comments      │
                                  └──────────┬───────────┘
                                             │
                                             ▼
                                  ┌──────────────────────┐
                                  │   OutgoingMapper     │
                                  │ (OLD→NEW field map)  │
                                  └──────────────────────┘
```

## 1. Các thành phần chính

### 1.1 SyncOutgoingModel (models/SyncOutgoingModel.js)
- **Vai trò**: Điều phối Extract → Load phases
- **extends**: BaseSyncModel
- **Phương thức chính**:
  - `initialize(instanceId)` — khởi tạo pools, staging table
  - `runExtract()` — chạy extract phase (OLD→Staging)
  - `runLoad()` — chạy load phase (Staging→Main)
  - `run()` — chạy full sync
  - `stop()` — graceful stop
  - `getProgress()` — lấy stats

### 1.2 Extractor (models/Extractor.js)
- **Vai trò**: Đọc từ OLD DB (VanBanBanHanh) → ghi vào staging
- **extends**: BaseExtractor
- **Logic đặc biệt**:
  - Dùng `DESC` cursor (newer records first, start từ 2999-12-31)
  - Tự định nghĩa schema bảng staging ( không dùng SELECT * INTO)
  - Upsert logic: IF EXISTS UPDATE ... ELSE INSERT
  - Các cột `__sync_time`, `__sync_id` dùng làm cursor

### 1.3 Loader (models/Loader.js)
- **Vai trò**: Đọc từ staging → xử lý → ghi main table
- **extends**: BaseLoader
- **Logic đặc biệt**:
  - `fetchOneFromStaging()` — lấy 1 record pending, đánh dấu `MigrateFlg=2` (processing)
  - Dùng ROWLOCK để tránh race-condition giữa các instance
  - Heartbeat update mỗi 30s

### 1.4 UpsertHandler (models/UpsertHandler.js)
- **Vai trò**: Xử lý business logic cho 1 document
- **Quy trình xử lý**:
  1. `_processDocument()` — insert/update outgoing_documents
  2. `_prepareFilesFromSharePoint()` + `_applyPreparedFiles()` — download & lưu files
  3. `_processAudits()` — xử lý LuanChuyenVanBan* (luồng duyệt)
  4. `_processHtmlComments()` — parse HTML comments (YKien, YKienChiHuy, ...)

### 1.5 OutgoingMapper (mappers/OutgoingMapper.js)
- **Vai trò**: Map fields từ VanBanBanHanh → outgoing_documents
- **Mapping chính**:
  - `ID` → `document_id` (format: `VBD_{oldId}_{suffix}`)
  - `NgayBanHanh` → `release_date`
  - `TrichYeu` → `abstract_note`
  - `DonVi` → `sender_unit` (map qua helper.mapSenderUnitId)
  - `NoiNhan` → `internal_receiving_dept` + `external_receiving_unit`
  - `LoaiVanBan` → `document_type`
  - `DoKhan` → `urgency_level`
  - `DoMat` → `private_level`
  - `TrangThai` → `status_code`, `stage_status`, `bpmn_version`

## 2. Tích hợp với SyncManager qua SyncOutgoingAdapter

### 2.1 SyncOutgoingAdapter (sync-manager/SyncOutgoingAdapter.js)
Adapter này wrap SyncOutgoingModel v2 để implement `BaseIncrementalSyncInterface`:

```javascript
// Interface methods cần implement:
getCount(lastTime, lastSyncId)     // → đếm staging
getList(lastSyncTime, syncJobId)    // → extract batch
processOne(syncJobId, options)      // → load 1 record
fetchListFromOldDb(...)             // → cho SyncHandlerModel
```

### 2.2 Flow khi SyncManager chạy job
1. `adapter.getList()` → gọi `model.extractor.fetchBatchFromOldDb()` + `syncBatchToStaging()`
2. `adapter.getCount()` → đếm số records trong staging
3. Loop `adapter.processOne()` → gọi `model.loader.processRecord()`
4. Mỗi `processOne` xử lý: document + files + audits + comments

### 2.3 Multi-instance support
- Instance ID từ `process.env.INSTANCE_ID` (default: '1')
- Staging table: `outgoing_documents_sync_{instanceId}`
- Cursor: `__sync_time` + `__sync_id` cho phép parallel extract

## 3. Mapping dữ liệu liên kết

### 3.1 Files
- **Nguồn**: `VanBanBanHanh.Files` (pipe-separated paths)
- **Xử lý**:
  1. Parse paths, download từ SharePoint
  2. Detect MIME type từ magic bytes
  3. Insert `doc_files` table
  4. Insert `doc_file_relations` (object_type='docDraft')

### 3.2 Audits (LuanChuyenVanBan*)
- **Bảng nguồn**: 50+ bảng `LuanChuyenVanBan*` trong OLD DB
- **Xử lý**:
  1. Fetch all audits cho document ID từ tất cả bảng
  2. Với mỗi audit, gọi `SyncOutgoingAuditModel.processSingleRecord()`
  3. Track max status_code từ audits
  4. Update `outgoing_documents.status_code` cuối cùng

### 3.3 HTML Comments
- **Fields**: YKien, YKienChiHuy, YKienLanhDao, YKienLanhDaoTCT, YKienLanhDaoVPDN, YKienCuaLDVPChoVanThu
- **Xử lý**: `OutgoingMapper.parseAndInsertHtmlComments()` → insert vào `doc_comments`

## 4. Cấu trúc Staging Table

```sql
outgoing_documents_sync_{instanceId}
├── ID                      BIGINT PRIMARY KEY  -- Từ VanBanBanHanh.ID
├── MigrateFlg              INT                 -- 0=pending, 1=success, 2=processing, 3=failed
├── MigrateErrFlg           INT
├── MigrateErrMess          NVARCHAR(MAX)
├── processing_owner        NVARCHAR(255)      -- pid_instanceId
├── processing_started_at   DATETIME2
├── processing_heartbeat_at DATETIME2
├── __sync_time             DATETIME2           -- Cursor cho extract
├── __sync_id               BIGINT              -- Cursor cho extract
├── [tất cả columns từ VanBanBanHanh]
└── [mapped columns cho NEW DB]
```

## 5. Key environment variables

```env
INSTANCE_ID=1
SYNC_START_DATE=2024-01-01
SYNC_END_DATE=2024-12-31
SYNC_MIN_DATE=1753-01-01
EXTRACT_BATCH_SIZE=1000
LOAD_BATCH_SIZE=1
STAGING_FETCH_BATCH_SIZE=2000
HEARTBEAT_INTERVAL_MS=30000
```

## 6. Phân vùng dữ liệu cho chạy song song (Multi-terminal)

### 6.1 Cơ chế phân vùng

Hệ thống hỗ trợ chạy song song nhiều terminal thông qua 2 lớp phân vùng:

#### Lớp 1: Instance-based (tách staging table)
- Mỗi terminal chạy với `INSTANCE_ID` khác nhau
- Tạo staging table riêng: `outgoing_documents_sync_{instanceId}`
- Tránh conflict khi đọc/ghi staging

#### Lớp 2: Cursor-based (tách phần dữ liệu từ OLD DB)
- Dùng `__sync_time` + `__sync_id` làm cursor
- Extract dùng ORDER BY DESC: terminal chạy trước lấy dữ liệu mới nhất, terminal sau tiếp tục từ cursor
- Không trùng lặp, không bỏ sót

### 6.2 Cấu hình cho từng terminal

```env
# Terminal 1 (chạy trước, lấy dữ liệu mới)
INSTANCE_ID=1

# Terminal 2 (tiếp tục từ cursor của terminal 1)
INSTANCE_ID=2
```

### 6.3 Ví dụ flow song song

```
Terminal 1 (INSTANCE_ID=1):
  → Extract: 2025-01-01 → 2025-04-01 (cursor: 2025-04-01_999)
  → Load: xử lý staging_1

Terminal 2 (INSTANCE_ID=2):
  → Extract tiếp từ cursor: 2025-04-01_999 → 2025-07-01 (cursor: 2025-07-01_888)
  → Load: xử lý staging_2
```

### 6.4 Điều kiện để chạy song song hiệu quả

1. **Đảm bảo thứ tự cursor**: Terminal 2 phải start từ cursor cuối của Terminal 1 (checkpoint)
2. **Không overlap thời gian**: Nếu dùng date range, chia `SYNC_START_DATE/SYNC_END_DATE` riêng
3. **Instance ID duy nhất**: Không có 2 terminal cùng INSTANCE_ID
4. **OLD DB connection đủ**: Nhiều terminal extract cùng lúc từ OLD DB

### 6.5 Monitor tiến độ

```javascript
// Kiểm tra staging của từng instance
const stats = await model.loader.getStats(instanceId);
// → { pending, processing, success, failed }
```

### 6.6 Lưu ý quan trọng

- **Load phase không song song** cho cùng 1 staging table — chỉ 1 process được pick record (dùng ROWLOCK)
- **Extract có thể song song** vì upsert logic (IF EXISTS UPDATE) đảm bảo không trùng
- Nếu cần load song song, dùng INSTANCE_ID khác nhau cho từng terminal

## 7. Điểm mở rộng

- Muốn thêm loại document khác: tạo tương tự `SyncIncomingModel`, `SyncAuditModel`
- Muốn thêm field mapping: sửa `OutgoingMapper.mapRecord()`
- Muốn thêm bảng audit: thêm vào `AUDIT_TABLES` array trong UpsertHandler