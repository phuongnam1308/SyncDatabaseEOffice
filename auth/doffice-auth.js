const axios = require('axios');
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');

const DOFFICE_TOKEN_FILE = path.join(__dirname, 'doffice_token.txt');

/**
 * Performs login to Doffice API and retrieves accessToken
 * @returns {Promise<string|null>} The accessToken or null if failed
 */
async function loginDoffice() {
  const url = process.env.DOFFICE_LOGIN_URL;
  const username = process.env.DOFFICE_USERNAME;
  const password = process.env.DOFFICE_PASSWORD;

  if (!url || !username || !password) {
    console.error('ERROR: DOFFICE_LOGIN_URL, DOFFICE_USERNAME, or DOFFICE_PASSWORD not set in .env');
    return null;
  }

  console.log(`Attempting login to Doffice at: ${url}`);

  try {
    const response = await axios.post(url, {
      username: username,
      password: password
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
      }
    });

    // Check common locations for the token in the response
    const token = response.data?.accessToken || 
                  response.data?.token || 
                  (response.data?.data && response.data.data.accessToken) ||
                  (response.data?.data && response.data.data.token);

    if (token) {
      await fs.writeFile(DOFFICE_TOKEN_FILE, token);
      console.log('SUCCESS: Logged in to Doffice. Token saved to:', DOFFICE_TOKEN_FILE);
      return token;
    } else {
      console.error('ERROR: Login successful but no token found in response metadata.');
      console.log('Response body:', JSON.stringify(response.data, null, 2));
      return null;
    }
  } catch (error) {
    if (error.response) {
      console.error(`ERROR: Doffice login failed (HTTP ${error.response.status}):`, error.response.data);
    } else {
      console.error('ERROR: Doffice login failed:', error.message);
    }
    return null;
  }
}

// If run directly: node auth/doffice-auth.js
if (require.main === module) {
  loginDoffice().then(token => {
    if (token) {
      console.log('Token starts with:', token.substring(0, 20) + '...');
    }
  });
}

module.exports = { loginDoffice, DOFFICE_TOKEN_FILE };
