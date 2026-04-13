const path = require('path');
const fs = require('fs');

// Tự động nhận diện môi trường SEA (EXE) hay Dev
// Sửa lỗi: node.exe cũng kết thúc bằng .exe nên cần check tên file
const isSeaApp = path.basename(process.execPath).toLowerCase() !== 'node.exe' && process.execPath.toLowerCase().endsWith('.exe');

console.log('--- MOI TRUONG HE THONG ---');
console.log(`- Executable: ${process.execPath}`);
console.log(`- CWD: ${process.cwd()}`);
console.log(`- Mode: ${isSeaApp ? 'EXE (Production)' : 'NodeJS (Development)'}`);

/**
 * Ham nap Playwright mot cach an toan, ho tro ca EXE va Dev
 */
function getPlaywright() {
  if (chromium) return chromium;

  const isSeaApp = process.execPath.toLowerCase().endsWith('.exe');
  if (isSeaApp) {
    try {
      const { createRequire } = require('module');
      const seaRootDir = path.dirname(process.execPath);
      const myRequire = createRequire(path.join(seaRootDir, 'index.js'));
      chromium = myRequire('playwright').chromium;
    } catch (e) {
      console.error('❌ SEA Playwright Load Error:', e.message);
    }
  } else {
    try {
      chromium = require('playwright').chromium;
    } catch (e) {
      console.error('❌ Dev Playwright Load Error:', e.message);
    }
  }
  return chromium;
}

async function login(options = {}) {
  // Nap thu vien truoc khi dung
  const chrom = getPlaywright();
  if (!chrom) {
    console.error('❌ KHONG THE NAP PLAYWRIGHT. Vui long kiem tra node_modules!');
    return;
  }
  const baseUrl = process.env.BASE_URL || 'https://eoffice.saigonnewport.com.vn';
  const startUrl = process.env.AUTH_URL || `${baseUrl}/tintuc/Pages/default.aspx`;
  const username = process.env.SHAREPOINT_USERNAME || process.env.USERNAME;
  const password = process.env.SHAREPOINT_PASSWORD || process.env.PASSWORD;
  const storageStatePath = process.env.STORAGE_STATE_PATH || 'auth/storageState.json';
  
  // Ưu tiên tham số truyền vào từ Controller (ví dụ từ nút bấm Dashboard)
  const headed = options.forceHeaded === true || process.env.HEADED === 'true';

  // Tự động tìm kiếm trình duyệt có sẵn trên Windows - Ưu tiên Chrome hàng đầu
  const possiblePaths = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
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

    // Tích vào ô "Đăng nhập tự động" (Remember Me) nếu có
    const rememberMeSelector = 'input[id*="RememberMe"]';
    if (await page.isVisible(rememberMeSelector)) {
      console.log('Checking "Remember Me" checkbox...');
      await page.check(rememberMeSelector);
    }

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

    // Trích xuất cookie để lưu vào file cookie.txt (phục vụ SharePointAuthService)
    const state = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
    const cookieString = state.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const cookiePath = path.join(authDir, 'cookie.txt');
    fs.writeFileSync(cookiePath, cookieString);
    console.log(`✓ Cookie string saved to: ${cookiePath}`);

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
