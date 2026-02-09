// config/tablesTaskUsersMapping.js
const tableMappings = {
  task_users_mapping: {
    sourceTable: 'task2',
    sourceSchema: 'dbo',
    sourceDatabase: 'camunda',

    targetTable: 'task_users2',
    targetSchema: 'dbo',
    targetDatabase: 'camunda',

    // Cột dùng để join/map
    backupIdFieldSource: 'id_taskBackups',   // trong task2
    backupIdFieldTarget: 'id_task_bak',      // trong task_users2
    targetUpdateField: 'task_id',            // cột cần update trong task_users2
    sourceIdField: 'id'                      // id mới trong task2
  }
};

module.exports = { tableMappings };