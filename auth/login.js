const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env file
require('dotenv').config();

// --- Configuration ---
const {
  BASE_URL,
  USERNAME,
  PASSWORD,
  STORAGE_STATE_PATH = 'auth/storageState.json',
  HEADED = 'true',
  LOGIN_TIMEOUT_MS = '180000',
  CHROME_PATH,
  BROWSER_PATH,
} = process.env;

// --- Selector l?y tr?c ti?p t? HTML trang login SharePoint ---
const USERNAME_SELECTOR = '#ctl00_PlaceHolderMain_signInControl_UserName';
const PASSWORD_SELECTOR = '#ctl00_PlaceHolderMain_signInControl_password';
const LOGIN_BUTTON_SELECTOR = '#ctl00_PlaceHolderMain_signInControl_login';
// ---

async function login() {
  // --- Basic validation ---
  if (!BASE_URL || !USERNAME || !PASSWORD) {
    console.error('Error: BASE_URL, USERNAME, and PASSWORD must be set in your .env file.');
    return;
  }

  // Determine browser executable path
  const executablePath = CHROME_PATH || BROWSER_PATH;
  const launchOptions = {
    headless: HEADED.toLowerCase() !== 'true',
    ...(executablePath && { executablePath }),
  };

  if (executablePath) {
    console.log(`Attempting to launch browser from: ${executablePath}`);
  } else {
    console.log('Launching playwright-managed browser. If this fails on a restricted network, set CHROME_PATH in your .env file.');
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log(`Navigating to ${BASE_URL}...`);

  try {
    await page.goto(BASE_URL);

    // Ch? field username xu?t hi?n
    console.log(`Waiting for username field: ${USERNAME_SELECTOR}`);
    await page.waitForSelector(USERNAME_SELECTOR, { timeout: 30000 });

    // Ði?n username
    console.log(`Entering username...`);
    await page.fill(USERNAME_SELECTOR, USERNAME);

    // Ði?n password
    console.log(`Entering password...`);
    await page.fill(PASSWORD_SELECTOR, PASSWORD);

    // B?m nút dang nh?p
    console.log('Clicking login button...');
    await page.click(LOGIN_BUTTON_SELECTOR);

    // Ch? di?u hu?ng sau khi dang nh?p
    console.log('Waiting for login to complete...');
    await page.waitForNavigation({ timeout: parseInt(LOGIN_TIMEOUT_MS, 10) });

    console.log('Login successful!');
    console.log(`Current URL: ${page.url()}`);

    // --- T? d?ng t?o thu m?c auth/ n?u chua có ---
    const storageStateAbsPath = path.isAbsolute(STORAGE_STATE_PATH)
      ? STORAGE_STATE_PATH
      : path.join(process.cwd(), STORAGE_STATE_PATH);
    const storageStateDir = path.dirname(storageStateAbsPath);
    if (!fs.existsSync(storageStateDir)) {
      fs.mkdirSync(storageStateDir, { recursive: true });
      console.log(`Created directory: ${storageStateDir}`);
    }

    // Luu storage state
    await context.storageState({ path: STORAGE_STATE_PATH });
    console.log(`Authentication state saved to ${STORAGE_STATE_PATH}`);

    // --- Luu cookie ra file auth/cookie.txt d? SharePointAuthService dùng ---
    const cookies = await context.cookies();
    const cookieString = cookies
      .map(c => `${c.name}=${c.value}`)
      .join('; ');

    const cookieTxtPath = process.env.COOKIE_FILE_PATH || 'auth/cookie.txt';
    const absCookieTxtPath = path.isAbsolute(cookieTxtPath)
      ? cookieTxtPath
      : path.join(process.cwd(), cookieTxtPath);

    // --- T? d?ng t?o thu m?c auth/ n?u chua có tru?c khi ghi cookie.txt ---
    const cookieDir = path.dirname(absCookieTxtPath);
    if (!fs.existsSync(cookieDir)) {
      fs.mkdirSync(cookieDir, { recursive: true });
      console.log(`Created directory: ${cookieDir}`);
    }

    fs.writeFileSync(absCookieTxtPath, cookieString);
    console.log(`Cookie string saved to ${absCookieTxtPath}`);

  } catch (error) {
    console.error(`\n--- Login failed! ---`);
    console.error(`Error: ${error.message}`);
    console.error(`\nTroubleshooting steps:`);
    console.error(`1. Kiem tra BASE_URL, USERNAME, PASSWORD trong .env`);
    console.error(`2. Kiem tra CHROME_PATH trong .env co dung khong`);

    // T?o thu m?c logs/ n?u chua có
    const logsDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    // Ch?p màn hình d? debug
    const screenshotPath = path.join(logsDir, 'login_error.png');
    await page.screenshot({ path: screenshotPath });
    console.error(`Screenshot saved to ${screenshotPath} for debugging.\n`);

  } finally {
    await browser.close();
  }
}

login();