# StreamUserMigrationService - Luồng Chạy API

## 1. Tổng Quan Kiến Trúc

```
┌─────────────────────────────────────────────────────────────────┐
│                   StreamUserMigrationController                │
│                  (HTTP Endpoint Layer)                          │
└────────────────┬──────────────────────────────────────────────┘
                 │
    ┌────────────┴──────────────┐
    │                           │
    ▼                           ▼
testGetList()          testProcessOne()
POST /test-get-list    POST /test-process-one
    │                           │
    └────────────────┬──────────┘
                     │
                     ▼
    ┌────────────────────────────────────┐
    │ StreamUserMigrationService         │
    │ (Business Logic Layer)             │
    └────────────────┬───────────────────┘
                     │
         ┌───────────┴───────────┐
         │                       │
         ▼                       ▼
    testGetList()          testProcessOne()
    (Step 1-5)             (Step A-C)
         │                       │
         └───────────┬───────────┘
                     │
                     ▼
    ┌────────────────────────────────────┐
    │ StreamUserMigrationModel           │
    │ (Data Access Layer)                │
    │ extends BaseIncrementalSyncInterface│
    └────────────┬──────────────────────┘
                 │
    ┌────────────┴────────────────┐
    │                             │
    ▼                             ▼
┌──────────────┐         ┌──────────────────┐
│  Old DB      │         │  New DB (camunda)│
│(DataEOffice) │         │                  │
│              │         │ - sync_jobs      │
│ PersonalProfile│        │ - sync_models    │
│              │         │ - user_clone_... │
└──────────────┘         └──────────────────┘
```

---

## 2. Luồng Chi Tiết: `testGetList()`

### Bước Gọi API

```http
POST /api/sync-user-copy/test-get-list
Content-Type: application/json

{
  "lastSyncTime": "1970-01-01T00:00:00.000Z",  // optional
  "syncJobId": null                             // optional
}
```

### Luồng Thực Hiện

```
START: testGetList()
  │
  ├─> Step 1: await this.service.initialize()
  │   └─> Tạo StreamUserMigrationModel instance
  │       └─> Kết nối tới Old DB + New DB
  │
  ├─> Step 2: await this._buildOrReuseJob(syncJobId)
  │   │
  │   ├─ Nếu syncJobId có sẵn:
  │   │   └─> Return syncJobId (reuse)
  │   │
  │   └─ Nếu syncJobId = null:
  │       ├─> SyncManagerService.createJob(UNIT_TEST_MODEL_NAME)
  │       │   └─> Tạo row mới trong sync_jobs
  │       │       └─> Ghi vào sync_models (FK check)
  │       │
  │       └─> await this._ensureJobExists(jobId)
  │           └─> Poll sync_jobs cho đến khi xuất hiện (max 10 retry)
  │
  ├─> Step 3: await this.model.getList(lastSyncTime, jobId)
  │   │
  │   ├─> Normalize lastSyncTime → ISO string
  │   │
  │   ├─> Fetch từ OLD DB:
  │   │   └─> PersonalProfile WHERE Modified > @lastSyncTime
  │   │       ORDER BY Modified, ID
  │   │   └─> Result: { rows, totalCount, lastSyncTime, status }
  │   │
  │   └─> Update sync_jobs:
  │       ├─> total_to_sync = totalCount
  │       ├─> status = (totalCount === 0) ? 'COMPLETED' : 'RUNNING'
  │       └─> last_sync_time = lastSyncTime
  │
  ├─> Step 4: await this.model.getBufferState(jobId)
  │   └─> Query sync_jobs WHERE job_id = @jobId
  │       └─> Extract: total_count, processing_item, status
  │
  ├─> Step 5: await this.model.countNewUsers()
  │   └─> SELECT COUNT(*) FROM user_clone_for_sync
  │
  └─> Return Object
      {
        syncJobId,                  // Job ID được tạo/reuse
        lastSyncTime,               // Thời gian đồng bộ lần cuối
        oldCount,                   // Tổng bản ghi từ OLD DB
        stagedCount,                // Bản ghi staged (= totalCount nếu 1-stage)
        newCount,                   // Bản ghi hiện có trong NEW DB
        totalCount,                 // Tổng cần xử lý (từ buffer)
        processingItem,             // Đã xử lý bao nhiêu mục
        isCountMatch,               // Kiểm tra: buffer count == list count
        lastSyncTime                // (Repeat) Thời gian lần cuối
      }

END: Return response to HTTP client
```

---

## 3. Luồng Chi Tiết: `testProcessOne()`

