# 📋 TEST FILES SUMMARY & INDEX

## Tổng quan

Êu cầu của bạn là debug vì sao ASPX files không được download về. Tôi đã tạo 5 file test chuyên sâu để giúp bạn từng bước tìm ra vấn đề.

---

## ✅ TEST FILES CREATED

### 1. **run_all_tests.js** - 🎯 CHẠY TRƯỚC TIÊN

**Mục đích:** Chạy tất cả 4 test trong sequence và summary kết quả
**Thời gian:** ~2-5 phút
**Câu lệnh:**

```bash
cd c:\Users\DELL\Documents\2903l2
node src\sync-news-aspx-page\run_all_tests.js
```

**Output:** Summary của tất cả tests, báo cáo những test nào fail

---

### 2. **test_debug_download_flow.js** - 🔍 MAIN DEBUG TOOL

**Mục đích:** Test 9 bước từ initialize service đến save file
**9 Bước:**

1. Initialize Service
2. Check Staging Table Structure
3. Get List of Pending Items
4. Check Staging Table Data
5. Fetch One Item from Staging
6. Check Download Service (spDownload)
7. **Test Download Single File** ← Quan trọng nhất
8. Test Process One Item
9. Check Downloaded Local Files

**Câu lệnh:**

```bash
node src\sync-news-aspx-page\test_debug_download_flow.js
```

**Kỳ vọng:**

- Step 1-2: OK (setup)
- **Step 3-4: OK - Phải có pending items, nếu 0 chạy TEST 2**
- **Step 7: OK - File download thành công**
- Step 8-9: OK (processing)

**Nếu fail ở step 7:**
→ Là lõi vấn đề download. Chạy test 3 để chi tiết hơn.

---

### 3. **test_detailed_download.js** - 💾 DOWNLOAD TROUBLESHOOTING

**Mục đích:** Test download với chi tiết từng bước
**Các test:**

- Test direct download with `spDownload()`
- Test download with axios directly (with auth headers)
- Test file save to disk
- Test full processRowData()

**Câu lệnh:**

```bash
node src\sync-news-aspx-page\test_detailed_download.js
```

**Lỗi có thể gặp:**

```
❌ "Downloaded buffer is empty"
   → npm run login (refresh auth)
   → Check IGNORE_SSL in .env

❌ "NTLM authentication failed"
   → npm run login

❌ "Connection refused"
   → Check Firewall, proxy settings

❌ "File was not created"
   → Check TINTUCRAW_DIR exists and writable
```

---

### 4. **test_check_data_fetch.js** - 🗄️ DATA VALIDATION

**Mục đích:** Kiểm tra dữ liệu từ SharePoint DB có tồn tại không
**Các test:**

1. Connect to SharePoint DB
2. Count total ASPX files
3. Get sample ASPX files
4. Get sync state (après running getList)
5. Check staging table after list sync
6. Manually fetch list from SharePoint
7. Check environment variables

**Câu lệnh:**

```bash
node src\sync-news-aspx-page\test_check_data_fetch.js
```

**Kỳ vọng:**

- "Total ASPX files found: 100+"
- "Pending items: 100+"

**Nếu 0 files:**
→ Check SHAREPOINT_DB_NAME, BASE_URL trong .env

---

### 5. **test_html_parsing.js** - 📄 PARSING TEST

**Mục đích:** Kiểm tra HTML files có được parse thành công không
**Các test:**

1. Initialize HTML Parser
2. Find sample HTML files from tintucraw
3. Parse single HTML file
4. Parse multiple files
5. Check parse logic (available methods)
6. Test extract functions (via cheerio)

**Câu lệnh:**

```bash
node src\sync-news-aspx-page\test_html_parsing.js
```

**Kỳ vọng:**

- "Found 10+ HTML files"
- "Parsing completed: 'Tiêu đề bài viết'"

---

## 📖 DOCUMENTS

### DEBUG_GUIDE.md

Chi tiết hơn về:

- Cách chẩn đoán từng issue
- Flowchart diagnostic
- Quick fix checklist
- Common issues & solutions
- Monitoring tips

### QUICK_START.js

- Print ra console
- Quick reference commands
- Expected results
- Common errors & fixes

---

## 🚀 QUICK EXECUTION GUIDE

### First Time (Complete Diagnosis)

```bash
# Step 0: Refresh auth
npm run login

# Step 1: Run all tests (will take 2-5 min)
cd c:\Users\DELL\Documents\2903l2
node src\sync-news-aspx-page\run_all_tests.js

# Step 2: Review summary at end
# All green ✓ ? Great, system is working!
# Some red ✗ ? See which test failed, follow fix guide
```

### If Test 2 or Test 3 Fails (Download Issue)

```bash
# More detailed output
node src\sync-news-aspx-page\test_detailed_download.js

# Refresh auth if needed
npm run login

# Try again
node src\sync-news-aspx-page\test_detailed_download.js
```

### If Test 1 Fails (Data Not Found)

```bash
# Check SharePoint connection
node src\sync-news-aspx-page\test_check_data_fetch.js

# Verify .env file settings:
# - SHAREPOINT_DB_NAME
# - BASE_URL
# - OLD_DB_SERVER
```

---

## 🎯 STEP-BY-STEP FOR YOUR SITUATION

Bạn nói: "tình tức đầu chưa được download"

**Nghĩa là:**

