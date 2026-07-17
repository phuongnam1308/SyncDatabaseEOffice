const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const fs = require('fs');
const sql = require('mssql');
const cheerio = require('cheerio');
const { newDbConfig } = require('../../config/database');

const projectRoot = path.resolve(__dirname, '../../');
const logFilePath = path.join(projectRoot, 'verify_news_sync.log');

// Helper to log to both console and log file
function log(msg = '') {
  console.log(msg);
  fs.appendFileSync(logFilePath, msg + '\n', 'utf-8');
}

async function main() {
  // Clear or initialize log file
  fs.writeFileSync(logFilePath, `=== NEWS SYNC VERIFICATION LOG - ${new Date().toISOString()} ===\n\n`, 'utf-8');

  log('======================================================');
  log('         🎛️  NEWS SYNCHRONIZATION AUDIT TOOL          ');
  log('======================================================');

  const slug = process.argv[2];

  let pool = null;
  try {
    pool = await sql.connect(newDbConfig);
    log('✅ Connected to target database.');
  } catch (err) {
    log(`❌ Cannot connect to Target Database: ${err.message}`);
    process.exit(1);
  }

  try {
    if (!slug) {
      await showGeneralAudit(pool);
    } else {
      await showDetailedSlugAudit(pool, slug.trim());
    }
  } catch (err) {
    log(`❌ Error during execution: ${err.message}`);
    if (err.stack) {
      fs.appendFileSync(logFilePath, err.stack + '\n', 'utf-8');
    }
  } finally {
    if (pool) await pool.close();
    log('\n======================================================');
    log(`📝 Log file successfully written to: ${logFilePath}`);
    log('======================================================');
    process.exit(0);
  }
}

async function showGeneralAudit(pool) {
  log('📊 STATUS: RUNNING GENERAL AUDIT...');
  log('------------------------------------------------------');

  // 1. Get counts
  const countStagingResult = await pool.request().query('SELECT COUNT(*) as count FROM dbo.news_aspx_new_sync');
  const countMainResult = await pool.request().query('SELECT COUNT(*) as count FROM dbo.news');
  
  const countOldLinksResult = await pool.request().query(`
    SELECT COUNT(*) as count FROM dbo.news 
    WHERE content LIKE '%eoffice.saigonnewport.com.vn%' 
       OR content LIKE '%10.1.253.41%' 
       OR content LIKE '%/tintuc/Pictures%'
       OR content LIKE '%/tintuc/Pages%'
  `);
  
  const countNoThumbnailResult = await pool.request().query(`
    SELECT COUNT(*) as count FROM dbo.news 
    WHERE nameThumbnail IS NULL 
       OR nameThumbnail = '' 
       OR nameThumbnail LIKE '%default%'
  `);

  const countEmptyContentResult = await pool.request().query(`
    SELECT COUNT(*) as count FROM dbo.news 
    WHERE content IS NULL OR DATALENGTH(content) < 100
  `);

  log(`• Staging News (dbo.news_aspx_new_sync) : ${countStagingResult.recordset[0].count} articles`);
  log(`• Main News (dbo.news)                  : ${countMainResult.recordset[0].count} articles`);
  log(`------------------------------------------------------`);
  log(`⚠️ Issues found in Main News (dbo.news):`);
  log(`  - With unconverted old links/images : ${countOldLinksResult.recordset[0].count} articles`);
  log(`  - With missing/default thumbnails   : ${countNoThumbnailResult.recordset[0].count} articles`);
  log(`  - With empty/extremely short content: ${countEmptyContentResult.recordset[0].count} articles`);
  log('------------------------------------------------------');

  // List 15 articles with issues
  const queryIssues = `
    SELECT TOP 15 id, slug, title, nameThumbnail, publishedAt,
           CASE 
             WHEN content LIKE '%eoffice.saigonnewport.com.vn%' OR content LIKE '%10.1.253.41%' OR content LIKE '%/tintuc/%' THEN 1 
             ELSE 0 
           END as hasOldLinks,
           CASE 
             WHEN nameThumbnail IS NULL OR nameThumbnail = '' OR nameThumbnail LIKE '%default%' THEN 1 
             ELSE 0 
           END as hasBadThumb,
           CASE
             WHEN content IS NULL OR DATALENGTH(content) < 100 THEN 1
             ELSE 0
           END as hasBadContent
    FROM dbo.news
    WHERE content LIKE '%eoffice.saigonnewport.com.vn%' 
       OR content LIKE '%10.1.253.41%' 
       OR content LIKE '%/tintuc/%'
       OR nameThumbnail IS NULL 
       OR nameThumbnail = '' 
       OR nameThumbnail LIKE '%default%'
       OR content IS NULL 
       OR DATALENGTH(content) < 100
    ORDER BY publishedAt DESC
  `;

  const issuesResult = await pool.request().query(queryIssues);
  if (issuesResult.recordset.length > 0) {
    log('List of 15 recently synchronized articles with issues:');
    log('------------------------------------------------------');
    issuesResult.recordset.forEach((row, index) => {
      let statusStr = [];
      if (row.hasOldLinks) statusStr.push('❌ Old Links');
      if (row.hasBadThumb) statusStr.push('⚠️ Missing Thumb');
      if (row.hasBadContent) statusStr.push('❌ Short Content');

      log(`[${index + 1}] ${row.title.substring(0, 70)}...`);
      log(`    Slug  : ${row.slug}`);
      log(`    Status: ${statusStr.join(' | ')}`);
      log(`    Date  : ${row.publishedAt ? new Date(row.publishedAt).toISOString().split('T')[0] : 'N/A'}`);
      log('');
    });
  } else {
    log('🎉 No obvious issues found in main news!');
  }

  log('------------------------------------------------------');
  log('💡 How to deep-check a specific article:');
  log('   node src/sync-news-aspx-page/verify_news_sync.js <slug>');
  log('======================================================');
}

