const path = require('path');
const fs = require('fs');

// T? d?ng nh?n di?n môi tru?ng SEA (EXE) hay Dev
const isSeaApp = path.basename(process.execPath).toLowerCase() !== 'node.exe' && process.execPath.toLowerCase().endsWith('.exe');

let chromium = null;

function getPlaywright() {
  if (chromium) return chromium;

  const execPath = process.execPath.toLowerCase();
  const isNode = execPath.endsWith('node.exe') || execPath.endsWith('node');
  const isExe = execPath.endsWith('.exe');

  if (!isNode && isExe) {
    try {
      const { createRequire } = require('module');
      const seaRootDir = path.dirname(process.execPath);
      const myRequire = createRequire(path.join(seaRootDir, 'index.js'));
      chromium = myRequire('playwright').chromium;
    } catch (e) {}
  }

  if (!chromium) {
    try {
      chromium = require('playwright').chromium;
    } catch (e) {
      console.error('? Playwright Load Error:', e.message);
    }
  }

  return chromium;
}

async function loginKeycloak(options = {}) {
  const chrom = getPlaywright();
  if (!chrom) {
    throw new Error('KHONG THE NAP PLAYWRIGHT. Vui long kiem tra node_modules!');
  }

  const clientId = process.env.KEYCLOAK_CLIENT_ID || 'doffice';
  const username = process.env.KEYCLOAK_USERNAME || 'admin-tancang';
  const password = process.env.KEYCLOAK_PASSWORD || '@SnpAdmin2026';
  const redirectUri = encodeURIComponent('https://apigw-uat.snp.com.vn/doffice-be/api/auth-keycloak/callback');

  const startUrl = `https://iam-uat.snp.com.vn/realms/snp-internal/protocol/openid-connect/auth?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=openid`;

  const storageStatePath = path.join(__dirname, '..', 'uploads', '.keycloak_jwt_cache');
  const headed = options.forceHeaded === true || process.env.HEADED === 'true';

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

  console.log('--- Keycloak Login Tool (Playwright) ---');
  console.log(`Starting URL: ${startUrl}`);

  if (!executablePath) {
    throw new Error('KHONG TIM THAY TRINH DUYET (CHROME/EDGE) TREN HE THONG!');
  }

  let browser;
  let page;
  try {
    const launchOptions = {
      headless: true, // Ép ch?y ng?m hoàn toàn
      executablePath: executablePath,
      args: [
        '--headless=new', // Thêm c? headless c?a Chrome d? ?n hoàn toàn giao di?n
        '--ignore-certificate-errors', 
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--window-size=1280,720'
      ]
    };

    browser = await chrom.launch(launchOptions);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true
    });

    page = await context.newPage();

    console.log(`Navigating to Keycloak Auth...`);
    await page.goto(startUrl, { waitUntil: 'networkidle', timeout: 60000 });

    // Ði?n form dang nh?p Keycloak
    console.log('Step 1: Filling login form...');

    // Các selector ph? bi?n c?a Keycloak
    const userSelector = '#username';
    const passSelector = '#password';
    const loginBtnSelector = '#kc-login';

    await page.waitForSelector(userSelector, { state: 'visible', timeout: 30000 });
    await page.fill(userSelector, username);

    await page.waitForSelector(passSelector, { state: 'visible' });
    await page.fill(passSelector, password);

    console.log('Step 2: Submitting login form...');
    await page.click(loginBtnSelector);

    // Ch? redirect v? Backend r?i redirect ti?p v? Frontend
    console.log('Step 3: Waiting for redirect to extract token...');

    let tokenUrl = null;
    try {
        // Ð?i URL có ch?a "token="
        await page.waitForURL('**/*token=*', { timeout: 60000 });
        tokenUrl = page.url();
        console.log(`Redirected to: ${tokenUrl.split('?')[0]}...`);
    } catch (e) {
        // N?u không có token= thì th? b?t body ho?c cookie
        console.log('Timeout waiting for URL with token=. Checking current URL...');
        tokenUrl = page.url();
    }

    // Trích xu?t token t? URL
    const urlObj = new URL(tokenUrl);
    let token = urlObj.searchParams.get('token');

    if (!token) {
        // Có th? nó n?m trong hash (fragment)
        const hashParams = new URLSearchParams(urlObj.hash.substring(1));
        token = hashParams.get('token');
    }

    if (!token) {
        throw new Error(`Khong tim thay token trong URL tra ve: ${tokenUrl}`);
    }

    // Luu cache token
    const authDir = path.dirname(path.resolve(storageStatePath));
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    // Decode token de lay thoi gian het han
    let expiresAt = Date.now() + 3600 * 1000; // default 1 hour
    try {
        const payloadBase64 = token.split('.')[1];
        const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
        if (payload.exp) {
            expiresAt = payload.exp * 1000 - 60000;
        }
    } catch (e) {
        console.log('Warning: Khong the decode JWT, su dung thoi gian het han mac dinh.');
    }

    fs.writeFileSync(storageStatePath, JSON.stringify({ token, expiresAt }), 'utf8');
    console.log(`? Token extracted and saved successfully. Expires at: ${new Date(expiresAt).toISOString()}`);

    return token;

  } catch (error) {
    console.error('? ERROR:', error.message);
    if (page && headed) {
      await page.screenshot({ path: path.join(__dirname, 'keycloak_error.png') });
      console.log('Error screenshot saved to keycloak_error.png');
    }
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = loginKeycloak;

if (require.main === module) {
  loginKeycloak().catch(err => {
    console.error('? CRITICAL KEYCLOAK LOGIN ERROR:', err);
    process.exit(1);
  });
}
