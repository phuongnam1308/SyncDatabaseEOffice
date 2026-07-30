/**
 * SCRIPT CHUẨN HÓA VÀ CẬP NHẬT DỮ LIỆU LIÊN KẾT USER STATUS 99 -> STATUS 1
 * CHUYÊN DÀNH CHO VĂN BẢN ĐẾN (INCOMING DOCUMENTS)
 * 
 * Các trường dữ liệu liên kết User thực tế của VĂN BẢN ĐẾN:
 *   1. dbo.incomming_documents:
 *      - CreatedBy / created_by (Người nhập/tạo văn bản đến)
 *      - ModifiedBy / updated_by (Người chỉnh sửa)
 *      - signer (Người ký văn bản đến, nếu có)
 *   2. dbo.audit (type_document IN ('IncomingDocument', 'IncommingDocument')):
 *      - user_id (Người thực hiện luân chuyển/xử lý)
 *      - created_by (Người tạo audit)
 *      - receiver (Người nhận - dạng ID đơn hoặc mảng JSON)
 *      - display_name (Tên hiển thị)
 *   3. dbo.incomming_assignment:
 *      - receiver (Người được giao xử lý)
 *   4. dbo.incomming_current_state:
 *      - current_receiver (Người đang thụ lý hiện tại)
 *   5. dbo.document_comments (nếu có):
 *      - user_id / created_by (Ý kiến/Bình luận văn bản đến)
 * 
 * Quy tắc an toàn:
 *   - Chỉ ánh xạ 1-1 chắc chắn (Email, Code ND, Username hoặc Tên gốc độc nhất).
 *   - Nếu 1 User rác trùng Tên Gốc với > 1 Active User (và không có email/code trùng): TẠM BỎ QUA HOÀN TOÀN.
 */

require('dotenv').config();
const dbConnection = require('../db/connection');
const logger = require('../utils/logger');

