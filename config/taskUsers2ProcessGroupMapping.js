module.exports = {
  taskUsers2ProcessGroupMapping: {
    sourceTable: {
      schema: 'dbo',
      table: 'task_users2'
    },

    groupTable: {
      schema: 'dbo',
      table: 'group_users'
    },

    condition: `
      [type] = 2
      AND userId_bak IS NOT NULL
    `,

    sourceBakField: 'userId_bak',

    groupBackupField: 'id_group_bk',

    updateFields: {
      process_id: 'id',
      process_name: 'name'
    },

    updateTimeField: 'update_at'
  }
};
