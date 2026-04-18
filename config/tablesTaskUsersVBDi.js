// config/tablesTaskUsersVBDi.js
const tableMappings = {
  task_users_vbdi: {
    oldTable: 'TaskVBDiPermission',
    oldJoinTable: 'UserField',
    oldSchema: 'dbo',
    oldDatabase: process.env.OLD_DB_NAME,

    newTable: 'task_users2',
    newSchema: 'dbo',
    newDatabase: process.env.NEW_DB_NAME,

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
      'NguoiChuTri':             'main',
      'ChuTri':                  'main',
      'NguoiPhoiHop':            'coordinator',
      'PhoiHop':                 'coordinator',
      'NguoiXem':                'viewer',
      'Xem':                     'viewer',
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