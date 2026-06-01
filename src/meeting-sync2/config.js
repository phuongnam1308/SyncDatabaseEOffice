const { v4: uuidv4 } = require('uuid');
const statusMapping = require('./status_mapping.json');
const mapping = require('./mapping.json');

/* ===================== UTIL ===================== */

/**
 * Hàm phân tích chuỗi ngày tháng hoặc object Date thành đối tượng Date hợp lệ.
 * Nếu giá trị truyền vào không hợp lệ, hàm sẽ trả về null để tránh lỗi.
 * 
 * @param {any} v - Giá trị ngày tháng cần phân tích (String, Number, Date object)
 * @returns {Date|null} Trả về đối tượng Date nếu hợp lệ, ngược lại trả về null
 */
const parseDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * Hàm định dạng khoảng thời gian diễn ra cuộc họp (Ví dụ: "08:00-11:00").
 * Hàm này sẽ tự động parse ngày bắt đầu và kết thúc, sau đó cộng thêm
 * độ lệch múi giờ (mặc định là +7 cho giờ Việt Nam).
 * 
 * @param {string|Date} start - Thời gian bắt đầu
 * @param {string|Date} end - Thời gian kết thúc
 * @param {number} offsetHours - Độ lệch múi giờ (Mặc định: 7)
 * @returns {string} Trả về chuỗi định dạng "HH:mm-HH:mm" (ví dụ: "14:00-16:00")
 */
const formatTimeRange = (start, end, offsetHours = 7) => {
  const s = parseDate(start);
  console.log(`[config.js][formatTimeRange] INPUT: start=${start} (type=${typeof start}), end=${end} (type=${typeof end}), offsetHours=${offsetHours}`);
  console.log(`[config.js][formatTimeRange] parsed start=${s ? s.toISOString() : null}`);
  if (!s) return '00:00-00:00';

  // Cộng thêm offset giờ để chuyển sang giờ VN
  const sLocal = new Date(s.getTime() + offsetHours * 60 * 60 * 1000);
  const startStr = sLocal.toISOString().substring(11, 16); // HH:mm

  const e = parseDate(end);
  console.log(`[config.js][formatTimeRange] parsed end=${e ? e.toISOString() : null}`);
  if (!e) {
    console.log(`[config.js][formatTimeRange] OUTPUT (no end): ${startStr}-${startStr}`);
    return `${startStr}-${startStr}`;
  }

  const eLocal = new Date(e.getTime() + offsetHours * 60 * 60 * 1000);
  const endStr = eLocal.toISOString().substring(11, 16); // HH:mm
  console.log(`[config.js][formatTimeRange] OUTPUT: ${startStr}-${endStr}`);
  return `${startStr}-${endStr}`;
};

/**
 * Hàm tính toán và xác định thời gian kết thúc của cuộc họp.
 * Ưu tiên sử dụng trường EndDate. Nếu không có EndDate nhưng có
 * thời lượng (ThoiLuongGiay), sẽ cộng thời lượng vào StartDate để ra kết quả.
 * Nếu cả hai không có, trả về thời gian bắt đầu hoặc thời điểm hiện tại.
 * 
 * @param {Object} r - Dòng dữ liệu lịch họp gốc từ DB cũ
 * @returns {Date} Đối tượng Date thể hiện thời gian kết thúc
 */
const buildEndedAt = (r) => {
  const ended = parseDate(r?.EndDate);
  if (ended) return ended;

  const started = parseDate(r?.StartDate);
  const duration = Number(r?.ThoiLuongGiay || 0);

  if (started && duration > 0) {
    return new Date(started.getTime() + duration * 1000);
  }

  return started || new Date();
};

/**
 * Xác định trạng thái của lịch họp dựa trên thời gian thực tế.
 * Nếu thời gian kết thúc đã trôi qua so với hiện tại, đánh dấu là 'KET_THUC'.
 * Ngược lại, gán trạng thái là 'DU_KIEN'.
 * 
 * @param {Object} r - Dòng dữ liệu lịch họp gốc từ DB cũ
 * @returns {string} Trạng thái tiến độ cuộc họp (DU_KIEN | KET_THUC)
 */
const buildMeetingState = (r) => {
  const now = new Date();
  const started = parseDate(r?.StartDate);
  const ended = buildEndedAt(r);

  if (ended && ended < now) return 'KET_THUC';
  return 'DU_KIEN';
};

/**
 * Ánh xạ trạng thái (status string) từ hệ thống cũ sang mã trạng thái mới
 * dựa trên cấu hình khai báo trong file status_mapping.json.
 * Các nhóm trạng thái sẽ được quy đổi thành mã số tương ứng (0: Đã hủy, 2: Đang xử lý, 3: Phê duyệt).
 * 
 * @param {string} statusStr - Chuỗi trạng thái từ hệ thống cũ (Ví dụ: "Đã phê duyệt")
 * @returns {number} Mã trạng thái số nguyên tương ứng trên DB mới
 */
const mapStatusToStatusCode = (statusStr) => {
  const defaultCode = statusMapping.DEFAULT_STATUS_CODE || 2;
  if (!statusStr) return defaultCode;

  const s = statusStr.trim();

  // 1. Kiểm tra nhóm Approved (Phê duyệt/Phát hành)
  if (statusMapping.APPROVED.includes(s)) return 3;

  // 2. Kiểm tra nhóm Deleted
  if (statusMapping.DELETED.includes(s)) return 0;

  // 3. Kiểm tra các Keyword xử lý
  const isProcessing = statusMapping.PROCESSING_KEYWORDS.some(kw => s.includes(kw));
  if (isProcessing) return 2;

  // 4. Mặc định theo cấu hình
  return defaultCode;
};

