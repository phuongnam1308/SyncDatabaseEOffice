# HƯỚNG DẪN DEBUG DOWNLOAD FILE ASPX

## 🔴 VẤN ĐỀ

File ASPX từ SharePoint không được download thành công về hệ thống mới.

---

## 📋 CÁC BƯỚC CHẨN ĐOÁN

### 1️⃣ TEST 1: Debug toàn bộ luồng (CHẠY TRƯỚC TIÊN)

**File:** `test_debug_download_flow.js`

```bash
# Chạy từ thư mục dự án
cd c:\Users\DELL\Documents\2903l2
node src/sync-news-aspx-page/test_debug_download_flow.js
```

**Mục đích:** Test 9 bước từ đơn giản đến phức tạp

- ✓ Check service initialize
- ✓ Check staging table structure
- ✓ Get list of pending items
- ✓ Check staging table data
- ✓ Fetch one item to download
- ✓ Check download service
- ✓ Test download single file
- ✓ Test process one item
- ✓ Check downloaded files

**Kết quả mong muốn:**

```
[✓] step1: OK
[✓] step2: OK
[✓] step3: OK  (totalCount > 0)
[✓] step4: OK  (pending items > 0)
[✓] step5: OK  (row found)
[✓] step6: OK  (spDownload available)
[✓] step7: OK  (buffer downloaded, size > 0)
[✓] step8: OK  (processing success)
[✓] step9: OK  (files exist)
```

**Nếu bị fail ở bước 3 hoặc 4:** → Chạy TEST 2
**Nếu bị fail ở bước 7 hoặc 8:** → Chạy TEST 3

---

### 2️⃣ TEST 2: Kiểm tra dữ liệu từ SharePoint DB

**File:** `test_check_data_fetch.js`

```bash
node src/sync-news-aspx-page/test_check_data_fetch.js
```

**Mục đích:** Xác nhận file ASPX có tồn tại trong SharePoint không

- ✓ Connect to SharePoint DB
- ✓ Count total ASPX files
- ✓ Get sample files from SharePoint
- ✓ Manual fetch test
- ✓ Check staging after list sync

**Kết quả mong muốn:**

```
✓ Total ASPX files found: 100+ files
✓ Found 5+ sample files
✓ Manual fetch: 10+ items
✓ Staging table status: 100+ pending items
```

**Nếu thấy "No ASPX files found":**

- ❌ Không có file ASPX trong SharePoint
- Kiểm tra: BASE_URL, SHAREPOINT_DB_NAME trong .env
- Kiểm tra kết nối SharePoint DB

---

### 3️⃣ TEST 3: Test download chi tiết

**File:** `test_detailed_download.js`

```bash
node src/sync-news-aspx-page/test_detailed_download.js
```

**Mục đích:** Debug cụ thể phần download

- ✓ Get first pending URL from staging
- ✓ Test direct download with spDownload()
- ✓ Test axios download
- ✓ Test file save
- ✓ Test full processRowData()

**Kết quả mong muốn:**

```
✓ Found URL to test: https://...
✓ Download completed: 50KB+
✓ Looks like HTML: ✓
✓ File created successfully
```

**Lỗi thường gặp:**

| Lỗi                          | Nguyên nhân             | Giải pháp                      |
| ---------------------------- | ----------------------- | ------------------------------ |
| "Cookie file not found"      | Auth cookie hết hạn     | Chạy: `npm run login`          |
| "Downloaded buffer is empty" | Server trả về file rỗng | Check URL, check SharePoint    |
| "Error: NTLM"                | Lỗi authentication      | Refresh token: `npm run login` |
| "ENOENT: no such file"       | Directory không tồn tại | Check TINTUCRAW_DIR            |

---

### 4️⃣ TEST 4: Test HTML parsing

**File:** `test_html_parsing.js`

```bash
node src/sync-news-aspx-page/test_html_parsing.js
```

**Mục đích:** Kiểm tra file HTML có được parse thành công không

- ✓ Initialize parser
- ✓ Find sample HTML files
- ✓ Parse single HTML file
- ✓ Parse multiple files
- ✓ Check parse logic
- ✓ Test extract functions

**Kết quả mong muốn:**

```
✓ Found 10+ HTML files
✓ Parsing completed: "Tiêu đề bài viết"
✓ Title: "..."
✓ Content length: 5000+ bytes
```

---

## 🔍 DIAGNOSTIC FLOWCHART

```
START
  ↓
[TEST 1] Run debug flow
  ├─ Fail Step 1? (Initialize) → Check NODE_PATH, DB connection
  ├─ Fail Step 3-4? (Get List) → Run TEST 2 (Data Fetch)
  │   ├─ No ASPX files? → Check SharePoint DB connection
  │   └─ But getList shows 0? → Check TINTUC_STAGE_BATCH_SIZE, COMPLETED_LIMIT
  ├─ Fail Step 7? (Download) → Run TEST 3 (Detailed Download)
  │   ├─ "Cookie not found"? → npm run login
  │   ├─ "Connection refused"? → Check FIREWALL, SSL
  │   └─ "Empty buffer"? → File might not exist on server
  └─ All pass? → File should be in tintucraw/ → Run TEST 4 (HTML Parse)
```

