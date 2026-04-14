const {
  ADMIN_KEYWORDS,
  ROLES_ADMIN,
  GIAM_DOC_KEYWORDS,
  ROLES_GIAM_DOC,
  PHO_GIAM_DOC_KEYWORDS,
  ROLES_PHO_GIAM_DOC,
  TRUONG_PHONG_KEYWORDS,
  ROLES_TRUONG_PHONG,
  PHO_TRUONG_PHONG_KEYWORDS,
  ROLES_PHO_TRUONG_PHONG,
  VAN_THU_CUC_KEYWORDS,
  ROLES_VAN_THU_CUC,
  VAN_THU_KEYWORDS,
  ROLES_VAN_THU,
  NHANVIEN_KEYWORDS,
  ROLES_DEFAULT
} = require('../../config');

// ── Mapping (thứ tự ưu tiên từ trên xuống) ───────────────────────────────────
const roleMapping = [
  { keywords: VAN_THU_CUC_KEYWORDS,       roles: ROLES_VAN_THU_CUC },      // ưu tiên trước VANTHU
  { keywords: ADMIN_KEYWORDS,           roles: ROLES_ADMIN },
  { keywords: GIAM_DOC_KEYWORDS,         roles: ROLES_GIAM_DOC },
  { keywords: PHO_GIAM_DOC_KEYWORDS,     roles: ROLES_PHO_GIAM_DOC },
  { keywords: TRUONG_PHONG_KEYWORDS,     roles: ROLES_TRUONG_PHONG },
  { keywords: PHO_TRUONG_PHONG_KEYWORDS, roles: ROLES_PHO_TRUONG_PHONG },
  { keywords: VAN_THU_KEYWORDS,          roles: ROLES_VAN_THU },
  { keywords: NHANVIEN_KEYWORDS,        roles: ROLES_DEFAULT },         // default, để cuối
];

module.exports = { roleMapping };