// config/tablesSharePointGroup.js - ĐƠN GIẢN HÓA
const { v4: uuidv4 } = require('uuid');

const tableMappings = {
  sharepointgroup: {
    oldTable: '[Group]',
    oldSchema: 'dbo',
    oldDatabase: 'DataEOfficeSNP',
    
    newTable: 'group_users',
    newSchema: 'dbo',
    newDatabase: 'camunda',
    
    // CHỈ map các trường có trong cả 2 bảng
    fieldMapping: {
      'ID': 'id_group_bk',           // GUID cũ → backup id
      'Title': 'name',               // Title → name
      'Description': 'description',   // Description → description
      'Created': 'createdAt',        // Created → createdAt
      'Modified': 'updatedAt'        // Modified → updatedAt
    },
    
    requiredFields: ['Title'],
    
    defaultValues: {
      'id': function() { 
        return uuidv4().toUpperCase(); 
      },
      
      'code': function(record) {
        try {
          // Đơn giản: tạo code từ Title hoặc ID
          if (record && record.Title && typeof record.Title === 'string') {
            // Lấy chữ cái đầu tiên và số từ Title
            const cleanCode = record.Title
              .replace(/[^a-zA-Z0-9]/g, '')  // Chỉ giữ chữ và số
              .substring(0, 20)              // Giới hạn độ dài
              .toUpperCase();
            
            if (cleanCode && cleanCode.length > 0) {
              return cleanCode;
            }
          }
          
          // Fallback: dùng ID
          if (record && record.ID) {
            const idPart = record.ID.substring(0, 8).toUpperCase();
            return `GRP_${idPart}`;
          }
          
          // Fallback cuối
          return `GRP_${Date.now().toString(36).toUpperCase()}`;
          
        } catch (error) {
          return `GRP_${Date.now().toString(36).toUpperCase()}`;
        }
      },
      
      'type': function(record) {
        try {
          if (record && record.SPGroupId) {
            const spId = parseInt(record.SPGroupId);
            if (spId === 1) return 'OWNER';
            if (spId === 2) return 'MEMBER';
            if (spId === 3) return 'VISITOR';
          }
          return 'CUSTOM';
        } catch {
          return 'CUSTOM';
        }
      },
      
      'status': 1,  // Luôn là active
      
      'userId': null,  // OWNER = NULL (KHÔNG MAP)
      
      'roles': '[]',
      'roles_dynamic': null,
      'organizationUnits': null,
      'permissionsId': null,
      'roleType': null
    },
    
    handleDuplicateCode: true,
    backupIdField: 'id_group_bk'
  }
};

module.exports = { tableMappings };