async function showDetailedSlugAudit(pool, slug) {
  log(`📊 STATUS: RUNNING DETAILED AUDIT FOR SLUG: "${slug}"`);
  log('------------------------------------------------------');

  const aspxPath = path.join(projectRoot, 'tintucraw/tintuc/Pages', `${slug}.aspx`);
  const jsonPath = path.join(projectRoot, 'tintucraw/tintuc/json_output', `${slug}.json`);

  log('📁 LOCAL ASSETS:');
  if (fs.existsSync(aspxPath)) {
    const stat = fs.statSync(aspxPath);
    log(`  [✅] Raw ASPX File  : Found (${stat.size} bytes)`);
    log(`        Path          : ${aspxPath}`);
  } else {
    log(`  [❌] Raw ASPX File  : NOT FOUND`);
  }

  let localJsonData = null;
  if (fs.existsSync(jsonPath)) {
    const stat = fs.statSync(jsonPath);
    log(`  [✅] Parsed JSON    : Found (${stat.size} bytes)`);
    try {
      localJsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      log(`        Title in JSON : ${localJsonData.title}`);
      log(`        Images in JSON: ${localJsonData.images ? localJsonData.images.length : 0}`);
    } catch (_) {
      log(`        [❌] Parse JSON error!`);
    }
  } else {
    log(`  [❌] Parsed JSON    : NOT FOUND`);
  }
  log('------------------------------------------------------');

  log('🗄️ DATABASE RECORDS:');
  const stagingResult = await pool.request()
    .input('slug', sql.NVarChar, slug)
    .query('SELECT * FROM dbo.news_aspx_new_sync WHERE slug = @slug');

  const mainResult = await pool.request()
    .input('slug', sql.NVarChar, slug)
    .query('SELECT * FROM dbo.news WHERE slug = @slug');

  const stagingRow = stagingResult.recordset[0];
  const mainRow = mainResult.recordset[0];

  if (stagingRow) {
    log(`  [✅] Staging Table (news_aspx_new_sync): FOUND`);
    log(`        Staging Title: ${stagingRow.title}`);
    log(`        Staging Topic: ${stagingRow.topic}`);
    log(`        Thumbnail URL: ${stagingRow.nameThumbnail || 'N/A'}`);
    log(`        Images Field : ${stagingRow.images ? JSON.parse(stagingRow.images).length : 0} items`);
    log(`        Status       : ${stagingRow.isActive ? 'Active' : 'Inactive'}`);
  } else {
    log(`  [❌] Staging Table (news_aspx_new_sync): NOT FOUND`);
  }

  if (mainRow) {
    log(`  [✅] Main Table (news): FOUND`);
    log(`        Main Title   : ${mainRow.title}`);
    log(`        Main Topic ID: ${mainRow.topic}`);
    log(`        Thumbnail URL: ${mainRow.nameThumbnail || 'N/A'}`);
    log(`        Author ID    : ${mainRow.authorId}`);
    log(`        Status       : ${mainRow.status === 1 ? 'Published (1)' : 'Draft (0)'}`);
    log(`        Published At : ${mainRow.publishedAt ? new Date(mainRow.publishedAt).toISOString() : 'N/A'}`);
  } else {
    log(`  [❌] Main Table (news): NOT FOUND`);
  }
  log('------------------------------------------------------');

  if (!mainRow) {
    log('❌ Cannot proceed with content analysis: Article not found in news table.');
    return;
  }

  log('📝 CONTENT ANALYSIS (Images & Documents in HTML body):');
  const content = mainRow.content || '';
  if (!content) {
    log('  [❌] Content body is empty or null!');
    return;
  }

  const $ = cheerio.load(content, { decodeEntities: false });
  const images = $('img');
  log(`  Total images found in body: ${images.length}`);

  const convertedImages = [];
  const oldImages = [];
  const otherImages = [];
  const fileIdsToCheck = [];

  images.each((idx, img) => {
    const src = $(img).attr('src')?.trim();
    if (!src) {
      otherImages.push({ index: idx, src: '(empty/null)' });
      return;
    }
    
    // Check if new system prefix
    const isNew = src.includes('/api/files/view/');
    const isOld = src.includes('eoffice.saigonnewport.com.vn') || src.includes('10.1.253.41') || src.includes('/tintuc/Pictures/') || src.includes('/tintuc/Lists/');

    if (isNew) {
      convertedImages.push({ index: idx, src });
      const fileIdMatch = src.match(/\/api\/files\/view\/([a-f0-9-]+)/i);
      if (fileIdMatch && fileIdMatch[1]) {
        fileIdsToCheck.push({ index: idx, id: fileIdMatch[1], type: 'Image' });
      }
    } else if (isOld) {
      oldImages.push({ index: idx, src });
    } else {
      otherImages.push({ index: idx, src });
    }
  });

  log(`  - Converted  : ${convertedImages.length} image(s)`);
  log(`  - Unconverted: ${oldImages.length} image(s)`);
  if (otherImages.length > 0) {
    log(`  - Other/Empty: ${otherImages.length} image(s)`);
  }

  if (oldImages.length > 0) {
    log(`\n  ⚠️ List of unconverted images (still using old SharePoint links):`);
    oldImages.forEach((img) => {
      log(`    [#${img.index + 1}] src="${img.src}"`);
    });
  }

  // Check document links
  const links = $('a');
  const docExtensions = ['.pdf', '.docx', '.xlsx', '.xls', '.doc', '.pptx', '.ppt', '.zip', '.rar'];
  const docLinks = [];
  
  links.each((idx, link) => {
    const href = $(link).attr('href')?.trim() || '';
    const text = $(link).text().trim();
    const isDoc = docExtensions.some(ext => href.toLowerCase().split('?')[0].endsWith(ext));
    if (isDoc) {
      const isNew = href.includes('/api/files/view/');
      const isOld = href.includes('eoffice.saigonnewport.com.vn') || href.includes('10.1.253.41') || href.includes('/tintuc/');
      
      let status = 'OTHER';
      if (isNew) {
        status = 'CONVERTED';
        const fileIdMatch = href.match(/\/api\/files\/view\/([a-f0-9-]+)/i);
        if (fileIdMatch && fileIdMatch[1]) {
          fileIdsToCheck.push({ index: idx, id: fileIdMatch[1], type: 'Document', text });
        }
      } else if (isOld) {
        status = 'OLD';
      }

      docLinks.push({
        index: idx,
        href,
        text,
        status
      });
    }
  });

  if (docLinks.length > 0) {
    log(`\n  Total document links found: ${docLinks.length}`);
    const convertedDocs = docLinks.filter(d => d.status === 'CONVERTED');
    const oldDocs = docLinks.filter(d => d.status === 'OLD');

    log(`  - Converted  : ${convertedDocs.length} link(s)`);
    log(`  - Unconverted: ${oldDocs.length} link(s)`);

    if (oldDocs.length > 0) {
      log(`\n  ⚠️ List of unconverted document links (still using old SharePoint links):`);
      oldDocs.forEach((doc) => {
        log(`    [#${doc.index + 1}] Text: "${doc.text}" | href="${doc.href}"`);
      });
    }
  }

  // Check files table existence for converted images/documents
  if (fileIdsToCheck.length > 0) {
    log('\n------------------------------------------------------');
    log('🔍 FILE INTEGRITY CHECK (Verifying files exist in dbo.files):');
    const ids = fileIdsToCheck.map(f => `'${f.id}'`).join(',');
    
    try {
      const filesResult = await pool.request().query(`
        SELECT id, name, file_type, storage_path 
        FROM dbo.files 
        WHERE id IN (${ids})
      `);

      const foundFilesMap = {};
      filesResult.recordset.forEach(f => {
        foundFilesMap[f.id.toString().toLowerCase()] = f;
      });

      fileIdsToCheck.forEach(item => {
        const fileRecord = foundFilesMap[item.id.toLowerCase()];
        if (fileRecord) {
          log(`  [✅] ${item.type} #${item.index + 1} (ID: ${item.id}) - Exists`);
          log(`        Filename    : ${fileRecord.name}`);
          log(`        Storage Path: ${fileRecord.storage_path || 'N/A'}`);
        } else {
          log(`  [❌] ${item.type} #${item.index + 1} (ID: ${item.id}) - NOT FOUND IN dbo.files!`);
        }
      });
    } catch (dbErr) {
      log(`  [⚠️] Error querying dbo.files table: ${dbErr.message}`);
    }
  }

  // Check thumbnail file integrity
  if (mainRow.nameThumbnail && mainRow.nameThumbnail.includes('/api/files/view/')) {
    const thumbIdMatch = mainRow.nameThumbnail.match(/\/api\/files\/view\/([a-f0-9-]+)/i);
    if (thumbIdMatch && thumbIdMatch[1]) {
      const thumbId = thumbIdMatch[1];
      try {
        const thumbResult = await pool.request()
          .input('thumbId', sql.NVarChar, thumbId)
          .query('SELECT name, storage_path FROM dbo.files WHERE id = @thumbId');
        
        log('\n------------------------------------------------------');
        log('🖼️ THUMBNAIL INTEGRITY:');
        if (thumbResult.recordset.length > 0) {
          log(`  [✅] Thumbnail file (ID: ${thumbId}) exists in database.`);
          log(`        Filename    : ${thumbResult.recordset[0].name}`);
          log(`        Storage Path: ${thumbResult.recordset[0].storage_path || 'N/A'}`);
        } else {
          log(`  [❌] Thumbnail file (ID: ${thumbId}) NOT FOUND IN dbo.files!`);
        }
      } catch (dbErr) {
        log(`  [⚠️] Error querying thumbnail in dbo.files: ${dbErr.message}`);
      }
    }
  } else if (!mainRow.nameThumbnail || mainRow.nameThumbnail.includes('default') || mainRow.nameThumbnail === '') {
    log('\n------------------------------------------------------');
    log('🖼️ THUMBNAIL INTEGRITY:');
    log(`  [⚠️] Thumbnail is empty or using default fallback: "${mainRow.nameThumbnail || 'N/A'}"`);
  }

  // Summary Verdict
  log('\n======================================================');
  log('🏁 VERDICT / CONCLUSION:');
  let verdict = '✅ PERFECT: Everything looks clean, images and attachments are fully migrated.';
  let hasErrors = false;

  if (oldImages.length > 0 || docLinks.some(d => d.status === 'OLD')) {
    verdict = '❌ INCOMPLETE: There are still links pointing to the old SharePoint site.';
    hasErrors = true;
  }
  
  if (!hasErrors && (!mainRow.nameThumbnail || mainRow.nameThumbnail.includes('default'))) {
    verdict = '⚠️ WARNING: Sync is mostly good, but the thumbnail is using a default image.';
  }

  log(`  ${verdict}`);
  log('======================================================');
}

main();
