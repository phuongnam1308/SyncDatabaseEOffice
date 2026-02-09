const tableMappings = {
  usergroup: {
    oldTable: 'UserGroup',
    oldSchema: 'SNP',              // Chú ý: schema là SNP, không phải dbo
    oldDatabase: 'DataEOfficeSNP',
    
    newTable: 'group_users',
    newSchema: 'dbo',
    newDatabase: 'DiOffice',
    
    fieldMapping: {
      'ID': 'id_group_bk',       // ID cũ lưu vào backup
      'Name': 'name',
      'Type': 'type',
      'AccountName': 'code'
      // Position không map vì bảng mới không có cột này (có thể bỏ hoặc map sang description nếu cần)
    },
    
    requiredFields: ['name', 'code'],
    
    defaultValues: {
      'id': function() { return require('uuid').v4().toUpperCase(); }, // Tạo GUID mới
      'userId': null,
    'status': function(record) { 
        // Sửa: Kiểm tra record tồn tại trước
        if (!record || record.WorkStatus === undefined || record.WorkStatus === null) {
        return 1;
        }
        return record.WorkStatus === -1 ? 3 : 1; 
    },
      'description': null,
      'permissionsId': null,
      'roleType': null,
      'roles': '[]',
      'createdAt': function() { return new Date(); },
      'updatedAt': function() { return new Date(); },
      'roles_dynamic': null,
      'organizationUnits': null
    },
    
    handleDuplicateCode: true,     // Tránh trùng code (vì có UNIQUE constraint)
    backupIdField: 'id_group_bk'
  }
};

module.exports = { tableMappings };