// config/tablesAgencies.js
const tableMappings = {
  agency: {
    oldTable: 'Department',
    oldSchema: 'dbo',
    oldDatabase: 'DataEOfficeSNP',

    newTable: 'agencies',
    newSchema: 'dbo',
    newDatabase: 'DiOffice',

    fieldMapping: {
      'ID': 'id_agencies_bak',
      'Title': 'name',
      'Code': 'code',
      'Manager': 'Manager',
      'Address': 'address',
      'PhoneNumber': 'phone_number',
      'IsExternal': 'industry_type'
    },

    requiredFields: ['name', 'code'],

    defaultValues: {
      'status': 1,
      'industry_type': 1,              // Mặc định 1 nếu IsExternal null
      'email': null,
      'description': null,
      'tran_status': null,
      'lgsp': null,
      'created_at': function() { return new Date(); },
      'updated_at': function() { return new Date(); }
    },

    handleDuplicateId: true,
    backupIdField: 'id_agencies_bak'
  }
};

module.exports = { tableMappings };