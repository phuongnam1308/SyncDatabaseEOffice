const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const logger = require('../../../utils/logger');
const BaseModel = require('../../../models/BaseModel');
const FileUploadService = require('../../sync-file-copy/Fileuploadservice');
const MigrationHelper = require('../../helpers/MigrationHelper');

class HtmlFileMigrationModel extends BaseModel {
  constructor() {
    super();
    this.baseSourceUrl = process.env.BASE_URL || 'https://eoffice.saigonnewport.com.vn';
    this.projectRoot = path.resolve(__dirname, '../../../');
    this.targetImgFolderPath = path.join(this.projectRoot, 'tintucraw/tintuc/img');
    this.jsonOutputPath = path.join(this.projectRoot, 'tintucraw/tintuc/json_output');

    const allowedRaw =
      process.env.TINTUC_IMG_ALLOWED_PATHS ||
      'tintuc/Pictures,tintuc/Documents,tintuc/Pages,tintuc/Lists,tintuc/VideoNewDK,tintuc/AlbumAnh,tintuc/Videos,tintuc/Video';
    this.allowedImgPaths = allowedRaw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    if (!fs.existsSync(this.targetImgFolderPath)) {
      fs.mkdirSync(this.targetImgFolderPath, { recursive: true });
    }
    if (!fs.existsSync(this.jsonOutputPath)) {
      fs.mkdirSync(this.jsonOutputPath, { recursive: true });
    }

    this.fileUploadService = new FileUploadService();
    this.helper = new MigrationHelper(this.queryNewDb.bind(this));
  }

  async findLocalImage(slug, index) {
    const subFolder = path.join(this.targetImgFolderPath, slug);
    if (!fs.existsSync(subFolder)) return null;

    const files = fs.readdirSync(subFolder);
    const pattern = new RegExp(`^${this.escapeRegExp(slug)}_${index}_`);
    const found = files.find((f) => pattern.test(f));

    if (found) {
      const fullPath = path.join(subFolder, found);
      return fs.readFileSync(fullPath);
    }
    return null;
  }

  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async _downloadToBuffer(imgUrl, slug, index) {
    try {
      if (slug && index !== undefined) {
        const localBuffer = await this.findLocalImage(slug, index);
        if (localBuffer) return localBuffer;
      }

      if (imgUrl.startsWith('/tintuc/img/')) {
        const relativePath = imgUrl.replace('/tintuc/img/', '');
        const localPath = path.join(this.targetImgFolderPath, relativePath);
        if (fs.existsSync(localPath)) return fs.readFileSync(localPath);
      }

      let fullUrl = imgUrl;
      if (fullUrl.startsWith('//')) {
        fullUrl = 'https:' + fullUrl;
      } else if (fullUrl.startsWith('/')) {
        fullUrl = this.baseSourceUrl + fullUrl;
      } else if (!fullUrl.startsWith('http')) {
        fullUrl = this.baseSourceUrl + '/' + fullUrl;
      }

      // Ưu tiên dùng SharePointAuthService để tải ảnh/tài liệu (Giải quyết lỗi 401 NTLM Auth)
      try {
        const { downloadFile } = require('../../sync-file-copy/SharePointAuthService');
        if (typeof downloadFile === 'function') {
          const spBuffer = await downloadFile(fullUrl);
          if (spBuffer && spBuffer.length > 0) {
            logger.info(
              `    [Resource] Tải thành công qua SharePointAuthService: ${fullUrl} (${spBuffer.length} bytes)`,
            );
            return spBuffer;
          }
        }
      } catch (authErr) {
        logger.debug(`    [Resource] Thử tải qua Auth thất bại, dùng phương án dự phòng axios...`);
      }

      // Phương án dự phòng: Dùng axios thường
      const response = await axios({
        url: fullUrl,
        method: 'GET',
        responseType: 'arraybuffer',
        timeout: 5000,
      });
      logger.info(`    [Resource] Tải thành công: ${fullUrl} (${response.data.length} bytes)`);
      return Buffer.from(response.data);
    } catch (error) {
      logger.warn(`    [Resource] Thất bại khi tải: ${imgUrl} | Lỗi: ${error.message}`);
      return null;
    }
  }

