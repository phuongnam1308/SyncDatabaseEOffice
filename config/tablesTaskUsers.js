// config/tablesTaskUsers.js
const tableMappings = {
  task_users2: {
    oldTable: 'TaskVBDenPermission',
    oldJoinTable: 'UserField',
    oldSchema: 'dbo',
    oldDatabase: 'DataEOfficeSNP',

    newTable: 'task_users2',
    newSchema: 'dbo',
    newDatabase: 'camunda',

    fieldMapping: {
      // cột từ query → cột trong task_users2
      'TaskId':          'id_task_bak',
      'UserId':          'userId_bak',
      'UserType':        'UserType',
      'Modified':        'update_at',         // sẽ convert sang ISO string
      'ModuleId':        'ModuleId',
      'Description':     'Description',
      'UserFieldName':   'role',              // sẽ map giá trị sau
      'Split':           'Split',
    },

    roleValueMapping: {
      'NguoiPhanViec': 'assigner',
      'AssignedTo':    'director',
      // thêm mapping khác nếu có
      // default nếu không match → giữ nguyên hoặc null
    },

    requiredFields: [],

    defaultValues: {
      task_id: null,
      process_id: null,
      process_name: null,
      type: null,           // có thể set 'candidate' / 'assignee' tùy logic sau
      created_at: new Date().toISOString(),
      // các trường khác nếu cần default
    },

    handleDuplicateId: true,
    backupIdField: 'id_task_bak'   // để check trùng lặp (kết hợp với userId_bak nếu cần)
  }
};

module.exports = { tableMappings };