#!/usr/bin/env node

/**
 * HOẶC CHẠY TỪNG TEST RIÊNG HỈETh
 *
 * Các câu lệnh nhanh:
 */

// =============================================================================
// 🚀 QUICK START COMMANDS
// =============================================================================

console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                  ASPX DOWNLOAD DEBUG - QUICK START GUIDE                  ║
╚════════════════════════════════════════════════════════════════════════════╝

📁 Project: c:\\Users\\DELL\\Documents\\2903l2\\src\\sync-news-aspx-page

🔧 STEP 1: Refresh Authentication (nếu chưa làm lần nào này đó)
============================================================================

  npm run login

  Lệnh này sẽ tạo cookie mới từ SharePoint


🧪 STEP 2: Run Tests (chọn một hoặc chạy tất cả)
============================================================================

  ▸ RUN ALL TESTS (Recommended - first time):
    cd c:\\Users\\DELL\\Documents\\2903l2
    node src\\sync-news-aspx-page\\run_all_tests.js


  ▸ RUN INDIVIDUAL TESTS:

    Test 1 - Check if ASPX files exist in SharePoint:
    node src\\sync-news-aspx-page\\test_check_data_fetch.js

    Test 2 - Full debug flow (9 steps):
    node src\\sync-news-aspx-page\\test_debug_download_flow.js

    Test 3 - Detailed download test (with error details):
    node src\\sync-news-aspx-page\\test_detailed_download.js

    Test 4 - HTML parsing test (check if files are parsed):
    node src\\sync-news-aspx-page\\test_html_parsing.js


📋 EXPECTED RESULTS
============================================================================

Test 1 - Check Data Fetch:
  ✓ Total ASPX files found: 100+ (หรือ số lượng file bạn có)
  ✓ Found sample files: 5+ files
  ✓ Manual fetch: 10+ items
  ✓ Staging table status: 100+ pending items

Test 2 - Debug Flow (MOST IMPORTANT):
  ✓ step1: OK (Service initialized)
  ✓ step2: OK (Table structure OK)
  ✓ step3: OK (totalCount > 0)      ← Quan trọng
  ✓ step4: OK (pending items > 0)   ← Quan trọng
  ✓ step5: OK (row found)
  ✓ step6: OK (Download service ready)
  ✓ step7: OK (Buffer downloaded)   ← Quan trọng
  ✓ step8: OK (Processing success)
  ✓ step9: OK (Files exist locally)

Test 3 - Detailed Download:
  ✓ Found URL to test: https://...
  ✓ Download completed! Size: 50KB+
  ✓ Looks like HTML: ✓
  ✓ File created successfully

Test 4 - HTML Parsing:
  ✓ Found 10+ HTML files
  ✓ Parsing completed: "Tiêu đề bài viết"
  ✓ Content length: 5000+ bytes


❌ COMMON ISSUES & FIXES
============================================================================

Issue 1: "0 records pending" (Test 2, Step 3-4 fails)
  └─ FIX: Run Test 1 (test_check_data_fetch.js)
     Check if ASPX files actually exist in SharePoint DB

Issue 2: "Cookie file not found" (Any test fails)
  └─ FIX: npm run login

Issue 3: "Downloaded buffer is empty" (Test 2, Step 7 fails)
  └─ FIX:
     • npm run login (refresh auth)
     • Check firewall/SSL: IGNORE_SSL=true in .env
     • Check BASE_URL in .env is correct

Issue 4: "ParseHtmlFile returns null" (Test 4 shows 0 success)
  └─ FIX: Check HTML parsing logic in HtmlFileMigrationModel.js
     File might be excluded by isNewsArticle filter

Issue 5: "NTLM authentication failed"
  └─ FIX:
     • npm run login
     • Check if proxy is configured
     • Check if FIREWALL blocks requests


📊 FILE LOCATIONS
============================================================================

Test files:
  • test_debug_download_flow.js   - Main debug flow (9 steps)
  • test_check_data_fetch.js      - Check SharePoint DB
  • test_detailed_download.js     - Download troubleshooting
  • test_html_parsing.js          - Parse testing
  • run_all_tests.js              - Run all tests in sequence
  • DEBUG_GUIDE.md                - Detailed guide

Downloaded files:
  • tintucraw/                    - Raw downloaded ASPX files
  • tintucraw/tintuc/             - Organized files

Logs:
  • logs/                         - Main logs
  • logs/sync-news-aspx-page/     - Specific sync logs


🔍 DETAILED DEBUG: Enable Enhanced Logging
============================================================================

Edit your .env file and add:

  LOG_LEVEL=debug
  DEBUG_DOWNLOAD=true
  VERBOSE_PARSE=true

Then run tests again for more detailed output.


📝 ENV VARIABLES TO VERIFY
============================================================================

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


🎯 RECOMMENDED ORDER OF EXECUTION
============================================================================

FIRST TIME (Full Diagnosis):
  1. npm run login
  2. node run_all_tests.js          (watches all 4 tests)
  3. Check summary at the end
  4. Fix issues reported
  5. Run specific test again

QUICK CHECK (Next times):
  1. node test_debug_download_flow.js
  2. Look at top 5 lines to see status quickly

AFTER FIXING ISSUES:
  1. Make your changes
  2. node test_debug_download_flow.js
  3. Verify everything passes


💡 PRO TIPS
============================================================================

• Keep a terminal window open with: tail -f logs/sync-news-aspx-page/*.log
  This lets you see detailed logs while tests run

• If tests pass but files still don't download in production:
  Run the actual sync with: npm start
  Then check: ls -la tintucraw/

• To reset and retry:
  DELETE FROM news_aspx_pages_temp WHERE DownloadStatus='OK'
  Then run your sync again

• For one-time testing:
  COMPLETED_LIMIT=5 node test_debug_download_flow.js
  (This will limit to 5 files for faster testing)


📞 NEED HELP?
============================================================================

1. Run ALL tests (run_all_tests.js)
2. Take note of which test fails
3. Read the specific section above for that test
4. Check DEBUG_GUIDE.md for more details


✅ SUCCESS INDICATORS
============================================================================

After running tests, you should see:
  ✓ Files in: tintucraw/tintuc/...
  ✓ Database staging table populated
  ✓ No download errors
  ✓ HTML content visible in test output


═══════════════════════════════════════════════════════════════════════════════

Ready? Let's go! 🚀

Run: npm run login
Then: node src\\sync-news-aspx-page\\run_all_tests.js

═══════════════════════════════════════════════════════════════════════════════
`);