1. ❓ Staging table có dữ liệu không? (test 2, step 4)
2. ❓ Download được buffer không? (test 2, step 7)
3. ❓ File được save không? (test 2, step 9)

**Cách kiểm tra:**

```bash
# 1. Check tất cả
node run_all_tests.js

# 2. Nếu step 7 fail trong test 2
   → Chạy test 3
   → Check: npm run login, firewall, SSL

# 3. Nếu step 3-4 fail trong test 2
   → Chạy test 1
   → Check: SHAREPOINT_DB_NAME, BASE_URL

# 4. Nếu step 9 fail
   → Check: tintucraw/ directory exists
   → Check: Files in tintucraw/ directory
```

---

## 📊 FILES LOCATION

```
c:\Users\DELL\Documents\2903l2\src\sync-news-aspx-page\
├── run_all_tests.js              ← 🌟 RUN THIS FIRST
├── test_debug_download_flow.js    ← Main debug (9 steps)
├── test_detailed_download.js      ← Download issues
├── test_check_data_fetch.js       ← Data validation
├── test_html_parsing.js           ← Parsing test
├── DEBUG_GUIDE.md                 ← Detailed guide
├── QUICK_START.js                 ← Quick reference
└── INDEX.md                       ← This file

Downloaded files:
└── tintucraw/                     ← Downloaded ASPX files go here
```

---

## 🔧 ENVIRONMENT VARIABLES TO CHECK

Before running tests, verify your .env has:

```env
# OLD DATABASE (SharePoint)
OLD_DB_SERVER=10.1.253.41
SHAREPOINT_DB_NAME=WSS_Content_eoffice_khkd

# NEW DATABASE (Target system)
NEW_DB_NAME=tancang_eoffice
NEW_DB_SERVER=...
NEW_DB_USER=...
NEW_DB_PASSWORD=...

# SHAREPOINT BASE
BASE_URL=https://eoffice.saigonnewport.com.vn
IGNORE_SSL=false

# OUTPUT
TINTUCRAW_DIR=tintucraw
COOKIE_FILE_PATH=auth/cookie.txt

# SYNC LIMITS
TINTUC_STAGE_BATCH_SIZE=500
COMPLETED_LIMIT=1000
BEGIN_LIMIT=0
```

---

## ✨ WHAT'S INCLUDED IN EACH TEST

| Test   | What checks                           | Issue detected     | Action                       |
| ------ | ------------------------------------- | ------------------ | ---------------------------- |
| Test 1 | SharePoint DB connection, ASPX count  | No files in DB     | Check SHAREPOINT_DB_NAME     |
| Test 2 | Service init, staging table, download | Download fails     | Run Test 3                   |
| Test 2 | List fetch, staging data              | 0 pending items    | Run Test 1                   |
| Test 3 | spDownload(), axios, file save        | Auth/network issue | npm run login                |
| Test 4 | HTML parsing, extract functions       | Parse fails        | Check HtmlFileMigrationModel |

---

## 🎓 TROUBLESHOOTING FLOWCHART

```
START
  ↓
[Run run_all_tests.js]
  ├─ All tests ✓ PASS?
  │   ↓
  │   → Files should be in tintucraw/
  │   → System is working! 🎉
  │
  └─ Some tests ✗ FAIL?
      ↓
      Which test?
      ├─ Test 1 FAIL? → Check SharePoint DB, SHAREPOINT_DB_NAME
      ├─ Test 2 FAIL?
      │   ├─ Step 1-2 fail? → Check DB connections
      │   ├─ Step 3-4 fail? → Run Test 1 (no data)
      │   ├─ Step 7 fail? → Run Test 3 (download issue)
      │   └─ Step 9 fail? → Check tintucraw/ directory
      ├─ Test 3 FAIL? → npm run login, check firewall
      └─ Test 4 FAIL? → Check HTML parsing logic
```

---

## 🎯 YOUR NEXT STEPS

1. **Now:** Run `npm run login` to refresh auth
2. **Now:** Run `node src\sync-news-aspx-page\run_all_tests.js`
3. **Check:** Which test fails?
4. **Fix:** Follow the fix guide for that test
5. **Retry:** Run the specific test again
6. **Confirm:** Re-run all tests to verify fixes

---

## 📞 QUICK REFERENCE

| Action            | Command                                                    |
| ----------------- | ---------------------------------------------------------- |
| Refresh auth      | `npm run login`                                            |
| Run all tests     | `node src\sync-news-aspx-page\run_all_tests.js`            |
| Test 1 (Data)     | `node src\sync-news-aspx-page\test_check_data_fetch.js`    |
| Test 2 (Flow)     | `node src\sync-news-aspx-page\test_debug_download_flow.js` |
| Test 3 (Download) | `node src\sync-news-aspx-page\test_detailed_download.js`   |
| Test 4 (Parse)    | `node src\sync-news-aspx-page\test_html_parsing.js`        |
| Show guide        | `cat DEBUG_GUIDE.md`                                       |
| Show quick start  | `node QUICK_START.js`                                      |

---

## ✅ SUCCESS CRITERIA

Your system is working when:

- ✓ Test 2, Step 7: "Downloaded successfully! Size: X KB"
- ✓ Test 2, Step 9: Files exist in tintucraw/
- ✓ Test 4: "Parsing completed" with article title
- ✓ Database: staging table has status='OK' records

---

**Chúc bạn debug thành công! 🚀**

Hãy bắt đầu bằng `run_all_tests.js` để xem tất cả những gì đang xảy ra.