### Bước Gọi API

```http
POST /api/sync-user-copy/test-process-one
Content-Type: application/json

{
  "syncJobId": "UNIT_TEST_STREAM_USER_COPY_MIGRATION-1772087721377-neeaze"
}
```

### Luồng Thực Hiện

```
START: testProcessOne()
  │
  ├─> Validate: syncJobId is required
  │   └─> Throw if missing
  │
  ├─> Step A: await this.service.initialize()
  │   └─> (Same as testGetList Step 1)
  │
  ├─> Step B: await this.model.processOne(syncJobId)
  │   │
  │   ├─> Query sync_jobs WHERE job_id = @syncJobId (LOCK)
  │   │   └─> Extract: total_to_sync, total_processed, last_sync_time
  │   │
  │   ├─> Check: processingItem >= totalToSync?
  │   │   └─> YES: Mark job status = 'COMPLETED', return done=true
  │   │   └─> NO: Continue to fetch next row
  │   │
  │   ├─> Fetch one row từ OLD DB:
  │   │   └─> PersonalProfile WHERE ID > lastId
  │   │       ORDER BY ID ASC
  │   │       LIMIT 1
  │   │
  │   ├─> processRowData(rowData, { syncJobId, transaction })
  │   │   │
  │   │   ├─> Extract: backupId = rowData.ID
  │   │   ├─> Extract: fallbackName = rowData.FullName || rowData.AccountName
  │   │   │
  │   │   └─> upsertUserById(backupId, fallbackName, transaction)
  │   │       │
  │   │       ├─> IF EXISTS (SELECT ... WHERE id = @id):
  │   │       │   └─> UPDATE user_clone_for_sync
  │   │       │       SET name = UPPER(name), updated_at = GETDATE()
  │   │       │
  │   │       └─ ELSE:
  │   │           └─> INSERT INTO user_clone_for_sync
  │   │               (id, name, created_at, updated_at)
  │   │               VALUES (id, UPPER(name), GETDATE(), GETDATE())
  │   │
  │   ├─> Update sync_jobs:
  │   │   ├─> total_processed += 1
  │   │   ├─> total_success += 1
  │   │   ├─> status = done ? 'COMPLETED' : 'RUNNING'
  │   │   ├─> updated_at = GETDATE()
  │   │   └─> ended_at = (done) ? GETDATE() : NULL
  │   │
  │   └─> Return Object
  │       {
  │         syncJobId,
  │         totalCount,             // Tổng cần xử lý
  │         processingItemBefore,   // Đã xử lý trước đó
  │         processingItemAfter,    // Đã xử lý sau lần này
  │         processed: true,
  │         done,                   // true nếu hoàn thành toàn bộ
  │         processResult: {...}    // Kết quả từ processRowData
  │       }
  │
  └─> Return response to HTTP client

END: Job status được cập nhật, sẵn sàng gọi testProcessOne lại (nếu done=false)
```

---

## 4. Quy Trình Toàn Bộ: Sync Người Dùng

```
┌──────────────────────────────────────────────────────────────────┐
│ CLIENT (Browser / API Consumer)                                 │
└──────────────────────────────────────────────────────────────────┘
    │
    ├─────────────────────────────────────────────────────────────
    │
    │ CALL 1: testGetList({ lastSyncTime, syncJobId: null })
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ Response:                                                       │
│ {                                                               │
│   syncJobId: "UNIT_TEST_...-abc123",                            │
│   oldCount: 2431,                                               │
│   newCount: 150,                                                │
│   totalCount: 2431,                                             │
│   processingItem: 0,                                            │
│   isCountMatch: true                                            │
│ }                                                               │
└─────────────────────────────────────────────────────────────────┘
    │
    │ CALL 2: testProcessOne({ syncJobId: "UNIT_TEST_...-abc123" })
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ Response:                                                       │
│ {                                                               │
│   syncJobId: "UNIT_TEST_...-abc123",                            │
│   processingItemAfter: 1,                                       │
│   processed: true,                                              │
│   done: false                                                   │
│ }                                                               │
└─────────────────────────────────────────────────────────────────┘
    │
    │ CALL 3: testProcessOne({ syncJobId: "UNIT_TEST_...-abc123" })
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ Response: { ..., processingItemAfter: 2, done: false }         │
└─────────────────────────────────────────────────────────────────┘
    │
    │ CALL 4-N: Loop testProcessOne() until done=true
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ Final Response: { ..., processingItemAfter: 2431, done: true } │
│                                                                 │
│ ✅ Đã đồng bộ xong 2431 user vào user_clone_for_sync           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Bảng Tóm Tắt Các Database Interaction

| Bước | Hành Động | Database | SQL | Kết Quả |
|------|----------|----------|-----|---------|
| 1 | Lấy danh sách | OLD DB | SELECT * FROM PersonalProfile WHERE Modified > @lastSyncTime | rows[] |
| 2 | Cập nhật job | NEW DB | UPDATE sync_jobs SET total_to_sync=@count, status=@status | 1 row |
| 3 | Lấy trạng thái | NEW DB | SELECT * FROM sync_jobs WHERE job_id=@id | bufferState |
| 4 | Đếm user mới | NEW DB | SELECT COUNT(*) FROM user_clone_for_sync | newCount |
| 5 | Fetch 1 row | OLD DB | SELECT TOP 1 * FROM PersonalProfile WHERE ID > @lastId | rowData |
| 6 | Upsert user | NEW DB | IF EXISTS... UPDATE / ELSE INSERT INTO user_clone_for_sync | 1 row |
| 7 | Update job | NEW DB | UPDATE sync_jobs SET total_processed=..., status=... | 1 row |

---

## 6. HTTP Client Usage Example (cURL)

```bash
# Step 1: Lấy danh sách (tạo job)
curl -X POST http://localhost:3000/api/sync-user-copy/test-get-list \
  -H "Content-Type: application/json" \
  -d '{
    "lastSyncTime": "1970-01-01T00:00:00.000Z"
  }'

