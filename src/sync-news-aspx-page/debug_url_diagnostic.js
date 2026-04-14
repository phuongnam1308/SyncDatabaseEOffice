/**
 * DIAGNOSTIC SCRIPT: Debug specific news ASPX page download (V2)
 * Purpose: Provide exhaustive logging and CALL LOGIN DIRECTLY for more reliability.
 * How to run: node src/sync-news-aspx-page/debug_url_diagnostic.js
 */

const path = require('path');
const fs = require('fs');

// Load environment variables
const envPath = path.resolve(__dirname, '../../.env');
require('dotenv').config({ path: envPath });

const axios = require('axios');
const https = require('https');
const login = require('../../auth/login_playwright');
const { downloadFile } = require('../sync-file-copy/SharePointAuthService');
const HtmlFileMigrationModel = require('./migrate/HtmlFileMigrationModel');
const logger = require('../../utils/logger');

const TARGET_URL = 'https://eoffice.saigonnewport.com.vn/tintuc/Pages/tan-cang-2.aspx';

/**
 * Phân tích mã lỗi và đưa ra giải pháp cụ thể
 */
function diagnoseError(err, url) {
  console.log('\n🔍 BÁO CÁO PHÂN TÍCH LỖI:');
  
  if (err.message && err.message.includes('404')) {
    console.log('❌ LỖI 404: KHÔNG TÌM THẤY TRANG');
    console.log('👉 Giải pháp:');
    console.log('   1. Kiểm tra lại tên file (Casing): SharePoint phân biệt hoa thường. Thử Tan-Cang-2.aspx?');
    console.log('   2. Kiểm tra xem file có bị xóa hoặc di chuyển trong SharePoint không.');
    console.log('   3. Kiểm tra xem URL có chứa ký tự đặc biệt cần encode không.');
    console.log('   4. Có thể file nằm trong một Library khác không phải /Pages/.');
  } else if (err.message && (err.message.includes('401') || err.message.includes('403'))) {
    console.log('❌ LỖI 401/403: KHÔNG CÓ QUYỀN TRUY CẬP');
    console.log('👉 Giải pháp:');
    console.log('   1. Tài khoản "migservice" có thể không có quyền đọc bài viết này.');
    console.log('   2. Cookie vừa tạo có thể chưa được SharePoint chấp nhận ngay (Thử đợi 1-2 giây).');
  } else if (err.message && err.message.includes('timeout')) {
    console.log('❌ LỖI TIMEOUT: TRÌNH DUYỆT HOẶC MẠNG CHẬM');
    console.log('👉 Giải pháp: Tăng LOCK_TIMEOUT_MS trong .env hoặc kiểm tra đường truyền mạng.');
  } else {
    console.log('❌ LỖI CHƯA XÁC ĐỊNH:', err.message);
    console.log('👉 Giải pháp: Kiểm tra log chi tiết bên trên và liên hệ quản trị hệ thống.');
  }
}

/**
 * Kiểm tra cấu hình MinIO (như yêu cầu của user)
 */
function verifyMinioConfig() {
  console.log('\n🔹 KIỂM TRA CẤU HÌNH MINIO:');
  const rawUrl = process.env.MINIO_URL || process.env.MINO_URL;
  if (!rawUrl) {
    console.log('⚠️ MINIO_URL không tồn tại trong .env');
    return;
  }
  try {
    const u = new URL(rawUrl);
    console.log('✅ URL MinIO hợp lệ:', rawUrl);
    console.log('   - Host:', u.hostname);
    console.log('   - Port:', u.port || (u.protocol === 'https:' ? 443 : 80));
    console.log('   - SSL:', u.protocol === 'https:');
  } catch (e) {
    console.log('❌ URL MinIO không hợp lệ:', rawUrl);
  }
}

