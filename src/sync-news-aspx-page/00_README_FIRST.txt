╔══════════════════════════════════════════════════════════════════════════════╗
║                           📦 DEBUG FILES SUMMARY                            ║
║                                                                              ║
║                   ASPX Download Issue - Complete Testing Kit                ║
╚══════════════════════════════════════════════════════════════════════════════╝

VẤN ĐỀ CỦA BẠN:
===============
"C:\Users\DELL\Documents\2903l2\src\sync-news-aspx-page hiện tại chưa được
download aspx về cái tin tức đầu, không biết nguyên nhân"

GIẢI PHÁP:
==========
Tôi đã tạo 4 file test + 3 file hướng dẫn để giúp bạn debug từng bước.


📁 FILES ĐÃ TẠO:
================

[1] ⭐ run_all_tests.js
    ├─ Chạy: node src\sync-news-aspx-page\run_all_tests.js
    ├─ Mục đích: Chạy TẤT CẢ 4 test trong sequence + summary
    ├─ Thời gian: 2-5 phút
    └─ Kết quả: Báo cáo test nào pass, test nào fail + fix guide

[2] 🔍 test_debug_download_flow.js
    ├─ Chạy: node src\sync-news-aspx-page\test_debug_download_flow.js
    ├─ Test 9 bước chi tiết:
    │   1. Initialize Service
    │   2. Check Staging Table Structure
    │   3. Get List of Pending Items ← Quan trọng
    │   4. Check Staging Table Data ← Quan trọng
    │   5. Fetch One Item from Staging
    │   6. Check Download Service (spDownload)
    │   7. Test Download Single File ← MOST IMPORTANT
    │   8. Test Process One Item
    │   9. Check Downloaded Local Files
    └─ Nếu step 7 fail → chạy test [3]

[3] 💾 test_detailed_download.js
    ├─ Chạy: node src\sync-news-aspx-page\test_detailed_download.js
    ├─ Mục đích: Test download chi tiết, lấy error messages cụ thể
    ├─ Test các phương pháp:
    │   • spDownload() function
    │   • axios direct download
    │   • file save to disk
    │   • full processRowData()
    ├─ Lỗi thường gặp:
    │   ✗ "Cookie file not found" → npm run login
    │   ✗ "Empty buffer" → check auth, firewall
    │   ✗ "NTLM failed" → npm run login
    │   ✗ "File not created" → check tintucraw/ permissions
    └─ Cho output chi tiết nhất về download errors

[4] 🗄️ test_check_data_fetch.js
    ├─ Chạy: node src\sync-news-aspx-page\test_check_data_fetch.js
    ├─ Mục đích: Kiểm tra dữ liệu từ SharePoint DB
    ├─ Test các phần:
    │   • Connect to SharePoint DB
    │   • Count total ASPX files
    │   • Get sample ASPX files
    │   • Check staging table status
    │   • Manual fetch list
    │   • Environment variables
    ├─ Nếu "0 files found" → check SHAREPOINT_DB_NAME, BASE_URL
    └─ Để biết data có từ SharePoint không

[5] 📄 test_html_parsing.js
    ├─ Chạy: node src\sync-news-aspx-page\test_html_parsing.js
    ├─ Mục đích: Kiểm tra HTML parsing
    ├─ Test:
    │   • Initialize parser
    │   • Find HTML files in tintucraw/
    │   • Parse single file
    │   • Parse multiple files
    │   • Check parse logic
    │   • Extract functions test
    └─ Để biết file có được parse thành bài viết không

[6] 📖 DEBUG_GUIDE.md
    ├─ Tài liệu: Chi tiết cách debug từng issue
    ├─ Bao gồm:
    │   • Diagnostic flowchart
    │   • Quick fix checklist
    │   • Common issues & solutions
    │   • Monitoring tips
    │   • Detailed fix guides
    └─ Đọc khi cần help chi tiết

[7] 📑 QUICK_START.js (chạy để xem guide)
    ├─ Chạy: node src\sync-news-aspx-page\QUICK_START.js
    ├─ Hiển thị:
    │   • Quick start commands
    │   • Expected results
    │   • Common issues & fixes
    │   • Pro tips
    └─ Print ra console cho dễ xem

[8] 📋 INDEX.md (file này)
    ├─ Tổng quan về tất cả files
    ├─ Mô tả mục đích từng test
    ├─ Troubleshooting flowchart
    ├─ Quick reference
    └─ Your next steps


🚀 CÁCH SỬ DỤNG:
================

FIRST TIME (Complete Diagnosis):
──────────────────────────────────

Step 1: Refresh authentication
    npm run login

Step 2: Run ALL tests (RUN THIS!)
    cd c:\Users\DELL\Documents\2903l2
    node src\sync-news-aspx-page\run_all_tests.js

Step 3: Wait for summary at the end
    • All ✓ PASS? → Files should be in tintucraw/ ✨
    • Some ✗ FAIL? → Read which test failed, follow fix guide

Step 4: For failed tests, run specific test:
    • If Test 1 fails: node src\sync-news-aspx-page\test_check_data_fetch.js
    • If Test 2 fails: node src\sync-news-aspx-page\test_debug_download_flow.js
    • If Test 3 fails: node src\sync-news-aspx-page\test_detailed_download.js
    • If Test 4 fails: node src\sync-news-aspx-page\test_html_parsing.js


