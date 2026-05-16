# 🔧 FIX DATABASE & MODEL REGISTRATION ISSUES

## 📋 PROBLEM SUMMARY

Your sync system was showing these errors:

```
Error: Model Đồng bộ lịch họp is not registered
Error: Model Đồng bộ công việc đến is not registered
Error: Model Đồng bộ công việc đi is not registered

[StreamMeetingMigrationModel] [ensureStagingTableExists] ERROR: Cannot find the object "dbo.meeting_sync_staging.IX_meeting_sync_staging_job_cursor"
[StreamEventMigrationModel] [ensureStagingTableExists] ERROR: Cannot find the object "event_sync_staging"
```

This happens because:

1. **Missing Model Registrations** - Models exist but aren't registered in SyncManagerController
2. **Missing/Broken Database Tables** - Staging tables don't exist or have schema issues
3. **Missing Scheduling Config** - Models aren't configured in cron_sync_config table

---

## ✅ WHAT WAS FIXED

### 1. **SQL Database Issues** → File: `FIX_MISSING_TABLES.sql`

The SQL script fixes:

| Issue                                       | Solution                                                              |
| ------------------------------------------- | --------------------------------------------------------------------- |
| `meeting_sync_staging` has wrong index name | ✅ Drop old index, create correct `IX_meeting_sync_staging_ID_Source` |
| `event_sync_staging` doesn't exist          | ✅ Create complete table with all required columns                    |
| Missing staging tables for tasks            | ✅ Create `task_sync_staging` (công việc đến)                         |
| Missing staging tables for outgoing tasks   | ✅ Create `task_outgoing_sync_staging` (công việc đi)                 |
| Models not in scheduler config              | ✅ Add 4 models to `cron_sync_config` table                           |

**Created tables:**

- `dbo.meeting_sync_staging` (with index `IX_meeting_sync_staging_ID_Source`)
- `dbo.event_sync_staging` (with index `IX_event_sync_staging_ID_Source`)
- `dbo.task_sync_staging` (with index `IX_task_sync_staging_ID_Source`)
- `dbo.task_outgoing_sync_staging` (with index `IX_task_outgoing_sync_staging_ID_Source`)

**Added cron config:**

```
Đồng bộ lịch họp @ 09:00
Đồng bộ sự kiện @ 10:00
Đồng bộ công việc đến @ 11:00
Đồng bộ công việc đi @ 12:00
```

### 2. **Model Registration** → File: `SyncManagerController.js`

Updated the controller to register 4 missing models:

```javascript
// Now registers:
1. StreamMeetingMigrationModel      → 'Đồng bộ lịch họp'
2. StreamEventMigrationModel        → 'Đồng bộ sự kiện'
3. StreamTaskMigrationModelIncoming → 'Đồng bộ công việc đến'
4. StreamTaskMigrationModelOutgoing → 'Đồng bộ công việc đi'
```

With proper error handling and logging:

- ✅ Registered messages when successful
- ❌ Error messages with details if initialization fails

---

## 🚀 HOW TO APPLY THE FIXES

### Step 1: Run the SQL Script

**Important:** Run this in your SQL Server Management Studio (SSMS):

```sql
-- Open file: FIX_MISSING_TABLES.sql
-- Execute the entire script in SSMS
-- You should see output:
-- ✓ Created table meeting_sync_staging with index IX_meeting_sync_staging_ID_Source
-- ✓ Created table event_sync_staging
-- ✓ Created table task_sync_staging
-- ✓ Created table task_outgoing_sync_staging
-- ✓ Added/Updated cron configs
```

**Database:** Use the NEW database (DiOffice)

### Step 2: Restart the Application

```bash
# Stop current app (Ctrl+C)

# Restart
npm start

# Look for these success messages:
# ✅ Registered: Đồng bộ lịch họp
# ✅ Registered: Đồng bộ sự kiện
# ✅ Registered: Đồng bộ công việc đến
# ✅ Registered: Đồng bộ công việc đi
```

### Step 3: Verify via Dashboard

1. Open: `http://localhost:3025`
2. Go to: **Đồng Bộ Dữ Liệu** → Check Models
3. Verify these 4 models now appear and can be started

---

