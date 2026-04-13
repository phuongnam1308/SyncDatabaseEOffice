/**
 * TEST FILE: Test HTML parsing after download
 * Mục đích: Kiểm tra xem file ASPX có được parse thành công hay không
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const path = require('path');
const fs = require('fs');
const logger = require('../../utils/logger');
const HtmlFileMigrationModel = require('./migrate/HtmlFileMigrationModel');

class TestHtmlParsing {
  constructor() {
    this.parser = new HtmlFileMigrationModel();
  }

  async test1_Initialize() {
    console.log('\n[TEST 1] Initialize HTML Parser...');

    try {
      await this.parser.initialize();
      console.log('✓ Parser initialized');
      console.log('  Base URL:', this.parser.baseSourceUrl);
      console.log('  Project root:', this.parser.projectRoot);
      console.log('  Target img folder:', this.parser.targetImgFolderPath);
      console.log('  JSON output:', this.parser.jsonOutputPath);

      return true;
    } catch (err) {
      console.error('✗ Failed:', err.message);
      return false;
    }
  }

  async test2_FindSampleHtmlFile() {
    console.log('\n[TEST 2] Finding sample HTML file from tintucraw...');

    try {
      const tintucRawDir = path.join(process.cwd(), 'tintucraw');

      if (!fs.existsSync(tintucRawDir)) {
        console.error('✗ tintucraw directory not found:', tintucRawDir);
        return null;
      }

      const files = this.findHtmlFiles(tintucRawDir);
      console.log(`✓ Found ${files.length} HTML files`);

      if (files.length === 0) {
        console.warn('⚠ No HTML files found in tintucraw');
        return null;
      }

      console.log('Sample files:');
      files.slice(0, 5).forEach((file, idx) => {
        const stat = fs.statSync(file);
        console.log(`  [${idx + 1}] ${file.substring(tintucRawDir.length)} (${stat.size} bytes)`);
      });

      return files[0];
    } catch (err) {
      console.error('✗ Failed:', err.message);
      return null;
    }
  }

  findHtmlFiles(dir, exclude = []) {
    let files = [];
    if (!fs.existsSync(dir)) return files;

    try {
      const items = fs.readdirSync(dir);
      items.forEach((item) => {
        const fullPath = path.join(dir, item);
        if (exclude.includes(fullPath)) return;

        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            files = files.concat(this.findHtmlFiles(fullPath, exclude));
          } else if (item.endsWith('.html') || item.endsWith('.aspx')) {
            files.push(fullPath);
          }
        } catch (err) {
          // ignore permission errors
        }
      });
    } catch (err) {
      // ignore
    }

    return files;
  }

  async test3_ParseHtmlFile(filePath) {
    console.log('\n[TEST 3] Parsing HTML file...');
    console.log('File:', filePath);

    try {
      if (!fs.existsSync(filePath)) {
        console.error('✗ File not found:', filePath);
        return null;
      }

      const stat = fs.statSync(filePath);
      console.log('File size:', stat.size, 'bytes');

      console.log('Parsing...');
      const startTime = Date.now();
      const result = await this.parser.parseHtmlFile(filePath);
      const duration = Date.now() - startTime;

      console.log(`✓ Parsing completed in ${duration}ms`);

      if (!result) {
        console.warn('⚠ Parser returned null - file might not be recognized as news article');
        return null;
      }

      console.log('Parse result:');
      console.log('  Title:', result.title);
      console.log('  Slug:', result.slug);
      console.log('  Topic:', result.topic);
      console.log('  Published:', result.publishedAt);
      console.log('  Is Active:', result.isActive);
      console.log('  Author:', result.authorName);
      console.log('  Content length:', result.content ? result.content.length : 0);
      console.log('  Summary length:', result.summary ? result.summary.length : 0);
      console.log('  Tags:', result.tags);

      return result;
    } catch (err) {
      console.error('✗ Failed:', err.message);
      console.error('Stack:', err.stack);
      return null;
    }
  }

  async test4_ParseMultipleFiles() {
    console.log('\n[TEST 4] Parsing multiple HTML files...');

    try {
      const tintucRawDir = path.join(process.cwd(), 'tintucraw');
      const files = this.findHtmlFiles(tintucRawDir).slice(0, 5);

      console.log(`Testing ${files.length} files...`);

      let successCount = 0;
      let failCount = 0;

      for (const file of files) {
        try {
          console.log(`\n  Parsing: ${path.basename(file)}`);
          const result = await this.parser.parseHtmlFile(file);

          if (result) {
            console.log(`    ✓ Success: "${result.title}"`);
            successCount++;
          } else {
            console.log(`    ✗ Returned null`);
            failCount++;
          }
        } catch (err) {
          console.log(`    ✗ Error: ${err.message}`);
          failCount++;
        }
      }

      console.log(`\nResults: ${successCount} success, ${failCount} failed`);

      return { success: successCount, failed: failCount };
    } catch (err) {
      console.error('✗ Failed:', err.message);
      return null;
    }
  }

  async test5_CheckParseLogic() {
    console.log('\n[TEST 5] Checking parse logic...');

    try {
      // Check what functions are available
      const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(this.parser));

      const parseFunctions = methods.filter(
        (m) => m.includes('parse') || m.includes('extract') || m.includes('get'),
      );

      console.log('Available parse-related methods:');
      parseFunctions.forEach((m) => {
        console.log(`  - ${m}`);
      });

      return true;
    } catch (err) {
      console.error('✗ Failed:', err.message);
      return false;
    }
  }

  async test6_TestExtractFunctions() {
    console.log('\n[TEST 6] Testing individual extract functions...');

    const filePath = await this.test2_FindSampleHtmlFile();
    if (!filePath) {
      console.warn('⚠ Cannot test - no HTML file found');
      return;
    }

    try {
      const html = fs.readFileSync(filePath, 'utf8');
      console.log('HTML file content length:', html.length);

      // Try different parsing approaches
      const cheerio = require('cheerio');
      const $ = cheerio.load(html);

      console.log('\nExtracted elements:');
      console.log('  Title tags:', $('title').length);
      console.log('  h1 tags:', $('h1').length);
      console.log('  h2 tags:', $('h2').length);
      console.log('  p tags:', $('p').length);
      console.log('  img tags:', $('img').length);
      console.log('  a tags:', $('a').length);
      console.log('  meta tags:', $('meta').length);

      // Show some content
      const title = $('title').first().text();
      console.log('\nContent preview:');
      console.log('  Title:', title);

      const h1 = $('h1').first().text();
      if (h1) console.log('  H1:', h1);

      const meta = $('meta[name="description"]').attr('content');
      if (meta) console.log('  Meta description:', meta);

      return true;
    } catch (err) {
      console.error('✗ Failed:', err.message);
      return false;
    }
  }

  async runAll() {
    console.log('='.repeat(70));
    console.log('TEST HTML PARSING');
    console.log('Started:', new Date().toISOString());
    console.log('='.repeat(70));

    await this.test1_Initialize();

    const htmlFile = await this.test2_FindSampleHtmlFile();

    if (htmlFile) {
      await this.test3_ParseHtmlFile(htmlFile);
      await this.test6_TestExtractFunctions();
    }

    await this.test4_ParseMultipleFiles();
    await this.test5_CheckParseLogic();

    console.log('\n' + '='.repeat(70));
    console.log('HTML PARSING TEST COMPLETED');
    console.log('='.repeat(70));
  }
}

// Run
const tester = new TestHtmlParsing();
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
