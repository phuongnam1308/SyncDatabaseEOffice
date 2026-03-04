const ROLES_ADMIN = process.env.ROLE_ADMIN || 'ADMIN';
const ROLES_GIAM_DOC = process.env.ROLE_GIAM_DOC || 'GIAM_DOC';
const ROLES_PHO_GIAM_DOC = process.env.ROLE_PHO_GIAM_DOC || 'PHO_GIAM_DOC';
const ROLES_TRUONG_PHONG = process.env.ROLE_TRUONG_PHONG || 'TRUONG_PHONG';
const ROLES_PHO_TRUONG_PHONG = process.env.ROLE_PHO_TRUONG_PHONG || 'PHO_TRUONG_PHONG';
const ROLES_VAN_THU_CUC = process.env.ROLE_VAN_THU_CUC || 'VAN_THU_CUC';
const ROLES_VAN_THU = process.env.ROLE_VAN_THU || 'VAN_THU';
const ROLES_NHAN_VIEN = process.env.ROLE_NHAN_VIEN || 'NHAN_VIEN';

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
    // Thử parse JSON array trước
    if (trimmed.startsWith('[')) {
      const parsed = JSON.parse(trimmed);
      return parsed.map(k => String(k).trim().toLowerCase()).filter(Boolean);
    }
  } catch (_) {
    // không phải JSON hợp lệ → fallback sang split CSV
  }
  // CSV thông thường
  return trimmed.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
}

const ADMIN_KEYWORDS        = parseKeywords(process.env.ADMIN_KEYWORDS,         ['admin', 'administrator', 'quản trị viên', 'quản trị']);
const GIAMDOC_KEYWORDS      = parseKeywords(process.env.GIAMDOC_KEYWORDS,       ['giám đốc', 'giam doc']);
const PHO_GIAMDOC_KEYWORDS  = parseKeywords(process.env.PHO_GIAMDOC_KEYWORDS,   ['phó giám đốc']);
const TRUONGPHONG_KEYWORDS  = parseKeywords(process.env.TRUONGPHONG_KEYWORDS,   ['trưởng phòng']);
const PHO_TRUONGPHONG_KEYWORDS = parseKeywords(process.env.PHO_TRUONGPHONG_KEYWORDS, ['phó phòng', 'phó trưởng phòng']);
const VANTHUCUC_KEYWORDS    = parseKeywords(process.env.VANTHUCUC_KEYWORDS,     ['văn thư cục']);
const VANTHU_KEYWORDS       = parseKeywords(process.env.VANTHU_KEYWORDS,        ['văn thư']);
const NHANVIEN_KEYWORDS     = parseKeywords(process.env.NHANVIEN_KEYWORDS,      ['nhân viên', 'nhan vien', 'cán bộ', 'can bo']);

const roleMapping = [
    { keywords: ADMIN_KEYWORDS,           role: ROLES_ADMIN },
    { keywords: GIAMDOC_KEYWORDS,         role: ROLES_GIAM_DOC },
    { keywords: PHO_GIAMDOC_KEYWORDS,     role: ROLES_PHO_GIAM_DOC },
    { keywords: TRUONGPHONG_KEYWORDS,     role: ROLES_TRUONG_PHONG },
    { keywords: PHO_TRUONGPHONG_KEYWORDS, role: ROLES_PHO_TRUONG_PHONG },
    { keywords: VANTHUCUC_KEYWORDS,       role: ROLES_VAN_THU_CUC },
    { keywords: VANTHU_KEYWORDS,          role: ROLES_VAN_THU },
    { keywords: NHANVIEN_KEYWORDS,        role: ROLES_NHAN_VIEN },
];

module.exports = {
    roleMapping,
};