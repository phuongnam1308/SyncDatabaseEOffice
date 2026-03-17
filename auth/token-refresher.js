require('dotenv').config();
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

const TOKEN_FILE_PATH = path.join(__dirname, 'minio_token.txt');
const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

let minioTokenCache = null;

async function getMinioToken(username, password) {
  const now = Date.now();

  // Use a cache to avoid re-logging in if the token is still fresh within the interval
  if (
    minioTokenCache &&
    minioTokenCache.key === `${username}:${password}` &&
    now < minioTokenCache.expiresAt
  ) {
    const remainSec = Math.round((minioTokenCache.expiresAt - now) / 1000);
    logger.info(`[TokenRefresher] Using cached MinIO token, valid for ${remainSec}s.`);
    return minioTokenCache.token;
  }

  const minioUrl = (process.env.MINIO_URL || '').replace(/\/$/, '');
  if (!minioUrl) {
    logger.error('[TokenRefresher] MINIO_URL is not set in .env file.');
    throw new Error('MINIO_URL is not set.');
  }

  const loginUrl = `${minioUrl}/api/v1/login`;
  // Set a cache TTL slightly less than the refresh interval to ensure re-login
  const ttlMs = 14 * 60 * 1000; // 14 minutes

  logger.info(`[TokenRefresher] Getting new MinIO token from: ${loginUrl}`);

  try {
    const response = await axios.post(
      loginUrl,
      { username, password },
      { headers: { 'Content-Type': 'application/json' } }
    );

    const token = response.data?.token;
    if (!token) {
      throw new Error('Login response did not contain a token.');
    }

    minioTokenCache = {
      key: `${username}:${password}`,
      token,
      expiresAt: now + ttlMs,
    };

    logger.info(`[TokenRefresher] Successfully got new MinIO token.`);
    return token;

  } catch (error) {
    minioTokenCache = null;
    if (error.response) {
      logger.error(`[TokenRefresher] MinIO login failed - HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`);
    } else {
      logger.error(`[TokenRefresher] MinIO login failed: ${error.message}`);
    }
    throw error;
  }
}

async function fetchAndSaveToken() {
  const minioUser = process.env.MINIO_USER;
  const minioPass = process.env.MINIO_PASSWORD;

  if (!minioUser || !minioPass) {
    logger.error('[TokenRefresher] MINIO_USER and MINIO_PASSWORD must be set in your .env file.');
    return;
  }

  try {
    logger.info('[TokenRefresher] Attempting to fetch and save MinIO token...');
    const token = await getMinioToken(minioUser, minioPass);
    await fs.writeFile(TOKEN_FILE_PATH, token);
    logger.info(`[TokenRefresher] MinIO token saved successfully to ${TOKEN_FILE_PATH}`);
  } catch (error) {
    logger.error('[TokenRefresher] Could not fetch and save MinIO token.');
    // The error is already logged in getMinioToken. We don't rethrow, so the process continues.
  }
}

function startTokenRefresher() {
  logger.info('[TokenRefresher] Starting MinIO token refresher service.');
  logger.info(`[TokenRefresher] Token will be refreshed every ${REFRESH_INTERVAL_MS / 60000} minutes.`);

  // 1. Run once immediately at the start.
  fetchAndSaveToken();

  // 2. Then, run on the specified interval.
  setInterval(fetchAndSaveToken, REFRESH_INTERVAL_MS);
}

startTokenRefresher();
