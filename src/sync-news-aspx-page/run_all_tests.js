/**
 * QUICK START RUNNER - Run all tests in sequence with summary
 * Chạy: node src/sync-news-aspx-page/run_all_tests.js
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

class TestRunner {
  constructor() {
    this.testDir = path.join(__dirname);
    this.projectRoot = path.resolve(__dirname, '../../');
    this.results = {};
  }

  async runTest(testFile, testName) {
    return new Promise((resolve) => {
      console.log(`\n${'='.repeat(70)}`);
      console.log(`▶ Running: ${testName}`);
      console.log(`  File: ${testFile}`);
      console.log('='.repeat(70));

      const proc = spawn('node', [path.join(this.testDir, testFile)], {
        stdio: 'inherit',
        cwd: this.projectRoot,
      });

      proc.on('close', (code) => {
        const status = code === 0 ? '✓ PASSED' : '✗ FAILED';
        console.log(`\n${status} - Exit code: ${code}`);
        this.results[testName] = { code, passed: code === 0 };
        resolve();
      });

      proc.on('error', (err) => {
        console.error(`✗ ERROR running test: ${err.message}`);
        this.results[testName] = { code: 1, passed: false, error: err.message };
        resolve();
      });
    });
  }

  printSummary() {
    console.log(`\n\n${'='.repeat(70)}`);
    console.log('TEST SUMMARY');
    console.log('='.repeat(70));

    Object.entries(this.results).forEach(([name, result]) => {
      const icon = result.passed ? '✓' : '✗';
      const status = result.passed ? 'PASSED' : 'FAILED';
      console.log(`${icon} ${name.padEnd(40)} ${status}`);
    });

    const totalTests = Object.keys(this.results).length;
    const passedTests = Object.values(this.results).filter((r) => r.passed).length;
    const failedTests = totalTests - passedTests;

    console.log('='.repeat(70));
    console.log(`Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);

    if (failedTests > 0) {
      console.log('\n📋 FAILED TESTS - NEXT STEPS:');
      Object.entries(this.results).forEach(([name, result]) => {
        if (!result.passed) {
          console.log(`\n  • ${name}`);
          if (name.includes('Data')) {
            console.log('    → Check: SHAREPOINT_DB_NAME, BASE_URL in .env');
            console.log('    → Check: SharePoint database connection');
          } else if (name.includes('Download')) {
            console.log('    → Check: npm run login (refresh auth)');
            console.log('    → Check: Firewall, SSL settings');
          } else if (name.includes('Initialize')) {
            console.log('    → Check: Database connections');
            console.log('    → Check: Environment variables');
          }
        }
      });
    } else {
      console.log('\n✓ ALL TESTS PASSED!');
      console.log('Your ASPX download system is working correctly.');
    }

    console.log('='.repeat(70));
  }

  async runSequential() {
    console.log('COMPREHENSIVE TEST SUITE FOR ASPX DOWNLOAD');
    console.log('Started:', new Date().toISOString());
    console.log('');
    console.log('This will run 4 tests to debug your ASPX download issue.');
    console.log('Total time: ~2-5 minutes depending on data volume');
    console.log('');

    // Test 1: Data Fetch
    await this.runTest('test_check_data_fetch.js', 'Test 1: Check Data from SharePoint');

    // Test 2: Debug Flow
    await this.runTest('test_debug_download_flow.js', 'Test 2: Full Download Flow');

    // Test 3: Detailed Download
    await this.runTest('test_detailed_download.js', 'Test 3: Detailed Download Test');

    // Test 4: HTML Parsing
    await this.runTest('test_html_parsing.js', 'Test 4: HTML Parsing Test');

    this.printSummary();
  }
}

// Main
const runner = new TestRunner();
runner.runSequential().catch((err) => {
  console.error('Error running tests:', err.message);
  process.exit(1);
});
