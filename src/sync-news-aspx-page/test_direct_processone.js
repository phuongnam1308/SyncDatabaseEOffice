#!/usr/bin/env node

/**
 * DIRECT TEST: Call processOne directly like SyncManager does
 * Mục đích: Debug tại sao ASPX files không được download khi job chạy
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const path = require('path');
const StreamNewsAspxPageIncrementalModel = require('./models/StreamNewsAspxPageIncrementalModel');

async function testDirectProcessOne() {
  console.log('\n====== DIRECT PROCESS ONE TEST ======\n');

  let model = null;

  try {
    // Step 1: Initialize model
    console.log('[STEP 1] Initialize StreamNewsAspxPageIncrementalModel...');
    model = new StreamNewsAspxPageIncrementalModel();
    await model.initialize();
    console.log('✓ Model initialized');

    // Step 2: Get list to prepare staging
    console.log('\n[STEP 2] Prepare staging table...');
    const listResult = await model.getList('1900-01-01T00:00:00.000Z', 'TEST-JOB-' + Date.now(), 0);
    console.log('✓ List result:');
    console.log('  - totalCount:', listResult.totalCount);
    console.log('  - stagedCount:', listResult.stagedCount);
    console.log('  - lastSyncTime:', listResult.lastSyncTime);
    console.log('  - lastSyncId:', listResult.lastSyncId);

    // Step 3: Fetch one from staging
    console.log('\n[STEP 3] Fetch one item from staging...');
    const row = await model.fetchOneFromStaging();

    if (!row) {
      console.log('✗ No items in staging table!');
      process.exit(1);
    }

    console.log('✓ Got row:');
    console.log('  - DocId:', row.DocId);
    console.log('  - LeafName:', row.LeafName);
    console.log('  - FullPageUrl:', row.FullPageUrl);
    console.log('  - LocalFilePath:', row.LocalFilePath);
    console.log('  - DownloadStatus:', row.DownloadStatus);

    // Step 4: Call processOne directly
    console.log('\n[STEP 4] Call processOne...');
    const jobId = 'MANUAL-TEST-' + Date.now();

    console.log('  Calling model.processOne("' + jobId + '", { itemIndex: 0 })...');
    try {
      const result = await model.processOne(jobId, { itemIndex: 0 });
      console.log('✓ RESULT:', JSON.stringify(result, null, 2));
    } catch (processErr) {
      console.log('✗ Error during processOne:');
      console.log('  Message:', processErr.message);
      console.log('  Code:', processErr.code);
      console.log('  Stack:', processErr.stack);

      // Try to extract more info
      if (processErr.message.includes('spDownload')) {
        console.log('\n❌ PROBLEM FOUND: spDownload is not accessible!');
        console.log('\nDEBUG INFO:');

        // Check if we can import it directly
        console.log('  1. Try to import spDownload directly...');
        try {
          const {
            downloadFile: testSpDownload,
          } = require('../sync-file-copy/SharePointAuthService');
          console.log('     ✓ Can import spDownload:', typeof testSpDownload);

          // Try to call it
          console.log('  2. Try to use spDownload...');
          const testUrl = row.FullPageUrl;
          console.log('     Calling testSpDownload("' + testUrl + '")...');
          const testBuffer = await testSpDownload(testUrl);
          console.log('     ✓ Download succeeded! Size:', testBuffer.length);
        } catch (debugErr) {
          console.log('     ✗ Debug failed:', debugErr.message);
        }
      }
    }

    console.log('\n====== TEST COMPLETE ======\n');
  } catch (err) {
    console.error('✗ Fatal error:', err.message);
    console.error('Stack:', err.stack);
  } finally {
    if (model && model.pool) {
      try {
        await model.pool.close();
      } catch (e) {}
    }
  }
}

testDirectProcessOne()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
