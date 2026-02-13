// config/tablesUserInGroup.js (bảng mapping cho UserInGroup)
const tableMappings = {
  useringroup: {
    oldTable: 'UserInGroup',
    oldSchema: 'dbo',
    oldDatabase: 'DataEOfficeSNP',

    newTable: 'user_group_users_bak',
    newSchema: 'dbo',
    newDatabase: 'camunda',

    fieldMapping: {
      'UserId': 'id_user_bak',    // UserId cũ → id_user_bak
      'GroupId': 'id_group_bak',  // GroupId cũ → id_group_bak
      'Modified': 'updated_at'    // Cập nhật updated_at
    },

    requiredFields: [],  // Không có required bắt buộc vì là bảng trung gian

    defaultValues: {
      // 'id_user': (record) => null,    // XÓA - cột không tồn tại trong bảng
      // 'id_group': (record) => null,   // XÓA - cột không tồn tại trong bảng
      'id_user_del_bak': null,
      'table_bak': 'UserInGroup',        // THÊM: đánh dấu bảng nguồn
      'created_at': () => new Date()     // THÊM: fill created_at
    },

    handleDuplicate: false,
    backupIdField: null
  }
};

module.exports = { tableMappings };