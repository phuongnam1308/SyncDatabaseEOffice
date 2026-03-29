const { v4: uuidv4 } = require('uuid');

/* ===================== UTIL ===================== */

const parseDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const formatTimeRange = (start, end) => {
  const s = parseDate(start);
  if (!s) return '00:00-00:00';

  const startStr = s.toTimeString().substring(0, 5);

  const e = parseDate(end);
  if (!e) return `${startStr}-${startStr}`;

  const endStr = e.toTimeString().substring(0, 5);
  return `${startStr}-${endStr}`;
};

const buildEndedAt = (r) => {
  const ended = parseDate(r?.EndDate || r?.KetThuc);
  if (ended) return ended;

  const started = parseDate(r?.StartDate || r?.BatDau);
  const duration = Number(r?.ThoiLuongGiay || 0);

  if (started && duration > 0) {
    return new Date(started.getTime() + duration * 1000);
  }

  return null;
};

const buildMeetingState = (r) => {
  const now = new Date();
  const started = parseDate(r?.StartDate || r?.BatDau);
  const ended = buildEndedAt(r);

  if (ended && ended < now) return 'KET_THUC';
  if (started && started <= now) return 'DU_KIEN';
  return 'DU_KIEN';
};

/* ===================== TABLE MAPPING ===================== */

const tableMappings = {
  meeting: {
    /* ================= OLD DB ================= */
    oldTable: 'AllUserData',
    oldSchema: 'dbo',
    oldDatabase: process.env.SHAREPOINT_DB_NAME || 'WSS_Content_eoffice_khkd',
    oldUserDatabase: 'WSS_Content_eoffice',

    listIds: [
        'A769253C-E2D8-4188-AEF5-8841D04F42AE',  // Lich2014
        'B0F4D2C4-D65B-42AB-A37A-9D45118A2A2C',  // Lịch họp
        '360585BB-EDDA-4990-B293-AA097594B073'   // Lich2015
    ],

    /* ================= NEW DB ================= */
    newTable: 'meetings',
    newSchema: 'dbo',
    newDatabase: process.env.NEW_DB_NAME || 'app_tancang',

    /* ================= FIELD MAP ================= */
    fieldMapping: {
      ID: 'id_sp_bak',
      Title: 'title',
      StartDate: 'meeting_date',  // Sẽ được xử lý tách ngày trong Model
      Location: 'room_ids',
      Description: 'content',
      Organizer: 'chairman_id',
      AuthorAccount: 'created_by',
      tp_Created: 'created_at',
      tp_Modified: 'updated_at'
    },

    requiredFields: ['Title', 'StartDate'],

    /* ================= DEFAULT VALUES ================= */
    defaultValues: {
      table_bak: 1,
      meeting_type: 'NORMAL',
      meeting_mode: 'OFFLINE',
      status: 'Đã phê duyệt',
      status_code: 'APPROVED',
      meeting_state: 'FINISHED',
      timezone: 'Asia/Ho_Chi_Minh',
      is_company: 0,
      is_cancelled: 0,
      is_template: 0,

      /* ===== 1. PRIMARY KEY ===== */
      id: () => uuidv4(),

      /* ===== 2. BASIC INFO ===== */
      title: (r) => r?.TieuDe || 'Không tiêu đề',

      meeting_type: (r) => r?.LoaiHop || 'NB',

      priority: (r) => (r?.isImportant ? 'cao' : 'tb'),

      meeting_date: (r) => {
        const d = parseDate(r?.BatDau);
        return d ? d.toISOString().split('T')[0] : null;
      },

      meeting_time: (r) =>
        formatTimeRange(r?.BatDau, r?.KetThuc),

      meeting_mode: (r) =>
        r?.isOnline ? 'ONLINE' : 'OFFLINE',

      room_ids: (r) => r?.DiaDiem || null,

      status: '1',

      bpmn_version: process.env.DEFAULT_BPMN_VERSION || 'QUY_TRINH_LICH_HOP',

      content: (r) => r?.NoiDung || r?.TieuDe || 'Không nội dung',

      chairman_id: (r) => r?.ChuTri || null,
      secretary_id: null,
      online_meeting_id: null,

      /* ===== 3. AUDIT ===== */
      created_at: (r) => parseDate(r?.tp_Created) || new Date(),

      updated_at: (r) => parseDate(r?.tp_Modified) || new Date(),

      status_code: 3, // Đã duyệt

      direct_command: '',
      conclusion: null,
      created_by: 'SYSTEM_MIGRATION',

      attendance_locked: 0,

      /* ===== 4. STATE ===== */
      meeting_state: (r) => buildMeetingState(r),

      started_at: (r) => parseDate(r?.BatDau),

      ended_at: (r) => buildEndedAt(r),

      timezone: 'Asia/Ho_Chi_Minh',

      /* ===== 5. FLAGS ===== */
      is_company: 0,
      organizational_unit: null,
      is_assigning_seat: 'NOT_ASSIGN',

      cancelled_by: null,
      cancelled_at: null,
      cancelled_reason: null,

      is_template: 0,
      parent_id: null,
      recurrence_group_id: null,

      is_cancelled: 0,
      is_override_instance: 0,

      /* ===== 6. SHAREPOINT LINK ===== */
      sharepoint_item_id: (r) => String(r?.ID || '')
    },

    /* ================= DUPLICATE ================= */
    duplicateCheck: {
      fields: ['sharepoint_item_id'],
      strategy: 'skip'
    },

    externalKey: 'sharepoint_item_id',

    backupIdField: 'sharepoint_item_id'
  }
};

module.exports = { tableMappings };
