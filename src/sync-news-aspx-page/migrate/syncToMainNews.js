const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const sql = require('mssql');
const { newDbConfig } = require('../../../config/database');
const MigrationHelper = require('../../helpers/MigrationHelper');

async function run() {
    let pool = null;
    try {
        console.log('--- STARTING FINAL SYNC TO MAIN NEWS TABLE ---');
        pool = await sql.connect(newDbConfig);
        console.log('✅ Connected to target database.');

        // Khởi tạo Helper với query function
        const helper = new MigrationHelper(async (sqlStr, params) => {
            const request = pool.request();
            if (params) {
                for (const key in params) {
                    request.input(key, params[key]);
                }
            }
            const result = await request.query(sqlStr);
            return result.recordset;
        });

        // 0. Đảm bảo các bảng có đầy đủ các cột cần thiết
        console.log('\n--- SCHEMA CHECK & AUTO UPDATE ---');
        const schemaChecks = [
            { table: 'dbo.topics', column: 'tb_bak', type: 'INT DEFAULT 0' },
            { table: 'dbo.news', column: 'viewCount', type: 'INT DEFAULT 0' },
            { table: 'dbo.news', column: 'tags', type: 'NVARCHAR(MAX) NULL' },
            { table: 'dbo.news', column: 'nameThumbnail', type: 'NVARCHAR(MAX) NULL' },
            { table: 'dbo.news', column: 'sizeSmall', type: 'NVARCHAR(MAX) NULL' },
            { table: 'dbo.news', column: 'sizeMedium', type: 'NVARCHAR(MAX) NULL' },
            { table: 'dbo.news', column: 'sizeBig', type: 'NVARCHAR(MAX) NULL' }
        ];

        for (const check of schemaChecks) {
            try {
                const tableName = check.table.split('.')[1];
                const checkColumnQuery = `
                    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('${check.table}') AND name = '${check.column}')
                    BEGIN
                        PRINT '[Schema Check] Dang them cot ${check.column} vao bang ${check.table}...';
                        ALTER TABLE ${check.table} ADD ${check.column} ${check.type};
                        SELECT 1 AS added;
                    END
                    ELSE SELECT 0 AS added;
                `;
                const result = await pool.request().query(checkColumnQuery);
                if (result.recordset && result.recordset[0] && result.recordset[0].added === 1) {
                    console.log(`✅ [Schema Check] Đã tự động thêm cột [${check.column}] vào bảng [${check.table}].`);
                } else {
                    console.log(`ℹ️ [Schema Check] Cột [${check.column}] đã tồn tại trong bảng [${check.table}].`);
                }
            } catch (e) {
                console.error(`❌ [Schema Check] Lỗi khi kiểm tra/cập nhật cột [${check.column}] tại [${check.table}]:`, e.message);
            }
        }
        console.log('--- SCHEMA CHECK COMPLETED ---\n');

        // 1. Get all topics for mapping by name
        console.log('Fetching topics for mapping...');
        const topicsResult = await pool.request().query('SELECT id, name FROM dbo.topics WHERE status = 1');
        const topicMap = {};
        topicsResult.recordset.forEach(t => {
            if (t.name) topicMap[t.name.trim().toLowerCase()] = t.id;
        });
        console.log(`Available topics count: ${Object.keys(topicMap).length}`);

        // 2. Get a fallback admin User ID
        const adminResult = await pool.request().query("SELECT TOP 1 id FROM dbo.users WHERE username = 'admin-tancang'");
        const adminId = adminResult.recordset.length > 0 ? adminResult.recordset[0].id : '6926bd32994b706c8b25118a';
        console.log(`Using fallback admin ID: ${adminId}`);

        // 3. Select all from staging
        const stagingRows = await pool.request().query('SELECT * FROM dbo.news_aspx_new_sync');
        console.log(`Found ${stagingRows.recordset.length} records to sync.`);

        for (const row of stagingRows.recordset) {
            console.log(`▶ Processing: ${row.slug}`);

            // A. Insert or Update News table
            // We use SLUG as the lookup key to avoid duplicates
            const newsQuery = `
                DECLARE @NewsId INT;
                IF EXISTS (SELECT 1 FROM dbo.news WHERE slug = @slug)
                BEGIN
                    UPDATE dbo.news SET 
                        title = @title,
                        summary = @summary,
                        content = @content,
                        authorName = @authorName,
                        publishedAt = @publishedAt,
                        status = @status,
                        updatedAt = GETDATE(),
                        topic = @topic,
                        authorId = @authorId,
                        nameThumbnail = @thumbnail,
                        sizeSmall = @thumbnail,
                        sizeMedium = @thumbnail,
                        sizeBig = @thumbnail,
                        tags = @tags,
                        viewCount = @viewCount
                    WHERE slug = @slug;
                    SELECT @NewsId = id FROM dbo.news WHERE slug = @slug;
                END
                ELSE
                BEGIN
                    INSERT INTO dbo.news (title, slug, summary, content, authorName, publishedAt, status, createdAt, updatedAt, topic, authorId, isComment, isSpecial, isImportant, nameThumbnail, sizeSmall, sizeMedium, sizeBig, tags, viewCount)
                    VALUES (@title, @slug, @summary, @content, @authorName, @publishedAt, @status, GETDATE(), GETDATE(), @topic, @authorId, 1, 0, 0, @thumbnail, @thumbnail, @thumbnail, @thumbnail, @tags, @viewCount);
                    SELECT @NewsId = SCOPE_IDENTITY();
                END
                SELECT @NewsId AS NewsId;
            `;

            const status = row.isActive ? 1 : 0; // Assuming 1 is active/published
            
            // Determine the topic ID based on newsType name comparison (Sử dụng Helper xử lý trùng lặp và tạo mới)
            const topicId = await helper.getOrCreateTopic(row.newsType || 'Tin tức', topicMap);
            console.log(`[Topic Mapping] bài viết [${row.title}] -> Topic ID: ${topicId}`);
            
            const newsRequest = pool.request();
            newsRequest.input('title', sql.NVarChar, row.title);
            newsRequest.input('slug', sql.NVarChar, row.slug);
            newsRequest.input('summary', sql.NVarChar, row.summary);
            newsRequest.input('content', sql.NVarChar, row.content);
            newsRequest.input('authorName', sql.NVarChar, row.authorName);
            newsRequest.input('publishedAt', sql.DateTime2, row.publishedAt);
            newsRequest.input('status', sql.Int, status);
            newsRequest.input('topic', sql.NVarChar, String(topicId));
            newsRequest.input('authorId', sql.NVarChar, adminId);
            newsRequest.input('thumbnail', sql.NVarChar, row.thumbnail);
            newsRequest.input('tags', sql.NVarChar, row.tags);
            newsRequest.input('viewCount', sql.Int, row.view_count || 0);

            const newsResult = await newsRequest.query(newsQuery);
            const newsId = newsResult.recordset[0].NewsId;

            // B. If isActive, ensure Audit record exists
            if (row.isActive) {
                const auditQuery = `
                    IF NOT EXISTS (SELECT 1 FROM dbo.audit WHERE document_id = @newsId AND type_document = 'NEWS' AND action_code = 'DUYET')
                    BEGIN
                        INSERT INTO dbo.audit (
                            document_id, time, user_id, display_name, role, action_code,
                            details, created_by, receiver, stage_status, curStatusCode,
                            created_at, updated_at, type_document
                        ) VALUES (
                            @newsId, @time, @userId, N'Hệ thống Migrator', 'ADMIN_NEWS', 'DUYET',
                            N'{"autoApproved":true,"reason":"Migrate từ ASPX Staging"}', @userId, @userId, 'HOAN_THANH', 'PUBLISHED',
                            GETDATE(), GETDATE(), 'NEWS'
                        );
                    END
                `;
                const auditRequest = pool.request();
                auditRequest.input('newsId', sql.NVarChar, String(newsId));
                auditRequest.input('time', sql.DateTime, row.publishedAt || new Date());
                auditRequest.input('userId', sql.NVarChar, adminId);
                await auditRequest.query(auditQuery);
            }
        }

        console.log('\n===============\n🎉 FINAL SYNC COMPLETED \n===============');
    } catch (err) {
        console.error('❌ Error during final sync:', err);
    } finally {
        if (pool) await pool.close();
        process.exit(0);
    }
}

run();
