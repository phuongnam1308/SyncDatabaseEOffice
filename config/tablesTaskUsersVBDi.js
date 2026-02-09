// config/tablesTaskUsersVBDi.js
const tableMappings = {
  task_users_vbdi: {
    oldTable: 'TaskVBDiPermission',
    oldJoinTable: 'UserField',
    oldSchema: 'dbo',
    oldDatabase: 'DataEOfficeSNP',

    newTable: 'task_users2',
    newSchema: 'dbo',
    newDatabase: 'camunda',

    fieldMapping: {
      'TaskId':          'id_task_bak',
      'UserId':          'userId_bak',
      'UserType':        'UserType',
      'Modified':        'update_at',
      'ModuleId':        'ModuleId',
      'Description':     'Description',
      'UserFieldName':   'role',             // sẽ override bằng logic mapping
      'Split':           'Split',
    },

    roleValueMapping: {
      'GroupUyQuyenLanhDaoTCT':  'assigner',
      'GroupThayTheLanhDaoTCT':  'assigner',
      'NguoiPhanViec':           'assigner',
      'AssignedTo':              'director',
      // Thêm các mapping khác nếu cần
    },

    requiredFields: [],

    defaultValues: {
      task_id: null,
      process_id: null,
      process_name: null,
      type: null,
      created_at: new Date().toISOString(),
    },

    handleDuplicateId: true,
    backupIdField: 'id_task_bak'   // dùng để check trùng (kết hợp với userId_bak)
  }
};

module.exports = { tableMappings };