async function runDiagnostic() {
  console.log('='.repeat(80));
  console.log('🚀 NEWS PAGE DIAGNOSTIC TOOL V2 - Starting');
  console.log('Target URL:', TARGET_URL);
  console.log('Time:', new Date().toLocaleString());
  console.log('='.repeat(80));

  // 0. Verify MinIO (user context)
  verifyMinioConfig();

  try {
    // 1. Perform fresh login DIRECTLY
    console.log('\nStep 1: Performing FRESH LOGIN via Playwright...');
    try {
      // Force headed if needed for debugging or keep headless for automation
      const headed = process.env.HEADED === 'true';
      console.log(`Starting login (Headed=${headed})...`);
      
      await login({ forceHeaded: headed });
      
      console.log('✅ Login function finished.');

      // --- INCREASED DELAY FOR SYSTEM LAG (V5) ---
      const DELAY_MS = 300000; // 5 minutes as requested by user
      console.log(`\n⏳ WAITING ${DELAY_MS / 1000} SECONDS (5 minutes) for system to stabilize...`);
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      console.log('✅ Stabilization delay finished. Proceeding sequentially...');
      // ----------------------------------
      
      // Check if cookie file was updated
      const cookiePath = path.resolve(process.cwd(), 'auth/cookie.txt');
      if (fs.existsSync(cookiePath)) {
        const stats = fs.statSync(cookiePath);
        const cookie = fs.readFileSync(cookiePath, 'utf8').trim();
        console.log(`🔹 Cookie file updated at: ${stats.mtime.toLocaleString()}`);
        console.log(`🔹 Cookie length: ${cookie.length}`);
      } else {
        throw new Error('Login finished but auth/cookie.txt NOT FOUND!');
      }
    } catch (err) {
      console.error('❌ LOGIN FAILED:', err.message);
      console.log('Will attempt download anyway, but it might fail...');
    }

    // 2. Attempt download with detailed logging (and VISUAL browser if requested)
    console.log('\nStep 2: Performing VISUAL Download via Playwright (Headed Chrome)...');
    console.log('User objective: "Watch" the browser as it loads the slow ASPX page.');

    const URL_VARIATIONS = [
      TARGET_URL,
      TARGET_URL.replace('tan-cang-2', 'Tan-Cang-2'),
      TARGET_URL.replace('tan-cang-2', 'TANCANG-2'),
      TARGET_URL.replace('Pages', 'lists/Pages')
    ];

    let successBuffer = null;
    let finalUrl = TARGET_URL;

    // Use Playwright for Visual verification as requested by user
    const chrom = require('../../auth/login_playwright').getPlaywright ? require('../../auth/login_playwright').getPlaywright() : null;
    if (chrom) {
      console.log('🚀 Starting Chrome to download visually...');
      const browser = await chrom.launch({ 
        headless: false, // Force headed for the user to see
        args: ['--ignore-certificate-errors', '--no-sandbox'] 
      });
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      
      // Load cookies if exist
      const cookiePath = path.resolve(process.cwd(), 'auth/storageState.json');
      if (fs.existsSync(cookiePath)) {
        await context.addCookies(JSON.parse(fs.readFileSync(cookiePath, 'utf8')).cookies);
        console.log('🔹 Loaded cookies into browser context.');
      }

      const page = await context.newPage();
      page.setDefaultTimeout(600000); // 10 minutes

      for (const url of URL_VARIATIONS) {
        console.log(`\n--- Phử tải URL (Visual): ${url} ---`);
        const startTime = Date.now();
        try {
          await page.goto(url, { waitUntil: 'load', timeout: 600000 });
          console.log(`✅ Page navigated in ${Date.now() - startTime}ms.`);
          
          // Wait for content (SharePoint can be slow to render)
          console.log('⏳ Waiting for body to be visible...');
          await page.waitForSelector('body', { timeout: 600000 });
          
          const content = await page.content();
          const isLoginRedirect = content.includes('signincontrol_username') || content.includes('login.aspx');
          
          if (isLoginRedirect) {
            console.warn('❌ URL redirect to Login page. Auth failed for this variation.');
          } else if (content.length < 500) {
            console.warn('❌ Content too small, might be a 404 or error page.');
          } else {
            successBuffer = Buffer.from(content, 'utf8');
            finalUrl = url;
            console.log(`✅ VISUAL SUCCESS: Found content on ${url}`);
            
            // Take screenshot
            const screenshotPath = path.join(process.cwd(), 'auth', `visual_debug_${Date.now()}.png`);
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`📸 Screenshot saved: ${screenshotPath}`);
            break;
          }
        } catch (err) {
          console.error(`❌ Visual load FAILED for ${url}: ${err.message}`);
        }
        console.log('⏳ Nghỉ 5 giây trước khi thử variation tiếp theo...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      await browser.close();
    } else {
      console.log('⚠️ Không thể khởi động Playwright, dùng axios fallback...');
      // ... axios fallback already existed below ...
    }

    if (!successBuffer) {
      console.error('\n❌ TẤT CẢ CÁC VARIATION ĐỀU THẤT BẠI.');
      diagnoseError(new Error('404'), TARGET_URL);
      return;
    }

    const buffer = successBuffer;

    // 3. Inspect Content
    const content = buffer.toString('utf8');
    const isLoginRedirect = content.includes('signincontrol_username') || content.includes('login.aspx');
    console.log('\nStep 3: Content Inspection');
    if (isLoginRedirect) {
      console.log('⚠️ CẢNH BÁO: Nội dung tải về là TRANG ĐĂNG NHẬP (Redirect).');
      console.log('👉 Ý nghĩa: SharePoint từ chối Cookie và chuyển hướng bạn về trang login.');
    } else {
      console.log('✅ Nội dung có vẻ là dữ liệu thật (Không thấy chuyển hướng login).');
    }
    
    // Save for manual inspection
    const debugFile = path.join(process.cwd(), 'tintucraw', 'debug_tan_cang_2.aspx.html');
    const dir = path.dirname(debugFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(debugFile, buffer);
    console.log(`🔹 Lưu file nội dung thô để kiểm tra: ${debugFile}`);

    // 4. Attempt Parsing
    console.log('\n⏳ Waiting 5 seconds before extraction...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('\nStep 4: Virtual Parsing Test...');
    const parser = new HtmlFileMigrationModel();
    try {
      // parseHtmlFile expects a path, so we use the debugFile we just saved
      const result = await parser.parseHtmlFile(debugFile);
      console.log('✅ Phân tích HTML hoàn tất.');
      console.log('Dữ liệu bóc tách được:');
      console.log(JSON.stringify({
        title: result.title || '(Empty)',
        created: result.publishedAt || '(Empty)',
        author: result.authorName || '(Empty)',
        contentPreview: result.content ? result.content.substring(0, 100) + '...' : '(Empty)',
        imageCount: result.images?.length || 0
      }, null, 2));

      if (!result.title && !result.content) {
        console.log('\n⚠️ GIẢI PHÁP CHO LỖI TRỐNG DỮ LIỆU:');
        console.log('   - Cấu trúc trang ASPX này khác hoàn toàn với các trang cũ.');
        console.log('   - Cần cập nhật Selector trong HtmlFileMigrationModel.js để hỗ trợ format này.');
      }
    } catch (err) {
      console.error('❌ Parsing failed:', err.message);
      console.error(err.stack);
    }

  } catch (err) {
    console.error('💥 LỖI HỆ THỐNG TRONG KHI CHẠY DIAGNOSTIC:', err);
  } finally {
    console.log('\n' + '='.repeat(80));
    console.log('🏁 DIAGNOSTIC FINISHED');
    console.log('='.repeat(80));
    process.exit(0);
  }
}

runDiagnostic();