QUICK CHECKS (Later):
─────────────────────

Just check main flow:
    node src\sync-news-aspx-page\test_debug_download_flow.js


🎯 EXPECTED RESULTS:
====================

Test 2 (Main debug) should show:
    ✓ step1: OK (Service initialized)
    ✓ step2: OK (Table structure OK)
    ✓ step3: OK (totalCount > 0)        ← If 0, data not fetched
    ✓ step4: OK (pending items > 0)     ← If 0, run Test 1
    ✓ step5: OK (row found)
    ✓ step6: OK (Download service ready)
    ✓ step7: OK (Buffer downloaded!)    ← MOST IMPORTANT
    ✓ step8: OK (Processing success)
    ✓ step9: OK (Files exist)


💡 COMMON ISSUES:
=================

❌ "0 records pending" (Test 2, Step 3-4)
   → Problem: No data fetched from SharePoint
   → Fix: Run Test 1 (test_check_data_fetch.js)
   → Check: SHAREPOINT_DB_NAME, BASE_URL in .env

❌ "Downloaded buffer is empty" (Test 2, Step 7)
   → Problem: Download returns empty buffer
   → Fix: npm run login (refresh auth)
   → Check: Firewall, SSL, set IGNORE_SSL=true

❌ "Cookie file not found" (Any test)
   → Problem: Auth token expired
   → Fix: npm run login

❌ "NTLM authentication failed"
   → Problem: Auth server unreachable
   → Fix: npm run login, check proxy, check firewall

❌ "No ASPX files found" (Test 1)
   → Problem: No files in SharePoint DB
   → Fix: Check BASE_URL, SHAREPOINT_DB_NAME
   → Fix: Verify tintuc site exists in SharePoint


📊 DIAGNOSTIC FLOWCHART:
========================

                    START
                      ↓
        npm run login (refresh auth)
                      ↓
    node run_all_tests.js
                      ↓
         ╔════════════════════╗
         │ Which test fails?  │
         ╚════════════════════╝
         │
    ┌────┼────┬────┬────┐
    │    │    │    │    │
   [1]  [2]  [3]  [4]  NONE
    │    │    │    │    │
    │    │    │    │    └→ ✓ SUCCESS! 🎉
    │    │    │    │       Files in tintucraw/
    │    │    │    │
    │    │    │    └→ Check HTML parsing logic
    │    │    │       in HtmlFileMigrationModel.js
    │    │    │
    │    │    └→ npm run login
    │    │       Check firewall, SSL
    │    │       Re-run test 3
    │    │
    │    └→ Run specific test to see which step fails
    │       ├─ Step 3-4 fail? → Run Test 1
    │       └─ Step 7 fail? → Run Test 3
    │
    └→ Check SharePoint DB connection
       Check SHAREPOINT_DB_NAME, BASE_URL


✅ WHAT YOU GET:
================

✓ Detailed logs showing EACH STEP
✓ Specific error messages and causes
✓ Download success/failure status
✓ File save confirmation
✓ Parse result with article title
✓ Quick fixes for common issues
✓ Environment variable verification
✓ HTML content preview


📝 FILES LOCATION (for reference):
==================================

c:\Users\DELL\Documents\2903l2\src\sync-news-aspx-page\

├── run_all_tests.js              ← 🌟 RUN THIS FIRST!
├── test_debug_download_flow.js    ← Main 9-step debug
├── test_detailed_download.js      ← Download troubleshooting
├── test_check_data_fetch.js       ← Data validation
├── test_html_parsing.js           ← Parse test
│
├── DEBUG_GUIDE.md                 ← Detailed reference
├── QUICK_START.js                 ← Print guide to console
└── INDEX.md                       ← Full index


🔧 BEFORE RUNNING TESTS:
==========================

Verify your .env file has these (check with: cat .env):

OLD_DB_SERVER=10.1.253.41              # SharePoint DB server
SHAREPOINT_DB_NAME=WSS_Content_eoffice_khkd
NEW_DB_NAME=tancang_eoffice            # New system DB
BASE_URL=https://eoffice.saigonnewport.com.vn
TINTUCRAW_DIR=tintucraw                # Downloads go here
IGNORE_SSL=false                       # or true if needed
COOKIE_FILE_PATH=auth/cookie.txt       # Auth cookie


🎓 STEP-BY-STEP:
================

1️⃣ Refresh auth (IMPORTANT):
   npm run login

2️⃣ Go to project directory:
   cd c:\Users\DELL\Documents\2903l2

3️⃣ Run all tests:
   node src\sync-news-aspx-page\run_all_tests.js

4️⃣ Check output at end (simple summary)

5️⃣ If any fails:
   • Read error message
   • Check which test failed
   • Follow fix guide for that test
   • Run specific test again

6️⃣ Success when:
   ✓ All tests show ✓ PASSED
   ✓ Files exist in tintucraw/
   ✓ Database shows status='OK'


🎯 YOUR IMMEDIATE ACTION:
=========================

1. npm run login

2. cd c:\Users\DELL\Documents\2903l2

3. node src\sync-news-aspx-page\run_all_tests.js

4. Tell me what test fails (if any)


═══════════════════════════════════════════════════════════════════════════════

That's it! You now have a complete debugging toolkit.

Next: npm run login && node src\sync-news-aspx-page\run_all_tests.js

═══════════════════════════════════════════════════════════════════════════════
