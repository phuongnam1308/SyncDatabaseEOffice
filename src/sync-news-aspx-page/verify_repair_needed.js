const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const fs = require('fs');
const sql = require('mssql');
const cheerio = require('cheerio');
const { newDbConfig } = require('../../config/database');

const projectRoot = path.resolve(__dirname, '../../');
const logFilePath = path.join(projectRoot, 'verify_repair_needed.log');
const outputFileSlugsPath = path.join(projectRoot, 'reprocess_slugs.txt');

function log(msg = '') {
  console.log(msg);
  fs.appendFileSync(logFilePath, msg + '\n', 'utf-8');
}

async function main() {
  fs.writeFileSync(logFilePath, `=== VERIFY AND DETECT NEWS REPROCESS NEEDED LOG - ${new Date().toISOString()} ===\n\n`, 'utf-8');

  log('======================================================');
  log('   🔍  NEWS VERIFICATION & DEFICIENCY DETECTION TOOL ');
  log('======================================================\n');

  let pool = null;
  try {
    pool = await sql.connect(newDbConfig);
    log('✅ Connected to target database.');
  } catch (err) {
    log(`❌ Connection to database failed: ${err.message}`);
    process.exit(1);
  }

  try {
    // 1. Get total count of news
    const countResult = await pool.request().query('SELECT COUNT(*) as total FROM dbo.news');
    const totalCount = countResult.recordset[0].total;
    log(`🔎 Total articles found in dbo.news: ${totalCount}`);

    const issueSlugs = new Set();
    const issueDetails = [];

    // Pre-cache all valid file IDs in dbo.files for fast checking
    log('📂 Caching valid file IDs from dbo.files...');
    const fileResult = await pool.request().query('SELECT id FROM dbo.files');
    const validFileIds = new Set(fileResult.recordset.map(row => String(row.id)));
    log(`  - Total valid files in dbo.files: ${validFileIds.size}`);

    const BATCH_SIZE = 500;
    let offset = 0;

    log(`\n🔍 Auditing articles in streamed batches of ${BATCH_SIZE}...`);

    while (offset < totalCount) {
      log(`▶ Auditing batch [${offset + 1} - ${Math.min(offset + BATCH_SIZE, totalCount)}] / ${totalCount}...`);

      const batchResult = await pool.request()
        .input('offset', sql.Int, offset)
        .input('batchSize', sql.Int, BATCH_SIZE)
        .query(`
          SELECT id, title, slug, nameThumbnail, sizeSmall, sizeMedium, sizeBig, content, DATALENGTH(content) as contentLength 
          FROM dbo.news
          ORDER BY id
          OFFSET @offset ROWS FETCH NEXT @batchSize ROWS ONLY
        `);

      const batchNews = batchResult.recordset;

      for (let idx = 0; idx < batchNews.length; idx++) {
        const article = batchNews[idx];
        const reasons = [];

        // A. Check Content Length / NULL
        if (!article.content || article.contentLength < 100) {
          reasons.push('Nội dung quá ngắn hoặc NULL');
        }

        // B. Check Unconverted Old Links in Content
        if (article.content) {
          const oldLinkPatterns = ['eoffice.saigonnewport.com.vn', '10.1.253.41', '/tintuc/Pictures', '/tintuc/Pages', '/tintuc/PagesDK'];
          for (const pat of oldLinkPatterns) {
            if (article.content.includes(pat)) {
              reasons.push(`Nội dung còn dính link cũ (${pat})`);
              break;
            }
          }
        }

        // C. Check Thumbnail (nameThumbnail)
        const thumb = article.nameThumbnail || '';
        if (!thumb || thumb === '' || thumb.includes('default')) {
          reasons.push('Thiếu ảnh đại diện (trống hoặc default)');
        } else if (thumb.includes('eoffice') || thumb.includes('10.1.253.41') || thumb.includes('/tintuc/')) {
          reasons.push('Ảnh đại diện vẫn chứa link SharePoint cũ');
        } else if (thumb.includes('/api/files/view/')) {
          const thumbIdMatch = thumb.match(/\/api\/files\/view\/([a-f0-9-]+)/i);
          if (thumbIdMatch && thumbIdMatch[1]) {
            if (!validFileIds.has(thumbIdMatch[1])) {
              reasons.push(`Ảnh đại diện ID ${thumbIdMatch[1]} không tồn tại trong dbo.files`);
            }
          } else {
            reasons.push('Ảnh đại diện định dạng API sai');
          }
        }

        // D. Check Images in Content
        if (article.content) {
          const $ = cheerio.load(article.content, { decodeEntities: false });
          const images = $('img');
          for (let i = 0; i < images.length; i++) {
            const src = $(images[i]).attr('src')?.trim();
            if (src && src.includes('/api/files/view/')) {
              const imgIdMatch = src.match(/\/api\/files\/view\/([a-f0-9-]+)/i);
              if (imgIdMatch && imgIdMatch[1] && !validFileIds.has(imgIdMatch[1])) {
                reasons.push(`Ảnh trong bài ID ${imgIdMatch[1]} không tồn tại trong dbo.files`);
                break;
              }
            }
          }

          // E. Check Document links in Content
          const docExts = ['.pdf', '.docx', '.xlsx', '.xls', '.doc', '.pptx', '.ppt', '.zip', '.rar'];
          const links = $('a');
          for (let i = 0; i < links.length; i++) {
            const href = $(links[i]).attr('href')?.trim();
            if (!href) continue;
            const isDoc = docExts.some(ext => href.toLowerCase().split('?')[0].endsWith(ext));
            if (isDoc && href.includes('/api/files/view/')) {
              const docIdMatch = href.match(/\/api\/files\/view\/([a-f0-9-]+)/i);
              if (docIdMatch && docIdMatch[1] && !validFileIds.has(docIdMatch[1])) {
                reasons.push(`Tài liệu đính kèm ID ${docIdMatch[1]} không tồn tại trong dbo.files`);
                break;
              }
            }
          }
        }

        // F. Check sizeSmall, sizeMedium, sizeBig
        if (!article.sizeSmall || article.sizeSmall.includes('/api/') || !validFileIds.has(String(article.sizeSmall))) {
          reasons.push('Trường sizeSmall chưa đúng File ID hoặc thiếu');
        }

        if (reasons.length > 0) {
          issueSlugs.add(article.slug);
          issueDetails.push({
            slug: article.slug,
            title: article.title,
            reasons
          });
        }
      }

      offset += BATCH_SIZE;
    }

    log('\n======================================================');
    log('📋 REPAIR NEEDED AUDIT RESULTS');
    log('======================================================');
    log(`• Tổng số bài viết kiểm tra : ${totalCount}`);
    log(`• Số bài viết phát hiện LỖI  : ${issueSlugs.size}`);
    log('------------------------------------------------------');

    if (issueDetails.length > 0) {
      log('\n⚠️ Chi tiết 20 bài viết lỗi đầu tiên:');
      issueDetails.slice(0, 20).forEach((item, index) => {
        log(`${index + 1}. Slug: "${item.slug}"`);
        log(`   Tiêu đề: ${item.title}`);
        log(`   Lỗi: ${item.reasons.join(' | ')}`);
      });

      // Xuất danh sách slug ra file reprocess_slugs.txt
      const slugsContent = Array.from(issueSlugs).join('\n');
      fs.writeFileSync(outputFileSlugsPath, slugsContent, 'utf-8');

      log('\n======================================================');
      log(`📄 Đã xuất danh sách ${issueSlugs.size} slugs lỗi ra tệp: ${outputFileSlugsPath}`);
      log('👉 Bạn có thể chạy sửa lỗi chính xác các bài này bằng lệnh:');
      log(`   node src/sync-news-aspx-page/migrate/reprocess_news.js --file reprocess_slugs.txt`);
      log('======================================================');
    } else {
      log('🎉 Tất cả bài viết đều ĐẠT CHUẨN! Không phát hiện bài viết bị thiếu sót.');
    }

  } catch (err) {
    log(`❌ Global Verification Error: ${err.message}`);
  } finally {
    if (pool) await pool.close();
    log(`\n📝 Chi tiết log được ghi tại: ${logFilePath}`);
    process.exit(0);
  }
}

main();
