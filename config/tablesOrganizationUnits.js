const tableMappings = {
  phongban: {
    oldTable: 'PhongBan',
    oldSchema: 'dbo',
    oldDatabase: 'DataEOfficeSNP',
    
    newTable: 'organization_units',
    newSchema: 'dbo',
    newDatabase: 'camunda',
    
    fieldMapping: {
      'ID': 'id',
      'TitleVn': 'name',
      'Code': 'code',
      'ParentID': 'parentId'
    },
    
    requiredFields: ['name'],
    
    defaultValues: {
      'type': null,
      'phone_number': null,
      'email': null,
      'leader': null,
      'position': null,
      'address': null,
      'description': null,
      'display_order': 0,
      'status': 1,
      'mpath': null,
      'created_at': function() { return new Date(); },
      'updated_at': function() { return new Date(); },
      'table_backups': 'PhongBan'
    },
    
    handleDuplicateId: true,
    backupIdField: 'Id_backups'
  },

  position: {
    oldTable: 'Position',
    oldSchema: 'dbo',
    oldDatabase: 'DataEOfficeSNP',
    
    newTable: 'organization_units',
    newSchema: 'dbo',
    newDatabase: 'camunda',
    
    fieldMapping: {
      'ID': 'id',
      'TitleVn': 'name',
      'Code': 'code',
      // 'ParentID': 'parentId'
    },
    
    requiredFields: ['name'],
    
    defaultValues: {
      'type': 'position',
      'phone_number': null,
      'email': null,
      'leader': null,
      'position': null,
      'address': null,
      'description': null,
      'display_order': 0,
      'status': 1,
      'mpath': null,
      'parentId': null,
      'created_at': function() { return new Date(); },
      'updated_at': function() { return new Date(); },
      'table_backups': 'Position'
    },
    
    handleDuplicateId: true,
    backupIdField: 'Id_backups'
  }
};

module.exports = {
  tableMappings
};