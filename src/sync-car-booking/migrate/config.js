const { v4: uuidv4 } = require('uuid');
const mapping = require('./mapping.json');

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
      id: () => uuidv4().toUpperCase(),
      table_bak: mapping.defaults.TABLE_BAK,
      name: (r) => r?.Title || r?.DocumentSubject || mapping.defaults.CONTENT,
      request_type: (r) => r?.nvarchar6 || mapping.defaults.REQUEST_TYPE,
      priority: (r) => r?.nvarchar7 || mapping.defaults.PRIORITY,
      is_important_guest: (r) => r?.nvarchar8 || mapping.defaults.IS_IMPORTANT_GUEST,
      passenger_count: (r) => r?.int1 || mapping.defaults.PASSENGER_COUNT,
      departure_point: (r) => r?.Location || mapping.defaults.CONTENT || 'Văn phòng Tân Cảng',
      contact_phone: (r) => r?.nvarchar9 || 'N/A',
      status: (r) => r?.status != null ? Number(r.status) : mapping.defaults.STATUS,
      vehicle_state: (r) => r?.vehicle_state || mapping.defaults.VEHICLE_STATE,
      timezone: mapping.defaults.TIMEZONE,
      departure_time: (r) => r?.StartDate ? new Date(r.StartDate) : new Date(),
      return_time: (r) => r?.EndDate ? new Date(r.EndDate) : new Date(),
      destination: (r) => r?.Location || 'Chưa xác định',
      purpose: (r) => r?.Description || r?.Title || 'Công tác (Đồng bộ)',
      contact_person: (r) => r?.Organizer || mapping.defaults.LEADER,
      
      // Bóc tách các trường JSON phối hợp
      coordination_information: (r) => r?.coordination_information || r?.nvarcharMAX1 || null,
      driver_ids: (r) => r?.driver_ids || r?.nvarcharMAX2 || null,
      car_ids: (r) => r?.car_ids || r?.nvarcharMAX3 || null,

      // 🔥 2. Ép cứng các trường hiển thị theo chuẩn UI của USER
      status_code: 2,
      bpmn_version: 'QUY_TRINH_DANG_KY_XE',
      request_code: 'YC-20260329-004',
      department: '68afbefecb36081f0bbbef2e',
      contact_phone: '0297227381',
      is_important_guest: 'co',
      request_type: 'Tp',
      priority: 'bt',

      created_by: (r) => r?.AuthorAccount || mapping.defaults.USER_ID,
      created_at: (r) => r?.tp_Created ? new Date(r.tp_Created) : new Date(),
      updated_at: (r) => r?.tp_Modified ? new Date(r.tp_Modified) : new Date(),
      id_sp_bak: (r) => r?.ItemID || r?.ID
    },

    /* ================= DUPLICATE ================= */
    duplicateCheck: {
      fields: ['id_sp_bak'],
      strategy: 'update'
    },

    externalKey: 'id_sp_bak',

    backupIdField: 'ID'
  }
};

module.exports = { tableMappings };
