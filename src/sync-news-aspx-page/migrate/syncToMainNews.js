const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const sql = require('mssql');
const { newDbConfig } = require('../../../config/database');

async function run() {
    let pool = null;
    try {
        console.log('--- STARTING FINAL SYNC TO MAIN NEWS TABLE ---');
        pool = await sql.connect(newDbConfig);
        console.log('✅ Connected to target database.');

        // 1. Get a default topic
        console.log('Fetching default topic...');
        const topicResult = await pool.request().query('SELECT TOP 1 id FROM dbo.topics WHERE status = 1 OR status IS NULL');
        const defaultTopicId = topicResult.recordset.length > 0 ? topicResult.recordset[0].id : null;
        console.log(`Using default topic ID: ${defaultTopicId}`);

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
                        content = @content,
                        authorName = @authorName,
                        publishedAt = @publishedAt,
                        status = @status,
                        updatedAt = GETDATE(),
                        topic = @topic,
                        authorId = @authorId
                    WHERE slug = @slug;
                    SELECT @NewsId = id FROM dbo.news WHERE slug = @slug;
                END
                ELSE
                BEGIN
                    INSERT INTO dbo.news (title, slug, content, authorName, publishedAt, status, createdAt, updatedAt, topic, authorId, isComment, isSpecial, isImportant)
                    VALUES (@title, @slug, @content, @authorName, @publishedAt, @status, GETDATE(), GETDATE(), @topic, @authorId, 1, 0, 0);
                    SELECT @NewsId = SCOPE_IDENTITY();
                END
                SELECT @NewsId AS NewsId;
            `;

            const status = row.isActive ? 1 : 0; // Assuming 1 is active/published
            
            const newsRequest = pool.request();
            newsRequest.input('title', sql.NVarChar, row.title);
            newsRequest.input('slug', sql.NVarChar, row.slug);
            newsRequest.input('content', sql.NVarChar, row.content);
            newsRequest.input('authorName', sql.NVarChar, row.authorName);
            newsRequest.input('publishedAt', sql.DateTime2, row.publishedAt);
            newsRequest.input('status', sql.Int, status);
            newsRequest.input('topic', sql.NVarChar, String(defaultTopicId));
            newsRequest.input('authorId', sql.NVarChar, adminId);

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
