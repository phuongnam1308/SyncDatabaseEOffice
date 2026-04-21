---
name: sync-outgoing-v2-to-task-den-mapping
description: Dung khi can chinh sua mapping trong src/sync-tasks-van-ban-den theo logic map va upsert cua src/sync-outgoing-v2.
---

# Skill: Port Mapping tu `sync-outgoing-v2` sang `sync-tasks-van-ban-den`

## Khi nao dung skill nay
- Khi can sua cac truong map trong `src/sync-tasks-van-ban-den`.
- Khi muon uu tien logic map, fallback, validate, upsert cua `src/sync-outgoing-v2`.
- Khi can dong bo kieu xu ly: `map -> validate -> insert/update -> mark staging`.

## Nguon su that (source of truth)
- `src/sync-outgoing-v2/mappers/OutgoingMapper.js`
- `src/sync-outgoing-v2/models/UpsertHandler.js`
- `src/sync-outgoing-v2/models/Loader.js`
- `src/sync-outgoing-v2/models/Extractor.js`

## File dich can sua
- `src/sync-tasks-van-ban-den/models/StreamTaskMigrationModel.js`
- `src/sync-tasks-van-ban-den/models/StreamTaskUsersModel.js`
- `src/sync-tasks-van-ban-den/models/StreamTaskInIncrementalModel.js`
- `src/sync-tasks-van-ban-den/services/StreamTaskMigrationService.js`

## Nguyen tac port logic
1. Khong doi contract API public (controller/service route giu nguyen).
2. Port uu tien theo thu tu:
   - Mapping field
   - Fallback/default
   - Validate bat buoc
   - Idempotent key cho upsert
   - Danh dau staging + xu ly loi
3. Moi field map moi phai co:
   - Nguon raw field
   - Ham xu ly helper
   - Fallback
   - Kieu du lieu dich

## Mapping pattern can copy tu OutgoingMapper

### A. Chuan hoa input
- Dung `helper.safeString(...)` truoc khi map text.
- Dung `helper.parseDate(...)` roi moi gan vao field date.
- Dung `helper.cleanText(...)` cho text mo ta/noi dung.

### B. Fallback pattern
- Pattern chuan:
  - `const mapped = await helperFn(raw) || ENV_DEFAULT || hardcoded_default`
- Vi du outgoing:
  - `document_field`: `processDocumentField(...) || DEFAULT_DOCUMENT_FIELD || 'vn-bn-hnh-chnh'`
  - `sender_unit`: `mapSenderUnitId(...) || DEFAULT_RECEIVER_UNIT_ID`

### C. Status/BPMN pattern
- Khong map status bang switch rieng le neu da co helper.
- Uu tien 1 nguon:
  - `const statusObj = helper.mapStatus(rawStatus)`
  - Lay dong bo cac field lien quan tu cung 1 object.

### D. Receiver/User mapping pattern
- Neu source la chuoi nhieu gia tri:
  - Tach bang helper split.
  - Thu map don vi truoc, roi map user.
  - Khong map duoc thi dua vao external bucket.
- Cac list can luu dang JSON string neu target field dang chuoi.

### E. Upsert pattern
- Tim record theo backup key (`id_*_bak`) truoc.
- Co thi `UPDATE`, khong co thi `INSERT`.
- Sau insert can verify lai key chinh nhu outgoing dang lam.

## Checklist sua `sync-tasks-van-ban-den`

1. Mo `StreamTaskMigrationModel.mapSingleRecord`.
2. Chuyen ve pattern outgoing cho cac nhom field:
   - Date fields (`start_date`, `end_date`, `created_at`, `update_at`)
   - User fields (`created_by`, `updated_by`)
   - Status fields (`process_status`, `priority`, neu co BPMN thi map cung luc)
   - Note/text fields (`name`, `note`)
3. Chuan hoa fallback theo thu tu: helper -> env -> hardcoded.
4. Dam bao `id_task_bak` la idempotent key duy nhat cho task upsert.
5. Kiem tra `StreamTaskUsersModel.mapSingleRecord`:
   - role map co fallback an toan
   - process_id/process_name map fail thi khong lam crash transaction
6. Kiem tra `StreamTaskInIncrementalModel.processOne/processAllAsync`:
   - claim staging record an toan
   - mark success/fail ro rang
   - retry deadlock giu nguyen
7. Chay test smoke:
   - `testGetList(jobId)`
   - `testProcessOne(jobId)` lap den khi het pending
8. Doi soat:
   - Khong sinh duplicate theo `id_task_bak`
   - Field map moi khong de null ngoai y muon
   - Log loi co ID nguon de truy vet

## Muc tieu chat luong sau khi sua
- Mapping nhat quan voi kieu outgoing-v2: ro nguon, ro fallback, ro key upsert.
- Khong vo luong hien tai cua `sync-tasks-van-ban-den`.
- De tiep tuc mo rong map field ma khong pha vo idempotency.

## Prompt mau de goi skill nay
`Dung skill sync-outgoing-v2-to-task-den-mapping. Doc OutgoingMapper va sua mapSingleRecord trong sync-tasks-van-ban-den theo cung pattern fallback + status + upsert key.`
