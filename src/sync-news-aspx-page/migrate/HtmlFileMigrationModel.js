const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const BaseModel = require('../../../models/BaseModel');
const FileUploadService = require('../../sync-file-copy/Fileuploadservice');

class HtmlFileMigrationModel extends BaseModel {
    constructor() {
        super();
        this.baseSourceUrl = process.env.BASE_URL || 'https://eoffice.saigonnewport.com.vn';
        // Base paths relative to project root
        this.projectRoot = path.resolve(__dirname, '../../../');
        this.targetImgFolderPath = path.join(this.projectRoot, 'tintucraw/tintuc/img');
        this.jsonOutputPath = path.join(this.projectRoot, 'tintucraw/tintuc/json_output');

        // Danh sách prefix được phép tải ảnh xuống, đọc từ .env (có thể thiết lập qua biến môi trường)
        const allowedRaw = process.env.TINTUC_IMG_ALLOWED_PATHS || 'tintuc/Pictures,tintuc/Documents,tintuc/Pages,tintuc/Lists,tintuc/VideoNewDK,tintuc/AlbumAnh,tintuc/Videos,tintuc/Video';
        this.allowedImgPaths = allowedRaw.split(',').map(p => p.trim()).filter(Boolean);
        
        // Ensure folders exist
        if (!fs.existsSync(this.targetImgFolderPath)) {
            fs.mkdirSync(this.targetImgFolderPath, { recursive: true });
        }
        if (!fs.existsSync(this.jsonOutputPath)) {
            fs.mkdirSync(this.jsonOutputPath, { recursive: true });
        }

        this.fileUploadService = new FileUploadService();
    }

    /**
     * Tìm ảnh local dựa trên slug và chỉ số (index)
     */
    async findLocalImage(slug, index) {
        const subFolder = path.join(this.targetImgFolderPath, slug);
        if (!fs.existsSync(subFolder)) return null;

        const files = fs.readdirSync(subFolder);
        // Tên file có dạng: slug_index_hash.ext
        const pattern = new RegExp(`^${this.escapeRegExp(slug)}_${index}_`);
        const found = files.find(f => pattern.test(f));
        
        if (found) {
            const fullPath = path.join(subFolder, found);
            console.log(`    [*] Tìm thấy ảnh đã tải sẵn tại local: ${fullPath}`);
            return fs.readFileSync(fullPath);
        }
        return null;
    }

    escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Tải ảnh từ SharePoint/Old system về Buffer (ưu tiên đọc từ local nếu đã tải)
     */
    async _downloadToBuffer(imgUrl, slug, index) {
        try {
            // 1. Ưu tiên tìm trong folder img cục bộ theo slug và index
            if (slug && index !== undefined) {
                const localBuffer = await this.findLocalImage(slug, index);
                if (localBuffer) return localBuffer;
            }

            // 2. Nếu không tìm thấy theo slug/index, thử map trực tiếp từ imgUrl nếu nó là link /tintuc/img
            if (imgUrl.startsWith('/tintuc/img/')) {
                const relativePath = imgUrl.replace('/tintuc/img/', '');
                const localPath = path.join(this.targetImgFolderPath, relativePath);
                
                if (fs.existsSync(localPath)) {
                    console.log(`    [*] Đang đọc ảnh từ local (theo path): ${localPath}`);
                    return fs.readFileSync(localPath);
                }
            }

            // 3. Fallback: Tải từ SharePoint (nếu server sống)
            let fullUrl = imgUrl;
            if (fullUrl.startsWith('//')) {
                fullUrl = 'https:' + fullUrl;
            } else if (fullUrl.startsWith('/')) {
                fullUrl = this.baseSourceUrl + fullUrl;
            } else if (!fullUrl.startsWith('http')) {
                fullUrl = this.baseSourceUrl + '/' + fullUrl;
            }

            console.log(`    [*] Đang tải ảnh từ URL: ${fullUrl}`);
            const response = await axios({
                url: fullUrl,
                method: 'GET',
                responseType: 'arraybuffer',
                timeout: 5000 // Giảm timeout để tránh chờ quá lâu nễu DNS chết
            });
            return Buffer.from(response.data);
        } catch (error) {
            console.error(`  [!] Lỗi khi lấy buffer cho ảnh ${imgUrl}:`, error.message);
            return null;
        }
    }

