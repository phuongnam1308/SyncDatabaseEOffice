const axios = require('axios');
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');

// Output file for the token
const TOKEN_FILE_PATH = path.join(__dirname, 'new_system_token.txt');

/**
 * Performs login to the new system and retrieves the accessToken.
 * Based on the Lifetex/NewSortAccess API.
 */
async function getAccessToken() {
  const url = process.env.NEW_SYSTEM_LOGIN_URL;
  const username = process.env.NEW_SYSTEM_USERNAME;
  const password = process.env.NEW_SYSTEM_PASSWORD;

  if (!url || !username || !password) {
    console.error('ERROR: NEW_SYSTEM_LOGIN_URL, NEW_SYSTEM_USERNAME, or NEW_SYSTEM_PASSWORD not set in .env');
    return null;
  }

  console.log(`[NewSortAccess] Attempting login to: ${url}`);

  try {
    // Derive Origin and Referer from the URL if not provided in .env
    const urlObj = new URL(url);
    const origin = process.env.NEW_SYSTEM_ORIGIN || `${urlObj.protocol}//${urlObj.host}`;
    const referer = process.env.NEW_SYSTEM_REFERER || `${urlObj.protocol}//${urlObj.host}/`;

    const response = await axios.post(url, {
      username: username,
      password: password
    }, {
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'User-Agent': process.env.NEW_SYSTEM_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        'Origin': origin,
        'Referer': referer,
        'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'Priority': 'u=1, i'
      }
    });

    // Extracting token from response
    // The API uses access_token (underscore)
    const token = response.data?.access_token ||
                  response.data?.accessToken || 
                  response.data?.token || 
                  (response.data?.data && (response.data.data.access_token || response.data.data.accessToken || response.data.data.token));

    if (token) {
      await fs.writeFile(TOKEN_FILE_PATH, token);
      console.log(`[NewSortAccess] SUCCESS: Login successful. Token saved to ${TOKEN_FILE_PATH}`);
      return token;
    } else {
      console.error('[NewSortAccess] ERROR: Login succeeded but no token found in response.');
      console.log('Response Keys:', Object.keys(response.data));
      if (response.data.data) {
        console.log('Response.data Keys:', Object.keys(response.data.data));
      }
      return null;
    }
  } catch (error) {
    if (error.response) {
      console.error(`[NewSortAccess] ERROR: Login failed (HTTP ${error.response.status}):`, error.response.data);
    } else {
      console.error('[NewSortAccess] ERROR: Login failed:', error.message);
    }
    return null;
  }
}

// Execute login if run directly
if (require.main === module) {
  getAccessToken().then(token => {
    if (token) {
      console.log('--- TOKEN START ---');
      console.log(token.substring(0, 50) + '...');
      console.log('--- TOKEN END ---');
    }
  });
}

module.exports = { getAccessToken, TOKEN_FILE_PATH };
