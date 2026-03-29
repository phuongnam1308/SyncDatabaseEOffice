const { v4: uuidv4 } = require('uuid');

/* ===================== UTIL ===================== */

const parseDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

/* ===================== TABLE MAPPING ===================== */

const tableMappings = {
  mission: {
    /* ================= OLD DB ================= */
    oldTable: 'AllUserData',
    oldSchema: 'dbo',
    oldDatabase: process.env.SHAREPOINT_DB_NAME || 'WSS_Content_eoffice_khkd',
    oldUserDatabase: 'WSS_Content_eoffice',

    listIds: [
        '4DB4FFD7-152C-4EB7-85A6-3A41053664BD'   // Lịch công tác
    ],

    /* ================= NEW DB ================= */
    newTable: 'travel_work_schedules',
    newSchema: 'dbo',
    newDatabase: process.env.NEW_DB_NAME || 'DiOffice',

    /* ================= FIELD MAP ================= */
    fieldMapping: {
      ID: 'id_sp_bak',
      Title: 'content',
      StartDate: 'from_date',
      EndDate: 'to_date',
      Location: 'location',
      Organizer: 'leader',
      AuthorAccount: 'created_by'
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
