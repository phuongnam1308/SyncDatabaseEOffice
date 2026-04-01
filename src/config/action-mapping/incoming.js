/**
 * Bảng Mapping Trạng Thái Văn Bản Đến
 * Key: action_code
 * Value: Map(role -> status_code) với 'default' là giá trị mặc định cho hành động đó
 */
module.exports = {
  "CREATE": {
    default: 2
  },

  "TRINH_KY": {
    default: 2
  },

  "CHUYEN_XU_LY": {
    default: 2
  },

  "HOAN_THANH_VAN_BAN": {
    default: 5
  },

  "THU_HOI": {
    default: 1
  }
};
