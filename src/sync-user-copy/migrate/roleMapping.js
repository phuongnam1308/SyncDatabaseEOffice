/**
 * Parse danh sách keyword từ biến môi trường.
 * Hỗ trợ 2 định dạng trong .env:
 *   - JSON array : TRUONGPHONG_KEYWORDS=["trưởng phòng","tp"]
 *   - Chuỗi CSV  : TRUONGPHONG_KEYWORDS=trưởng phòng,tp
 * Trả về mảng string đã lowercase + trim.
 */
function parseKeywords(envValue, defaults) {
  if (!envValue) return defaults;
  const trimmed = envValue.trim();
  try {
    if (trimmed.startsWith('[')) {
      const parsed = JSON.parse(trimmed);
      return parsed.map(k => String(k).trim().toLowerCase()).filter(Boolean);
    }
  } catch (_) {
    // không phải JSON hợp lệ → fallback sang split CSV
  }
  return trimmed.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
}

/**
 * Parse mảng roles_by_process từ biến môi trường.
 * Env phải là JSON array, ví dụ:
 *   ROLES_TRUONG_PHONG='[{"processKey":"VAN_BAN_DI","roles":[...]}]'
 * Trả về mảng object, hoặc fallback 1 entry đơn nếu lỗi / không có.
 */
function parseRoles(envValue, fallbackRoleCode) {
  if (envValue) {
    try {
      const parsed = JSON.parse(envValue.trim());
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch (err) {
      console.warn(`[roleMapping] Không parse được roles JSON: ${err.message}`);
    }
  }
  return [
    {
      processKey: fallbackRoleCode,
      name: fallbackRoleCode,
      roles: [{ roleCode: fallbackRoleCode, name: fallbackRoleCode }],
    },
  ];
}

// ── Keywords ─────────────────────────────────────────────────────────────────
const ADMIN_KEYWORDS           = parseKeywords(process.env.ADMIN_KEYWORDS,           ['admin', 'administrator', 'quản trị viên', 'quản trị']);
const GIAMDOC_KEYWORDS         = parseKeywords(process.env.GIAMDOC_KEYWORDS,         ['giám đốc', 'giam doc']);
const PHO_GIAMDOC_KEYWORDS     = parseKeywords(process.env.PHO_GIAMDOC_KEYWORDS,     ['phó giám đốc']);
const TRUONGPHONG_KEYWORDS     = parseKeywords(process.env.TRUONGPHONG_KEYWORDS,     ['trưởng phòng']);
const PHO_TRUONGPHONG_KEYWORDS = parseKeywords(process.env.PHO_TRUONGPHONG_KEYWORDS, ['phó phòng', 'phó trưởng phòng']);
const VANTHUCUC_KEYWORDS       = parseKeywords(process.env.VANTHUCUC_KEYWORDS,       ['văn thư cục']);
const VANTHU_KEYWORDS          = parseKeywords(process.env.VANTHU_KEYWORDS,          ['văn thư']);
const NHANVIEN_KEYWORDS        = parseKeywords(process.env.NHANVIEN_KEYWORDS,        ['nhân viên', 'nhan vien', 'cán bộ', 'can bo']);

// ── Roles ─────────────────────────────────────────────────────────────────────
// Tên env đúng là ROLES_* (có S), không phải ROLE_* (thiếu S)
const ROLES_ADMIN            = parseRoles(process.env.ROLES_ADMIN,            'ADMIN');
const ROLES_GIAM_DOC         = parseRoles(process.env.ROLES_GIAM_DOC,         'GIAM_DOC');
const ROLES_PHO_GIAM_DOC     = parseRoles(process.env.ROLES_PHO_GIAM_DOC,     'PHO_GIAM_DOC');
const ROLES_TRUONG_PHONG     = parseRoles(process.env.ROLES_TRUONG_PHONG,     'TRUONG_PHONG');
const ROLES_PHO_TRUONG_PHONG = parseRoles(process.env.ROLES_PHO_TRUONG_PHONG, 'PHO_TRUONG_PHONG');
const ROLES_VAN_THU_CUC      = parseRoles(process.env.ROLES_VAN_THU_CUC,      'VAN_THU_CUC');
const ROLES_VAN_THU          = parseRoles(process.env.ROLES_VAN_THU,          'VAN_THU');
const ROLES_NHAN_VIEN        = parseRoles(process.env.ROLES_DEFAULT,          'NHAN_VIEN');

// ── Mapping (thứ tự ưu tiên từ trên xuống) ───────────────────────────────────
const roleMapping = [
  { keywords: VANTHUCUC_KEYWORDS,       roles: ROLES_VAN_THU_CUC },      // ưu tiên trước VANTHU
  { keywords: ADMIN_KEYWORDS,           roles: ROLES_ADMIN },
  { keywords: GIAMDOC_KEYWORDS,         roles: ROLES_GIAM_DOC },
  { keywords: PHO_GIAMDOC_KEYWORDS,     roles: ROLES_PHO_GIAM_DOC },
  { keywords: TRUONGPHONG_KEYWORDS,     roles: ROLES_TRUONG_PHONG },
  { keywords: PHO_TRUONGPHONG_KEYWORDS, roles: ROLES_PHO_TRUONG_PHONG },
  { keywords: VANTHU_KEYWORDS,          roles: ROLES_VAN_THU },
  { keywords: NHANVIEN_KEYWORDS,        roles: ROLES_NHAN_VIEN },         // default, để cuối
];

module.exports = { roleMapping };