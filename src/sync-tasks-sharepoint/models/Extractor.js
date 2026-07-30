const axios = require('axios');
const logger = require('../../../utils/logger');
const { downloadFile } = require('../../sync-file-copy/SharePointAuthService');

// Danh sách tất cả các sub-site phòng ban/đơn vị thành viên
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

class Extractor {
  constructor() {
    this.modelName = 'SHAREPOINT_TASK_EXTRACTOR';
    this.newPool = null;
  }

  async initialize(newPool) {
    this.newPool = newPool;
  }

  /**
   * Tự động quét, phát hiện Task List và bóc tách cấu trúc cột (Field Schema) để tránh lỗi HTTP 400
   */
  async discoverTaskList(siteUrl) {
    try {
      const listsUrl = `${siteUrl}/_api/web/lists?$select=Id,Title,BaseTemplate`;
      const responseBuffer = await downloadFile(listsUrl, this.newPool);
      const data = JSON.parse(responseBuffer.toString());
      const lists = data.d?.results || data.value || [];

      // 1. Lọc ra các list là Task List (107 hoặc 171) và KHÔNG phải là Workflow Tasks của hệ thống
      let taskLists = lists.filter(l => 
        (l.BaseTemplate === 107 || l.BaseTemplate === 171) && 
        !String(l.Title).toLowerCase().includes('workflow')
      );
      
      // Nếu không có list nào ngoài Workflow, buộc phải dùng fallback bao gồm cả workflow
      const finalLists = taskLists.length > 0 ? taskLists : lists.filter(l => l.BaseTemplate === 107 || l.BaseTemplate === 171);
      if (finalLists.length === 0) return null;

      // Ưu tiên sắp xếp để đưa các list có tên "Công việc", "Tasks", "Danh sách công việc" lên đầu
      finalLists.sort((a, b) => {
        const aTitle = String(a.Title).toLowerCase();
        const bTitle = String(b.Title).toLowerCase();
        const keywords = ['công việc', 'tasks', 'danh sách công việc'];
        const aPriority = keywords.some(k => aTitle.includes(k)) ? 1 : 0;
        const bPriority = keywords.some(k => bTitle.includes(k)) ? 1 : 0;
        return bPriority - aPriority;
      });

      const selectedList = finalLists[0];
      const listId = selectedList.Id;

      // 2. Truy vấn lấy danh sách cột (Fields) của List này để xây dựng câu query OData động
      // Điều này giúp tránh lỗi HTTP 400 khi list không có cột tùy chỉnh (ví dụ: "TheoDoiCongViec")
      const fieldsUrl = `${siteUrl}/_api/web/lists(guid'${listId}')/fields?$select=InternalName`;
      const fieldsBuffer = await downloadFile(fieldsUrl, this.newPool);
      const fieldsData = JSON.parse(fieldsBuffer.toString());
      const fields = fieldsData.d?.results || fieldsData.value || [];
      const internalNames = fields.map(f => f.InternalName);

      // Xây dựng danh sách các trường select và expand dựa trên các cột thực sự có mặt trong list
      const selectFields = ['ID', 'Title'];
      const expandFields = [];

      // Check Body hoặc Description (Trường mô tả chi tiết công việc)
      if (internalNames.includes('Body')) {
        selectFields.push('Body');
      } else if (internalNames.includes('Description')) {
        selectFields.push('Description');
      }

      // Check Priority
      if (internalNames.includes('Priority')) {
        selectFields.push('Priority');
      }

      // Check PercentComplete
      if (internalNames.includes('PercentComplete')) {
        selectFields.push('PercentComplete');
      }

      // Check StartDate
      if (internalNames.includes('StartDate')) {
        selectFields.push('StartDate');
      }

      // Check DueDate
      if (internalNames.includes('DueDate')) {
        selectFields.push('DueDate');
      }

      // Check DateCompleted
      if (internalNames.includes('DateCompleted')) {
        selectFields.push('DateCompleted');
      }

      // Check Created
      if (internalNames.includes('Created')) {
        selectFields.push('Created');
      }

      // Check Modified
      if (internalNames.includes('Modified')) {
        selectFields.push('Modified');
      }

      // Check GUID (Một số list hệ thống hoặc bản SharePoint cũ không cho phép select trực tiếp GUID)
      if (internalNames.includes('GUID')) {
        selectFields.push('GUID');
      }

      // Check nStatus hoặc Status
      if (internalNames.includes('nStatus')) {
        selectFields.push('nStatus');
      } else if (internalNames.includes('Status')) {
        selectFields.push('Status');
      }

      // Check Author (Người tạo)
      if (internalNames.includes('Author')) {
        selectFields.push('Author/Title', 'Author/Name');
        expandFields.push('Author');
      }

      // Check Editor (Người sửa)
      if (internalNames.includes('Editor')) {
        selectFields.push('Editor/Title', 'Editor/Name');
        expandFields.push('Editor');
      }

      // Check AssignedTo (Người thực hiện)
      if (internalNames.includes('AssignedTo')) {
        selectFields.push('AssignedTo/Title', 'AssignedTo/Name');
        expandFields.push('AssignedTo');
      }

      // Check TheoDoiCongViec (Người theo dõi - cột tùy chỉnh)
      if (internalNames.includes('TheoDoiCongViec')) {
        selectFields.push('TheoDoiCongViec/Title', 'TheoDoiCongViec/Name');
        expandFields.push('TheoDoiCongViec');
      }

      return {
        Id: listId,
        Title: selectedList.Title,
        selectStr: selectFields.join(','),
        expandStr: expandFields.join(',')
      };
    } catch (err) {
      logger.warn(`[${this.modelName}] discoverTaskList error for ${siteUrl}: ${err.message}`);
      return null;
    }
  }

