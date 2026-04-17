/**
 * TEST FILE: Test download a single ASPX file with detailed logging
 * Mục đích: Debug vì sao file ASPX không được download - focus on download step
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const StreamNewsAspxPageMigrationService = require('./services/StreamNewsAspxPageMigrationService');
const logger = require('../../utils/logger');
const { downloadFile } = require('../sync-file-copy/SharePointAuthService');
const fs = require('fs');
const path = require('path');

class DetailedDownloadTest {
  constructor() {
    this.service = new StreamNewsAspxPageMigrationService();
  }

  /**
   * Test 1: Check if we can get a URL to download
   */
  async getDownloadUrl() {
    console.log('\n[TEST 1] Getting first pending URL from staging...');

    try {
      await this.service.initialize();
      const model = this.service.model;

      const rows = await model.queryNewDb(`
                SELECT TOP 1
                    DocId,
                    LeafName,
                    FullPageUrl,
                    LocalFilePath
                FROM ${model.getStagingTableRef()}
                WHERE ISNULL(DownloadStatus, '') NOT IN ('OK', 'ERROR')
                ORDER BY TimeLastModified DESC
            `);

      if (!rows || rows.length === 0) {
        console.error('[ERROR] No pending URLs found in staging!');
        return null;
      }

      const row = rows[0];
      console.log('✓ Found URL to test:');
      console.log('  DocId:', row.DocId);
      console.log('  File:', row.LeafName);
      console.log('  URL:', row.FullPageUrl);
      console.log('  Local Path:', row.LocalFilePath);

      return row;
    } catch (err) {
      console.error('[ERROR]', err.message);
      return null;
    }
  }

  /**
   * Test 2: Try downloading directly with downloadFile
   */
  async testDirectDownload(url) {
    console.log('\n[TEST 2] Testing direct download with downloadFile()...');
    console.log('URL:', url);

    try {
      console.log('Calling downloadFile()...');
      const startTime = Date.now();

      const buffer = await downloadFile(url);

      const duration = Date.now() - startTime;
      console.log(`✓ Download completed in ${duration}ms`);

      if (!buffer) {
        console.error('[ERROR] Buffer is null');
        return null;
      }

      console.log('Buffer size:', buffer.length, 'bytes');

      // Check content type
      const content = buffer.toString('utf8');
      console.log('First 500 chars of content:');
      console.log(content.substring(0, 500));

      // Check if it's HTML
      const isHtml = content.includes('<') && content.includes('>');
      console.log('Looks like HTML:', isHtml ? '✓' : '✗');

      return buffer;
    } catch (err) {
      console.error('[ERROR] Download failed:');
      console.error('  Message:', err.message);
      console.error('  Code:', err.code);
      console.error('  Status:', err.response?.status);
      console.error('  Status Text:', err.response?.statusText);
      if (err.response?.data) {
        console.error('  Response data:', err.response.data.substring(0, 200));
      }
      console.error('Stack:', err.stack);
      return null;
    }
  }

  /**
   * Test 3: Try downloading with axios directly (with logging)
   */
  async testAxiosDownload(url) {
    console.log('\n[TEST 3] Testing download with axios directly...');
    console.log('URL:', url);

    try {
      const axios = require('axios');
      const https = require('https');
      const { NtlmClient } = require('axios-ntlm');

      // Get AUTH cookie
      const cookieFile = path.join(process.cwd(), 'auth', 'cookie.txt');
      if (!fs.existsSync(cookieFile)) {
        console.error('[ERROR] Cookie file not found:', cookieFile);
        return null;
      }

      const cookie = fs.readFileSync(cookieFile, 'utf8').trim();
      console.log('Cookie loaded, length:', cookie.length);

      const httpsAgent = new https.Agent({
        rejectUnauthorized: process.env.IGNORE_SSL === 'true' ? false : true,
      });

      console.log('Sending request...');
      const startTime = Date.now();

      const response = await axios.get(url, {
        headers: {
          Cookie: cookie,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0',
        },
        httpsAgent: httpsAgent,
        timeout: 30000,
        responseType: 'arraybuffer',
        maxRedirects: 5,
      });

      const duration = Date.now() - startTime;
      console.log(`✓ Request completed in ${duration}ms`);
      console.log('Response status:', response.status);
      console.log('Response headers:', response.headers);

      if (response.data) {
        const buffer = Buffer.from(response.data);
        console.log('Response size:', buffer.length, 'bytes');

        const content = buffer.toString('utf8');
        const isHtml = content.includes('<');
        console.log('Is HTML:', isHtml ? '✓' : '✗');

        return buffer;
      }

      return null;
    } catch (err) {
      console.error('[ERROR] Axios download failed:');
      console.error('  Type:', err.constructor.name);
      console.error('  Message:', err.message);
      if (err.response) {
        console.error('  Status:', err.response.status);
        console.error('  Headers:', err.response.headers);
        if (err.response.data) {
          const data = Buffer.isBuffer(err.response.data)
            ? err.response.data.toString('utf8')
            : err.response.data;
          console.error('  Data (first 500 chars):', String(data).substring(0, 500));
        }
      }
      return null;
    }
  }

  /**
   * Test 4: Save downloaded file and check it
   */
  async testSaveFile(buffer, localPath) {
    console.log('\n[TEST 4] Testing file save...');
    console.log('Target path:', localPath);

    try {
      // Create directory if not exists
      const dir = path.dirname(localPath);
      if (!fs.existsSync(dir)) {
        console.log('Creating directory:', dir);
        fs.mkdirSync(dir, { recursive: true });
      }

      console.log('Writing file...');
      fs.writeFileSync(localPath, buffer);

      // Check if file was created
      if (!fs.existsSync(localPath)) {
        console.error('[ERROR] File was not created!');
        return false;
      }

      const stat = fs.statSync(localPath);
      console.log('✓ File created successfully');
      console.log('  Size:', stat.size, 'bytes');
      console.log('  Path:', localPath);

      return true;
    } catch (err) {
      console.error('[ERROR] Failed to save file:');
      console.error('  Message:', err.message);
      console.error('  Code:', err.code);
      return false;
    }
  }

  /**
   * Test 5: Test the full processRowData function
   */
  async testFullProcessRowData(rowData) {
    console.log('\n[TEST 5] Testing full processRowData()...');

    try {
      const model = this.service.model;
      const result = await model.processRowData(rowData);

      console.log('✓ processRowData completed');
      console.log('  Result:', JSON.stringify(result, null, 2));

      return result;
    } catch (err) {
      console.error('[ERROR] processRowData failed:');
      console.error('  Message:', err.message);
      console.error('  Stack:', err.stack);
      return null;
    }
  }

  /**
   * Run all tests
   */
  async runAll() {
    console.log('='.repeat(70));
    console.log('DETAILED ASPX DOWNLOAD TEST');
    console.log('Started:', new Date().toISOString());
    console.log('='.repeat(70));

    // Get URL
    const rowData = await this.getDownloadUrl();
    if (!rowData) {
      console.error('\n✗ Cannot proceed - no URL found');
      process.exit(1);
    }

    // Direct download test
    const buffer1 = await this.testDirectDownload(rowData.FullPageUrl);

    // Axios download test
    const buffer2 = await this.testAxiosDownload(rowData.FullPageUrl);

    // Save file test
    if (buffer1 || buffer2) {
      const testPath = path.join(process.cwd(), 'tintucraw', 'test_aspx.html');
      const saveResult = await this.testSaveFile(buffer1 || buffer2, testPath);
    }

    // Full process test
    if (rowData) {
      await this.testFullProcessRowData(rowData);
    }

    console.log('\n' + '='.repeat(70));
    console.log('TEST COMPLETED');
    console.log('='.repeat(70));
  }
}

// Run
const tester = new DetailedDownloadTest();
tester
  .runAll()
  .then(() => {
    console.log('\n✓ All tests complete');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n✗ Test failed:', err.message);
    process.exit(1);
  });
