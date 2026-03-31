// Danh sách các vai trò chuẩn trong hệ thống
const ROLES = [
  "GIAM_DOC",
  "PHO_GIAM_DOC",
  "CHANH_VAN_PHONG",
  "PHO_CHANH_VAN_PHONG",
  "TRUONG_PHONG",
  "PHO_TRUONG_PHONG",
  "VAN_THU",
  "VAN_THU_CUC",
  "CAN_BO"
];

// Helper để điền mặc định các role chưa được khai báo với giá trị fallback (1)
function buildMapping(baseConfig, fallback = 1) {
  const result = {};
  for (const role of ROLES) {
    result[role] = baseConfig[role] !== undefined ? baseConfig[role] : fallback;
  }
  return result;
}

/**
 * Bảng Mapping Trạng Thái Văn Bản Đến
 * Key: action_code
 * Value: Map(role -> status_code)
 */
module.exports = {
  "CREATE": buildMapping({
    "CAN_BO": 2, 
    "VAN_THU": 2, 
    "TRUONG_PHONG": 1,
  }),

  "TRINH_KY": buildMapping({
    
  }),

  "CHUYEN_XU_LY": buildMapping({
    
  }),

  "HOAN_THANH_VAN_BAN": buildMapping({
    
  }),

  "BAN_HANH": buildMapping({
    
  }),

  "THU_HOI": buildMapping({
    
  })
};
