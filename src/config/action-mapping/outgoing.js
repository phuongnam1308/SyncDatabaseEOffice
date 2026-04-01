/**
 * Bảng Mapping Trạng Thái Văn Bản Đi
 * Key: action_code
 * Value: Map(role -> status_code) với 'default' là giá trị dành cho mọi chức danh trừ khi bị ghi đè.
 */
module.exports = {
  "CREATE": {
    default: 2,
  },

  "TRINH_KY": {
    default: 2
  },

  "BAN_HANH": {
    default: 9
  },

  "THU_HOI": {
    default: 1
  }
};
