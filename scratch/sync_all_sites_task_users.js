require('dotenv').config();
const dbConnection = require('../db/connection');
const { downloadFile } = require('../src/sync-file-copy/SharePointAuthService');
const logger = require('../utils/logger');
const crypto = require('crypto');

// Danh sách tất cả các sub-site người dùng cung cấp
const SITES = [
  '/', // Tổng công ty (Root)
  '/ct', // Phòng Chính trị
  '/qsbv', // Phòng Tham mưu
  '/ktvt', // Phòng Kỹ thuật
  '/hc', // Phòng Hậu cần
  '/mkt', // Phòng Marketing
  '/tcld', // Phòng TCLD
  '/khkd', // Phòng KHKD
  '/khdt', // Phòng KHĐT
  '/cntt', // Phòng CNTT
  '/qlct', // Phòng Kiểm toán nội bộ
  '/atpc', // Phòng Pháp chế
  '/tc', // Phòng Tài chính – kế toán
  '/vp', // Văn phòng
  '/xncg', // Xí nghiệp cơ giới
  '/snpl', // Trung tâm dịch vụ Logistic
  '/ttddc', // Trung tâm điều độ cảng
  '/vptnb', // Chi nhánh đồng bằng Sông Cửu Long
  '/vpmb', // Chi nhánh Tân cảng miền Bắc
  '/ht', // Công ty MTV Hoa tiêu Tân Cảng
  '/tctt', // Công ty MTV Cảng Tân Cảng – Cái Mép Thị Vải
  '/icdst', // Công ty ICD Tân Cảng Sóng Thần
  '/icdlb', // Công ty ICD Tân Cảng Long Bình
  '/vtb', // Công ty Cổ phần VTB Tân Cảng
  '/vtt', // Công ty Cổ phần VTT Tân Cảng
  '/kvtc', // Công ty Cổ phần Kho vận Tân Cảng
  '/gnvt', // Công ty Cổ phần Đại lý giao nhận vận tải
  '/dvhh', // Công ty Cổ phần Dịch vụ hàng hải Tân Cảng
  '/dvkt', // Công ty Cổ phần Dịch vụ kỹ thuật Tân Cảng
  '/tcct', // Công ty Cổ phần Tân Cảng – Cái mép
  '/tchp', // Công ty Cổ phần Tân Cảng Hiệp Phước
  '/xdct', // Công ty Cổ phần Xây dựng Công trình Tân Cảng
  '/tcidi', // Công ty Cổ phần Đầu tư phát triển hạ tầng
  '/tcpc', // Công ty TNHH Tân Cảng Petro Cam Ranh
  '/tcmt', // Công ty Cổ phần Tân Cảng Miền Trung
  '/tcph', // Công ty Cổ phần Tân Cảng Phú Hữu
  '/cll', // Công ty Cổ phần Cảng Cát Lái
  '/tco', // Công ty Cổ phần Dịch vụ biển Tân Cảng
  '/xdsm', // Công ty Cổ phần Tân Cảng số 1
  '/tc189', // Công ty Cổ phần Tân Cảng 189 Hải Phòng
  '/cvtc', // Cảng vụ Tân Cảng
  '/yte' // Trung tâm y tế
];

const BASE_URL = process.env.BASE_URL || 'https://eoffice.saigonnewport.com.vn';

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
 * Tìm kiếm Task List trên một site dựa vào BaseTemplate (107 = Tasks, 171 = Tasks with Timeline)
 */
async function discoverTaskList(siteUrl, pool) {
  try {
    const listsUrl = `${siteUrl}/_api/web/lists?$select=Id,Title,BaseTemplate`;
    const responseBuffer = await downloadFile(listsUrl, pool);
    const data = JSON.parse(responseBuffer.toString());
    const lists = data.d?.results || data.value || [];

    // Tìm list có BaseTemplate là 107 hoặc 171
    let taskList = lists.find(l => l.BaseTemplate === 107 || l.BaseTemplate === 171);
    
    // Nếu không tìm thấy bằng BaseTemplate, tìm theo tên phổ biến
    if (!taskList) {
      taskList = lists.find(l => {
        const title = String(l.Title).toLowerCase();
        return title === 'tasks' || title === 'công việc' || title === 'danh sách công việc';
      });
    }

    return taskList || null;
  } catch (err) {
    logger.warn(`[Discover] Không thể quét danh sách List tại ${siteUrl}: ${err.message}`);
    return null;
  }
}

/**
 * Chạy tiến trình quét tất cả các site
 */
