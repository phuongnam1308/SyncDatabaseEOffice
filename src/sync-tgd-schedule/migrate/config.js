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
    const days = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
    return days[d.getDay()];
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
      StartDate: 'duty_date',
      Organizer: 'leader_id',
      Description: 'notes',
    },

    requiredFields: ['StartDate'],

    /* ================= DEFAULT VALUES ================= */
    defaultValues: {
      table_bak: 1,
      schedule_id: 'MIGRATED', // Hoặc logic tạo schedule cha
      day_of_week: (r) => getDayOfWeek(r?.StartDate),
      status: 1,
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