  async runExtract() {
    let totalExtracted = 0;

    logger.info(`[${this.modelName}] Bắt đầu tiến trình trích xuất đa site (41 sites)...`);

    for (const sitePath of SITES) {
      const siteName = sitePath === '/' ? 'root' : sitePath.replace(/\//g, '');
      const siteUrl = `${BASE_URL}${sitePath === '/' ? '' : sitePath}`;

      try {
        // 1. Tự động phát hiện danh sách công việc và schema cột
        const listMeta = await this.discoverTaskList(siteUrl);
        if (!listMeta) {
          logger.warn(`[${this.modelName}] Bỏ qua site: Không tìm thấy Task List hợp lệ tại ${siteUrl}`);
          continue;
        }

        logger.info(`[${this.modelName}] Phát hiện Task List "${listMeta.Title}" tại site: ${siteUrl}`);

        // 2. Tạo URL API động với select và expand tương ứng
        let nextUrl = `${siteUrl}/_api/web/lists(guid'${listMeta.Id}')/items?$format=json&$top=300`;
        if (listMeta.expandStr) {
          nextUrl += `&$expand=${listMeta.expandStr}`;
        }
        if (listMeta.selectStr) {
          nextUrl += `&$select=${listMeta.selectStr}`;
        }
        
        let siteExtracted = 0;

        while (nextUrl) {
          const responseBuffer = await downloadFile(nextUrl, this.newPool);
          const data = JSON.parse(responseBuffer.toString());
          
          const items = data.d?.results || data.value || [];
          if (items.length === 0) break;

          await this.syncBatchToStaging(items, siteName);
          siteExtracted += items.length;
          totalExtracted += items.length;

          nextUrl = data.d?.__next || data['odata.nextLink'] || null;
        }

        logger.info(`[${this.modelName}] Đã hoàn thành trích xuất site [${siteName}]: kéo được ${siteExtracted} công việc.`);
      } catch (siteErr) {
        logger.error(`[${this.modelName}] Trích xuất thất bại tại site ${siteUrl}: ${siteErr.message}`);
        // Tiếp tục các site khác, không block toàn bộ tiến trình
      }
    }

    logger.info(`[${this.modelName}] Hoàn tất trích xuất đa site. Tổng số bản ghi kéo về staging: ${totalExtracted}`);
    return { extractedCount: totalExtracted };
  }

  async syncBatchToStaging(items, siteName) {
    const table = `task_sharepoint_sync`;
    
    for (const item of items) {
      const spId = String(item.ID || item.Id);
      // Kết hợp ID để đảm bảo tính duy nhất giữa các site
      const compositeId = `${siteName}_${spId}`;
      
      // Định dạng thông tin người tạo/sửa: "[Tên hiển thị]|[Tên đăng nhập AD]"
      const authorValue = item.Author ? `${item.Author.Title || ''}|${item.Author.Name || ''}` : null;
      const editorValue = item.Editor ? `${item.Editor.Title || ''}|${item.Editor.Name || ''}` : null;

      // Định dạng thông tin người gán/theo dõi dưới dạng mảng JSON chứa cả Title và Name (nếu có)
      const assignedToValues = item.AssignedTo 
        ? (item.AssignedTo.results 
            ? item.AssignedTo.results.map(u => ({ Title: u.Title, Name: u.Name }))
            : (item.AssignedTo.Name ? [{ Title: item.AssignedTo.Title, Name: item.AssignedTo.Name }] : []))
        : [];
      
      const theoDoiValues = item.TheoDoiCongViec
        ? (item.TheoDoiCongViec.results
            ? item.TheoDoiCongViec.results.map(u => ({ Title: u.Title, Name: u.Name }))
            : (item.TheoDoiCongViec.Name ? [{ Title: item.TheoDoiCongViec.Title, Name: item.TheoDoiCongViec.Name }] : []))
        : [];

      const params = {
        ID: compositeId,
        Title: item.Title || null,
        Body: item.Body || item.Description || null, // Hỗ trợ đọc cả Body và Description
        Priority: item.Priority || null,
        PercentComplete: item.PercentComplete !== undefined ? item.PercentComplete : 0,
        StartDate: item.StartDate ? new Date(item.StartDate) : null,
        DueDate: item.DueDate ? new Date(item.DueDate) : null,
        DateCompleted: item.DateCompleted ? new Date(item.DateCompleted) : null,
        nStatus: item.nStatus || item.Status || null, // Hỗ trợ đọc cả nStatus và Status
        AuthorId: item.AuthorId || null,
        AuthorName: authorValue,
        EditorId: item.EditorId || null,
        EditorName: editorValue,
        Created: item.Created ? new Date(item.Created) : null,
        Modified: item.Modified ? new Date(item.Modified) : null,
        AssignedToId: item.AssignedToId ? (item.AssignedToId.results ? JSON.stringify(item.AssignedToId.results) : JSON.stringify([item.AssignedToId])) : null,
        AssignedToNames: assignedToValues.length > 0 ? JSON.stringify(assignedToValues) : null,
        TheoDoiCongViecId: item.TheoDoiCongViecId ? (item.TheoDoiCongViecId.results ? JSON.stringify(item.TheoDoiCongViecId.results) : JSON.stringify([item.TheoDoiCongViecId])) : null,
        TheoDoiCongViecNames: theoDoiValues.length > 0 ? JSON.stringify(theoDoiValues) : null,
        GUID: item.GUID || null
      };

      const query = `
        IF EXISTS (SELECT 1 FROM ${table} WHERE ID = @ID)
        BEGIN
          UPDATE ${table} SET
            Title = @Title,
            Body = @Body,
            Priority = @Priority,
            PercentComplete = @PercentComplete,
            StartDate = @StartDate,
            DueDate = @DueDate,
            DateCompleted = @DateCompleted,
            nStatus = @nStatus,
            AuthorId = @AuthorId,
            AuthorName = @AuthorName,
            EditorId = @EditorId,
            EditorName = @EditorName,
            Created = @Created,
            Modified = @Modified,
            AssignedToId = @AssignedToId,
            AssignedToNames = @AssignedToNames,
            TheoDoiCongViecId = @TheoDoiCongViecId,
            TheoDoiCongViecNames = @TheoDoiCongViecNames,
            GUID = @GUID,
            MigrateFlg = CASE WHEN Modified > @Modified THEN MigrateFlg ELSE 0 END -- Reset để sync lại nếu có sửa đổi
          WHERE ID = @ID;
        END
        ELSE
        BEGIN
          INSERT INTO ${table} (
            ID, Title, Body, Priority, PercentComplete, StartDate, DueDate, 
            DateCompleted, nStatus, AuthorId, AuthorName, EditorId, EditorName, 
            Created, Modified, AssignedToId, AssignedToNames, 
            TheoDoiCongViecId, TheoDoiCongViecNames, GUID
          ) VALUES (
            @ID, @Title, @Body, @Priority, @PercentComplete, @StartDate, @DueDate,
            @DateCompleted, @nStatus, @AuthorId, @AuthorName, @EditorId, @EditorName,
            @Created, @Modified, @AssignedToId, @AssignedToNames,
            @TheoDoiCongViecId, @TheoDoiCongViecNames, @GUID
          );
        END
      `;

      const request = this.newPool.request();
      for (const [key, value] of Object.entries(params)) {
        request.input(key, value);
      }
      await request.query(query);
    }
  }
}

module.exports = Extractor;
