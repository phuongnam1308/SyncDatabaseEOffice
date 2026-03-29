const {
  ADMIN_KEYWORDS,
  ROLES_ADMIN,
  GIAMDOC_KEYWORDS,
  ROLES_GIAM_DOC,
  PHO_GIAMDOC_KEYWORDS,
  ROLES_PHO_GIAM_DOC,
  TRUONGPHONG_KEYWORDS,
  ROLES_TRUONG_PHONG,
  PHO_TRUONGPHONG_KEYWORDS,
  ROLES_PHO_TRUONG_PHONG,
  VANTHUCUC_KEYWORDS,
  ROLES_VAN_THU_CUC,
  VANTHU_KEYWORDS,
  ROLES_VAN_THU,
  NHANVIEN_KEYWORDS,
  ROLES_DEFAULT
} = require('../../config');

// ── Mapping (thứ tự ưu tiên từ trên xuống) ───────────────────────────────────
const roleMapping = [
  { keywords: VANTHUCUC_KEYWORDS,       roles: ROLES_VAN_THU_CUC },      // ưu tiên trước VANTHU
  { keywords: ADMIN_KEYWORDS,           roles: ROLES_ADMIN },
  { keywords: GIAMDOC_KEYWORDS,         roles: ROLES_GIAM_DOC },
  { keywords: PHO_GIAMDOC_KEYWORDS,     roles: ROLES_PHO_GIAM_DOC },
  { keywords: TRUONGPHONG_KEYWORDS,     roles: ROLES_TRUONG_PHONG },
  { keywords: PHO_TRUONGPHONG_KEYWORDS, roles: ROLES_PHO_TRUONG_PHONG },
  { keywords: VANTHU_KEYWORDS,          roles: ROLES_VAN_THU },
  { keywords: NHANVIEN_KEYWORDS,        roles: ROLES_DEFAULT },         // default, để cuối
];

module.exports = { roleMapping };