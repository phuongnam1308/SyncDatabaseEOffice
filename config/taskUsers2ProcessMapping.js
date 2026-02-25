module.exports = {
  taskUsers2ProcessMapping: {
    sourceTable: {
      database: 'DiOffice',
      schema: 'dbo',
      table: 'task_users2'
    },

    userTable: {
      database: 'DiOffice',
      schema: 'dbo',
      table: 'users'
    },

    matchFields: [
      'id_user_bak',
      'id_user_del_bak'
    ],

    sourceUserBakField: 'userId_bak',

    updateFields: {
      process_id: 'id',
      process_name: 'name'
    },

    condition: `
      userId_bak IS NOT NULL
      AND (process_id IS NULL OR process_name IS NULL)
    `,

    updateTimeField: 'update_at'
  }
};
