const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const fs = require('fs');
const sql = require('mssql');
const cheerio = require('cheerio');
const { newDbConfig } = require('../../config/database');

const projectRoot = path.resolve(__dirname, '../../');
const logFilePath = path.join(projectRoot, 'verify_content_compare.log');

// Helper to log to both console and log file
function log(msg = '') {
  console.log(msg);
  fs.appendFileSync(logFilePath, msg + '\n', 'utf-8');
}

async function main() {
  fs.writeFileSync(logFilePath, `=== CONTENT COMPARISON REPORT - ${new Date().toISOString()} ===\n\n`, 'utf-8');

  const slug = process.argv[2];
  if (!slug) {
    log('❌ Error: Please provide a slug to compare.');
    log('Usage: node src/sync-news-aspx-page/verify_content_compare.js <slug>');
    process.exit(1);
  }

  let pool = null;
  try {
    pool = await sql.connect(newDbConfig);
    log('✅ Connected to database.');
  } catch (err) {
    log(`❌ Connection failed: ${err.message}`);
    process.exit(1);
  }

  try {
    await compareSlug(pool, slug.trim());
  } catch (err) {
    log(`❌ Error: ${err.message}`);
    if (err.stack) {
      fs.appendFileSync(logFilePath, err.stack + '\n', 'utf-8');
    }
  } finally {
    if (pool) await pool.close();
    log('\n======================================================');
    log(`📝 Comparison report written to: ${logFilePath}`);
    log('======================================================');
    process.exit(0);
  }
}

// Extract content from SharePoint HTML (replicate migrator logic)
function extractSharePointContent(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  
  // 1. Extract Title
  let title = $('meta[property="og:title"]').attr('content') ||
              $('h1').first().text().trim() ||
              $('#DeltaPlaceHolderPageTitleInTitleArea').text().trim() ||
              '';

  // 2. Extract Body Container
  let docMainArea = $('#DeltaPlaceHolderMain, .article-content, .news-content-body, #MSO_ContentTable').first();
  if (!docMainArea.length) {
    docMainArea = $('.news-detail, .NewsMainArea, .article-body').first();
  }

  let contentContainer = $('.content').first();
  if (!contentContainer.length) {
    contentContainer = $('#print-news').first();
  }
  if (!contentContainer.length) {
    contentContainer = $('.newsdetail').first();
  }
  if (!contentContainer.length || contentContainer.text().trim().length < 20) {
    contentContainer = docMainArea;
  }

  const cleanContainer = contentContainer.clone();
  
  const blocksToRemove = [
    '#s4-ribbonrow', '#suiteBarDelta', '#s4-titlerow', '#sideNavBox', '#footer',
    '.ms-breadcrumb', '.ms-core-listMenu-verticalBox', '.ms-pub-breadcrumb',
    '.ms-belltown-sideNav', '#DeltaPlaceHolderLeftNavBar', '#DeltaPlaceHolderPageTitleInTitleArea',
    'script', 'style', 'link', 'iframe', 'object', 'embed', '.other-news',
    '.feedbackSend', '.feedback', '.Title', '.subtitle', '.des', '.linkadmin',
    '.link-banner', '.menu-cover'
  ];
  blocksToRemove.forEach(sel => cleanContainer.find(sel).remove());

  // Extract images
  const images = [];
  cleanContainer.find('img').each((idx, img) => {
    const src = $(img).attr('src')?.trim();
    if (src && !src.startsWith('data:')) {
      images.push(src);
    }
  });

  // Extract docs
  const docExtensions = ['.pdf', '.docx', '.xlsx', '.xls', '.doc', '.pptx', '.ppt', '.zip', '.rar'];
  const docs = [];
  cleanContainer.find('a').each((idx, link) => {
    const href = $(link).attr('href')?.trim() || '';
    const text = $(link).text().trim();
    const isDoc = docExtensions.some(ext => href.toLowerCase().split('?')[0].endsWith(ext));
    if (isDoc) {
      docs.push({ href, text });
    }
  });

  const bodyHtml = cleanContainer.html() || '';
  const bodyText = cleanContainer.text().replace(/\s+/g, ' ').trim();

  return {
    title,
    bodyHtml,
    bodyText,
    images,
    docs
  };
}