    /**
     * Xử lý tìm ảnh trong content, upload lên hệ thống mới và thay thế URL
     */
    async processContentImages(content, itemId, slug) {
        if (!content) return content;
        
        const $ = cheerio.load(content, { decodeEntities: false });
        const images = $('img');
        
        console.log(`  [*] Đang xử lý ${images.length} ảnh trong nội dung của slug: ${slug}...`);
        
        for (let i = 0; i < images.length; i++) {
            const imgParams = $(images[i]);
            const src = imgParams.attr('src');
            
            if (!src) continue;

            const isSharePoint = src.startsWith('/') || src.includes(this.baseSourceUrl.replace('https://', '').replace('http://', ''));
            const isAlreadyNew = src.includes('apigw-uat.snp.com.vn');

            if (isSharePoint && !isAlreadyNew) {
                // Truyền i để tìm local file nếu đã tải trước đó
                const buffer = await this._downloadToBuffer(src, slug, i);
                if (buffer) {
                    const originalName = path.basename(src.split('?')[0]) || `image_${Date.now()}_${i}.png`;
                    
                    console.log(`    -> Đang upload ảnh [${originalName}] lên hệ thống mới...`);
                    const uploadRes = await this.fileUploadService.uploadToNewSystem({
                        fileBuffer: buffer,
                        originalName: originalName,
                        objectType: 'news',
                        objectId: itemId || '9999'
                    });

                    if (uploadRes && uploadRes.id) {
                        // Theo yêu cầu mới: Sử dụng /api/files/view/{id} và prefix từ ENV
                        const viewPrefix = process.env.NEW_SYSTEM_VIEW_PREFIX || 'https://apigw-uat.snp.com.vn/doffice-be';
                        const newUrl = `${viewPrefix}/api/files/view/${uploadRes.id}`;
                        
                        imgParams.attr('src', newUrl);
                        console.log(`    ✅ Đã thay thế URL theo ID: ${newUrl}`);
                    }
                }
            }
        }
        
        return $.html();
    }

