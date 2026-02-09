module.exports = {
  taskUsers2ProcessOrgMapping: {
    sourceTable: {
      schema: 'dbo',
      table: 'task_users2'
    },

    orgTable: {
      schema: 'dbo',
      table: 'organization_units'
    },

    condition: `
      [type] = 1
      AND userId_bak IS NOT NULL
    `,

    sourceBakField: 'userId_bak',

    orgBackupField: 'Id_backups',

    updateFields: {
      process_id: 'id',
      process_name: 'name'
    },

    updateTimeField: 'update_at'
  }
};
