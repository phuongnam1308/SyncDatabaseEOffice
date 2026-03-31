const mapping = require('./mapping.json');

/* ===================== UTIL ===================== */
const parseDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * Tạo ID theo định dạng: TWS_[Timestamp]_[Random]
 */
const generateTWSId = () => {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).substring(2, 10).toUpperCase();
    return `TWS_${timestamp}_${rand}`;
};

/**
 * Bóc tách nội dung Sáng/Chiều
 */
const extractSessionPart = (text, part = 'morning') => {
    if (!text || typeof text !== 'string') return '';
    
    // Tách theo dấu gạch đứng | hoặc xuống dòng \n
    const separator = text.includes('|') ? '|' : (text.includes('\n') ? '\n' : null);
    if (!separator) return part === 'morning' ? text : '';
    
    const parts = text.split(separator);
    if (part === 'morning') {
        const morning = parts[0] || '';
        return morning.replace(/^(Sáng:|Buổi sáng:|Sáng)\s*/i, '').trim();
    } else {
        const afternoon = parts[1] || '';
        return afternoon.replace(/^(Chiều:|Buổi chiều:|Chiều)\s*/i, '').trim();
    }
};

/* ===================== TABLE MAPPING ===================== */
const tableMappings = {
  mission: {
    /* ================= OLD DB ================= */
    oldTable: mapping.oldTable,
    oldSchema: mapping.oldSchema,
    oldDatabase: process.env.SHAREPOINT_DB_NAME || mapping.oldDatabase,
    oldUserDatabase: mapping.oldUserDatabase,

    listIds: mapping.listIds,

    /* ================= NEW DB ================= */
    newTable: mapping.newTable,
    newSchema: mapping.newSchema,
    newDatabase: process.env.NEW_DB_NAME || mapping.newDatabase,

    /* ================= FIELD MAP ================= */
    fieldMapping: mapping.fieldMapping,

    requiredFields: ['Title', 'StartDate'],

    /* ================= DEFAULT VALUES ================= */
    defaultValues: {
      id: () => generateTWSId(),
      table_bak: 1,
      id_sp_bak: (r) => String(r?.ItemID || r?.ID || ''),
      status: (r) => r?.DocumentStatus || mapping.defaults.STATUS || '1',

      // 1. Loại lịch (schedule_type)
      schedule_type: (r) => {
        if (!r?.StartDate || !r?.EndDate) return 'singleDay';
        const start = new Date(r.StartDate).toISOString().split('T')[0];
        const end = new Date(r.EndDate).toISOString().split('T')[0];
        return start === end ? 'singleDay' : 'multiDay';
      },

    // 2. Định dạng lịch (calendar_format) - Khớp 100% dữ liệu mẫu
    calendar_format: (r) => {
      if (!r?.StartDate || !r?.EndDate) return 'fullDay'; // Thay vì null
      const start = new Date(r.StartDate).toISOString().split('T')[0];
      const end = new Date(r.EndDate).toISOString().split('T')[0];
      if (start !== end) return 'fullDay'; // Thay vì null

        // Nếu là singleDay, kiểm tra có phải session không
        const fullContent = (r?.Description || r?.Title || '').toLowerCase();
        if (fullContent.includes('sáng:') || fullContent.includes('chiều:') || fullContent.includes('buổi sáng:')) {
            return 'session';
        }
        return 'fullDay';
      },

      // 3. Ngày làm việc (work_date) - multiDay để NULL
      work_date: (r) => {
        if (!r?.StartDate || !r?.EndDate) return r?.StartDate ? new Date(r.StartDate) : null;
        const start = new Date(r.StartDate).toISOString().split('T')[0];
        const end = new Date(r.EndDate).toISOString().split('T')[0];
        return start === end ? new Date(r.StartDate) : null;
      },

      from_date: (r) => r?.StartDate ? new Date(r.StartDate) : new Date(),
      to_date: (r) => r?.EndDate ? new Date(r.EndDate) : new Date(),

      // 4. Nội dung & Bóc tách (Morning/Afternoon)
      location: (r) => r?.Location || r?.DonViChuTri || mapping.defaults.LOCATION,
      content: (r) => r?.Description || r?.Content || r?.Title || mapping.defaults.CONTENT,
      
      morning_location: (r) => {
          const type = tableMappings.mission.defaultValues.schedule_type(r);
          const baseLoc = r?.Location || r?.DonViChuTri || '';
          if (type === 'multiDay') return baseLoc;
          return extractSessionPart(baseLoc, 'morning');
      },
      morning_content: (r) => {
          const type = tableMappings.mission.defaultValues.schedule_type(r);
          const baseContent = r?.Description || r?.Content || r?.Title || '';
          if (type === 'multiDay') return baseContent;
          return extractSessionPart(baseContent, 'morning');
      },
      
      afternoon_location: (r) => {
          const type = tableMappings.mission.defaultValues.schedule_type(r);
          const baseLoc = r?.Location || r?.DonViChuTri || '';
          if (type === 'multiDay') return baseLoc;
          return extractSessionPart(baseLoc, 'afternoon');
      },
      afternoon_content: (r) => {
          const type = tableMappings.mission.defaultValues.schedule_type(r);
          const baseContent = r?.Description || r?.Content || r?.Title || '';
          if (type === 'multiDay') return baseContent;
          return extractSessionPart(baseContent, 'afternoon');
      },

      // 5. Schedules (Mẫu để NULL)
      schedules: () => null,

      // 6. Định danh người dùng (ID UUID)
      leader: (r) => r?.Organizer || mapping.defaults.LEADER,
      created_by: (r) => r?.AuthorAccount || mapping.defaults.USER_ID,
      
      created_at: (r) => r?.tp_Created ? new Date(r.tp_Created) : new Date(),
      updated_at: (r) => r?.tp_Modified ? new Date(r.tp_Modified) : new Date()
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
