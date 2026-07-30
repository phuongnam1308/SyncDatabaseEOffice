require('dotenv').config();
const dbConnection = require('../db/connection');
const { downloadFile } = require('../src/sync-file-copy/SharePointAuthService');
const logger = require('../utils/logger');
const crypto = require('crypto');

// Cấu hình SharePoint
const SHAREPOINT_TASK_LIST_ID = process.env.SHAREPOINT_TASK_LIST_ID || 'FEC511D8-E617-41C0-9C63-EAD5CB201F8A';
const SHAREPOINT_SITE_URL = process.env.SHAREPOINT_SITE_URL || 'https://eoffice.saigonnewport.com.vn/congviec';

/**
 * Bóc tách username từ chuỗi định danh SharePoint
 * Ví dụ: "i:0#.f|admembers|duongvk" -> "duongvk"
 */
function extractUsername(spName) {
  if (!spName || typeof spName !== 'string') return null;
  if (spName.includes('|')) {
    const parts = spName.split('|');
    return parts[parts.length - 1].trim().toLowerCase();
  }
  return spName.trim().toLowerCase();
}

/**
 * Thực hiện quét API SharePoint và cập nhật CSDL EOffice
 */
async function runUpdate() {
  try {
    // 1. Kết nối cơ sở dữ liệu đích
    await dbConnection.connectAll();
    const pool = dbConnection.getNewPool();
    if (!pool) {
      console.error('❌ Không thể kết nối cơ sở dữ liệu đích (New DB).');
      process.exit(1);
    }
    console.log('✅ Đã kết nối cơ sở dữ liệu.');

    // 2. Chuẩn bị truy vấn API SharePoint
    const expandFields = 'Author,Editor,AssignedTo,TheoDoiCongViec';
    // Ta lấy các thuộc tính Name (Tên đăng nhập AD) và Title (Họ tên hiển thị)
    const selectFields = 'ID,Title,Author/Title,Author/Name,Editor/Title,Editor/Name,AssignedTo/Title,AssignedTo/Name,TheoDoiCongViec/Title,TheoDoiCongViec/Name';
    
    let nextUrl = `${SHAREPOINT_SITE_URL}/_api/web/lists(guid'${SHAREPOINT_TASK_LIST_ID}')/items?$format=json&$top=200&$expand=${expandFields}&$select=${selectFields}`;
    
    console.log('🔄 Đang bắt đầu gọi API SharePoint và cập nhật dữ liệu...');
    let totalProcessed = 0;

    // Cache để tránh truy vấn DB lặp đi lặp lại cho cùng 1 username
    const userCache = new Map();

    // Hàm phụ tìm ID người dùng từ username (có cache)
    const getUserIdByUsername = async (username) => {
      if (!username) return null;
      if (userCache.has(username)) return userCache.get(username);

      const res = await pool.request()
        .input('username', username)
        .query('SELECT TOP 1 id FROM dbo.users WHERE LTRIM(RTRIM(username)) = LTRIM(RTRIM(@username))');
      
      const id = res.recordset?.[0]?.id || null;
      userCache.set(username, id);
      return id;
    };

    while (nextUrl) {
      console.log(`📡 Đang tải dữ liệu từ URL: ${nextUrl}`);
      const responseBuffer = await downloadFile(nextUrl, pool);
      const data = JSON.parse(responseBuffer.toString());
      
      const items = data.d?.results || data.value || [];
      if (items.length === 0) {
        console.log('Không có dữ liệu trả về từ SharePoint.');
        break;
      }

      console.log(`Đã tải ${items.length} công việc từ SharePoint. Đang đối chiếu cập nhật...`);

      for (const item of items) {
        const spId = String(item.ID || item.Id);
        const idTaskBak = `${spId}_general`;

        // Kiểm tra xem task này có tồn tại trong bảng task của EOffice hay không
        const taskCheck = await pool.request()
          .input('id_task_bak', idTaskBak)
          .query("SELECT id FROM dbo.task WHERE id_task_bak = @id_task_bak AND type_task = 'general'");
        
        const task = taskCheck.recordset?.[0];
        if (!task) {
          // Bỏ qua nếu task này chưa được đồng bộ sang EOffice
          continue;
        }

        const taskId = task.id;
        
        // --- A. Cập nhật Người tạo (created_by) ---
        const authorSpName = item.Author?.Name;
        const authorUsername = extractUsername(authorSpName);
        const authorNewId = await getUserIdByUsername(authorUsername);

        if (authorNewId) {
          await pool.request()
            .input('taskId', taskId)
            .input('createdBy', authorNewId)
            .query("UPDATE dbo.task SET created_by = @createdBy WHERE id = @taskId AND (created_by != @createdBy OR created_by IS NULL)");
          
          // Cập nhật log hệ thống (system_log_tasks)
          await pool.request()
            .input('taskId', taskId)
            .input('userInfo', authorNewId)
            .query("UPDATE dbo.system_log_tasks SET user_info = CAST(@userInfo AS NVARCHAR(250)) WHERE task_id = @taskId AND (user_info != CAST(@userInfo AS NVARCHAR(250)) OR user_info IS NULL)");
        }

        // --- B. Cập nhật Người sửa (updated_by) ---
        const editorSpName = item.Editor?.Name;
        const editorUsername = extractUsername(editorSpName);
        const editorNewId = await getUserIdByUsername(editorUsername);

        if (editorNewId) {
          await pool.request()
            .input('taskId', taskId)
            .input('updatedBy', editorNewId)
            .query("UPDATE dbo.task SET updated_by = @updatedBy WHERE id = @taskId AND (updated_by != @updatedBy OR updated_by IS NULL)");
        }

        // --- C. Cập nhật Người xử lý (AssignedTo -> task_users) ---
        const assignees = item.AssignedTo?.results ? item.AssignedTo.results : (item.AssignedTo?.Name ? [item.AssignedTo] : []);
        for (const assignee of assignees) {
          const assigneeUsername = extractUsername(assignee.Name);
          const assigneeDisplayName = assignee.Title;
          const assigneeNewId = await getUserIdByUsername(assigneeUsername);

          if (assigneeNewId && assigneeDisplayName) {
            // Tìm kiếm dòng task_users khớp với taskId và họ tên hiển thị để cập nhật process_id chuẩn
            await pool.request()
              .input('taskId', taskId)
              .input('processName', assigneeDisplayName)
              .input('processId', assigneeNewId)
              .query(`
                UPDATE dbo.task_users 
                SET process_id = @processId 
                WHERE task_id = @taskId 
                  AND role = 'director'
                  AND LTRIM(RTRIM(process_name)) = LTRIM(RTRIM(@processName))
                  AND (process_id != @processId OR process_id IS NULL)
              `);
          }
        }

        // --- D. Cập nhật Người theo dõi (TheoDoiCongViec -> task_users) ---
        const followers = item.TheoDoiCongViec?.results ? item.TheoDoiCongViec.results : (item.TheoDoiCongViec?.Name ? [item.TheoDoiCongViec] : []);
        for (const follower of followers) {
          const followerUsername = extractUsername(follower.Name);
          const followerDisplayName = follower.Title;
          const followerNewId = await getUserIdByUsername(followerUsername);

          if (followerNewId && followerDisplayName) {
            // Tìm kiếm dòng task_users khớp với taskId và họ tên hiển thị để cập nhật process_id chuẩn
            await pool.request()
              .input('taskId', taskId)
              .input('processName', followerDisplayName)
              .input('processId', followerNewId)
              .query(`
                UPDATE dbo.task_users 
                SET process_id = @processId 
                WHERE task_id = @taskId 
                  AND role = 'viewer'
                  AND LTRIM(RTRIM(process_name)) = LTRIM(RTRIM(@processName))
                  AND (process_id != @processId OR process_id IS NULL)
              `);
          }
        }

        totalProcessed++;
      }

      console.log(`Đã xử lý xong lô hiện tại. Tổng số task đã kiểm tra/cập nhật: ${totalProcessed}`);
      
      // Lấy URL trang tiếp theo (nếu có)
      nextUrl = data.d?.__next || data['odata.nextLink'] || null;
    }

    console.log(`\n🎉 HOÀN TẤT! Tổng số task đã quét và xử lý: ${totalProcessed}`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Lỗi nghiêm trọng trong quá trình xử lý:', err);
    process.exit(1);
  }
}

runUpdate();
