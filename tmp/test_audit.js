const { StreamPassportMigrationModel } = require('../src/sync-passport/migrate/StreamPassportMigrationModel');
const model = new StreamPassportMigrationModel();
async function test() {
  try {
    const res = await model.queryNewDb('SELECT TOP 1 sharepoint_item_id, status FROM passport_borrow_request_sync_staging WHERE status IN (\'Phê duyệt\', \'Từ chối\', \'COMPLETED\', \'REJECTED\')');
    if (res.recordset.length > 0) {
      const id = res.recordset[0].sharepoint_item_id;
      console.log(`Testing with SharePoint ID: ${id}`);
      await model.processOne(id);
      
      // Verify audit
      const auditRes = await model.queryNewDb(`SELECT * FROM audit WHERE origin_id = 'migration_origin' ORDER BY time DESC`);
      console.log('--- AUDIT LOGS ---');
      console.log(JSON.stringify(auditRes.recordset, null, 2));
    } else {
      console.log('No eligible records found for dual-audit test.');
    }
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}
test();