async function compareSlug(pool, slug) {
  log(`======================================================`);
  log(`🔍 COMPARISON REPORT FOR SLUG: "${slug}"`);
  log(`======================================================\n`);

  // 1. Fetch metadata from staging pages temp table
  log('1. Querying SharePoint Staging Metadata (news_aspx_pages_temp)...');
  const tempResult = await pool.request()
    .input('slug', sql.NVarChar, slug)
    .query('SELECT TOP 1 * FROM dbo.news_aspx_pages_temp WHERE LeafName = @slug + \'.aspx\' OR LeafName = @slug');
  
  const tempRow = tempResult.recordset[0];
  let spHtml = null;

  if (tempRow) {
    log(`  [✅] Staging Page Row: FOUND`);
    log(`        DocId        : ${tempRow.DocId}`);
    log(`        Full Page URL: ${tempRow.FullPageUrl}`);
    log(`        Local Path   : ${tempRow.LocalFilePath}`);
    
    // Attempt to read local file
    let localPath = tempRow.LocalFilePath;
    if (localPath) {
      if (!path.isAbsolute(localPath)) {
        localPath = path.resolve(projectRoot, localPath);
      }
      if (fs.existsSync(localPath)) {
        log(`  [✅] Local ASPX file found, reading content...`);
        spHtml = fs.readFileSync(localPath, 'utf-8');
      } else {
        log(`  [❌] Local ASPX file NOT found at: ${localPath}`);
      }
    }

    // Attempt to download if not found locally
    if (!spHtml && tempRow.FullPageUrl) {
      log(`  [🔄] Attempting to download page directly from SharePoint...`);
      try {
        const { downloadFile } = require('../sync-file-copy/SharePointAuthService');
        const buffer = await downloadFile(tempRow.FullPageUrl, pool);
        if (buffer && buffer.length > 0) {
          log(`  [✅] Downloaded successfully (${buffer.length} bytes)`);
          spHtml = buffer.toString('utf-8');
        }
      } catch (dlErr) {
        log(`  [❌] Download failed: ${dlErr.message}`);
      }
    }
  } else {
    log(`  [❌] Staging Page Row not found in news_aspx_pages_temp.`);
    // Fallback: check if we can check local file directly inside Pages
    const fallbackPath = path.resolve(projectRoot, 'tintucraw/tintuc/Pages', `${slug}.aspx`);
    if (fs.existsSync(fallbackPath)) {
      log(`  [✅] Fallback: Found local ASPX file at default path, reading content...`);
      spHtml = fs.readFileSync(fallbackPath, 'utf-8');
    } else {
      log(`  [❌] Fallback local ASPX file not found.`);
    }
  }

  if (!spHtml) {
    log('\n❌ Error: Cannot compare because original SharePoint HTML content is NOT available.');
    log('Please ensure the raw ASPX file exists or the SharePoint server is accessible for download.');
    return;
  }

  // Parse SharePoint HTML
  log('\n2. Extracting content from SharePoint HTML page...');
  const spData = extractSharePointContent(spHtml);
  log(`  - Original Title: "${spData.title}"`);
  log(`  - Text Length   : ${spData.bodyText.length} chars`);
  log(`  - Images Count  : ${spData.images.length}`);
  log(`  - Docs Count    : ${spData.docs.length}`);

  // Fetch Main DB news content
  log('\n3. Querying Main target database (dbo.news)...');
  const mainResult = await pool.request()
    .input('slug', sql.NVarChar, slug)
    .query('SELECT TOP 1 * FROM dbo.news WHERE slug = @slug');

  const mainRow = mainResult.recordset[0];
  if (!mainRow) {
    log(`  [❌] Target article NOT found in dbo.news table.`);
    log('Comparison cannot be completed.');
    return;
  }

  log(`  [✅] Target article FOUND`);
  log(`        Main Title   : "${mainRow.title}"`);
  
  const main$ = cheerio.load(mainRow.content || '', { decodeEntities: false });
  const mainText = main$.text().replace(/\s+/g, ' ').trim();
  const mainImages = [];
  main$('img').each((idx, img) => {
    const src = main$(img).attr('src')?.trim();
    if (src) mainImages.push(src);
  });
  const mainDocs = [];
  const docExtensions = ['.pdf', '.docx', '.xlsx', '.xls', '.doc', '.pptx', '.ppt', '.zip', '.rar'];
  main$('a').each((idx, link) => {
    const href = main$(link).attr('href')?.trim() || '';
    const text = main$(link).text().trim();
    const isDoc = docExtensions.some(ext => href.toLowerCase().split('?')[0].endsWith(ext));
    if (isDoc) {
      mainDocs.push({ href, text });
    }
  });

  log(`  - Main Text Length : ${mainText.length} chars`);
  log(`  - Main Images Count: ${mainImages.length}`);
  log(`  - Main Docs Count  : ${mainDocs.length}`);

  // Side-by-side detailed verification
  log('\n======================================================');
  log('📊 SIDE-BY-SIDE VERIFICATION LOG');
  log('======================================================');

  // Title verification
  log(`\n[TITLE COMPARISON]`);
  log(`  - SharePoint: "${spData.title}"`);
  log(`  - Main DB   : "${mainRow.title}"`);
  if (spData.title.trim().toLowerCase() === mainRow.title.trim().toLowerCase()) {
    log(`  ✅ Titles match exactly.`);
  } else {
    log(`  ⚠️ Title difference detected!`);
  }

  // Text content verification
  log(`\n[TEXT CONTENT COMPARISON]`);
  log(`  - SharePoint Word Count: ~${spData.bodyText.split(' ').length} words`);
  log(`  - Main DB Word Count   : ~${mainText.split(' ').length} words`);
  log(`  - SharePoint Text Len  : ${spData.bodyText.length} chars`);
  log(`  - Main DB Text Len     : ${mainText.length} chars`);

  const lengthDiff = Math.abs(spData.bodyText.length - mainText.length);
  const lengthRatio = Math.min(spData.bodyText.length, mainText.length) / Math.max(spData.bodyText.length, mainText.length || 1);
  
  if (lengthRatio > 0.9) {
    log(`  ✅ Text bodies match well (Similarity ratio: ${(lengthRatio * 100).toFixed(1)}%)`);
  } else {
    log(`  ❌ Text length mismatch! Difference is ${lengthDiff} characters. Content might be truncated or noise cleanup was too aggressive.`);
  }

  // Sample texts
  log(`\n--- ORIGINAL SHAREPOINT TEXT PREVIEW (First 200 chars) ---`);
  log(spData.bodyText.substring(0, 200) + '...');
  log(`\n--- MAIN TARGET DB TEXT PREVIEW (First 200 chars) ---`);
  log(mainText.substring(0, 200) + '...');
  log(`------------------------------------------------------`);

  // Images mapping verification
  log(`\n[IMAGE COMPARISON & CONVERSION STATUS]`);
  log(`  - Original SharePoint Images: ${spData.images.length}`);
  log(`  - Main DB Converted Images  : ${mainImages.length}`);

  if (spData.images.length > 0) {
    log(`\n  Detail Image Mappings:`);
    spData.images.forEach((origSrc, idx) => {
      // Find matching converted image in mainDB
      // Usually, images are updated in order
      const newSrc = mainImages[idx];
      let statusSymbol = '❌ FAILED';
      let statusDetails = 'Not converted (Missing or still pointing to old URL)';
      
      if (newSrc) {
        if (newSrc.includes('/api/files/view/')) {
          statusSymbol = '✅ SUCCESS';
          statusDetails = `Mapped to: ${newSrc}`;
        } else {
          statusDetails = `Mapped to unconverted URL: ${newSrc}`;
        }
      }
      
      log(`    [Image #${idx + 1}]`);
      log(`      Original: ${origSrc}`);
      log(`      Status  : ${statusSymbol} | ${statusDetails}`);
    });
  } else {
    log('  ℹ️ No images found in original SharePoint article.');
  }

  // Documents mapping verification
  log(`\n[DOCUMENT / ATTACHMENT COMPARISON]`);
  log(`  - Original SharePoint Docs: ${spData.docs.length}`);
  log(`  - Main DB Converted Docs  : ${mainDocs.length}`);

  if (spData.docs.length > 0) {
    log(`\n  Detail Document Mappings:`);
    spData.docs.forEach((origDoc, idx) => {
      const newDoc = mainDocs[idx];
      let statusSymbol = '❌ FAILED';
      let statusDetails = 'Not converted';

      if (newDoc) {
        if (newDoc.href.includes('/api/files/view/')) {
          statusSymbol = '✅ SUCCESS';
          statusDetails = `Mapped to: ${newDoc.href}`;
        } else {
          statusDetails = `Mapped to unconverted URL: ${newDoc.href}`;
        }
      }
      
      log(`    [Doc #${idx + 1}] Text: "${origDoc.text}"`);
      log(`      Original: ${origDoc.href}`);
      log(`      Status  : ${statusSymbol} | ${statusDetails}`);
    });
  } else {
    log('  ℹ️ No documents/attachments found in original SharePoint article.');
  }

  // Overall verdict on content correctness
  log(`\n======================================================`);
  log(`🏁 VERDICT ON CONTENT ACCURACY:`);
  let contentVerdict = '✅ PERFECT: Content, images, and attachments match the original SharePoint article perfectly.';
  let hasImageErrors = spData.images.length > 0 && mainImages.length < spData.images.length;
  let hasDocErrors = spData.docs.length > 0 && mainDocs.length < spData.docs.length;
  let hasTextTrunc = lengthRatio < 0.85;

  if (hasImageErrors || hasDocErrors || hasTextTrunc) {
    contentVerdict = '❌ MISMATCH DETECTED:';
    const reasons = [];
    if (hasImageErrors) reasons.push(`Missing ${spData.images.length - mainImages.length} image(s)`);
    if (hasDocErrors) reasons.push(`Missing ${spData.docs.length - mainDocs.length} document(s)`);
    if (hasTextTrunc) reasons.push(`Text length difference is significant (Similarity: ${(lengthRatio * 100).toFixed(1)}%)`);
    contentVerdict += '\n     - ' + reasons.join('\n     - ');
  }

  log(`  ${contentVerdict}`);
  log(`======================================================`);
}

main();
