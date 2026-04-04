const path = require('path');
const fs = require('fs');

// Tự động nhận diện môi trường SEA (EXE) hay Dev
const isSeaApp = process.execPath.toLowerCase().endsWith('.exe');

console.log('--- MOI TRUONG HE THONG ---');
console.log(`- Executable: ${process.execPath}`);
console.log(`- CWD: ${process.cwd()}`);
console.log(`- Mode: ${isSeaApp ? 'EXE (Production)' : 'NodeJS (Development)'}`);

let chromium;
if (isSeaApp) {
    try {
        const { createRequire } = require('module');
        const seaRootDir = path.dirname(process.execPath);
        const nodeModulesPath = path.join(seaRootDir, 'node_modules');
        
        console.log(`- Sea Root: ${seaRootDir}`);
        if (!fs.existsSync(nodeModulesPath)) {
            console.error('❌ KHONG TIM THAY node_modules ben canh file EXE!');
            console.log('  (Vui long dam bao co thu muc node_modules trong thu muc cai dat)');
        }

        const myRequire = createRequire(path.join(seaRootDir, 'index.js'));
        chromium = myRequire('playwright').chromium;
        console.log('✅ Da nap Playwright tu thu muc ngoai.');
    } catch (e) {
        console.error('❌ SEA Loader Error:', e.message);
    }
} else {
    // Chế độ DEV (npm start)
    try {
        chromium = require('playwright').chromium;
        console.log('✅ Da nap Playwright (Standard Require).');
    } catch (e) {
        console.error('❌ Dev Loader Error: Khong tim thay playwright trong node_modules goc!');
        console.log('  (Loi: ' + e.message + ')');
    }
}
console.log('---------------------------');
require('dotenv').config();

async function login() {
  const baseUrl = process.env.BASE_URL || 'https://eoffice.saigonnewport.com.vn';
  const startUrl = `${baseUrl}/tintuc/Pages/default.aspx`;
  const username = process.env.USERNAME;
  const password = process.env.PASSWORD;
  const storageStatePath = process.env.STORAGE_STATE_PATH || 'auth/storageState.json';
  const headed = process.env.HEADED === 'true';

  // Tự động tìm kiếm trình duyệt có sẵn trên Windows
  const possiblePaths = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
  ].filter(Boolean);

  let executablePath = null;
  for (const p of possiblePaths) {
    const cleanPath = p.replace(/"/g, '');
    if (fs.existsSync(cleanPath)) {
      executablePath = cleanPath;
      break;
    }
  }

  console.log('--- SNP EOffice Login Tool (Playwright) ---');
  console.log(`Starting URL: ${startUrl}`);
  
  if (executablePath) {
    console.log(`Using Browser at: ${executablePath}`);
  } else {
    console.error('❌ KHÔNG TÌM THẤY TRÌNH DUYỆT (CHROME/EDGE) TRÊN HỆ THỐNG!');
    return;
  }

  let browser;
  try {
    const launchOptions = {
      headless: !headed,
      executablePath: executablePath,
      args: ['--ignore-certificate-errors', '--no-sandbox', '--disable-setuid-sandbox']
    };

    browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true
    });

    const page = await context.newPage();

    console.log(`Navigating to ${startUrl}...`);
    // Chờ trang chủ tải xong hoàn toàn và mạng ổn định
    await page.goto(startUrl, { waitUntil: 'networkidle', timeout: 90000 });

    // Bước 1: Click "Đăng nhập" link
    console.log('Step 1: Finding "Đăng nhập" link...');
    const loginLink = page.locator('a.aLogin, a:has-text("Đăng nhập")').first();
    
    try {
      // Đợi nút xuất hiện và click ngay khi sẵn sàng
      await loginLink.waitFor({ state: 'visible', timeout: 20000 });
      console.log('Clicking "Đăng nhập" link...');
      await loginLink.click();
      
      // Chờ chuyển hướng sang trang login
      await page.waitForLoadState('networkidle');
    } catch (e) {
      console.log('Login link not found or already on login page. Checking current URL...');
    }

    // Bước 2: Điền thông tin đăng nhập
    console.log('Step 2: Waiting for login form inputs...');
    const userSelector = 'input[name*="UserName"], input[id*="UserName"]';
    const passSelector = 'input[name*="password"], input[id*="password"]';
    const loginBtnSelector = 'input[type="submit"], input[name*="login"], input[id*="login"]';

    // Đợi ô nhập liệu xuất hiện
    await page.waitForSelector(userSelector, { state: 'visible', timeout: 45000 });
    
    console.log(`Filling username...`);
    await page.fill(userSelector, username);
    
    await page.waitForSelector(passSelector, { state: 'visible' });
    console.log('Filling password...');
    await page.fill(passSelector, password);

    // Bước 3: Submit form
    console.log('Step 3: Submitting login form...');
    await page.click(loginBtnSelector);

    // Bước 4: Chờ xác thực thành công (Quay lại trang chủ hoặc tìm dấu hiệu đã đăng nhập)
    console.log('Step 4: Waiting for authentication to complete...');
    // Chờ cho đến khi mạng hết bận (load xong trang sau login)
    await page.waitForLoadState('networkidle', { timeout: 90000 });
    
    // Đợi một trong các dấu hiệu thành công xuất hiện
    await Promise.race([
      page.waitForSelector('#welcomeMenuBox', { timeout: 30000 }),
      page.waitForSelector('.aLogout', { timeout: 30000 }),
      page.waitForURL('**/Pages/default.aspx', { timeout: 30000 })
    ]).catch(() => console.log('Wait for success indicators timed out, checking manual status...'));

    const authDir = path.dirname(path.resolve(storageStatePath));
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    await context.storageState({ path: storageStatePath });
    console.log(`✓ Auth state saved successfully to: ${storageStatePath}`);

  } catch (error) {
    console.error('✘ ERROR:', error.message);
    if (browser && headed) {
      await page.screenshot({ path: 'auth/login_error_capture.png' });
      console.log('Error screenshot saved to auth/login_error_capture.png');
    }
  } finally {
    if (browser) {
      console.log('Closing browser...');
      await browser.close();
    }
  }
}

module.exports = login;
