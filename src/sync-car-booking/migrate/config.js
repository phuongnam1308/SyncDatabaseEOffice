const { v4: uuidv4 } = require('uuid');

/* ===================== UTIL ===================== */

const parseDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

/* ===================== TABLE MAPPING ===================== */

const tableMappings = {
  car_booking: {
    /* ================= OLD DB ================= */
    oldTable: 'AllUserData',
    oldSchema: 'dbo',
    oldDatabase: process.env.SHAREPOINT_DB_NAME || 'WSS_Content_eoffice_khkd',
    oldUserDatabase: 'WSS_Content_eoffice',

    listIds: [
        '090933CE-FF2D-4962-AC64-87B73626F973'   // Lịch đặt xe
    ],

    /* ================= NEW DB ================= */
    newTable: 'vehicle_registrations',
    newSchema: 'dbo',
    newDatabase: process.env.NEW_DB_NAME || 'app_tancang',

    /* ================= FIELD MAP ================= */
    fieldMapping: {
      ID: 'id_sp_bak',
      Title: 'name',
      StartDate: 'departure_time',
      EndDate: 'return_time',
      Location: 'destination',
      Description: 'purpose',
      Organizer: 'contact_person',
      AuthorAccount: 'created_by'
    },

    requiredFields: ['Title', 'StartDate'],

    /* ================= DEFAULT VALUES ================= */
    defaultValues: {
      id: () => uuidv4(),
      table_bak: 1,
      request_type: 'MIGRATED',
      priority: 'NORMAL',
      is_important_guest: '0',
      passenger_count: 1,
      departure_point: 'N/A',
      contact_phone: 'N/A',
      status: 1,
      vehicle_state: 'DA_DUYET',
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
