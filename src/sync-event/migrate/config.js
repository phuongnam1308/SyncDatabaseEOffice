const mapping = require('./mapping.json');

/* ===================== UTIL ===================== */
const parseDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * Bóc tách nội dung Sáng/Chiều
 */
const extractSessionPart = (text, part = 'morning') => {
    if (!text || typeof text !== 'string') return '';
    const separator = text.includes('|') ? '|' : (text.includes('\n') ? '\n' : null);
    if (!separator) return part === 'morning' ? text : '';
    const parts = text.split(separator);
    return part === 'morning' ? (parts[0] || '').trim() : (parts[1] || '').trim();
};

/* ===================== TABLE MAPPING ===================== */
const tableMappings = {
  event: {
    /* ================= OLD DB ================= */
    oldTable: 'AllUserData',
    oldSchema: 'dbo',
    oldDatabase: process.env.SHAREPOINT_DB_NAME || 'WSS_Content_eoffice_khkd',
    oldUserDatabase: 'WSS_Content_eoffice',
    listIds: [
        'C27A522F-FD18-4D74-90C5-B6AC6F70AE42'  // Chỉ lấy Event theo yêu cầu
    ],

    /* ================= NEW DB ================= */
    newTable: 'news_calendar',
    newSchema: 'dbo',
    newDatabase: process.env.NEW_DB_NAME || 'app_tancang',

    /* ================= FIELD MAP ================= */
    fieldMapping: {
        ID: 'id_sp_bak',
        Title: 'title',
        StartDate: 'startTime',
        EndDate: 'endTime',
        Location: 'location',
        Description: 'description',
        AuthorAccount: 'createdBy',
        AuthorName: 'createdByName',
        Organizer: 'participants'
    },

    requiredFields: ['Title', 'StartDate'],

    /* ================= DEFAULT VALUES ================= */
    defaultValues: {
        table_bak: 1,
        status: (r) => {
            // Ưu tiên trạng thái từ SNP (CodeItem) nếu có
            if (r?.DocumentStatus === '1' || r?.DocumentStatus === 1) return 1;
            return mapping.defaults.STATUS || 1;
        },
        type: (r) => {
            const listName = r?.ListName || '';
            const loaiVB = r?.LoaiVanBan || '';
            
            // Dựa trên mẫu dữ liệu bạn gửi (Sản xuất kinh doanh, Ngày truyền thống...)
            if (r?.DonViChuTri) return r.DonViChuTri; // Ví dụ: Cột bóc tách loại hình
            if (listName.includes('Sự kiện') || loaiVB.includes('Sự kiện')) return 'Sự kiện';
            if (listName.includes('Họp') || loaiVB.includes('Họp')) return 'Cuộc họp';
            
            return mapping.defaults.TYPE || 'Sự kiện';
        },
        
        // Tiêu đề: Ưu tiên DocumentSubject từ SNP. Tuyệt đối không để trống (NOT NULL)
        title: (r) => r?.Title || r?.DocumentSubject || r?.DocumentTitle || 'Sự kiện (Đồng bộ)',

        // Địa điểm: Ưu tiên lấy từ cột Location của SP hoặc DonViChuTri của SNP. Fix cứng nếu NULL.
        location: (r) => r?.Location || r?.DonViChuTri || mapping.defaults.LOCATION || 'Văn phòng Tân Cảng Sài Gòn',

        // Nội dung: Ưu tiên Content hoặc DocumentSubject từ SNP
        description: (r) => r?.Description || r?.Content || r?.DocumentSubject || '',
        
        createdAt: (r) => r?.tp_Created || r?.DocumentCreatedDate || new Date(),
        updatedAt: (r) => r?.tp_Modified || r?.DocumentModified || new Date(),

        createdBy: (r) => r?.AuthorAccount || mapping.defaults.CREATED_BY || 'SYSTEM',
        createdByName: (r) => r?.AuthorName || mapping.defaults.CREATED_BY_NAME || 'SYSTEM'
    },

    /* ================= DUPLICATE ================= */
    duplicateCheck: {
      fields: ['id_sp_bak'],
      strategy: 'skip',
    },

    externalKey: 'id_sp_bak',
    backupIdField: 'ID',
  },
};

module.exports = { tableMappings };
