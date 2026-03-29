const { v4: uuidv4 } = require('uuid');

/* ===================== UTIL ===================== */

const parseDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

/* ===================== TABLE MAPPING ===================== */

const tableMappings = {
  event: {
    /* ================= OLD DB ================= */
    oldTable: 'AllUserData',
    oldSchema: 'dbo',
    oldDatabase: process.env.SHAREPOINT_DB_NAME || 'WSS_Content_eoffice_khkd',
    oldUserDatabase: 'WSS_Content_eoffice',

    // Danh sách các List ID liên quan đến Sự kiện/Lịch họp
    listIds: [
        'C27A522F-FD18-4D74-90C5-B6AC6F70AE42'   // Event (Lịch sự kiện)
    ],

    /* ================= NEW DB ================= */
    newTable: 'news_calendar',
    newSchema: 'dbo',
    newDatabase: process.env.NEW_DB_NAME || 'app_tancang',

    /* ================= FIELD MAP ================= */
    // Mapping từ kết quả truy vấn JOIN SQL sang bảng news_calendar mới
    fieldMapping: {
        ID: 'id_sp_bak',
        Title: 'title',
        StartDate: 'startTime',
        EndDate: 'endTime',
        Location: 'location',
        Description: 'description',
        AuthorAccount: 'createdBy',
        AuthorName: 'createdByName'
    },

    requiredFields: ['Title', 'StartDate'],

    /* ================= DEFAULT VALUES ================= */
    defaultValues: {
        table_bak: 1,
        status: 1,
        created_at: (r) => r?.tp_Created || new Date(),
        updated_at: (r) => r?.tp_Modified || new Date(),
    },

    /* ================= DUPLICATE ================= */
    duplicateCheck: {
      fields: ['id_sp_bak'],
      strategy: 'skip'
    },

    externalKey: 'id_sp_bak',

    backupIdField: 'ID'
  }
};

module.exports = { tableMappings };