  async _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async processContentResources(content, itemId, slug) {
    const $ = cheerio.load(content, { decodeEntities: false });
    const imagesProcessed = [];

    const images = $('img');
    const imgExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp'];

    for (let i = 0; i < images.length; i++) {
      try {
        const img = $(images[i]);
        let src = img.attr('src')?.trim();
        if (!src || src.startsWith('data:')) continue;

        const oldServer = process.env.OLD_DB_SERVER || '10.1.253.41';
        const baseHost = this.baseSourceUrl.replace(/https?:\/\//, '').split('/')[0];
        const isAlreadyNew = src.includes('/api/files/view/');

        const isInternal =
          !src.startsWith('http') ||
          src.includes(oldServer) ||
          src.includes(baseHost) ||
          src.includes('saigonnewport.com.vn');

        if (isInternal && !isAlreadyNew) {
          const downloadUrl = src.startsWith('http')
            ? encodeURI(decodeURIComponent(src))
            : encodeURI(
                this.baseSourceUrl.replace(/\/$/, '') +
                  '/' +
                  decodeURIComponent(src).replace(/^\//, ''),
              );

          logger.info(`    [Content] Đang xử lý ảnh: ${src}`);
          const buffer = await this._downloadToBuffer(downloadUrl, slug, i);
          if (buffer) {
            const originalName =
              path.basename(decodeURIComponent(src).split('?')[0]) || `img_${i}.png`;
            const uploadRes = await this.fileUploadService.uploadToNewSystem({
              fileBuffer: buffer,
              originalName: originalName,
              objectType: 'news',
              objectId: itemId || '9999',
            });

            if (uploadRes && uploadRes.id) {
              const viewPrefix = (
                process.env.NEW_SYSTEM_VIEW_PREFIX || 'https://apigw-uat.snp.com.vn/doffice-be'
              ).replace(/\/$/, '');
              const newSrc = `${viewPrefix}/api/files/view/${uploadRes.id}`;
              img.attr('src', newSrc);
              imagesProcessed.push(newSrc);
              if (!this._firstImageId) this._firstImageId = uploadRes.id;
              logger.info(`    [Content] [✔] Ảnh đã được upload: ${newSrc}`);
            } else {
              logger.warn(`    [Content] [!] Upload ảnh thất bại: ${src}`);
            }
          }
        } else if (isAlreadyNew) {
          logger.info(`    [Content] Ảnh đã được chuyển đổi trước đó: ${src}`);
          imagesProcessed.push(src);
        }
      } catch (err) {
        logger.warn(`[HtmlFileMigrationModel] [!] Loi anh: ${err.message}`);
      }
    }

    const links = $('a');
    const docExtensions = [
      '.doc',
      '.docx',
      '.pdf',
      '.xls',
      '.xlsx',
      '.ppt',
      '.pptx',
      '.zip',
      '.rar',
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.bmp',
    ];
    for (let i = 0; i < links.length; i++) {
      try {
        const link = $(links[i]);
        let rawHref = link.attr('href')?.trim();
        if (!rawHref) continue;

        const oldServer = process.env.OLD_DB_SERVER || '';
        const baseHost = this.baseSourceUrl.replace(/https?:\/\//, '').split('/')[0];
        const isAlreadyNew = rawHref.includes('/api/files/view/');

        const isInternal =
          !rawHref.startsWith('http') ||
          (oldServer && rawHref.includes(oldServer)) ||
          rawHref.includes(baseHost);

        const href = decodeURIComponent(rawHref);
        const ext = path.extname(href.split('?')[0]).toLowerCase();
        const isResource = docExtensions.includes(ext);

        if (isResource && isInternal && !isAlreadyNew) {
          logger.debug(`[HtmlFileMigrationModel] Dang xu ly tai lieu: ${href}`);
          // Xử lý URL có tiếng Việt: Decode hết ra rồi Encode chuẩn URI lại
          const downloadUrl = rawHref.startsWith('http')
            ? encodeURI(href)
            : encodeURI(this.baseSourceUrl.replace(/\/$/, '') + '/' + href.replace(/^\//, ''));

          const buffer = await this._downloadToBuffer(downloadUrl, slug, `doc_${i}`);
          if (buffer) {
            const originalName = path.basename(href.split('?')[0]);
            const uploadRes = await this.fileUploadService.uploadToNewSystem({
              fileBuffer: buffer,
              originalName: originalName,
              objectType: 'news',
              objectId: itemId || '9999',
            });

            if (uploadRes && uploadRes.id) {
              const viewPrefix = (
                process.env.NEW_SYSTEM_VIEW_PREFIX || 'https://apigw-uat.snp.com.vn/doffice-be'
              ).replace(/\/$/, '');
              const newHref = `${viewPrefix}/api/files/view/${uploadRes.id}`;
              link.attr('href', newHref);
              logger.info(`[HtmlFileMigrationModel] [✔] DA DOI FILE: ${newHref}`);
            }
          }
        }
      } catch (err) {
        logger.warn(`[HtmlFileMigrationModel] [!] Bo qua file do loi: ${err.message}`);
      }
    }
    return {
      content: $('body').html() || $.html(),
      images: imagesProcessed,
    };
  }

  async ensureSyncTableExists() {
    if (!this.newPool) return;
    const query = `
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'news_aspx_new_sync')
        BEGIN
            CREATE TABLE dbo.news_aspx_new_sync (
                id INT IDENTITY(1,1) PRIMARY KEY,
                title NVARCHAR(MAX) NULL,
                slug NVARCHAR(MAX) NULL,
                DocId NVARCHAR(100) NULL,
                summary NVARCHAR(MAX) NULL,
                authorName NVARCHAR(MAX) NULL,
                authorDepartment NVARCHAR(255) NULL,
                authorCode NVARCHAR(255) NULL,
                created_by NVARCHAR(255) NULL,
                publishedAt DATETIME2 NULL,
                content NVARCHAR(MAX) NULL,
                isActive BIT NULL,
                itemId NVARCHAR(MAX) NULL,
                images NVARCHAR(MAX) NULL,
                nameThumbnail NVARCHAR(500) NULL,
                tags NVARCHAR(MAX) NULL,
                topic NVARCHAR(255) NULL,
                updated_by NVARCHAR(255) NULL,
                reviewerId NVARCHAR(100) NULL,
                reviewerName NVARCHAR(100) NULL,
                submitterId NVARCHAR(100) NULL,
                department NVARCHAR(255) NULL,
                view_count INT DEFAULT 0,
                status INT DEFAULT 1,
                isComment BIT DEFAULT 0,
                isImportant BIT DEFAULT 0,
                isBak INT DEFAULT 0,
                created_at DATETIME2 DEFAULT GETDATE(),
                updated_at DATETIME2 DEFAULT GETDATE()
            );
        END
        ELSE
        BEGIN
            -- Ensure columns are long enough for Vietnamese text and long paths
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news_aspx_new_sync' AND COLUMN_NAME = 'DocId')
                ALTER TABLE dbo.news_aspx_new_sync ADD DocId NVARCHAR(100) NULL;
            ELSE IF (SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news_aspx_new_sync' AND COLUMN_NAME = 'DocId') = 'uniqueidentifier'
                ALTER TABLE dbo.news_aspx_new_sync ALTER COLUMN DocId NVARCHAR(100) NULL;

            IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news_aspx_new_sync' AND COLUMN_NAME = 'title' AND CHARACTER_MAXIMUM_LENGTH < 1000 AND CHARACTER_MAXIMUM_LENGTH <> -1)
                ALTER TABLE dbo.news_aspx_new_sync ALTER COLUMN title NVARCHAR(MAX) NULL;

            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news_aspx_new_sync' AND COLUMN_NAME = 'authorCode')
                ALTER TABLE dbo.news_aspx_new_sync ADD authorCode NVARCHAR(255) NULL;
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news_aspx_new_sync' AND COLUMN_NAME = 'created_by')
                ALTER TABLE dbo.news_aspx_new_sync ADD created_by NVARCHAR(255) NULL;
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news_aspx_new_sync' AND COLUMN_NAME = 'topic')
                ALTER TABLE dbo.news_aspx_new_sync ADD topic NVARCHAR(255) NULL;
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news_aspx_new_sync' AND COLUMN_NAME = 'nameThumbnail')
                ALTER TABLE dbo.news_aspx_new_sync ADD nameThumbnail NVARCHAR(500) NULL;
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news_aspx_new_sync' AND COLUMN_NAME = 'reviewerId')
                ALTER TABLE dbo.news_aspx_new_sync ADD reviewerId NVARCHAR(100) NULL;
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news_aspx_new_sync' AND COLUMN_NAME = 'submitterId')
                ALTER TABLE dbo.news_aspx_new_sync ADD submitterId NVARCHAR(100) NULL;
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news_aspx_new_sync' AND COLUMN_NAME = 'isBak')
                ALTER TABLE dbo.news_aspx_new_sync ADD isBak INT DEFAULT 0;
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'news_aspx_new_sync' AND COLUMN_NAME = 'view_count')
                ALTER TABLE dbo.news_aspx_new_sync ADD view_count INT DEFAULT 0;
        END
        `;
    const fileTableQuery = `
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'file_new_sync')
        BEGIN
            CREATE TABLE dbo.file_new_sync (
                id INT IDENTITY(1,1) PRIMARY KEY,
                news_slug NVARCHAR(MAX) NULL,
                original_url NVARCHAR(MAX) NULL,
                local_path NVARCHAR(MAX) NULL,
                created_at DATETIME2 DEFAULT GETDATE()
            );
        END
        `;

    try {
      await this.queryNewDb(query);
      await this.queryNewDb(fileTableQuery);
    } catch (err) {
      logger.error(`[HtmlFileMigrationModel] Lỗi khi tạo bảng trung gian: ${err.message}`);
    }

    logger.info('[HtmlFileMigrationModel] Staging tables ensured.');
  }

  async insertToSyncTable(data, realDocId = null) {
    if (!this.newPool) return;

    logger.info(`[Sync] Đang bắt đầu xử lý bài viết: ${data.title} (Slug: ${data.slug})`);

    // Reset first image cache
    this._firstImageId = null;

    // 1. Process content (images, docs inside)
    logger.info(`[Sync] Bắt đầu xử lý tài nguyên trong nội dung bài viết...`);
    const result = await this.processContentResources(data.content, data.itemId, data.slug);
    const updatedContent = result.content;
    const processedImages = result.images || [];

    // 2. Process thumbnail (outside content)
    let finalThumbnail = data.nameThumbnail || '';
    const viewPrefix = (
      process.env.NEW_SYSTEM_VIEW_PREFIX || 'https://apigw-uat.snp.com.vn/doffice-be'
    ).replace(/\/$/, '');

    if (finalThumbnail && !finalThumbnail.includes('/api/files/view/')) {
      const isSharePoint =
        finalThumbnail.startsWith('/') ||
        finalThumbnail.includes('10.1.25') ||
        finalThumbnail.includes('saigonnewport.com.vn') ||
        finalThumbnail.includes(this.baseSourceUrl.replace(/https?:\/\//, ''));
      if (isSharePoint) {
        logger.info(`[Sync] Đang tải ảnh đại diện: ${finalThumbnail}`);
        const buffer = await this._downloadToBuffer(finalThumbnail, data.slug, 'thumb');
        if (buffer) {
          const originalName =
            path.basename(finalThumbnail.split('?')[0]) || `thumb_${data.slug}.png`;
          const uploadRes = await this.fileUploadService.uploadToNewSystem({
            fileBuffer: buffer,
            originalName: originalName,
            objectType: 'news',
            objectId: data.itemId || '9999',
          });
          if (uploadRes && uploadRes.id) {
            finalThumbnail = `${viewPrefix}/api/files/view/${uploadRes.id}`;
            logger.info(`[Sync] [✔] Ảnh đại diện đã được upload: ${finalThumbnail}`);
          }
        }
      }
    }

    // Nếu Thumbnail vẫn trống hoặc không hợp lệ, lấy ảnh đầu tiên trong Content làm thay thế
    if (
      (!finalThumbnail || finalThumbnail === process.env.DEFAULT_NEWS_IMAGE) &&
      this._firstImageId
    ) {
      finalThumbnail = `${viewPrefix}/api/files/view/${this._firstImageId}`;
      logger.info(`[Sync] Tự động gán Ảnh đại diện từ ảnh đầu tiên của bài viết.`);
    }

    const DocIdToUse = data.DocId || realDocId || data.itemId;

    const query = `
            DECLARE @nid INT = NULL;
            IF @DocId IS NOT NULL AND @DocId <> ''
                SELECT TOP 1 @nid = id FROM dbo.news_aspx_new_sync WHERE DocId = @DocId;
            IF @nid IS NULL AND @slug IS NOT NULL
                SELECT TOP 1 @nid = id FROM dbo.news_aspx_new_sync WHERE slug = @slug;

            IF @nid IS NOT NULL
            BEGIN
                UPDATE dbo.news_aspx_new_sync SET
                    title = @title,
                    summary = @summary,
                    authorName = @authorName,
                    authorDepartment = @authorDepartment,
                    authorCode = @authorCode,
                    created_by = @created_by,
                    submitterId = @submitterId,
                    publishedAt = @publishedAt,
                    content = @content,
                    isActive = @isActive,
                    itemId = @itemId,
                    topic = @topic,
                    images = @images,
                    status = @status,
                    nameThumbnail = @nameThumbnail,
                    tags = @tags,
                    view_count = @view_count,
                    updated_at = GETDATE()
                WHERE id = @nid;
                SELECT 'updated' AS action;
            END
            ELSE
            BEGIN
                INSERT INTO dbo.news_aspx_new_sync (
                    title, slug, summary, authorName, authorDepartment, authorCode, created_by, submitterId,
                    publishedAt, content, isActive, itemId, DocId, topic, images, status, nameThumbnail, tags, view_count, isBak
                )
                VALUES (
                    @title, @slug, @summary, @authorName, @authorDepartment, @authorCode, @created_by, @submitterId,
                    @publishedAt, @content, @isActive, @itemId, @DocId, @topic, @images, @status, @nameThumbnail, @tags, @view_count, 1
                );
                SELECT 'inserted' AS action;
            END
        `;
    try {
      const sqlRes = await this.queryNewDb(query, {
        title: data.title,
        slug: data.slug,
        summary: data.summary,
        authorName: data.authorName,
        authorDepartment: data.authorDepartment,
        authorCode: data.authorCode,
        created_by: data.created_by,
        submitterId: data.submitterId,
        publishedAt: data.publishedAt,
        content: updatedContent,
        isActive: data.isActive,
        itemId: data.itemId,
        DocId: DocIdToUse,
        topic: data.topic,
        images: processedImages.length > 0 ? JSON.stringify(processedImages) : null,
        status: data.isActive === false ? 0 : 1,
        nameThumbnail: finalThumbnail,
        tags: data.tags,
        view_count: data.viewCount || 0,
      });
      const action = sqlRes?.[0]?.action || 'none';
      logger.info(`    [✔] [${action.toUpperCase()}] bài viết: [${data.title}]`);
    } catch (e) {
      logger.error('    [Error] Insert DB failed: ' + e.message);
    }
  }

  async parseHtmlFile(filePath, syncJobId = null) {
    this.syncJobId = syncJobId; // Store for use in findUserIdByNameOnly
    const html = fs.readFileSync(filePath, 'utf-8');
    const $ = cheerio.load(html, { decodeEntities: false });
    const slug = path.basename(filePath, '.aspx');

    // 1. EXTRACT TITLE
    let titleExtract =
      $('meta[property="og:title"]').attr('content') ||
      $('h1').first().text().trim() ||
      $('#DeltaPlaceHolderPageTitleInTitleArea').text().trim() ||
      '';

    // Fallback title from slug if empty
    if (!titleExtract || titleExtract.trim() === '') {
      titleExtract = slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, ' ');
      logger.info(`[Parser] Title is empty, using fallback from slug: "${titleExtract}"`);
    }

    // 2. EXTRACT TOPIC (Ưu tiên Kế hoạch)
    let topic = null;
    const fullText = $('body').text().substring(0, 2000).replace(/\s+/g, ' ');
    const combinedText = (titleExtract + ' ' + slug + ' ' + fullText).toLowerCase();

    // Nhận diện "Kế hoạch" cực mạnh
    if (
      combinedText.includes('kế hoạch') ||
      combinedText.includes('ke hoach') ||
      combinedText.includes('kehoach')
    ) {
      topic = 'Kế hoạch';
    } else {
      const navMatch =
        fullText.match(/Quản trị tin tức\s*([^\s]{2,30})/i) ||
        fullText.match(/Tin tức\s*([^\s]{2,30})/i);
      if (navMatch && navMatch[1]) topic = navMatch[1].trim();
      if (!topic || topic.length > 50 || topic.includes('Trang chủ')) {
        topic = $('.ms-breadcrumb ul li, .breadcrumb a').last().text().trim();
      }
    }

    if (!topic || topic === 'Trang chủ') topic = 'Tin tức';
    if (topic.includes('Quản trị tin tức')) topic = topic.replace('Quản trị tin tức', '').trim();

    logger.info(`[Sync] Detected Topic final: "${topic}" for ${slug}`);

    // 3. CLEAN CONTENT (Aggressive Noise Removal)
    const blocksToRemove = [
      '#s4-ribbonrow',
      '#suiteBarDelta',
      '#s4-titlerow',
      '#sideNavBox',
      '#footer',
      '.ms-breadcrumb',
      '.ms-core-listMenu-verticalBox',
      '.ms-pub-breadcrumb',
      '.ms-belltown-sideNav',
      '#DeltaPlaceHolderLeftNavBar',
      '#DeltaPlaceHolderPageTitleInTitleArea',
      'script',
      'style',
      'link',
      'iframe',
      'object',
      'embed',
      '.other-news',
      '.tags',
      '.social-share',
      '.ms-helper',
      '.ms-skipToContent',
      '.ms-access-key',
      '.ms-hide',
      '.ms-hidden',
      '.ms-comm-pageTitle',
      '.ms-core-sideNavBox-removed',
      '.ms-vertical-sideNav',
      '#ms-accessible-navigation',
      '#ms-skipped-resource-msg',
      '.ms-skipToMainContent',
      '#top-navigation',
      '#global-navigation',
      '.other-category',
      '.keyword',
      '.likebook',
      '.Form',
      '.feedbackSend',
      '.feedback',
      '.Title',
      '.subtitle',
      '.des',
      '.linkadmin',
      '.link-banner',
      '.menu-cover',
    ];

    // Lấy vùng chứa chung lớn nhất lưu lại để tìm ảnh thumbnail nếu cần
    let docMainArea = $(
      '#DeltaPlaceHolderMain, .article-content, .news-content-body, #MSO_ContentTable',
    ).first();
    if (!docMainArea.length) {
      docMainArea = $('.news-detail, .NewsMainArea, .article-body').first();
    }

    // Ưu tiên cao nhất là khung in báo (chứa tất cả title, ngày giờ, nội dung, người tạo)
    let contentContainer = $('#print-news').first();
    if (!contentContainer.length) {
      contentContainer = $('.newsdetail').first();
    }
    if (!contentContainer.length) {
      contentContainer = $('.content').first();
    }
    if (!contentContainer.length || contentContainer.text().trim().length < 20) {
      // Fallback nếu không có class nào phù hợp
      contentContainer = docMainArea;
    }

    // Xóa rác nội dung (chỉ chạy 1 lần loop)
    contentContainer = contentContainer.clone();
    blocksToRemove.forEach((selector) => contentContainer.find(selector).remove());

    // 4. SUMMARY
    let summary =
      $('meta[property="og:description"]').attr('content') || $('.des').first().text().trim() || '';
    if (!summary || summary.length < 5) {
      summary = contentContainer.text().replace(/\s+/g, ' ').trim().substring(0, 300);
    }

    // 5. PUBLISHED DATE (Xử lý Ngày Đăng dạng DD/MM/YYYY)
    let publishedAtStr =
      $('meta[property="og:posttime"]').attr('content') ||
      $('.day')
        .first()
        .text()
        .replace(/Ngày đăng:|Ngày sửa:|Ngày tạo:/i, '')
        .trim();
    let publishedAt = new Date();

    if (publishedAtStr) {
      const dateParts = publishedAtStr.match(
        /(\d{1,2})\/(\d{1,2})\/(\d{4})(\s+(\d{1,2}):(\d{1,2}))?/,
      );
      if (dateParts) {
        const day = parseInt(dateParts[1]);
        const month = parseInt(dateParts[2]) - 1;
        const year = parseInt(dateParts[3]);
        const hour = dateParts[5] ? parseInt(dateParts[5]) : 0;
        const min = dateParts[6] ? parseInt(dateParts[6]) : 0;
        publishedAt = new Date(year, month, day, hour, min);
      } else {
        publishedAt = new Date(publishedAtStr.replace(' ', 'T'));
      }
    }
    if (!publishedAt || isNaN(publishedAt.getTime())) publishedAt = new Date();

    // 6. AUTHOR INFORMATION
    const authorBlock =
      $('meta[property="og:authorname"]').attr('content') ||
      $('.author').first().text().trim() ||
      '';
    let authorName = '',
      authorDepartment = '',
      authorCode = null,
      created_by = null;

    if (authorBlock) {
      const parts = authorBlock.split(/\s*[-–—]\s*/);
      authorName = this.helper.extractDisplayName(parts[0]);
      if (parts.length > 1) authorDepartment = parts[1].trim();

      try {
        authorCode = await this.helper.findUserCodeByName(authorName);
        // Use non-creating lookup with default fallback
        created_by = await this.helper.findUserIdByNameOnly(authorName, {
          syncJobId: this.syncJobId,
          recordId: slug || authorName
        });
      } catch (err) {}
    }

    const ogItemId = $('meta[property="og:itemid"]').attr('content') || slug;

    // 7. THUMBNAIL
    let nameThumbnail =
      $('meta[property="og:image"]').attr('content') ||
      docMainArea.find('img').first().attr('src') ||
      process.env.DEFAULT_NEWS_IMAGE ||
      '';

    // 8. EXTRACT ALL IMAGES FROM CONTENT (Helper for Phase 3)
    const images = this.extractImagesFromHtml(contentContainer.html() || '');

    logger.info(`[Parser] Hoàn tất trích xuất dữ liệu cho slug: ${slug}`);
    logger.info(`    - Tiêu đề: ${titleExtract}`);
    logger.info(`    - Chủ đề: ${topic}`);
    logger.info(`    - Ngày đăng: ${publishedAt.toISOString()}`);
    logger.info(`    - Tác giả: ${authorName} (${authorCode || 'N/A'})`);
    logger.info(`    - Số lượng ảnh tìm thấy: ${images.length}`);

    return {
      title: titleExtract,
      slug,
      summary,
      authorName,
      authorDepartment,
      publishedAt,
      isActive: true,
      itemId: ogItemId,
      topic: topic,
      content: contentContainer.html(),
      authorCode,
      created_by,
      submitterId: created_by,
      nameThumbnail: nameThumbnail,
      images: images, // Trả về danh sách ảnh để Step 3 xử lý tải về ổ cứng
    };
  }

  /**
   * Trích xuất danh sách ảnh từ HTML (chỉ lấy URL, chưa download/upload)
   */
  extractImagesFromHtml(html) {
    if (!html) return [];
    const $ = cheerio.load(html, { decodeEntities: false });
    const images = [];
    const baseHost = this.baseSourceUrl.replace(/https?:\/\//, '').split('/')[0];

    $('img').each((i, el) => {
      const src = $(el).attr('src')?.trim();
      if (!src || src.startsWith('data:')) return;

      const isInternal =
        !src.startsWith('http') ||
        src.includes(baseHost) ||
        src.includes('saigonnewport.com.vn') ||
        src.includes('10.1.25');

      if (isInternal) {
        let fullUrl = src;
        if (fullUrl.startsWith('//')) {
          fullUrl = 'https:' + fullUrl;
        } else if (fullUrl.startsWith('/')) {
          fullUrl = this.baseSourceUrl.replace(/\/$/, '') + '/' + fullUrl.replace(/^\//, '');
        } else if (!fullUrl.startsWith('http')) {
          fullUrl = this.baseSourceUrl.replace(/\/$/, '') + '/' + fullUrl;
        }

        images.push({
          originalUrl: src,
          fullUrl: encodeURI(decodeURIComponent(fullUrl))
        });
      }
    });

    return images;
  }
}

module.exports = HtmlFileMigrationModel;