## 📊 MODEL SCHEDULE

After fix, these models will auto-run at scheduled times:

| Model                 | Time  | Staging Table                |
| --------------------- | ----- | ---------------------------- |
| Đồng bộ lịch họp      | 09:00 | `meeting_sync_staging`       |
| Đồng bộ sự kiện       | 10:00 | `event_sync_staging`         |
| Đồng bộ công việc đến | 11:00 | `task_sync_staging`          |
| Đồng bộ công việc đi  | 12:00 | `task_outgoing_sync_staging` |

You can change these times by updating `cron_sync_config` table:

```sql
UPDATE dbo.cron_sync_config
SET cron_time = '14:30'  -- Change to 14:30 (2:30 PM)
WHERE module_name = N'Đồng bộ lịch họp';
```

---

## 🔍 VERIFICATION CHECKLIST

After applying fixes, verify:

- [ ] SQL script ran without errors (no red text in SSMS)
- [ ] All 4 new tables exist in database
- [ ] App starts without "Model ... is not registered" errors
- [ ] 4 models appear in dashboard
- [ ] Can manually trigger sync for each model
- [ ] Check logs for ✅ registration messages

---

## 📝 TABLE SCHEMA REFERENCE

### meeting_sync_staging

```sql
[SY_SyncId]      INT (PK)
[__sync_time]    DATETIME2
[__sync_id_num]  BIGINT
[ID]             BIGINT NOT NULL (part of unique index)
[source_db]      NVARCHAR(255) (part of unique index)
[MigrateFlg]     INT (0=pending, 1=success, 2=processing, 3=error)
[MigrateErrFlg]  INT
[MigrateErrMess] NVARCHAR(MAX)
[TieuDe]         NVARCHAR(1000)
[BatDau]         DATETIME
[KetThuc]        DATETIME
... (and other meeting fields)
```

### event_sync_staging

```sql
[SY_SyncId]      INT (PK)
[__sync_time]    DATETIME2
[__sync_id_num]  BIGINT
[ID]             BIGINT NOT NULL (part of unique index)
[source_db]      NVARCHAR(255) (part of unique index)
[MigrateFlg]     INT
[MigrateErrFlg]  INT
[MigrateErrMess] NVARCHAR(MAX)
... (80+ columns for event data)
```

### task_sync_staging / task_outgoing_sync_staging

```sql
[SY_SyncId]      INT (PK)
[__sync_time]    DATETIME2
[__sync_id_num]  BIGINT
[ID]             BIGINT NOT NULL (part of unique index)
[source_db]      NVARCHAR(255) (part of unique index)
[MigrateFlg]     INT
[MigrateErrFlg]  INT
[MigrateErrMess] NVARCHAR(MAX)
[Title]          NVARCHAR(MAX)
[VBId]           BIGINT
[StartDate]      DATETIME
[DueDate]        DATETIME
... (task-related fields)
```

---

## 🆘 TROUBLESHOOTING

### Error: "Cannot find table meeting_sync_staging"

→ Run FIX_MISSING_TABLES.sql and verify execution completed without errors

### Error: "Model still not registered"

→ Check SyncManagerController.js was updated with new imports and registrations
→ Check app console for ❌ registration error messages with details

### Error: "Permission denied" on database

→ Verify user `app_dioffice_mig` has:

- CREATE TABLE permission
- ALTER TABLE permission
- CREATE INDEX permission
- SELECT/INSERT/UPDATE on dbo schema

### Scheduler not running at scheduled times

→ Check `cron_sync_config` table has correct `cron_time` format (HH:mm)
→ Verify CronSyncScheduler is initialized
→ Check `is_active` column = 1

---

## 📞 NEED HELP?

If issues persist after applying fixes:

1. **Check database**: `SELECT * FROM dbo.cron_sync_config`
2. **Check logs**: `npm start` and look for registration messages
3. **Verify tables exist**:
   ```sql
   SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
   WHERE TABLE_NAME LIKE '%sync_staging'
   ```
4. **Verify indexes**:
   ```sql
   SELECT name FROM sys.indexes
   WHERE object_id = OBJECT_ID('dbo.meeting_sync_staging')
   ```

---

**✨ All set! Your sync system should now work correctly.**
