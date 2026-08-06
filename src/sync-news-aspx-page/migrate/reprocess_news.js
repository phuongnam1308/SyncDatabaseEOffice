const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const fs = require('fs');
const sql = require('mssql');
const axios = require('axios');
const https = require('https');
const cheerio = require('cheerio');
const { newDbConfig } = require('../../../config/database');
const FileUploadService = require('../../sync-file-copy/Fileuploadservice');

const projectRoot = path.resolve(__dirname, '../../../');
const logFilePath = path.join(projectRoot, 'reprocess_news.log');

// Initialize keycloak login/playwright env if needed
const { downloadFile } = require('../../sync-file-copy/SharePointAuthService');

// Helper to log to both console and log file
function log(msg = '') {
  console.log(msg);
  fs.appendFileSync(logFilePath, msg + '\n', 'utf-8');
}

// Global upload service
const fileUploadService = new FileUploadService();

async function main() {
  // Clear or initialize log file
  fs.writeFileSync(logFilePath, `=== NEWS REPROCESS AND REPAIR LOG - ${new Date().toISOString()} ===\n\n`, 'utf-8');

  log('======================================================');
  log('         🛠️  NEWS REPROCESS AND REPAIR TOOL           ');
  log('======================================================');

  // Command-line arguments
  const args = process.argv.slice(2);
  let slugArg = null;
  let repairIssues = false;
  let fileArg = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--slug' && args[i + 1]) {
      slugArg = args[i + 1].trim();
      i++;
    } else if (args[i] === '--repair-issues') {
      repairIssues = true;
    } else if (args[i] === '--file' && args[i + 1]) {
      fileArg = args[i + 1].trim();
      i++;
    }
  }

  if (!slugArg && !repairIssues && !fileArg) {
    log('❌ Error: Missing running mode arguments.');
    log('Usage:');
    log('  node src/sync-news-aspx-page/migrate/reprocess_news.js --slug <slug>');
    log('  node src/sync-news-aspx-page/migrate/reprocess_news.js --repair-issues');
    log('  node src/sync-news-aspx-page/migrate/reprocess_news.js --file <slugs_file.txt>');
    process.exit(1);
  }

  let pool = null;
  try {
    pool = await sql.connect(newDbConfig);
    log('✅ Connected to target database.');
    fileUploadService.fileModel.newPool = pool;
    fileUploadService.fileRelationsModel.newPool = pool;
  } catch (err) {
    log(`❌ Connection to database failed: ${err.message}`);
    process.exit(1);
  }

  try {
    let slugs = [];
    if (slugArg) {
      slugs = [slugArg];
    } else if (fileArg) {
      if (fs.existsSync(fileArg)) {
        slugs = fs.readFileSync(fileArg, 'utf-8')
          .split('\n')
          .map(s => s.trim())
          .filter(Boolean);
        log(`📂 Read ${slugs.length} slugs from file: ${fileArg}`);
      } else {
        log(`❌ Error: Slugs file not found: ${fileArg}`);
        process.exit(1);
      }
    } else if (repairIssues) {
      log('🔍 Finding articles with issues in target database...');
      // Query for articles with unconverted links, missing thumbnails, or empty content
      const query = `
        SELECT DISTINCT n.slug FROM dbo.news n
        WHERE n.content LIKE '%eoffice.saigonnewport.com.vn%'
           OR n.content LIKE '%10.1.253.41%'
           OR n.content LIKE '%/tintuc/Pictures%'
           OR n.content LIKE '%/tintuc/Pages%'
           OR n.content LIKE '%/tintuc/PagesDK%'
           OR n.nameThumbnail IS NULL
           OR n.nameThumbnail = ''
           OR n.nameThumbnail NOT LIKE '%/api/files/view/%'
           OR (
             n.nameThumbnail LIKE '%/api/files/view/%'
             AND NOT EXISTS (
               SELECT 1 FROM dbo.files f 
               WHERE n.nameThumbnail LIKE '%' + CAST(f.id AS VARCHAR(100)) + '%'
             )
           )
           OR n.content IS NULL
           OR DATALENGTH(n.content) < 100
      `;
      const result = await pool.request().query(query);
      slugs = result.recordset.map(row => row.slug);
      log(`🔎 Found ${slugs.length} articles with potential sync issues.`);
    }

    if (slugs.length === 0) {
      log('🎉 No articles found to process.');
      return;
    }

    let successCount = 0;
    let failCount = 0;
    const BATCH_SIZE = 20;
    const PAUSE_DELAY_MS = 5000;

    for (let idx = 0; idx < slugs.length; idx++) {
      const currentSlug = slugs[idx];
      log(`\n------------------------------------------------------`);
      log(`▶ [${idx + 1}/${slugs.length}] Processing: "${currentSlug}"`);
      log(`------------------------------------------------------`);

      try {
        const success = await reprocessArticle(pool, currentSlug);
        if (success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (err) {
        log(`❌ Error processing slug "${currentSlug}": ${err.message}`);
        failCount++;
      }

      // Nghỉ 3s sau mỗi đợt 100 bài viết
      if ((idx + 1) % BATCH_SIZE === 0 && idx + 1 < slugs.length) {
        log(`\n======================================================`);
        log(`⏳ Đã hoàn thành lô ${BATCH_SIZE} bài viết (${idx + 1}/${slugs.length}). Tạm dừng ${PAUSE_DELAY_MS / 1000}s trước khi tiếp tục...`);
        log(`======================================================`);
        await new Promise(resolve => setTimeout(resolve, PAUSE_DELAY_MS));
      }
    }

    log(`\n======================================================`);
    log('🏁 PROCESS COMPLETED');
    log(`  - Total processed : ${slugs.length}`);
    log(`  - Success count   : ${successCount}`);
    log(`  - Failure count   : ${failCount}`);
    log('======================================================');

  } catch (err) {
    log(`❌ Global Execution Error: ${err.message}`);
  } finally {
    if (pool) await pool.close();
    log(`\n📝 Detailed log written to: ${logFilePath}`);
    process.exit(0);
  }
}

// Main logic to reprocess a single article
async function reprocessArticle(pool, slug) {
  // 1. Get raw SharePoint details (either from DB metadata or try fetching directly)
  let docId = '9999';
  let fullPageUrl = `https://${process.env.SHAREPOINT_DOMAIN || 'eoffice.saigonnewport.com.vn'}/tintuc/Pages/${slug}.aspx`;

  const tempResult = await pool.request()
    .input('slug', sql.NVarChar, slug)
    .query('SELECT TOP 1 DocId, FullPageUrl FROM dbo.news_aspx_pages_temp WHERE LeafName = @slug + \'.aspx\' OR LeafName = @slug');

  if (tempResult.recordset.length > 0) {
    docId = tempResult.recordset[0].DocId || docId;
    fullPageUrl = tempResult.recordset[0].FullPageUrl || fullPageUrl;
  }

  // 2. Fetch original raw HTML from SharePoint (REST API first, fallback to HTTP page)
  let rawHtml = '';
  let spTitle = '';
  let spThumbnail = '';
  let spSummary = '';
  let isFromApi = false;

  const spApiItem = await fetchSharePointApiData(slug);
  if (spApiItem) {
    isFromApi = true;
    spTitle = spApiItem.Title || '';
    rawHtml = spApiItem.PublishingPageContent || spApiItem.Body || spApiItem.CanvasContent1 || '';

    // Extract thumbnail from Image_Roll or Image_Stand
    const imgHtml = spApiItem.Image_Roll || spApiItem.Image_Stand;
    if (imgHtml) {
      const match = imgHtml.match(/src=['"]([^'"]+)['"]/i);
      if (match && match[1]) {
        spThumbnail = match[1];
        if (!rawHtml.includes(spThumbnail)) {
          rawHtml = `<div class="general-image">${imgHtml}</div>` + rawHtml;
        }
      }
    }

    // Prepend description to content body if available
    const descriptionText = spApiItem.Description || spApiItem.Comments || spApiItem.PublishingImageCaption || spApiItem.SeoMetaDescription || '';
    if (descriptionText && descriptionText.length > 5) {
      const cleanDesc = descriptionText.replace(/\s+/g, ' ').trim();
      const plainContent = cheerio.load(rawHtml).text();
      if (!plainContent.includes(cleanDesc)) {
        rawHtml = `<div class="des">${descriptionText}</div>` + rawHtml;
      }
    }



    // Extract and clean summary (plain text only)
    let summarySource = spApiItem.PublishingImageCaption || spApiItem.SeoMetaDescription || '';
    if (!summarySource || summarySource.length < 5) {
      const temp$ = cheerio.load(rawHtml);
      summarySource = temp$.text().replace(/\s+/g, ' ').trim().substring(0, 300);
    } else {
      const temp$ = cheerio.load(summarySource);
      summarySource = temp$.text().replace(/\s+/g, ' ').trim();
    }
    spSummary = summarySource.substring(0, 300);
  } else {
    log(`  [🔄] REST API failed. Trying direct page download: ${fullPageUrl}`);
    try {
      const buffer = await downloadFile(fullPageUrl, pool);
      if (buffer && buffer.length > 0) {
        rawHtml = buffer.toString('utf-8');
        const extracted = extractContentFromPageHtml(rawHtml);
        spTitle = extracted.title;
        rawHtml = extracted.bodyHtml;
        spThumbnail = extracted.thumbnail || '';
        spSummary = extracted.summary || '';
      }
    } catch (dlErr) {
      log(`  [❌] Failed to download raw SharePoint page: ${dlErr.message}`);
    }
  }

  if (!rawHtml) {
    log('  ❌ Skip: Could not fetch original content from SharePoint (Cookie expired or page deleted).');
    return false;
  }

  log(`  - SharePoint Title: "${spTitle}"`);
  log(`  - Raw Text Length  : ${rawHtml.length} chars`);
  log(`  - Original Thumb   : ${spThumbnail || 'None'}`);

  // 3. Process Content Resources (Images, Links)
  log('  🔄 Processing content resources...');
  const $ = cheerio.load(rawHtml, { decodeEntities: false });
  const viewPrefix = (process.env.NEW_SYSTEM_VIEW_PREFIX || 'https://apigw-uat.snp.com.vn/doffice-be').replace(/\/$/, '');

  // A. Process Images
  const images = $('img');
  const processedImages = [];
  let firstImageId = null;

  for (let i = 0; i < images.length; i++) {
    const img = $(images[i]);
    const src = img.attr('src')?.trim();
    if (!src || src.startsWith('data:')) continue;

    const isAlreadyNew = src.includes('/api/files/view/');
    const oldServer = process.env.OLD_DB_SERVER || '10.1.253.41';
    const baseHost = (process.env.SHAREPOINT_DOMAIN || 'eoffice.saigonnewport.com.vn').replace(/https?:\/\//, '').split('/')[0];
    const isInternal = !src.startsWith('http') || src.includes(oldServer) || src.includes(baseHost) || src.includes('saigonnewport.com.vn');

    if (isInternal) {
      let finalNewSrc = null;

      if (isAlreadyNew) {
        // Verify if file actually exists in dbo.files
        const fileIdMatch = src.match(/\/api\/files\/view\/([a-f0-9-]+)/i);
        if (fileIdMatch && fileIdMatch[1]) {
          const fileId = fileIdMatch[1];
          const exists = await verifyFileExistsInDb(pool, fileId);
          if (exists) {
            log(`    [Image #${i + 1}] Already converted and verified in DB: ${fileId}`);
            finalNewSrc = src;
            if (!firstImageId) firstImageId = fileId;
          } else {
            log(`    [Image #${i + 1}] ⚠️ Mapped ID ${fileId} NOT found in dbo.files! Re-uploading...`);
          }
        }
      }

      if (!finalNewSrc) {
        // Need to download and upload
        let downloadUrl = src;
        if (!src.startsWith('http')) {
          const cleanPath = src.replace(/^\/+/, '');
          downloadUrl = `https://${baseHost}/${cleanPath}`;
        }

        log(`    [Image #${i + 1}] Downloading: ${downloadUrl}`);
        let buffer = findLocalAsset(slug, 'img', i);
        if (buffer) {
          log(`    [Image #${i + 1}] ℹ️ Found local copy in tintucraw/, skipping network download.`);
        } else {
          buffer = await downloadSharePointAsset(downloadUrl, pool);
          if (buffer) {
            saveAssetLocally(slug, 'img', i, path.basename(src.split('?')[0]), buffer);
          }
        }

        if (buffer) {
          const originalName = path.basename(src.split('?')[0]) || `img_${i}.png`;
          const sanitizedName = await sanitizeFileName(originalName, buffer);
          log(`    [File Info] Image #${i + 1} | Original Name: "${originalName}" | Sanitized Name: "${sanitizedName}" | Size: ${buffer.length} bytes`);

          const uploadRes = await fileUploadService.uploadToNewSystem({
            fileBuffer: buffer,
            originalName: sanitizedName,
            objectType: 'news',
            objectId: docId
          });

          if (uploadRes && uploadRes.id) {
            finalNewSrc = `${viewPrefix}/api/files/view/${uploadRes.id}`;
            log(`    [Image #${i + 1}] ✅ Uploaded successfully: ${finalNewSrc}`);
            if (!firstImageId) firstImageId = uploadRes.id;
          } else {
            log(`    [Image #${i + 1}] ❌ Upload failed. Response: ${JSON.stringify(uploadRes)}`);
          }
        } else {
          log(`    [Image #${i + 1}] ❌ Download failed.`);
        }
      }

      if (finalNewSrc) {
        img.attr('src', finalNewSrc);
        processedImages.push(finalNewSrc);
      }
    }
  }

  // B. Process Document Links
  const links = $('a');
  const docExtensions = ['.pdf', '.docx', '.xlsx', '.xls', '.doc', '.pptx', '.ppt', '.zip', '.rar'];

  for (let i = 0; i < links.length; i++) {
    const link = $(links[i]);
    const href = link.attr('href')?.trim();
    if (!href) continue;

    const isDoc = docExtensions.some(ext => href.toLowerCase().split('?')[0].endsWith(ext));
    if (!isDoc) continue;

    const isAlreadyNew = href.includes('/api/files/view/');
    const oldServer = process.env.OLD_DB_SERVER || '10.1.253.41';
    const baseHost = (process.env.SHAREPOINT_DOMAIN || 'eoffice.saigonnewport.com.vn').replace(/https?:\/\//, '').split('/')[0];
    const isInternal = !href.startsWith('http') || href.includes(oldServer) || href.includes(baseHost) || href.includes('saigonnewport.com.vn');

    if (isInternal) {
      let finalNewHref = null;

      if (isAlreadyNew) {
        const fileIdMatch = href.match(/\/api\/files\/view\/([a-f0-9-]+)/i);
        if (fileIdMatch && fileIdMatch[1]) {
          const fileId = fileIdMatch[1];
          const exists = await verifyFileExistsInDb(pool, fileId);
          if (exists) {
            log(`    [DocLink #${i + 1}] Already converted and verified in DB: ${fileId}`);
            finalNewHref = href;
          } else {
            log(`    [DocLink #${i + 1}] ⚠️ Mapped ID ${fileId} NOT found in dbo.files! Re-uploading...`);
          }
        }
      }

      if (!finalNewHref) {
        let downloadUrl = href;
        if (!href.startsWith('http')) {
          const cleanPath = href.replace(/^\/+/, '');
          downloadUrl = `https://${baseHost}/${cleanPath}`;
        }

        log(`    [DocLink #${i + 1}] Downloading document: ${downloadUrl}`);
        let buffer = findLocalAsset(slug, 'doc', i);
        if (buffer) {
          log(`    [DocLink #${i + 1}] ℹ️ Found local copy in tintucraw/, skipping network download.`);
        } else {
          buffer = await downloadSharePointAsset(downloadUrl, pool);
          if (buffer) {
            saveAssetLocally(slug, 'doc', i, path.basename(href.split('?')[0]), buffer);
          }
        }

        if (buffer) {
          const originalName = path.basename(href.split('?')[0]) || `file_${i}.pdf`;
          const sanitizedName = await sanitizeFileName(originalName, buffer);
          log(`    [File Info] DocLink #${i + 1} | Original Name: "${originalName}" | Sanitized Name: "${sanitizedName}" | Size: ${buffer.length} bytes`);

          const uploadRes = await fileUploadService.uploadToNewSystem({
            fileBuffer: buffer,
            originalName: sanitizedName,
            objectType: 'NEWS',
            objectId: docId
          });

          if (uploadRes && uploadRes.id) {
            finalNewHref = `${viewPrefix}/api/files/view/${uploadRes.id}`;
            log(`    [DocLink #${i + 1}] ✅ Uploaded successfully: ${finalNewHref}`);
          } else {
            log(`    [DocLink #${i + 1}] ❌ Upload failed. Response: ${JSON.stringify(uploadRes)}`);
          }
        } else {
          log(`    [DocLink #${i + 1}] ❌ Download failed.`);
        }
      }

      if (finalNewHref) {
        link.attr('href', finalNewHref);
      }
    }
  }

  // 4. Clean HTML entities (&#58; -> :)
  const bodyHtml = $('body').html() || $.html();
  const cleanedContent = bodyHtml.replace(/&#58;/g, ':');

  // 5. Process Thumbnail (outside content)
  let finalThumbnail = null;

  // Try querying current thumbnail from dbo.news
  const mainDbQuery = await pool.request()
    .input('slug', sql.NVarChar, slug)
    .query('SELECT nameThumbnail FROM dbo.news WHERE slug = @slug');

  const currentThumb = mainDbQuery.recordset[0]?.nameThumbnail || '';

  if (currentThumb && currentThumb.includes('/api/files/view/')) {
    const thumbIdMatch = currentThumb.match(/\/api\/files\/view\/([a-f0-9-]+)/i);
    if (thumbIdMatch && thumbIdMatch[1]) {
      const exists = await verifyFileExistsInDb(pool, thumbIdMatch[1]);
      if (exists) {
        finalThumbnail = currentThumb;
        log(`  🖼️ Current thumbnail is valid in DB.`);
      }
    }
  }

  if (!finalThumbnail && !spThumbnail && currentThumb && !currentThumb.includes('default')) {
    spThumbnail = currentThumb;
    log(`  🖼️ Using current DB nameThumbnail as download target: "${spThumbnail}"`);
  }

  if (!finalThumbnail && spThumbnail) {
    const oldServer = process.env.OLD_DB_SERVER || '10.1.253.41';
    const baseHost = (process.env.SHAREPOINT_DOMAIN || 'eoffice.saigonnewport.com.vn').replace(/https?:\/\//, '').split('/')[0];
    const isInternal = !spThumbnail.startsWith('http') || spThumbnail.includes(oldServer) || spThumbnail.includes(baseHost) || spThumbnail.includes('saigonnewport.com.vn') || spThumbnail.includes('/tintuc/');

    if (isInternal) {
      let downloadUrl = spThumbnail;
      if (!spThumbnail.startsWith('http')) {
        const cleanPath = spThumbnail.replace(/^\/+/, '');
        downloadUrl = `https://${baseHost}/${cleanPath}`;
      }

      log(`  🖼️ Downloading original thumbnail: ${downloadUrl}`);
      let buffer = findLocalAsset(slug, 'thumb', 0);
      if (buffer) {
        log(`  🖼️ ℹ️ Found local copy of thumbnail in tintucraw/, skipping network download.`);
      } else {
        buffer = await downloadSharePointAsset(downloadUrl, pool);
        if (buffer) {
          saveAssetLocally(slug, 'thumb', 0, path.basename(spThumbnail.split('?')[0]), buffer);
        }
      }

      if (buffer) {
        const originalName = path.basename(spThumbnail.split('?')[0]) || `thumb_${slug}.png`;
        const sanitizedName = await sanitizeFileName(originalName, buffer);
        log(`  🖼️ [File Info] Thumbnail | Original Name: "${originalName}" | Sanitized Name: "${sanitizedName}" | Size: ${buffer.length} bytes`);

        const uploadRes = await fileUploadService.uploadToNewSystem({
          fileBuffer: buffer,
          originalName: sanitizedName,
          objectType: 'news',
          objectId: docId
        });
        if (uploadRes && uploadRes.id) {
          finalThumbnail = `${viewPrefix}/api/files/view/${uploadRes.id}`;
          log(`  🖼️ ✅ Thumbnail uploaded successfully: ${finalThumbnail}`);
        } else {
          log(`  🖼️ ❌ Thumbnail upload failed. Response: ${JSON.stringify(uploadRes)}`);
        }
      }
    }
  }

  // Fallback to first image in content if thumbnail is empty or default
  if ((!finalThumbnail || finalThumbnail.includes('default')) && firstImageId) {
    finalThumbnail = `${viewPrefix}/api/files/view/${firstImageId}`;
    log(`  🖼️ ℹ️ Using first content image as thumbnail.`);
  }

  if (!finalThumbnail) {
    finalThumbnail = process.env.DEFAULT_NEWS_IMAGE || '';
  }

  // 6. DB Updates
  log('  💾 Updating database records...');

  // Extract pure File ID (GUID) for sizeSmall, sizeMedium, sizeBig fields
  let thumbnailFileId = null;
  if (finalThumbnail && finalThumbnail.includes('/api/files/view/')) {
    const thumbIdMatch = finalThumbnail.match(/\/api\/files\/view\/([a-f0-9-]+)/i);
    if (thumbIdMatch && thumbIdMatch[1]) {
      thumbnailFileId = thumbIdMatch[1];
    }
  }

  // A. Check if record exists in staging
  const stagingCheck = await pool.request()
    .input('slug', sql.NVarChar, slug)
    .query('SELECT 1 as found FROM dbo.news_aspx_new_sync WHERE slug = @slug');

  if (stagingCheck.recordset.length > 0) {
    const updateStaging = `
      UPDATE dbo.news_aspx_new_sync
      SET title = @title,
          summary = @summary,
          content = @content,
          nameThumbnail = @thumbnail,
          images = @images
      WHERE slug = @slug
    `;
    await pool.request()
      .input('title', sql.NVarChar, spTitle || slug)
      .input('summary', sql.NVarChar, spSummary)
      .input('content', sql.NVarChar, cleanedContent)
      .input('thumbnail', sql.NVarChar, finalThumbnail)
      .input('images', sql.NVarChar, processedImages.length > 0 ? JSON.stringify(processedImages) : null)
      .input('slug', sql.NVarChar, slug)
      .query(updateStaging);
    log('    - [STAGING] Record updated successfully.');
  }

  // B. Update main news table
  const mainCheck = await pool.request()
    .input('slug', sql.NVarChar, slug)
    .query('SELECT 1 as found FROM dbo.news WHERE slug = @slug');

  if (mainCheck.recordset.length > 0) {
    const updateMain = `
      UPDATE dbo.news
      SET title = @title,
          summary = @summary,
          content = @content,
          nameThumbnail = @thumbnail,
          sizeSmall = @thumbnailFileId,
          sizeMedium = @thumbnailFileId,
          sizeBig = @thumbnailFileId
      WHERE slug = @slug
    `;
    await pool.request()
      .input('title', sql.NVarChar, spTitle || slug)
      .input('summary', sql.NVarChar, spSummary)
      .input('content', sql.NVarChar, cleanedContent)
      .input('thumbnail', sql.NVarChar, finalThumbnail)
      .input('thumbnailFileId', sql.NVarChar, thumbnailFileId)
      .input('slug', sql.NVarChar, slug)
      .query(updateMain);
    log('    - [MAIN NEWS] Record updated successfully.');
    return true;
  } else {
    log('    - ⚠️ Warning: Record does not exist in main news table, skipping main news update.');
    return false;
  }
}

// Fetch raw article JSON from SharePoint REST API
async function fetchSharePointApiData(slug) {
  const domain = process.env.SHAREPOINT_DOMAIN || 'eoffice.saigonnewport.com.vn';
  const baseUrl = `https://${domain}/tintuc`;
  const listName = 'Pages';
  const leafName = slug.endsWith('.aspx') ? slug : `${slug}.aspx`;
  const apiUrl = `${baseUrl}/_api/web/lists/getbytitle('${listName}')/items?$filter=FileLeafRef eq '${leafName}'`;

  let cookie = '';
  const cookiePath = path.join(projectRoot, 'auth', 'cookie.txt');
  if (fs.existsSync(cookiePath)) {
    cookie = fs.readFileSync(cookiePath, 'utf8').trim();
  }

  const httpsAgent = new https.Agent({ rejectUnauthorized: false });

  try {
    const response = await axios.get(apiUrl, {
      httpsAgent,
      headers: {
        'Accept': 'application/json;odata=verbose',
        'Cookie': cookie
      },
      timeout: 10000
    });

    const items = response.data?.d?.results;
    if (items && items.length > 0) {
      return items[0];
    }
    return null;
  } catch (err) {
    return null;
  }
}

// Extract content from page HTML
function extractContentFromPageHtml(html) {
  const $ = cheerio.load(html, { decodeEntities: false });

  let title = $('meta[property="og:title"]').attr('content') ||
    $('h1').first().text().trim() ||
    $('#DeltaPlaceHolderPageTitleInTitleArea').text().trim() ||
    '';

  let thumbnail = $('meta[property="og:image"]').attr('content') || '';

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

  // Gộp mô tả (.des) và ảnh đại diện ngoài (.tbimg-news, .general-image) vào nội dung
  let cleanContainer = $('<div>');
  
  const desBlock = $('.des').first();
  if (desBlock.length && contentContainer.length && !contentContainer.has(desBlock).length) {
    cleanContainer.append(desBlock.clone());
  }

  const topImgTable = $('.tbimg-news, .general-image').first();
  if (topImgTable.length && contentContainer.length && !contentContainer.has(topImgTable).length) {
    cleanContainer.append(topImgTable.clone());
  }

  cleanContainer.append(contentContainer.clone());

  const blocksToRemove = [
    '#s4-ribbonrow', '#suiteBarDelta', '#s4-titlerow', '#sideNavBox', '#footer',
    '.ms-breadcrumb', '.ms-core-listMenu-verticalBox', '.ms-pub-breadcrumb',
    '.ms-belltown-sideNav', '#DeltaPlaceHolderLeftNavBar', '#DeltaPlaceHolderPageTitleInTitleArea',
    'script', 'style', 'link', 'iframe', 'object', 'embed', '.other-news',
    '.feedbackSend', '.feedback', '.Title', '.subtitle', '.linkadmin',
    '.link-banner', '.menu-cover'
  ];
  blocksToRemove.forEach(sel => cleanContainer.find(sel).remove());

  const bodyHtml = cleanContainer.html() || '';

  // Extract summary (only plain text, no HTML tags)
  let summary = $('.des').first().text().trim() || '';
  if (!summary || summary.length < 5) {
    const temp$ = cheerio.load(bodyHtml);
    summary = temp$.text().replace(/\s+/g, ' ').trim().substring(0, 300);
  } else {
    const temp$ = cheerio.load(summary);
    summary = temp$.text().replace(/\s+/g, ' ').trim();
  }
  if (summary.length > 300) {
    summary = summary.substring(0, 300);
  }

  return {
    title,
    thumbnail,
    bodyHtml,
    summary
  };
}

// Sanitize file name for new API gateway
async function sanitizeFileName(filename, buffer) {
  let cleanName = filename;
  try {
    cleanName = decodeURIComponent(filename);
  } catch (_) {}

  // Replace invalid characters like spaces, commas, percents etc.
  cleanName = cleanName.replace(/[,;%#~*?"'<>|\s]/g, '_');

  // Detect extension using file-type from buffer
  let ext = '';
  try {
    const FileType = require('file-type');
    const typeInfo = await FileType.fromBuffer(buffer);
    if (typeInfo && typeInfo.ext) {
      ext = '.' + typeInfo.ext;
    }
  } catch (_) {}

  const currentExt = path.extname(cleanName);
  const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.rar'];

  if (!validExtensions.includes(currentExt.toLowerCase())) {
    const baseName = path.basename(cleanName, currentExt);
    if (ext) {
      const cleanExt = ext.replace('.', '');
      // If the baseName has an ending like "_jpg" or "_png", replace it
      const regex = new RegExp(`_${cleanExt}$`, 'i');
      if (regex.test(baseName)) {
        cleanName = baseName.replace(regex, '') + ext;
      } else {
        cleanName = baseName + ext;
      }
    } else {
      cleanName = baseName + '.png';
    }
  }

  return cleanName;
}

// Check and read local files
function findLocalAsset(slug, type, index) {
  try {
    const subFolder = path.join(projectRoot, 'tintucraw/tintuc/img', slug);
    if (!fs.existsSync(subFolder)) return null;

    const files = fs.readdirSync(subFolder);
    let pattern;
    if (type === 'thumb') {
      pattern = new RegExp(`^${escapeRegExp(slug)}_thumb_`);
    } else if (type === 'doc') {
      pattern = new RegExp(`^${escapeRegExp(slug)}_doc_${index}_`);
    } else {
      pattern = new RegExp(`^${escapeRegExp(slug)}_${index}_`);
    }

    const found = files.find((f) => pattern.test(f));
    if (found) {
      const fullPath = path.join(subFolder, found);
      return fs.readFileSync(fullPath);
    }
  } catch (_) {}
  return null;
}

// Save copies of downloaded assets locally
function saveAssetLocally(slug, type, index, filename, buffer) {
  try {
    const subFolder = path.join(projectRoot, 'tintucraw/tintuc/img', slug);
    if (!fs.existsSync(subFolder)) {
      fs.mkdirSync(subFolder, { recursive: true });
    }

    let cleanName = filename;
    try {
      cleanName = decodeURIComponent(filename);
    } catch (_) {}
    cleanName = cleanName.replace(/[,;%#~*?"'<>|\s]/g, '_');

    let localName = '';
    if (type === 'thumb') {
      localName = `${slug}_thumb_${cleanName}`;
    } else if (type === 'doc') {
      localName = `${slug}_doc_${index}_${cleanName}`;
    } else {
      localName = `${slug}_${index}_${cleanName}`;
    }

    const localFilePath = path.join(subFolder, localName);
    fs.writeFileSync(localFilePath, buffer);
    log(`    [Local Save] Saved copy of asset to: ${localFilePath}`);
  } catch (err) {
    log(`    [Local Save Warning] Failed to save copy locally: ${err.message}`);
  }
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Verify if a file exists in dbo.files
async function verifyFileExistsInDb(pool, fileId) {
  try {
    const result = await pool.request()
      .input('id', sql.NVarChar, fileId)
      .query('SELECT 1 as found FROM dbo.files WHERE id = @id');
    return result.recordset.length > 0;
  } catch (err) {
    return false;
  }
}

// Helper to resolve original image URL from SharePoint thumbnail URL
function getOriginalSharePointImageUrl(url) {
  if (!url) return url;
  let original = url.replace(/\/_w\//i, '/').replace(/\/_t\//i, '/');
  const parts = original.split('/');
  const filename = parts[parts.length - 1];
  const match = filename.match(/(.+)_([a-zA-Z0-9]+)\.([a-zA-Z0-9]+)$/);
  if (match) {
    const baseName = match[1];
    const origExt = match[2];
    const currentExt = match[3];
    if (origExt.toLowerCase() === currentExt.toLowerCase()) {
      parts[parts.length - 1] = `${baseName}.${origExt}`;
      original = parts.join('/');
    }
  }
  return original;
}

// Download asset from SharePoint (handle cookie auth)
async function downloadSharePointAsset(assetUrl, pool) {
  let urlToDownload = assetUrl;

  // Convert http to https to prevent redirect-ssl agent drop issues in axios
  if (urlToDownload.startsWith('http://saigonnewport.com.vn') || urlToDownload.startsWith('http://eoffice.saigonnewport.com.vn')) {
    urlToDownload = urlToDownload.replace('http://', 'https://');
  }

  // Proper URI encoding for Unicode characters and spaces
  try {
    urlToDownload = encodeURI(decodeURIComponent(urlToDownload));
  } catch (_) {
    urlToDownload = encodeURI(urlToDownload);
  }

  let buffer = await _tryDownloadAsset(urlToDownload, pool);
  if (buffer) return buffer;

  // Fallback: If thumbnail download failed, try to download the original image
  if (urlToDownload.includes('/_w/') || urlToDownload.includes('/_t/')) {
    const originalUrl = getOriginalSharePointImageUrl(urlToDownload);
    if (originalUrl !== urlToDownload) {
      log(`    [Download Fallback] Thumbnail failed (404). Trying original image: ${originalUrl}`);
      buffer = await _tryDownloadAsset(originalUrl, pool);
      if (buffer) return buffer;
    }
  }

  log(`    [Download Warning] Failed downloading ${urlToDownload}`);
  return null;
}

async function _tryDownloadAsset(url, pool) {
  try {
    const buffer = await downloadFile(url, pool);
    if (buffer && buffer.length > 0) return buffer;
  } catch (err) {
    // Fallback to axios
  }

  try {
    let cookie = '';
    const cookiePath = path.join(projectRoot, 'auth', 'cookie.txt');
    if (fs.existsSync(cookiePath)) {
      cookie = fs.readFileSync(cookiePath, 'utf8').trim();
    }
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });
    const response = await axios.get(url, {
      httpsAgent,
      headers: { 'Cookie': cookie },
      responseType: 'arraybuffer',
    });
    if (response.status === 200) {
      return Buffer.from(response.data);
    }
  } catch (err) {
    // Silent fail for single try
  }
  return null;
}

main();