---

## 🛠️ QUICK FIX CHECKLIST

- [ ] Cookie expired? Run: `npm run login`
- [ ] No ASPX files? Check: `SHAREPOINT_DB_NAME`, `BASE_URL` in .env
- [ ] Download fails? Check: Firewall, SSL, IGNORE_SSL=true
- [ ] Files not saved? Check: TINTUCRAW_DIR exists, have write permission
- [ ] Parsing fails? Check: `.ensure` methods in HtmlFileMigrationModel.js

---

## 📊 LOG FILES LOCATION

```
Main logs:   logs/
Sync logs:   logs/sync-news-aspx-page/
Downloaded:  tintucraw/
Test output: stdout (console)
```

---

## 🚀 QUICK START

### Lần đầu tiên:

```bash
# 1. Refresh auth
npm run login

# 2. Check data exists
node src/sync-news-aspx-page/test_check_data_fetch.js

# 3. Full debug
node src/sync-news-aspx-page/test_debug_download_flow.js

# 4. Test download
node src/sync-news-aspx-page/test_detailed_download.js

# 5. Test parsing
node src/sync-news-aspx-page/test_html_parsing.js
```

### Hàng ngày:

```bash
# Get status
node src/sync-news-aspx-page/test_debug_download_flow.js | head -50

# Run full sync
node index.js  # or use the API endpoint to start sync
```

---

## 📞 COMMON ISSUES

### Issue 1: "0 records pending"

```
Nguyên nhân:
- Staging table trống
- getList() chưa fetch được dữ liệu
- Hoặc tất cả file đã được download (status='OK')

Fix:
- Kiểm tra getList() fetch dữ liệu: test_check_data_fetch.js
- Reset staging: DELETE FROM news_aspx_pages_temp WHERE DownloadStatus='OK'
```

### Issue 2: "Downloaded buffer is empty"

```
Nguyên nhân:
- Cookie hết hạn
- URL không đúng
- SharePoint server không response

Fix:
- npm run login  (refresh auth)
- Kiểm tra URL format
- Check FIREWALL, proxy settings
```

### Issue 3: "ParseHtmlFile returns null"

```
Nguyên nhân:
- File HTML không match pattern news article
- File bị exclude (Forms/, SiteAssets/, v.v.)

Fix:
- Kiểm tra isNewsArticle logic trong processRowData()
- Xem file content: test_html_parsing.js
```

---

## 📝 ENV VARIABLES TO CHECK

```env
# Database
OLD_DB_SERVER=10.1.253.41
SHAREPOINT_DB_NAME=WSS_Content_eoffice_khkd

# New System
NEW_DB_NAME=tancang_eoffice
NEW_DB_SERVER=...
NEW_DB_USER=...
NEW_DB_PASSWORD=...

# SharePoint
BASE_URL=https://eoffice.saigonnewport.com.vn
IGNORE_SSL=false

# Download
TINTUCRAW_DIR=tintucraw
TINTUC_STAGE_BATCH_SIZE=500
COMPLETED_LIMIT=1000
BEGIN_LIMIT=0

# Auth
COOKIE_FILE_PATH=auth/cookie.txt
```

---

## 🎯 DETAILED FIX GUIDE

### Scenario 1: "No ASPX files found"

```bash
# 1. Check SharePoint connection
sqlcmd -S OLD_DB_SERVER -U user -P pass -d SHAREPOINT_DB_NAME -Q "SELECT COUNT(*) FROM AllDocs WHERE LeafName LIKE '%.aspx'"

# 2. Check tintuc site
sqlcmd -S OLD_DB_SERVER -U user -P pass -d SHAREPOINT_DB_NAME -Q "SELECT FullUrl FROM AllWebs WHERE FullUrl LIKE '%tintuc%'"

# 3. If no results, update BASE_URL in .env
```

### Scenario 2: "Download fails with 401"

```bash
# Token expired
npm run login

# Verify cookie
cat auth/cookie.txt

# Test direct download (manual test)
curl -H "Cookie: <content-of-auth/cookie.txt>" "https://eoffice.../tintuc/...aspx"
```

### Scenario 3: "File saved but parsing returns null"

```bash
# Check file content
type tintucraw/tintuc/file.aspx | head -20

# If it's HTML, check parseHtmlFile logic
# If it's JSON, check if it needs special parsing

# Check extensions:
ls -la tintucraw/ | grep -E "\.(html|aspx|json)"
```

---

## 📈 MONITORING

```bash
# Watch log in real-time
tail -f logs/sync-news-aspx-page/*.log

# Count pending items
node -e "
    const db = require('mssql');
    db.connect({...}).then(() => {
        db.query('SELECT COUNT(*) FROM news_aspx_pages_temp WHERE DownloadStatus IS NULL');
    });
"

# Monitor disk usage
dir tintucraw /s /h | tail -5
```

---

**Chúc bạn debug thành công! 🎉**

Nếu vẫn gặp sự cố, hãy:

1. Chạy đầy đủ TEST 1-4
2. Ghi lại output và error messages
3. Check các env variables
4. Kiểm tra lại firewall, proxy, SSL settings