async function runUpdateAllSites() {
  try {
    // 1. Kết nối CSDL
    await dbConnection.connectAll();
    const pool = dbConnection.getNewPool();
    if (!pool) {
      console.error('❌ Không thể kết nối cơ sở dữ liệu đích (New DB).');
      process.exit(1);
    }
    console.log('✅ Đã kết nối cơ sở dữ liệu.');

    // Cache để tránh truy vấn DB lặp đi lặp lại cho cùng một username
    const userCache = new Map();

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

    let totalTasksUpdated = 0;

    for (const sitePath of SITES) {
      const siteName = sitePath === '/' ? 'root' : sitePath.replace(/\//g, '');
      const siteUrl = `${BASE_URL}${sitePath === '/' ? '' : sitePath}`;
      
      console.log(`\n--------------------------------------------------`);
      console.log(`🌐 ĐANG XỬ LÝ SITE: ${siteUrl}`);
      console.log(`--------------------------------------------------`);

      // 2. Tự động tìm kiếm danh sách Công việc (Task List) trên site này
      const taskList = await discoverTaskList(siteUrl, pool);
      if (!taskList) {
        console.log(`⚠️ Bỏ qua site: Không tìm thấy danh sách công việc (Tasks List) nào.`);
        continue;
      }

      console.log(`🔍 Đã tìm thấy Task List: "${taskList.Title}" (ID: ${taskList.Id})`);

      // 3. Chuẩn bị truy vấn lấy các bản ghi công việc
      const expandFields = 'Author,Editor,AssignedTo,TheoDoiCongViec';
      const selectFields = 'ID,Title,Author/Title,Author/Name,Editor/Title,Editor/Name,AssignedTo/Title,AssignedTo/Name,TheoDoiCongViec/Title,TheoDoiCongViec/Name';
      
      let nextUrl = `${siteUrl}/_api/web/lists(guid'${taskList.Id}')/items?$format=json&$top=200&$expand=${expandFields}&$select=${selectFields}`;
      let siteTasksProcessed = 0;
      let siteTasksUpdated = 0;

      while (nextUrl) {
        try {
          const responseBuffer = await downloadFile(nextUrl, pool);
          const data = JSON.parse(responseBuffer.toString());
          
          const items = data.d?.results || data.value || [];
          if (items.length === 0) break;

          for (const item of items) {
            const spId = String(item.ID || item.Id);
            
            // Hỗ trợ các định dạng id_task_bak khác nhau:
            // 1. Dạng mặc định: "${spId}_general"
            // 2. Dạng có chứa tên site: "${siteName}_${spId}_general" (để chống trùng lặp ID giữa các site)
            const idTaskBakDefault = `${spId}_general`;
            const idTaskBakSiteSpecific = `${siteName}_${spId}_general`;

            // Tìm kiếm task trong DB
            const taskCheck = await pool.request()
              .input('id_default', idTaskBakDefault)
              .input('id_site', idTaskBakSiteSpecific)
              .query(`
                SELECT id 
                FROM dbo.task 
                WHERE type_task = 'general' 
                  AND (id_task_bak = @id_default OR id_task_bak = @id_site)
              `);
            
            const task = taskCheck.recordset?.[0];
            if (!task) continue; // Task này chưa từng được đồng bộ sang, bỏ qua.

            const taskId = task.id;
            let isUpdated = false;

            // --- A. Cập nhật Người tạo (created_by) ---
            const authorSpName = item.Author?.Name;
            const authorUsername = extractUsername(authorSpName);
            const authorNewId = await getUserIdByUsername(authorUsername);

            if (authorNewId) {
              const res = await pool.request()
                .input('taskId', taskId)
                .input('createdBy', authorNewId)
                .query("UPDATE dbo.task SET created_by = @createdBy WHERE id = @taskId AND (created_by != @createdBy OR created_by IS NULL)");
              if (res.rowsAffected[0] > 0) isUpdated = true;
              
              // Cập nhật log hệ thống
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
              const res = await pool.request()
                .input('taskId', taskId)
                .input('updatedBy', editorNewId)
                .query("UPDATE dbo.task SET updated_by = @updatedBy WHERE id = @taskId AND (updated_by != @updatedBy OR updated_by IS NULL)");
              if (res.rowsAffected[0] > 0) isUpdated = true;
            }

            // --- C. Cập nhật Người xử lý (AssignedTo -> task_users) ---
            const assignees = item.AssignedTo?.results ? item.AssignedTo.results : (item.AssignedTo?.Name ? [item.AssignedTo] : []);
            for (const assignee of assignees) {
              const assigneeUsername = extractUsername(assignee.Name);
              const assigneeDisplayName = assignee.Title;
              const assigneeNewId = await getUserIdByUsername(assigneeUsername);

              if (assigneeNewId && assigneeDisplayName) {
                const res = await pool.request()
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
                if (res.rowsAffected[0] > 0) isUpdated = true;
              }
            }

            // --- D. Cập nhật Người theo dõi (TheoDoiCongViec -> task_users) ---
            const followers = item.TheoDoiCongViec?.results ? item.TheoDoiCongViec.results : (item.TheoDoiCongViec?.Name ? [item.TheoDoiCongViec] : []);
            for (const follower of followers) {
              const followerUsername = extractUsername(follower.Name);
              const followerDisplayName = follower.Title;
              const followerNewId = await getUserIdByUsername(followerUsername);

              if (followerNewId && followerDisplayName) {
                const res = await pool.request()
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
                if (res.rowsAffected[0] > 0) isUpdated = true;
              }
            }

            if (isUpdated) {
              siteTasksUpdated++;
            }
            siteTasksProcessed++;
          }

          nextUrl = data.d?.__next || data['odata.nextLink'] || null;
        } catch (fetchErr) {
          logger.error(`[Fetch] Lỗi khi xử lý lô dữ liệu của site ${siteUrl}: ${fetchErr.message}`);
          break; // Thoát vòng lặp trang hiện tại của site này, chuyển sang site tiếp theo
        }
      }

      console.log(`✅ Hoàn tất site ${siteName}: Quét ${siteTasksProcessed} công việc, cập nhật thành công ${siteTasksUpdated} công việc.`);
      totalTasksUpdated += siteTasksUpdated;
    }

    console.log(`\n==================================================`);
    console.log(`🎉 HOÀN THÀNH TẤT CẢ! Tổng số công việc đã được cập nhật thành công GUID chuẩn trên tất cả các site: ${totalTasksUpdated}`);
    console.log(`==================================================`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Lỗi nghiêm trọng trong toàn bộ tiến trình:', err);
    process.exit(1);
  }
}

runUpdateAllSites();