# Response:
# {
#   "syncJobId": "UNIT_TEST_STREAM_USER_COPY_MIGRATION-1772087721377-neeaze",
#   "oldCount": 2431,
#   "newCount": 150,
#   "totalCount": 2431,
#   ...
# }

# Step 2: Lặp xử lý từng user (gọi N lần)
for i in {1..2431}; do
  curl -X POST http://localhost:3000/api/sync-user-copy/test-process-one \
    -H "Content-Type: application/json" \
    -d '{
      "syncJobId": "UNIT_TEST_STREAM_USER_COPY_MIGRATION-1772087721377-neeaze"
    }'
  echo "Processed item $i"
  sleep 0.1  # Delay để tránh overload
done

# Hoặc dùng loop trong Node.js:
# while (processingItem < totalCount) {
#   const result = await fetch('/api/sync-user-copy/test-process-one', {...})
#   if (result.done) break
#   processingItem = result.processingItemAfter
# }
```

---

## 7. State Transition Diagram (Trạng Thái Job)

```
           ┌─────────────────────────────────┐
           │        IDLE (khởi tạo)          │
           │ (job chưa được tạo)             │
           └────────────┬────────────────────┘
                        │
          testGetList() │
                        ▼
           ┌─────────────────────────────────┐
           │       RUNNING                   │
           │ (job được tạo, ready xử lý)     │
           │ totalToSync: 2431               │
           │ totalProcessed: 0               │
           └────────────┬────────────────────┘
                        │
       testProcessOne() │ (lặp)
       (mỗi lần +1)     │
                        ▼
           ┌─────────────────────────────────┐
           │       RUNNING                   │
           │ totalToSync: 2431               │
           │ totalProcessed: 1               │
           │ totalSuccess: 1                 │
           └────────────┬────────────────────┘
                        │
                        │ (lặp... N lần)
                        ▼
           ┌─────────────────────────────────┐
           │       RUNNING                   │
           │ totalToSync: 2431               │
           │ totalProcessed: 2430            │
           │ totalSuccess: 2430              │
           └────────────┬────────────────────┘
                        │
       testProcessOne() │ (lần cuối)
                        ▼
           ┌─────────────────────────────────┐
           │     COMPLETED ✅                │
           │ totalToSync: 2431               │
           │ totalProcessed: 2431            │
           │ totalSuccess: 2431              │
           │ done: true                      │
           └─────────────────────────────────┘
```

---

## 8. Lưu Ý Khi Sử Dụng

1. **Khởi tạo:** `await service.initialize()` tự động được gọi (idempotent).
2. **Job ID:** Lưu `syncJobId` từ `testGetList()` để dùng trong `testProcessOne()`.
3. **Lặp:** Gọi `testProcessOne()` cho đến khi response có `done: true`.
4. **Timeout:** Mỗi lần `testProcessOne()` xử lý 1 user, nên tốn ~10-100ms tùy tải DB.
5. **Rollback:** Nếu muốn reset, gọi `model.rollback()` để xóa tất cả `user_clone_for_sync`.
