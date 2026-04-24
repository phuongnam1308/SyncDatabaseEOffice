const path = require('path');
const fs = require('fs');

// Tự động nhận diện môi trường SEA (EXE) hay Dev
// Sửa lỗi: node.exe cũng kết thúc bằng .exe nên cần check tên file
const isSeaApp = path.basename(process.execPath).toLowerCase() !== 'node.exe' && process.execPath.toLowerCase().endsWith('.exe');

console.log('--- MOI TRUONG HE THONG ---');
console.log(`- Executable: ${process.execPath}`);
console.log(`- CWD: ${process.cwd()}`);
console.log(`- Mode: ${isSeaApp ? 'EXE (Production)' : 'NodeJS (Development)'}`);

let chromium = null;

/**
 * Ham nap Playwright mot cach an toan, ho tro ca EXE va Dev
 */
function getPlaywright() {
  if (chromium) return chromium;

  const execPath = process.execPath.toLowerCase();
  const isNode = execPath.endsWith('node.exe') || execPath.endsWith('node');
  const isExe = execPath.endsWith('.exe');

  // 1. Thu nap theo kieu SEA (neu la file EXE thuc thu)
  if (!isNode && isExe) {
    try {
      const { createRequire } = require('module');
      const seaRootDir = path.dirname(process.execPath);
      const myRequire = createRequire(path.join(seaRootDir, 'index.js'));
      chromium = myRequire('playwright').chromium;
      if (chromium) console.log('✅ Loaded Playwright via SEA require');
    } catch (e) {
      // Khong can bao loi o day vi se fallback xuong duoi
    }
  }

  // 2. Fallback nap theo kieu Development (NodeJS) neu SEA fail hoac khong phai SEA
  if (!chromium) {
    try {
      chromium = require('playwright').chromium;
    } catch (e) {
      console.error('❌ Playwright Load Error (Dev):', e.message);
    }
  }

  return chromium;
}

async function login(options = {}) {
  // Nap thu vien truoc khi dung
  const chrom = getPlaywright();
  if (!chrom) {
    throw new Error('KHONG THE NAP PLAYWRIGHT. Vui long kiem tra node_modules!');
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
    throw new Error('KHONG TIM THAY TRINH DUYET (CHROME/EDGE) TREN HE THONG!');
  }

  let browser;
  let page;
  try {
    const launchOptions = {
      headless: !headed,
      executablePath: executablePath,
      args: ['--ignore-certificate-errors', '--no-sandbox', '--disable-setuid-sandbox']
    };

    browser = await chrom.launch(launchOptions);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true
    });

    const pageInternal = await context.newPage();
    page = pageInternal;

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
    // Tăng timeout lên 10 phút vì hệ thống cực chậm
    await page.click(loginBtnSelector, { timeout: 600000 });

    // Bước 4: Chờ xác thực thành công (Quay lại trang chủ hoặc tìm dấu hiệu đã đăng nhập)
    console.log('Step 4: Waiting for authentication to complete...');
    // Chờ cho đến khi mạng hết bận (load xong trang sau login)
    await page.waitForLoadState('networkidle', { timeout: 600000 });
    
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
    
    // Kiểm tra xem đã thực sự có Cookie xác thực chưa
    const state = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
    const hasAuthCookie = state.cookies.some(c => c.name === 'FedAuth' || c.name === 'rtFa' || c.name.includes('Wave'));
    
    if (!hasAuthCookie) {
      throw new Error('Đăng nhập hoàn tất nhưng không tìm thấy FedAuth/rtFa cookie. Có thể sai mật khẩu hoặc bị chặn.');
    }

    console.log(`✓ Auth state saved successfully to: ${storageStatePath}`);

    // Trích xuất cookie để lưu vào file cookie.txt (phục vụ SharePointAuthService)
    const cookieString = state.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const cookiePath = path.join(authDir, 'cookie.txt');
    fs.writeFileSync(cookiePath, cookieString);
    console.log(`✓ Cookie string saved to: ${cookiePath}`);
    return true;

  } catch (error) {
    console.error('✘ ERROR:', error.message);
    if (browser && headed) {
      await page.screenshot({ path: 'auth/login_error_capture.png' });
      console.log('Error screenshot saved to auth/login_error_capture.png');
    }
    throw error;
  } finally {
    if (browser) {
      console.log('Closing browser...');
      await browser.close();
    }
  }
}


module.exports = login;

// Nếu chạy trực tiếp file này (node login_playwright.js)
if (require.main === module) {
  login().catch(err => {
    console.error('❌ CRITICAL LOGIN ERROR:', err);
    process.exit(1);
  });
}
