require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');
const logger = require('../utils/logger');

const LOGIN_SCRIPT_PATH = path.join(__dirname, 'login.js');
const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

function runLoginScript() {
  return new Promise((resolve, reject) => {
    logger.info('[SessionRefresher] Starting login script execution...');
    
    const child = spawn('node', [LOGIN_SCRIPT_PATH], { stdio: 'pipe' });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      logger.info(`[LoginScript-STDOUT] ${output.trim()}`);
    });

    child.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      logger.error(`[LoginScript-STDERR] ${output.trim()}`);
    });

    child.on('close', (code) => {
      if (code === 0) {
        logger.info('[SessionRefresher] Login script finished successfully.');
        resolve(stdout);
      } else {
        logger.error(`[SessionRefresher] Login script exited with error code ${code}.`);
        reject(new Error(`Login script failed. Full stderr:
${stderr}`));
      }
    });

    child.on('error', (err) => {
      logger.error(`[SessionRefresher] Failed to start login script: ${err.message}`);
      reject(err);
    });
  });
}

async function refreshSession() {
  try {
    await runLoginScript();
    logger.info('[SessionRefresher] SharePoint session has been refreshed successfully.');
  } catch (error) {
    logger.error(`[SessionRefresher] An error occurred during session refresh: ${error.message}`);
    // We continue the loop even if one run fails.
  }
}

function startSessionRefresher() {
  logger.info('[SessionRefresher] Starting SharePoint session refresher service.');
  logger.info(`[SessionRefresher] Session will be refreshed every ${REFRESH_INTERVAL_MS / 60000} minutes.`);
  
  // 1. Run once immediately at the start.
  refreshSession();

  // 2. Then, run on the specified interval.
  setInterval(refreshSession, REFRESH_INTERVAL_MS);
}

startSessionRefresher();
