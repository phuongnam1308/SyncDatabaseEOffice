const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const sql = require('mssql');
const { newDbConfig } = require('../config/database');

async function run() {
    let pool = null;
    try {
        console.log('--- BẮT ĐẦU BỔ SUNG CẶP BẢN GHI AUDIT (CREATE & DUYET) THEO THÔNG TIN TỪ TIN TỨC ---');
        pool = await sql.connect(newDbConfig);
        console.log('✅ Kết nối thành công đến cơ sở dữ liệu mới.');

        // Lấy ID tài khoản admin mặc định làm phương án dự phòng cuối cùng
        const adminResult = await pool.request().query("SELECT TOP 1 id FROM dbo.users WHERE username = 'admin-tancang'");
        const adminId = adminResult.recordset.length > 0 ? adminResult.recordset[0].id : '6926bd32994b706c8b25118a';

        // Lấy danh sách tin tức đã đồng bộ
        const newsQuery = `
            SELECT id, title, slug, summary, content, publishedAt, createdAt, updatedAt, 
                   topic, tags, authorName, authorId, created_by, DocId, isImportant,
                   reviewerId, reviewerName, submitterId, submitterName
            FROM dbo.news
            WHERE (DocId IS NOT NULL OR isBak = 1) AND status = 1
        `;
        
        const newsResult = await pool.request().query(newsQuery);
        const articles = newsResult.recordset;
        console.log(`📊 Tổng số tin tức đã đồng bộ được tìm thấy: ${articles.length}`);

        let countCreated = 0;
        let countDuyet = 0;

        for (const n of articles) {
            const documentIdStr = String(n.id);
            
            // Lấy thông tin Tác giả (Author) từ bản ghi tin tức
            const authorUserId = n.authorId || n.created_by || adminId;
            const authorDisplayName = n.authorName || 'Cán bộ 01';

            // Lấy thông tin Người phê duyệt (Reviewer) từ bản ghi tin tức
            const reviewerUserId = n.reviewerId || n.submitterId || adminId;

            // Thiết lập mốc thời gian
            const duyetTime = n.publishedAt || n.updatedAt || new Date();
            // Lấy thời gian tạo (CREATE) trước thời gian duyệt 5 phút (300000ms)
            const createTime = n.createdAt || new Date(new Date(duyetTime).getTime() - 300000);

            // A. Kiểm tra và chèn bản ghi CREATE
            const checkCreate = await pool.request()
                .input('docId', sql.NVarChar, documentIdStr)
                .query("SELECT 1 FROM dbo.audit WHERE document_id = @docId AND type_document = 'NEWS' AND action_code = 'CREATE'");
            
            if (checkCreate.recordset.length === 0) {
                const createDetailsObj = {
                    documentId: documentIdStr,
                    bpmnVersion: "quan_ly_tin_tuc",
                    title: n.title || "",
                    content: n.content || "",
                    summary: n.summary || "",
                    isComment: true,
                    isImportant: n.isImportant === 1 || n.isImportant === true,
                    topic: n.topic || "",
                    tags: n.tags || "",
                    publishedAt: duyetTime ? new Date(duyetTime).toISOString().split('T')[0] : "",
                    authorName: authorDisplayName,
                    authorId: authorUserId,
                    flowId: null
                };

                const insertCreateQuery = `
                    INSERT INTO dbo.audit (
                        document_id, time, user_id, display_name, role, action_code,
                        from_node_id, to_node_id, details, origin_id, created_by, receiver,
                        receiver_unit, group_, roleProcess, action, deadline, stage_status,
                        curStatusCode, created_at, updated_at, type_document
                    ) VALUES (
                        @document_id, @time, @user_id, @display_name, @role, @action_code,
                        NULL, 'Gateway_0v9uw21', @details, NULL, @created_by, @receiver,
                        NULL, NULL, 'NGUOI_TAO_TIN', NULL, NULL, 'CHUA_XU_LY',
                        'DRAFT', @created_at, @updated_at, 'NEWS'
                    )
                `;

                const reqCreate = pool.request();
                reqCreate.input('document_id', sql.NVarChar, documentIdStr);
                reqCreate.input('time', sql.DateTime, createTime);
                reqCreate.input('user_id', sql.NVarChar, authorUserId);
                reqCreate.input('display_name', sql.NVarChar, authorDisplayName);
                reqCreate.input('role', sql.NVarChar, 'NGUOI_TAO_TIN');
                reqCreate.input('action_code', sql.NVarChar, 'CREATE');
                reqCreate.input('details', sql.NVarChar, JSON.stringify(createDetailsObj));
                reqCreate.input('created_by', sql.NVarChar, authorUserId);
                reqCreate.input('receiver', sql.NVarChar, authorUserId); // Người nhận của CREATE là chính Tác giả
                reqCreate.input('created_at', sql.DateTime, createTime);
                reqCreate.input('updated_at', sql.DateTime, createTime);

                await reqCreate.query(insertCreateQuery);
                countCreated++;
            }

            // B. Kiểm tra và chèn bản ghi DUYET
            const checkDuyet = await pool.request()
                .input('docId', sql.NVarChar, documentIdStr)
                .query("SELECT 1 FROM dbo.audit WHERE document_id = @docId AND type_document = 'NEWS' AND action_code = 'DUYET'");
            
            if (checkDuyet.recordset.length === 0) {
                const duyetDetailsObj = {
                    note: "Xuất bản trực tiếp (Topic không cần duyệt)",
                    autoApprove: true
                };

                const insertDuyetQuery = `
                    INSERT INTO dbo.audit (
                        document_id, time, user_id, display_name, role, action_code,
                        from_node_id, to_node_id, details, origin_id, created_by, receiver,
                        receiver_unit, group_, roleProcess, action, deadline, stage_status,
                        curStatusCode, created_at, updated_at, type_document
                    ) VALUES (
                        @document_id, @time, @user_id, @display_name, @role, @action_code,
                        'Gateway_0v9uw21', 'Activity_1k1yhfl', @details, NULL, @created_by, @receiver,
                        NULL, NULL, 'NGUOI_TAO_TIN', NULL, NULL, 'HOAN_THANH',
                        'PUBLISHED', @created_at, @updated_at, 'NEWS'
                    )
                `;

                const reqDuyet = pool.request();
                reqDuyet.input('document_id', sql.NVarChar, documentIdStr);
                reqDuyet.input('time', sql.DateTime, duyetTime);
                reqDuyet.input('user_id', sql.NVarChar, authorUserId);
                reqDuyet.input('display_name', sql.NVarChar, authorDisplayName);
                reqDuyet.input('role', sql.NVarChar, 'NGUOI_TAO_TIN');
                reqDuyet.input('action_code', sql.NVarChar, 'DUYET');
                reqDuyet.input('details', sql.NVarChar, JSON.stringify(duyetDetailsObj));
                reqDuyet.input('created_by', sql.NVarChar, authorUserId);
                reqDuyet.input('receiver', sql.NVarChar, reviewerUserId); // Người nhận của DUYET lấy từ reviewerId/submitterId của news
                reqDuyet.input('created_at', sql.DateTime, duyetTime);
                reqDuyet.input('updated_at', sql.DateTime, duyetTime);

                await reqDuyet.query(insertDuyetQuery);
                countDuyet++;
            }
        }

        console.log(`\n🎉 Hoàn thành khôi phục:`);
        console.log(`   - Số bản ghi CREATE đã thêm: ${countCreated}`);
        console.log(`   - Số bản ghi DUYET đã thêm: ${countDuyet}`);

    } catch (err) {
        console.error('❌ Lỗi phê duyệt/khôi phục:', err);
    } finally {
        if (pool) await pool.close();
        console.log('--- HOÀN THÀNH ---');
        process.exit(0);
    }
}

run();
