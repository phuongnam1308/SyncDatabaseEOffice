const { StreamPassportMigrationModel } = require('../src/sync-passport/migrate/StreamPassportMigrationModel');
const model = new StreamPassportMigrationModel();

async function run() {
  try {
    const db = process.env.NEW_DB_NAME || 'app_tancang';
    const groupUserId = 'b59238b0-6de2-4bda-87ac-f62ccab182bf';
    
    console.log(`[Script] Finding users involved in passport borrowing to assign to group ${groupUserId}...`);
    
    const userResult = await model.queryNewDb(`
      SELECT DISTINCT requester_id as userId FROM [${db}].[dbo].[passport_borrow_requests] WHERE requester_id IS NOT NULL
      UNION
      SELECT DISTINCT created_by as userId FROM [${db}].[dbo].[passport_borrow_requests] WHERE created_by IS NOT NULL
    `);
    
    const userIds = userResult.map(r => r.userId);
    console.log(`[Script] Found ${userIds.length} relevant users.`);

    let updatedCount = 0;
    for (const userId of userIds) {
      const checkQ = `SELECT 1 FROM [${db}].[dbo].[user_group_users] WHERE user_id = @userId AND group_user_id = @groupUserId`;
      const rows = await model.queryNewDb(checkQ, { userId, groupUserId });
      
      if (!rows || rows.length === 0) {
        const insertQ = `INSERT INTO [${db}].[dbo].[user_group_users] (user_id, group_user_id) VALUES (@userId, @groupUserId)`;
        await model.queryNewDb(insertQ, { userId, groupUserId });
        updatedCount++;
      }
    }

    console.log(`[Script] FINISHED. Total users assigned to group: ${updatedCount}/${userIds.length}`);
    process.exit(0);
  } catch (err) {
    console.error(`[Script] ERROR: ${err.message}`);
    process.exit(1);
  }
}

run();