/* ===================== TABLE MAPPING ===================== */

const tableMappings = {
  meeting: {
    /* ================= OLD DB ================= */
    oldTable: mapping.oldTable || 'AllUserData',
    oldSchema: mapping.oldSchema || 'dbo',
    oldDatabase: process.env.SHAREPOINT_DB_NAME || mapping.oldDatabase,
    oldUserDatabase: mapping.oldUserDatabase || 'WSS_Content_eoffice',

    listIds: mapping.listIds || [],

    /* ================= NEW DB ================= */
    newTable: mapping.newTable || 'meetings',
    newSchema: mapping.newSchema || 'dbo',
    newDatabase: process.env.NEW_DB_NAME || mapping.newDatabase,

    /* ================= FIELD MAP ================= */
    fieldMapping: mapping.fieldMapping,

    requiredFields: ['Title', 'StartDate'],

    /* ================= DEFAULT VALUES ================= */
    defaultValues: {
      table_bak: mapping.defaults.TABLE_BAK || 1,
      meeting_type: mapping.defaults.MEETING_TYPE || 'NORMAL',
      meeting_mode: mapping.defaults.MEETING_MODE || 'OFFLINE',
      status: mapping.defaults.STATUS || '1',
      status_code: mapping.defaults.STATUS_CODE || 'APPROVED',
      meeting_state: mapping.defaults.MEETING_STATE || 'FINISHED',
      timezone: mapping.defaults.TIMEZONE || 'Asia/Ho_Chi_Minh',
      is_company: 0,
      is_cancelled: 0,
      is_template: 0,

      /* ===== 1. PRIMARY KEY ===== */
      id: () => uuidv4(),

      /* ===== 2. BASIC INFO ===== */
      title: (r) => r?.Title || mapping.defaults.DEFAULT_TITLE || 'Không tiêu đề',

      meeting_type: (r) => r?.nvarchar6 || mapping.defaults.MEETING_TYPE || 'NB',

      priority: (r) => r?.priority || mapping.defaults.MEETING_PRIORITY || 'tb',

      meeting_date: (r) => {
        const d = parseDate(r?.StartDate) || new Date();
        return d.toISOString().split('T')[0];
      },

      meeting_time: (r) =>
        formatTimeRange(r?.BatDau || r?.StartDate, r?.KetThuc || r?.EndDate, 7),

      meeting_mode: (r) => {
        if (!r?.Location) return mapping.defaults.MEETING_MODE || 'OFFLINE';
        const loc = String(r.Location).toLowerCase();
        if (loc.includes('zoom') || loc.includes('online')) return 'ONLINE';
        if (loc.includes('hybrid')) return 'HYBRID';
        return 'OFFLINE';
      },

      room_ids: (r) => {
        if (r?.room_ids) return r.room_ids;
        if (r?.Location && r.Location !== 'NULL' && String(r.Location).includes('-')) return r.Location;
        return mapping.room_default.id;
      },

      status: mapping.defaults.STATUS || '1',

      bpmn_version: mapping.defaults.BPMN_VERSION || 'QUY_TRINH_LICH_HOP',

      // nvarchar3/Description hiện được dùng làm tên phòng, không dùng làm content nữa.
      content: (r) => r?.Title || 'Không nội dung',

      chairman_id: (r) => r?.chairman_id || mapping.defaults.CHAIRMAN_ID || 'SYSTEM_MIGRATION',
      secretary_id: (r) => r?.secretary_id || null,
      online_meeting_id: (r) => r?.online_meeting_id || null,

      /* ===== 3. AUDIT ===== */
      created_at: (r) => parseDate(r?.tp_Created) || new Date(),

      updated_at: (r) => parseDate(r?.tp_Modified) || new Date(),

      status_code: (r) => mapStatusToStatusCode(r?.WorkflowStatus || r?.nvarchar10),

      direct_command: (r) => r?.DocumentTitle || null,
      conclusion: (r) => r?.nvarchar7 || null,
      created_by: (r) => r?.AuthorAccount || mapping.defaults.USER_ID || 'SYSTEM_MIGRATION',

      attendance_locked: 0,

      /* ===== 4. STATE ===== */
      meeting_state: (r) => buildMeetingState(r),

      started_at: (r) => parseDate(r?.StartDate) || new Date(),

      ended_at: (r) => buildEndedAt(r),

      timezone: mapping.defaults.TIMEZONE || 'Asia/Ho_Chi_Minh',

      /* ===== 5. FLAGS ===== */
      is_company: 0,
      organizational_unit: (r) => r?.organizational_unit || mapping.defaults.ORG_UNIT || null,
      is_assigning_seat: 'NOT_ASSIGN',

      cancelled_by: null,
      cancelled_at: null,
      cancelled_reason: null,

      is_template: 0,
      parent_id: null,
      recurrence_group_id: null,

      is_cancelled: 0,
      is_override_instance: 0,
      schedule_type: 'NORMAL',

      /* ===== 6. SHAREPOINT LINK ===== */
      sharepoint_item_id: (r) => String(r?.ID || '')
    },

    /* ================= DUPLICATE ================= */
    duplicateCheck: {
      fields: [mapping.externalKey || 'id_sp_bak'],
      strategy: 'skip'
    },

    externalKey: mapping.externalKey || 'id_sp_bak',

    backupIdField: mapping.externalKey || 'id_sp_bak'
  }
};

module.exports = { tableMappings };
