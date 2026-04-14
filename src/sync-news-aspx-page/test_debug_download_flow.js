/**
 * TEST FILE: Kiểm tra toàn bộ luồng download ASPX từng bước
 * Mục đích: Debug vì sao file ASPX không được download
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const logger = require('../../utils/logger');
const StreamNewsAspxPageMigrationService = require('./services/StreamNewsAspxPageMigrationService');
const sql = require('mssql');
const fs = require('fs');
const path = require('path');

class DebugDownloadFlow {
  constructor() {
    this.service = new StreamNewsAspxPageMigrationService();
  }

  async testStep1_InitializeService() {
    console.log('\n========== STEP 1: Initialize Service ==========');
    try {
      await this.service.initialize();
      console.log('✓ Service initialized successfully');

      if (this.service.model) {
        console.log('  - Model class:', this.service.model.constructor.name);
        console.log('  - New DB:', this.service.model.newDbName);
        console.log('  - Staging table:', this.service.model.getStagingTableRef());
        console.log('  - Output root:', this.service.model.outputRoot);
        console.log('  - Topic IDs loaded:', this.service.model.topicIds.length);
        console.log('  - Admin ID:', this.service.model.adminId);
      }
      return true;
    } catch (err) {
      console.error('✗ FAILED:', err.message);
      console.error('Stack:', err.stack);
      return false;
    }
  }

  async testStep2_CheckStagingTableStructure() {
    console.log('\n========== STEP 2: Check Staging Table Structure ==========');
    try {
      const model = this.service.model;
      const table = model.getStagingTableRef();

      const query = `
                SELECT
                    COLUMN_NAME,
                    DATA_TYPE,
                    IS_NULLABLE,
                    CHARACTER_MAXIMUM_LENGTH
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = 'news_aspx_pages_temp'
                ORDER BY ORDINAL_POSITION
            `;

      const rows = await model.queryNewDb(query);
      console.log(`✓ Staging table has ${rows.length} columns:`);
      rows.forEach((col) => {
        console.log(
          `  - ${col.COLUMN_NAME}: ${col.DATA_TYPE}${col.CHARACTER_MAXIMUM_LENGTH ? '(' + col.CHARACTER_MAXIMUM_LENGTH + ')' : ''} ${col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL'}`,
        );
      });
      return true;
    } catch (err) {
      console.error('✗ FAILED:', err.message);
      return false;
    }
  }

  async testStep3_GetListOfPendingItems() {
    console.log('\n========== STEP 3: Get List of Pending Items ==========');
    try {
      const result = await this.service.testGetList({
        lastSyncTime: '1900-01-01T00:00:00.000Z',
        lastSyncId: 0,
      });

      console.log('✓ List fetched successfully:');
      console.log('  - Job ID:', result.syncJobId);
      console.log('  - Total count:', result.totalCount);
      console.log('  - Staged count:', result.stagedCount);
      console.log('  - Currently processing:', result.processingItem);
      console.log('  - Last sync time:', result.lastSyncTime);
      console.log('  - Last sync ID:', result.lastSyncId);

      if (result.totalCount === 0) {
        console.warn('⚠ No pending items found! Check if staging table has data.');
      }

      return { success: true, ...result };
    } catch (err) {
      console.error('✗ FAILED:', err.message);
      console.error('Stack:', err.stack);
      return { success: false, error: err.message };
    }
  }

  async testStep4_CheckStagingTableData() {
    console.log('\n========== STEP 4: Check Staging Table Data ==========');
    try {
      const model = this.service.model;
      const table = model.getStagingTableRef();

      const countQuery = `SELECT COUNT(1) as cnt FROM ${table}`;
      const countRows = await model.queryNewDb(countQuery);
      const totalCount = countRows[0]?.cnt || 0;

      console.log(`✓ Staging table contains ${totalCount} total records`);

      const pendingQuery = `
                SELECT TOP 5
                    DocId,
                    LeafName,
                    FullPageUrl,
                    LocalFilePath,
                    DownloadStatus,
                    DownloadError,
                    TimeLastModified
                FROM ${table}
                WHERE ISNULL(DownloadStatus, '') NOT IN ('OK', 'ERROR')
                ORDER BY TimeLastModified DESC, DocId DESC
            `;

      const rows = await model.queryNewDb(pendingQuery);
      console.log(`\n📋 Top 5 pending items (to be downloaded):`);

      if (rows.length === 0) {
        console.warn('⚠ No pending items in staging table!');
      } else {
        rows.forEach((row, idx) => {
          console.log(`\n  [${idx + 1}] DocId: ${row.DocId}`);
          console.log(`      File: ${row.LeafName}`);
          console.log(`      URL: ${row.FullPageUrl}`);
          console.log(`      Local Path: ${row.LocalFilePath}`);
          console.log(`      Status: ${row.DownloadStatus || 'PENDING'}`);
          console.log(`      Error: ${row.DownloadError || 'None'}`);
          console.log(`      Last Modified: ${row.TimeLastModified}`);
        });
      }

      return { success: true, total: totalCount, pending: rows };
    } catch (err) {
      console.error('✗ FAILED:', err.message);
      return { success: false, error: err.message };
    }
  }

  async testStep5_FetchOneFromStaging() {
    console.log('\n========== STEP 5: Fetch One Item from Staging ==========');
    try {
      const model = this.service.model;
      const row = await model.fetchOneFromStaging();

      if (!row) {
        console.warn('⚠ No items found in staging table!');
        return { success: false, error: 'No items found' };
      }

      console.log('✓ Successfully fetched one item:');
      console.log('  - DocId:', row.DocId);
      console.log('  - File Name:', row.LeafName);
      console.log('  - Full URL:', row.FullPageUrl);
      console.log('  - Local Path:', row.LocalFilePath);
      console.log('  - Download Status:', row.DownloadStatus);

      const urlIsValid =
        row.FullPageUrl &&
        (row.FullPageUrl.startsWith('http://') || row.FullPageUrl.startsWith('https://'));
      console.log(`  - URL Valid: ${urlIsValid ? '✓' : '✗'}`);

      const pathIsValid = row.LocalFilePath && row.LocalFilePath.length > 0;
      console.log(`  - Path Valid: ${pathIsValid ? '✓' : '✗'}`);

      return { success: true, row };
    } catch (err) {
      console.error('✗ FAILED:', err.message);
      return { success: false, error: err.message };
    }
  }

  async testStep6_CheckDownloadService() {
    console.log('\n========== STEP 6: Check Download Service ==========');
    try {
      const { downloadFile } = require('../sync-file-copy/SharePointAuthService');

      if (typeof downloadFile === 'function') {
        console.log('✓ downloadFile function is available');
      } else {
        throw new Error('downloadFile is not a function');
      }

      // Check if we can access auth
      const cookieFile =
        process.env.COOKIE_FILE_PATH || path.join(process.cwd(), 'auth', 'cookie.txt');
      const hasCookie = fs.existsSync(cookieFile);
      console.log('  - Cookie file exists:', hasCookie ? '✓' : '✗');

      if (hasCookie) {
        const cookie = fs.readFileSync(cookieFile, 'utf8').trim();
        console.log('  - Cookie length:', cookie.length, 'bytes');
      }

      return { success: true };
    } catch (err) {
      console.error('✗ FAILED:', err.message);
      return { success: false, error: err.message };
    }
  }

  async testStep7_TestDownloadSingleFile(url) {
    console.log('\n========== STEP 7: Test Download Single File ==========');
    console.log('Testing URL:', url);

    try {
      const { downloadFile } = require('../sync-file-copy/SharePointAuthService');

      console.log('📡 Attempting to download...');
      const startTime = Date.now();
      const buffer = await downloadFile(url);
      const duration = Date.now() - startTime;

      if (buffer && buffer.length > 0) {
        console.log(
          `✓ Downloaded successfully! Size: ${buffer.length} bytes (${(buffer.length / 1024).toFixed(2)} KB) in ${duration}ms`,
        );

        // Check if it looks like HTML
        const content = buffer.toString('utf8');
        const isHtml =
          content.includes('<html') || content.includes('<HTML') || content.includes('<!DOCTYPE');
        console.log(`  - Looks like HTML: ${isHtml ? '✓' : '✗'}`);

        // Check first 200 chars
        console.log(`  - First 200 chars: ${content.substring(0, 200)}`);

        return { success: true, buffer, size: buffer.length };
      } else {
        console.error('✗ Downloaded buffer is empty or null');
        return { success: false, error: 'Empty buffer' };
      }
    } catch (err) {
      console.error('✗ FAILED:', err.message);
      console.error('Stack:', err.stack);
      return { success: false, error: err.message };
    }
  }

  async testStep8_TestProcessOne(syncJobId) {
    console.log('\n========== STEP 8: Test Process One Item ==========');

    try {
      if (!syncJobId) {
        throw new Error('syncJobId is required');
      }

      console.log('Processing with job ID:', syncJobId);
      const result = await this.service.testProcessOne(syncJobId);

      console.log('✓ Process result:');
      console.log('  - Processed:', result.processed);
      console.log('  - Done:', result.done);
      console.log('  - Row ID:', result.rowId);
      console.log('  - Result:', JSON.stringify(result.result, null, 2));

      return { success: true, result };
    } catch (err) {
      console.error('✗ FAILED:', err.message);
      console.error('Stack:', err.stack);
      return { success: false, error: err.message };
    }
  }

  async testStep9_CheckLocalFiles() {
    console.log('\n========== STEP 9: Check Downloaded Local Files ==========');

    try {
      const model = this.service.model;
      const outputRoot = model.outputRoot;
      const fullPath = path.join(process.cwd(), outputRoot);

      console.log('Output directory:', fullPath);
      console.log('Exists:', fs.existsSync(fullPath) ? '✓' : '✗');

      if (fs.existsSync(fullPath)) {
        const files = this.getAllFiles(fullPath);
        console.log(`✓ Found ${files.length} files in output directory:`);
        files.slice(0, 10).forEach((file) => {
          const stat = fs.statSync(file);
          console.log(`  - ${file.substring(fullPath.length)}: ${stat.size} bytes`);
        });

        if (files.length > 10) {
          console.log(`  ... and ${files.length - 10} more files`);
        }
      }

      return { success: true };
    } catch (err) {
      console.error('✗ FAILED:', err.message);
      return { success: false, error: err.message };
    }
  }

  getAllFiles(dir) {
    let files = [];
    if (!fs.existsSync(dir)) return files;

    const items = fs.readdirSync(dir);
    items.forEach((item) => {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        files = files.concat(this.getAllFiles(fullPath));
      } else {
        files.push(fullPath);
      }
    });
    return files;
  }

  async runFullTest() {
    console.log('\n' + '='.repeat(60));
    console.log('COMPREHENSIVE ASPX DOWNLOAD DEBUG TEST');
    console.log('Started at:', new Date().toISOString());
    console.log('='.repeat(60));

    const results = {};

    // Step 1
    results.step1 = await this.testStep1_InitializeService();
    if (!results.step1) return results;

    // Step 2
    results.step2 = await this.testStep2_CheckStagingTableStructure();

    // Step 3
    results.step3 = await this.testStep3_GetListOfPendingItems();

    // Step 4
    results.step4 = await this.testStep4_CheckStagingTableData();

    // Step 5
    results.step5 = await this.testStep5_FetchOneFromStaging();

    // Step 6
    results.step6 = await this.testStep6_CheckDownloadService();

    // Step 7 - Download single file if we have one
    if (results.step5.success && results.step5.row) {
      results.step7 = await this.testStep7_TestDownloadSingleFile(results.step5.row.FullPageUrl);
    }

    // Step 9 - Check local files
    results.step9 = await this.testStep9_CheckLocalFiles();

    console.log('\n' + '='.repeat(60));
    console.log('TEST SUMMARY');
    console.log('='.repeat(60));
    Object.entries(results).forEach(([step, result]) => {
      const status =
        result.success === false ? '✗' : result === true ? '✓' : result?.success ? '✓' : '?';
      console.log(`${status} ${step}: ${result.error || 'OK'}`);
    });

    return results;
  }
}

// Run the test
const tester = new DebugDownloadFlow();
tester
  .runFullTest()
  .then(() => {
    console.log('\n✓ Test completed. Check logs above for details.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n✗ Test failed:', err.message);
    process.exit(1);
  });
