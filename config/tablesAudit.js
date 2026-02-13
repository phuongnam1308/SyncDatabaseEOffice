// config/tablesAudit.js
const tableMappings = {
  audit: {
    oldTable: 'LuanChuyenVanBan',
    oldSchema: 'dbo',
    oldDatabase: 'DataEOfficeSNP',

    newTable: 'audit2',
    newSchema: 'dbo',
    newDatabase: 'DiOffice',

    fieldMapping: {
      'ID': 'origin_id',  // Lưu ID cũ vào origin_id
      'IDVanBan': 'IDVanBan',
      'NguoiXuLy': 'NguoiXuLy',
      'NgayTao': 'time',  // Map ngày tạo sang time (DATETIME)
      'HanhDong': 'HanhDong',
      'Category': 'Category',
      'IDVanBanGoc': 'IDVanBanGoc',
      'VBId': 'VBId',
      'VBGocId': 'VBGocId',
    },

    requiredFields: [],  // Không bắt buộc, tất cả NULL được

    defaultValues: {
      document_id: null,
      user_id: null,
      display_name: null,
      'role': null,
      action_code: null,
      from_node_id: null,
      to_node_id: null,
      details: null,
      created_by: null,
      receiver: null,
      receiver_unit: null,
      'group_': null,
      roleProcess: null,
      'action': null,
      deadline: null,
      stage_status: null,
      curStatusCode: null,
      created_at: new Date(),  // Giá trị trực tiếp
      updated_at: new Date(),
      type_document: null ,  // Hoặc 'OutgoingDocument' tùy loại
      processed_by: null,
    },

    handleDuplicateId: true,
    backupIdField: 'origin_id'  // Để check duplicate
  }
};

module.exports = { tableMappings };