async function main() {
  console.log('=================================================================');
  console.log('=== SCRIPT CHUẨN HÓA USER CHO VĂN BẢN ĐẾN (INCOMING DOCUMENTS) ===');
  console.log('=================================================================\n');

  console.log('🔌 Đang kết nối đến Database Mới...');
  await dbConnection.connectNewDb();
  const newPool = dbConnection.getNewPool();

  if (!newPool) {
    console.error('❌ Không thể kết nối đến Database Mới!');
    process.exit(1);
  }

  // 1. Tạo bảng ánh xạ #UserMapping (Chỉ giữ bản ghi 1-1 tuyệt đối)
  console.log('[1/4] Lập bản đồ ánh xạ User 1-1 chắc chắn (Bỏ qua các trường hợp trùng tên nhiều Active User)...');
  
  const mappingQuery = `
    IF OBJECT_ID('tempdb..#UserMapping') IS NOT NULL DROP TABLE #UserMapping;

    -- CTE trích xuất Active Users (status = 1)
    WITH ActiveUsersExtracted AS (
      SELECT 
        id AS active_id,
        name AS active_name,
        username AS active_username,
        email_user AS active_email,
        code_nd AS active_code_nd,
        LTRIM(RTRIM(
          CASE 
            WHEN CHARINDEX(' - ', name) > 0 THEN LEFT(name, CHARINDEX(' - ', name) - 1)
            WHEN CHARINDEX(' -', name) > 0 THEN LEFT(name, CHARINDEX(' -', name) - 1)
            WHEN CHARINDEX('-', name) > 0 THEN LEFT(name, CHARINDEX('-', name) - 1)
            WHEN CHARINDEX(' (', name) > 0 THEN LEFT(name, CHARINDEX(' (', name) - 1)
            ELSE name
          END
        )) AS base_name
      FROM dbo.users
      WHERE status = 1 AND name IS NOT NULL AND LTRIM(RTRIM(name)) <> ''
    ),
    -- CTE trích xuất Junk Users (status = 99)
    JunkUsersExtracted AS (
      SELECT 
        id AS junk_id,
        name AS junk_name,
        username AS junk_username,
        email_user AS junk_email,
        code_nd AS junk_code_nd,
        LTRIM(RTRIM(
          CASE 
            WHEN CHARINDEX(' - ', name) > 0 THEN LEFT(name, CHARINDEX(' - ', name) - 1)
            WHEN CHARINDEX(' -', name) > 0 THEN LEFT(name, CHARINDEX(' -', name) - 1)
            WHEN CHARINDEX('-', name) > 0 THEN LEFT(name, CHARINDEX('-', name) - 1)
            WHEN CHARINDEX(' (', name) > 0 THEN LEFT(name, CHARINDEX(' (', name) - 1)
            ELSE name
          END
        )) AS base_name
      FROM dbo.users
      WHERE status = 99 AND name IS NOT NULL AND LTRIM(RTRIM(name)) <> ''
    ),
    Candidates AS (
      SELECT 
        j.junk_id,
        j.junk_name,
        j.junk_username,
        a.active_id,
        a.active_name,
        a.active_username,
        a.active_email,
        CASE 
          WHEN j.junk_email IS NOT NULL AND LTRIM(RTRIM(j.junk_email)) <> '' AND LOWER(j.junk_email) = LOWER(a.active_email) THEN 1
          WHEN j.junk_code_nd IS NOT NULL AND LTRIM(RTRIM(j.junk_code_nd)) <> '' AND LOWER(j.junk_code_nd) = LOWER(a.active_code_nd) THEN 2
          WHEN j.junk_username IS NOT NULL AND LTRIM(RTRIM(j.junk_username)) <> '' AND LOWER(j.junk_username) = LOWER(a.active_username) THEN 3
          ELSE 10
        END AS match_priority,
        COUNT(*) OVER (PARTITION BY j.junk_id) as total_base_matches
      FROM JunkUsersExtracted j
      INNER JOIN ActiveUsersExtracted a ON 
        (j.junk_email IS NOT NULL AND LTRIM(RTRIM(j.junk_email)) <> '' AND LOWER(j.junk_email) = LOWER(a.active_email))
        OR (j.junk_code_nd IS NOT NULL AND LTRIM(RTRIM(j.junk_code_nd)) <> '' AND LOWER(j.junk_code_nd) = LOWER(a.active_code_nd))
        OR (j.junk_username IS NOT NULL AND LTRIM(RTRIM(j.junk_username)) <> '' AND LOWER(j.junk_username) = LOWER(a.active_username))
        OR LOWER(j.base_name) = LOWER(a.base_name)
    ),
    Valid1To1Matches AS (
      SELECT 
        junk_id, junk_name, junk_username, active_id, active_name, active_username, active_email, match_priority,
        ROW_NUMBER() OVER (PARTITION BY junk_id ORDER BY match_priority ASC) as rn,
        COUNT(*) OVER (PARTITION BY junk_id) as valid_match_count
      FROM Candidates
      WHERE match_priority < 10 OR total_base_matches = 1
    )
    SELECT junk_id, junk_name, junk_username, active_id, active_name, active_username, active_email
    INTO #UserMapping
    FROM Valid1To1Matches
    WHERE rn = 1 AND valid_match_count = 1;

    SELECT COUNT(1) AS total_mapped FROM #UserMapping;
  `;

  const mapRes = await newPool.request().query(mappingQuery);
  const totalMapped = mapRes.recordset[0]?.total_mapped || 0;
  console.log(`-> Đã ánh xạ thành công ${totalMapped} user rác (status 99) 1-1 chắc chắn sang user chuẩn (status 1).`);

  if (totalMapped === 0) {
    console.log('⚠️ Không có user 1-1 nào cần ánh xạ. Kết thúc script.');
    process.exit(0);
  }

  // 2. Bắt đầu Transaction cập nhật các bảng dữ liệu
  console.log('[2/4] Đang thực hiện cập nhật các bảng liên kết của VĂN BẢN ĐẾN...');

  const transaction = newPool.transaction();
  await transaction.begin();

  try {
    const req = transaction.request();

    const updateBatchSql = `
      -- =========================================================================
      -- 1. BẢNG dbo.incomming_documents (Các trường thuộc Văn bản đến)
      -- =========================================================================
      IF OBJECT_ID('dbo.incomming_documents', 'U') IS NOT NULL
      BEGIN
        -- CreatedBy / created_by (Người nhập văn bản đến)
        IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'incomming_documents' AND COLUMN_NAME = 'CreatedBy')
        BEGIN
          EXEC('UPDATE d SET d.CreatedBy = m.active_id FROM dbo.incomming_documents d INNER JOIN #UserMapping m ON d.CreatedBy = m.junk_id OR d.CreatedBy = m.junk_username;');
        END
        IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'incomming_documents' AND COLUMN_NAME = 'created_by')
        BEGIN
          EXEC('UPDATE d SET d.created_by = m.active_id FROM dbo.incomming_documents d INNER JOIN #UserMapping m ON d.created_by = m.junk_id OR d.created_by = m.junk_username;');
        END

        -- ModifiedBy / updated_by (Người chỉnh sửa)
        IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'incomming_documents' AND COLUMN_NAME = 'ModifiedBy')
        BEGIN
          EXEC('UPDATE d SET d.ModifiedBy = m.active_id FROM dbo.incomming_documents d INNER JOIN #UserMapping m ON d.ModifiedBy = m.junk_id OR d.ModifiedBy = m.junk_username;');
        END
        IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'incomming_documents' AND COLUMN_NAME = 'updated_by')
        BEGIN
          EXEC('UPDATE d SET d.updated_by = m.active_id FROM dbo.incomming_documents d INNER JOIN #UserMapping m ON d.updated_by = m.junk_id OR d.updated_by = m.junk_username;');
        END

        -- Signer (Người ký văn bản đến nếu có)
        IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'incomming_documents' AND COLUMN_NAME = 'signer')
        BEGIN
          EXEC('UPDATE d SET d.signer = m.active_id FROM dbo.incomming_documents d INNER JOIN #UserMapping m ON d.signer = m.junk_id;');
        END
      END;

      -- =========================================================================
      -- 2. BẢNG dbo.audit (Văn bản đến - type_document IN ('IncomingDocument', 'IncommingDocument'))
      -- =========================================================================
      IF OBJECT_ID('dbo.audit', 'U') IS NOT NULL
      BEGIN
        -- User ID người thực hiện audit
        UPDATE a
        SET a.user_id = m.active_id,
            a.display_name = m.active_name
        FROM dbo.audit a
        INNER JOIN #UserMapping m ON a.user_id = m.junk_id
        WHERE a.type_document IN ('IncomingDocument', 'IncommingDocument');

        -- Created_by trong audit
        UPDATE a
        SET a.created_by = m.active_id
        FROM dbo.audit a
        INNER JOIN #UserMapping m ON a.created_by = m.junk_id
        WHERE a.type_document IN ('IncomingDocument', 'IncommingDocument');

        -- Receiver đơn (User ID trực tiếp)
        UPDATE a
        SET a.receiver = m.active_id
        FROM dbo.audit a
        INNER JOIN #UserMapping m ON a.receiver = m.junk_id
        WHERE a.type_document IN ('IncomingDocument', 'IncommingDocument');

        -- Receiver chuỗi JSON (ví dụ: ["junk_id"])
        UPDATE a
        SET a.receiver = REPLACE(a.receiver, m.junk_id, m.active_id)
        FROM dbo.audit a
        INNER JOIN #UserMapping m ON a.receiver LIKE '%' + m.junk_id + '%'
        WHERE a.type_document IN ('IncomingDocument', 'IncommingDocument');
      END;

      -- =========================================================================
      -- 3. BẢNG dbo.incomming_assignment (Xử lý trùng lặp PK nếu có)
      -- =========================================================================
      IF OBJECT_ID('dbo.incomming_assignment', 'U') IS NOT NULL
      BEGIN
        DELETE target
        FROM dbo.incomming_assignment target
        INNER JOIN #UserMapping m ON target.receiver = m.junk_id
        WHERE EXISTS (
          SELECT 1 
          FROM dbo.incomming_assignment existing
          WHERE existing.document_id = target.document_id
            AND existing.receiver = m.active_id
            AND existing.role_process = target.role_process
        );

        UPDATE target
        SET target.receiver = m.active_id
        FROM dbo.incomming_assignment target
        INNER JOIN #UserMapping m ON target.receiver = m.junk_id;
      END;

      -- =========================================================================
      -- 4. BẢNG dbo.incomming_current_state
      -- =========================================================================
      IF OBJECT_ID('dbo.incomming_current_state', 'U') IS NOT NULL
      BEGIN
        UPDATE target
        SET target.current_receiver = m.active_id
        FROM dbo.incomming_current_state target
        INNER JOIN #UserMapping m ON target.current_receiver = m.junk_id;
      END;

      -- =========================================================================
      -- 5. BẢNG dbo.document_comments (Văn bản đến, nếu có)
      -- =========================================================================
      IF OBJECT_ID('dbo.document_comments', 'U') IS NOT NULL
      BEGIN
        IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'document_comments' AND COLUMN_NAME = 'user_id')
        BEGIN
          EXEC('UPDATE c SET c.user_id = m.active_id FROM dbo.document_comments c INNER JOIN #UserMapping m ON c.user_id = m.junk_id WHERE c.type_document IN (''IncomingDocument'', ''IncommingDocument'');');
        END
        IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'document_comments' AND COLUMN_NAME = 'created_by')
        BEGIN
          EXEC('UPDATE c SET c.created_by = m.active_id FROM dbo.document_comments c INNER JOIN #UserMapping m ON c.created_by = m.junk_id WHERE c.type_document IN (''IncomingDocument'', ''IncommingDocument'');');
        END
      END;
    `;

    await req.query(updateBatchSql);
    await transaction.commit();

    console.log('✅ ĐÃ CẬP NHẬT THÀNH CÔNG VÀ CHUẨN XÁC CÁC TRƯỜNG CỦA VĂN BẢN ĐẾN!\n');
  } catch (err) {
    console.error('❌ Lỗi khi thực hiện Transaction update:', err);
    try {
      await transaction.rollback();
      console.log('🔄 Đã rollback transaction.');
    } catch (rbErr) {
      console.error('Lỗi rollback:', rbErr);
    }
    process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('❌ Lỗi chạy script:', err);
  process.exit(1);
});
