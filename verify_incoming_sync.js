const sql = require('mssql');
require('dotenv').config();
const StreamIncomingIncrementalModel = require('./src/sync-incoming-document/models/StreamIncomingIncrementalModel');

async function test() {
    console.log('--- TESTING INCOMING SYNC FORWARD LOGIC ---');
    const model = new StreamIncomingIncrementalModel();
    
    try {
        await model.initialize();
        
        console.log('\n[1] Testing Staging MAX(Modified) detection...');
        // Query directly to compare
        const stagingTableRef = model.getStagingTableRef();
        const maxRes = await model.queryNewDb(`SELECT MAX(Modified) as maxTime FROM ${stagingTableRef}`);
        console.log('Direct Query MAX(Modified):', maxRes[0].maxTime);
        
        // Test normalizeSyncTime
        const normalized = model.normalizeSyncTime(maxRes[0].maxTime);
        console.log('Normalized MAX Sync Time:', normalized);

        console.log('\n[2] Testing fetchListFromOldDb (ASC order)...');
        // Use a very old sync time to see first records
        const sampleLastSyncTime = '2010-01-01T00:00:00.000Z';
        const rows = await model.fetchListFromOldDb(sampleLastSyncTime, 0);
        
        if (rows && rows.length > 0) {
            console.log('Fetched rows:', rows.length);
            console.log('First record sync_time:', rows[0].__sync_time);
            console.log('Last record sync_time:', rows[rows.length - 1].__sync_time);
            
            const t1 = new Date(rows[0].__sync_time).getTime();
            const t2 = new Date(rows[rows.length - 1].__sync_time).getTime();
            
            if (t1 <= t2) {
                console.log('SUCCESS: Rows are in ASCENDING order.');
            } else {
                console.log('FAILURE: Rows are NOT in ASCENDING order.');
            }
        } else {
            console.log('No rows found for old sync time.');
        }

        console.log('\n[3] Testing isCursorAhead (ASC)...');
        const newer = '2024-04-09T00:00:00.000Z';
        const older = '2024-04-01T00:00:00.000Z';
        const isAhead = model.isCursorAhead(newer, 10, older, 100);
        console.log(`Is ${newer} ahead of ${older}?`, isAhead);
        if (isAhead === true) {
            console.log('SUCCESS: isCursorAhead correctly identifies newer date as forward.');
        } else {
            console.log('FAILURE: isCursorAhead logic is incorrect for ASC mode.');
        }

        await model.destroy();
        process.exit(0);
    } catch (err) {
        console.error('Test failed:', err);
        process.exit(1);
    }
}

test();
