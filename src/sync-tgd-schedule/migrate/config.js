const { v4: uuidv4 } = require('uuid');

/* ===================== UTIL ===================== */

const parseDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const getDayOfWeek = (date) => {
    const d = parseDate(date);
    if (!d) return null;
    // d.getDay() returns 0 (Sunday), 1 (Monday), etc.
    return d.getDay();
};

/* ===================== TABLE MAPPING ===================== */

const tableMappings = {
  tgd_schedule: {
    /* ================= OLD DB ================= */
    oldTable: 'AllUserData',
    oldSchema: 'dbo',
    oldDatabase: process.env.SHAREPOINT_DB_NAME || 'WSS_Content_eoffice_khkd',
    oldUserDatabase: 'WSS_Content_eoffice',

    listIds: [
        '50654456-9F7A-4436-BFED-F86F1BFDF58D'   // Lịch trực ban TGD
    ],

    /* ================= NEW DB ================= */
    newTable: 'leadership_duty_details',
    newSchema: 'dbo',
    newDatabase: process.env.NEW_DB_NAME || 'DiOffice',

    /* ================= FIELD MAP ================= */
    fieldMapping: {
      ID: 'id_sp_bak',
      Title: 'content',      // Thông tin chi tiết lịch / Nội dung
      Location: 'destination', // Địa điểm (nơi đến/phòng họp) dạng Text
      StartDate: 'duty_date',
      Organizer: 'leader_id',
      Description: 'notes',
    },

    requiredFields: ['StartDate'],

    /* ================= DEFAULT VALUES ================= */
    defaultValues: {
      table_bak: 1,
      schedule_id: 'LDS_1773063888220_HNP0JV0N', // Hardcoded as requested
      schedule_type: 'NORMAL',
      day_of_week: (r) => getDayOfWeek(r?.StartDate),
      duty_date: (r) => parseDate(r?.StartDate) || new Date(),
      notes: (r) => r?.Description || 'N/A',
      status: 1,
      leader_id: (r) => r?.Organizer || '6915f2387e39c2ba33cef79a',
      created_at: (r) => parseDate(r?.tp_Created) || new Date(),
      updated_at: (r) => parseDate(r?.tp_Modified) || new Date(),
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
