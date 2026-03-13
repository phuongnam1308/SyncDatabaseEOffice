
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

// --- !!! IMPORTANT: Please update these selectors to match your login page ---
// You can find these by right-clicking the input field on the login page and selecting "Inspect".
// Then, right-click the highlighted HTML element, and choose "Copy > Copy selector".
const USERNAME_SELECTOR = 'input[type="email"]'; // Example: 'input#username' or 'input[name="loginfmt"]'
const PASSWORD_SELECTOR = 'input[type="password"]'; // Example: 'input#password' or 'input[name="passwd"]'
const LOGIN_BUTTON_SELECTOR = 'button[type="submit"]'; // Example: 'button#login-button' or 'input[type="submit"]'
// ---

async function login() {
  // --- Basic validation ---
  if (!BASE_URL || !USERNAME || !PASSWORD) {
    console.error('Error: BASE_URL, USERNAME, and PASSWORD must be set in your .env file.');
    process.exit(1);
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

    // Wait for the username field to be visible
    console.log(`Waiting for username field: ${USERNAME_SELECTOR}`);
    await page.waitForSelector(USERNAME_SELECTOR, { timeout: 30000 });

    // Fill in credentials
    console.log(`Entering username...`);
    await page.fill(USERNAME_SELECTOR, USERNAME);

    // Some login forms have an intermediate step after entering the username
    // Click the login button if it's a separate step, or just proceed
    if (await page.isVisible(LOGIN_BUTTON_SELECTOR)) {
        await page.click(LOGIN_BUTTON_SELECTOR);
    }
    
    console.log(`Waiting for password field: ${PASSWORD_SELECTOR}`);
    await page.waitForSelector(PASSWORD_SELECTOR, { timeout: 30000 });

    console.log('Entering password...');
    await page.fill(PASSWORD_SELECTOR, PASSWORD);

    // Click the final login button
    console.log('Clicking login button...');
    await page.click(LOGIN_BUTTON_SELECTOR);

    // Wait for navigation to complete after login.
    // Replace with a more specific condition if possible, e.g., waiting for a specific element on the dashboard.
    console.log('Waiting for login to complete...');
    await page.waitForNavigation({ timeout: parseInt(LOGIN_TIMEOUT_MS, 10) });

    console.log('Login successful!');
    console.log(`Current URL: ${page.url()}`);

    // Save storage state
    await context.storageState({ path: STORAGE_STATE_PATH });
    console.log(`Authentication state saved to ${STORAGE_STATE_PATH}`);

  } catch (error) {
    console.error(`
--- Login failed! ---`);
    console.error(`Error: ${error.message}`);
    console.error(`
Troubleshooting steps:`);
    console.error(`1. Verify your BASE_URL, USERNAME, and PASSWORD in the .env file.`);
    console.error(`2. Double-check the CSS selectors (USERNAME_SELECTOR, etc.) in this script.`);
    console.error(`3. If on a restricted network, ensure CHROME_PATH in .env points to a valid Chrome/Edge installation.`);
    
    // Create a 'logs' directory if it doesn't exist
    const logsDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir);
    }
    // Save a screenshot for debugging
    const screenshotPath = path.join(logsDir, 'login_error.png');
    await page.screenshot({ path: screenshotPath });
    console.error(`A screenshot has been saved to ${screenshotPath} for debugging.
`);
    
    process.exit(1);
  } finally {
    await browser.close();
  }
}

login();
