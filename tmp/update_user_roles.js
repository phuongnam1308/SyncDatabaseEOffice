const { StreamPassportMigrationModel } = require('../src/sync-passport/migrate/StreamPassportMigrationModel');
const model = new StreamPassportMigrationModel();

async function run() {
  try {
    console.log('[Script] Loading required roles from required_process_roles.json...');
    const requiredRoles = require('../src/sync-passport/migrate/required_process_roles.json');
    console.log(`[Script] Loaded ${requiredRoles.length} process roles.`);

    const db = process.env.NEW_DB_NAME || 'app_tancang';
    console.log(`[Script] Finding users involved in [${db}].[dbo].[passport_borrow_requests]...`);
    
    // Lấy danh sách ID người dùng thực tế có trong dữ liệu hộ chiếu
    const userResult = await model.queryNewDb(`
      SELECT DISTINCT requester_id as userId FROM [${db}].[dbo].[passport_borrow_requests] WHERE requester_id IS NOT NULL
      UNION
      SELECT DISTINCT created_by as userId FROM [${db}].[dbo].[passport_borrow_requests] WHERE created_by IS NOT NULL
    `);
    
    const userIds = userResult.map(r => r.userId);
    console.log(`[Script] Found ${userIds.length} relevant users.`);

    let updatedCount = 0;
    for (const userId of userIds) {
      const rows = await model.queryNewDb(`SELECT roles_by_process FROM [${db}].[dbo].[users] WHERE id = @id`, { id: userId });
      if (!rows || rows.length === 0) continue;

      const currentRolesStr = rows[0].roles_by_process;
      
      let existingRolesArr = [];
      if (currentRolesStr && currentRolesStr.trim() !== '' && currentRolesStr.trim() !== '[]') {
        try {
          existingRolesArr = JSON.parse(currentRolesStr);
        } catch (e) {
          console.error(`[Script] Error parsing roles for user ${userId}: ${e.message}`);
          continue;
        }
      }

      if (!Array.isArray(existingRolesArr)) existingRolesArr = [];

      const roleMap = new Map();
      existingRolesArr.forEach(item => {
        if (item && item.processKey) roleMap.set(item.processKey, item);
      });

      let changed = false;
      for (const req of requiredRoles) {
        const existing = roleMap.get(req.processKey);
        if (!existing) {
          existingRolesArr.push(req);
          changed = true;
        } else {
          // Merge roles inside the processKey
          const existingSubRoles = existing.roles || [];
          const reqSubRoles = req.roles || [];
          const subRoleCodes = new Set(existingSubRoles.map(r => r.roleCode));
          
          for (const rsr of reqSubRoles) {
            if (!subRoleCodes.has(rsr.roleCode)) {
              existingSubRoles.push(rsr);
              changed = true;
            }
          }
        }
      }

      if (changed) {
        const newRolesStr = JSON.stringify(existingRolesArr);
        await model.queryNewDb(`UPDATE [${db}].[dbo].[users] SET roles_by_process = @roles WHERE id = @id`, {
          id: userId,
          roles: newRolesStr
        });
        updatedCount++;
        if (updatedCount % 50 === 0) console.log(`[Script] Updated ${updatedCount} users...`);
      }
    }

    console.log(`[Script] FINISHED. Total users updated: ${updatedCount}/${userIds.length}`);
    process.exit(0);
  } catch (err) {
    console.error(`[Script] ERROR: ${err.message}`);
    process.exit(1);
  }
}

run();