    async ensureSyncTableExists() {
        if (!this.newPool) {
            console.log('[HtmlFileMigrationModel] Skip ensureSyncTableExists: No DB connection.');
            return;
        }
        const query = `
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'news_aspx_new_sync')
        BEGIN
            CREATE TABLE dbo.news_aspx_new_sync (
                id INT IDENTITY(1,1) PRIMARY KEY,
                title NVARCHAR(MAX) NULL,
                slug NVARCHAR(MAX) NULL,
                authorName NVARCHAR(MAX) NULL,
                publishedAt DATETIME2 NULL,
                content NVARCHAR(MAX) NULL,
                isActive BIT NULL,
                itemId NVARCHAR(MAX) NULL,
                newsType NVARCHAR(MAX) NULL,
                images NVARCHAR(MAX) NULL,
                status INT DEFAULT 1,
                created_at DATETIME2 DEFAULT GETDATE(),
                updated_at DATETIME2 DEFAULT GETDATE()
            );
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
        await this.queryNewDb(query);
        await this.queryNewDb(fileTableQuery);
        console.log('[HtmlFileMigrationModel] Đã kiểm tra/tạo bảng news_aspx_new_sync và file_new_sync thành công.');
    }

    async insertToFileNewSync(slug, originalUrl, localPath) {
        if (!this.newPool) return;
        const query = `
            INSERT INTO dbo.file_new_sync (news_slug, original_url, local_path)
            VALUES (@slug, @originalUrl, @localPath)
        `;
        try {
            await this.queryNewDb(query, {
                slug: slug,
                originalUrl: originalUrl,
                localPath: localPath
            });
        } catch(e) {
            console.error('[-] Lỗi chèn file_new_sync DB:', e);
        }
    }

    async downloadImage(imgUrl, slug = 'misc', index = 0) {
        try {
            // Nếu là URL tương đối, nối thêm base_url
            let fullUrl = imgUrl;
            if (fullUrl.startsWith('//')) {
                fullUrl = 'https:' + fullUrl;
            } else if (fullUrl.startsWith('/')) {
                fullUrl = this.baseSourceUrl + fullUrl;
            } else if (!fullUrl.startsWith('http')) {
                fullUrl = this.baseSourceUrl + '/' + fullUrl;
            }

            // Kiểm tra URL có thuộc danh sách đường dẫn được phép không
            const imgPath = imgUrl.startsWith('/') ? imgUrl.substring(1) : imgUrl;
            const isAllowed = this.allowedImgPaths.some(allowed => imgPath.startsWith(allowed) || imgPath.startsWith('/' + allowed));
            if (!isAllowed) {
                console.log(`  [SKIP] Ảnh không thuộc whitelist, bỏ qua: ${imgUrl}`);
                return imgUrl; // Giữ nguyên URL gốc
            }

            // Tạo mã hash ngắn từ URL để đảm bảo duy nhất
            const hash = crypto.createHash('md5').update(fullUrl).digest('hex').substring(0, 8);
            const ext = path.extname(new URL(fullUrl).pathname) || '.jpg';
            
            // Tên file: [slug]_[index]_[hash].[ext]
            const fileName = `${slug}_${index}_${hash}${ext}`;
            
            // Tạo thư mục con theo slug để quản lý ảnh theo bài viết
            const subFolder = path.join(this.targetImgFolderPath, slug);
            if (!fs.existsSync(subFolder)) {
                fs.mkdirSync(subFolder, { recursive: true });
            }

            const finalPath = path.join(subFolder, fileName);
            const dbPath = `/tintuc/img/${slug}/${fileName}`;
            
            // Nếu file đã tải rồi thì bỏ qua tải lại (return ngay)
            if (fs.existsSync(finalPath)) {
                return dbPath;
            }

            try {
                console.log(`  -> Đang tải ảnh: ${fullUrl}`);
                const response = await axios({
                    url: fullUrl,
                    method: 'GET',
                    responseType: 'stream',
                    timeout: 10000 // 10s timeout
                });

                const writer = fs.createWriteStream(finalPath);
                response.data.pipe(writer);

                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });

                return dbPath;
            } catch (error) {
                console.error(`  [!] Lỗi khi tải ảnh ${imgUrl}:`, error.message);
                // Vẫn trả về dbPath để JSON có cấu trúc mong muốn, dù download có thể thất bại tạm thời
                return dbPath; 
            }
        } catch (error) {
            console.error(`  [!] Lỗi nghiêm trọng tại downloadImage ${imgUrl}:`, error.message);
            return imgUrl;
        }
    }

    async parseHtmlFile(filePath) {
        const html = fs.readFileSync(filePath, 'utf-8');
        const $ = cheerio.load(html);

        // Lấy dữ liệu
        const title = $('h1').first().text().replace(/\\u00a0/g, ' ').trim() || '';
        const publishedAtStr = $('#date-modified').first().text().trim();
        
        let authorName = '';
        const authorBlock = $('.author div[__MarkupType="vsattributemarkup"]').first().text().trim();
        if (authorBlock) {
            authorName = authorBlock;
        }

        const slug = path.basename(filePath, '.aspx');

        // Trích xuất trạng thái phê duyệt từ mso:IsActive (trong comment HTML)
        // 1 = Active/Đã duyệt, 0 = Inactive/Chưa duyệt, null = Không có thông tin
        let isActive = null;
        const isActiveMatch = html.match(/<mso:IsActive[^>]*>([\s\S]*?)<\/mso:IsActive>/);
        if (isActiveMatch) {
            isActive = isActiveMatch[1].trim() === '1';
        }

        // Trích xuất thông tin từ og: meta tags
        const ogItemId = $('meta[property="og:itemid"]').attr('content') || null;
        const ogType   = $('meta[property="og:type"]').attr('content') || null;
        
        // Tìm tất cả ảnh trong vùng bài viết (#print-news)
        const printNews = $('#print-news');
        const images = printNews.find('img');
        const extractedImages = [];

        // Lưu thông tin ảnh nguyên thủy (để khớp với JSON cũ nếu cần)
        for (let i = 0; i < images.length; i++) {
            const imgParams = $(images[i]);
            let src = imgParams.attr('src');
            if (src) {
                const fullUrl = src.startsWith('http') ? src : `${this.baseSourceUrl}${src.startsWith('/') ? '' : '/'}${src}`;
                extractedImages.push({
                    originalUrl: src,
                    fullUrl: fullUrl
                });
            }
        }
        
        // Lấy nội dung bao gồm cả mô tả (.des), bảng ảnh (.tbimg-news) và nội dung chính (.content)
        let contentHtml = '';
        const desHtml = $('.des').html();
        const tbimgHtml = $('.tbimg-news').html();
        const mainContentHtml = $('.content').html();

        if (desHtml) contentHtml += `<div class="des">${desHtml}</div>`;
        if (tbimgHtml) contentHtml += `<div class="tbimg-news">${tbimgHtml}</div>`;
        if (mainContentHtml) contentHtml += `<div class="content">${mainContentHtml}</div>`;

        if(!contentHtml) {
            // fallback cho ASPX nếu tìm không ra các thẻ trên
            const match = html.match(/<div class="content">([\s\S]*?)<\/div><!-- end content -->/);
            contentHtml = match ? match[1].trim() : '';
        }

        // --- BƯỚC QUAN TRỌNG: Upload ảnh trong content lên hệ thống mới và thay URL ---
        console.log(`[Extaction] Đang xử lý và upload ảnh cho : ${slug}`);
        const updatedContent = await this.processContentImages(contentHtml, ogItemId, slug);
        // ----------------------------------------------------------------------------

        // Convert chuỗi Date của VN "dd/mm/yyyy hh:mm" sang JS Date
        let publishedAt = null;
        if (publishedAtStr) {
            const parts = publishedAtStr.split(' ');
            if (parts.length >= 2) {
                const dateParts = parts[0].split('/');
                if (dateParts.length === 3) {
                    publishedAt = new Date(`${dateParts[2]}-${dateParts[1]}-${dateParts[0]}T${parts[1]}:00+07:00`);
                }
            }
        }
        if (!publishedAt || isNaN(publishedAt.getTime())) {
            publishedAt = new Date(); // fallback
        }

        return {
            title,
            slug,
            authorName,
            publishedAt,
            isActive,           // trạng thái phê duyệt: true=duyệt, false=không, null=không có dữ liệu
            itemId: ogItemId,   // ID bài viết trên SharePoint
            newsType: ogType,   // Loại bài viết
            images: extractedImages,
            content: updatedContent
        };
    }

    async saveToJson(data) {
        try {
            const fileName = `${data.slug}.json`;
            const filePath = path.join(this.jsonOutputPath, fileName);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
            console.log(`[JSON Export] Saved: ${fileName}`);
            return filePath;
        } catch (error) {
            console.error('[JSON Export] Error saving file:', error.message);
            return null;
        }
    }

    async insertToSyncTable(data) {
        if (!this.newPool) {
            console.log('[HtmlFileMigrationModel] Skip insertToSyncTable: No DB connection.');
            return;
        }

        // Xử lý upload ảnh trong content trước khi lưu vào DB
        console.log(`[Content Processing] Đang kiểm tra ảnh cho bài viết: ${data.title}`);
        const updatedContent = await this.processContentImages(data.content, data.itemId, data.slug);

        const query = `
            INSERT INTO dbo.news_aspx_new_sync (title, slug, authorName, publishedAt, content, isActive, itemId, newsType, images, status)
            VALUES (@title, @slug, @authorName, @publishedAt, @content, @isActive, @itemId, @newsType, @images, @status)
        `;
        try {
            await this.queryNewDb(query, {
                title: data.title,
                slug: data.slug,
                authorName: data.authorName,
                publishedAt: data.publishedAt,
                content: updatedContent, // Sử dụng content đã update URL ảnh
                isActive: data.isActive,
                itemId: data.itemId,
                newsType: data.newsType,
                images: data.images ? JSON.stringify(data.images) : null,
                status: 1
            });
            console.log(`[+] Đã cập nhật dòng [ ${data.title} ] thành công vào news_aspx_new_sync.`);
        } catch(e) {
            console.error('[-] Lỗi chèn DB:', e);
        }
    }
}

module.exports = HtmlFileMigrationModel;
