const sql = require('mssql');
require('dotenv').config();

async function check() {
    try {
        console.log('Connecting to old DB (source):', process.env.OLD_DB_SERVER);
        const oldPool = await sql.connect({
            user: process.env.OLD_DB_USER,
            password: process.env.OLD_DB_PASSWORD,
            server: process.env.OLD_DB_SERVER,
            database: process.env.OLD_DB_NAME,
            options: { encrypt: false, trustServerCertificate: true }
        });

        console.log('Connecting to new DB (target):', process.env.NEW_DB_SERVER);
        const newPool = new sql.ConnectionPool({
            user: process.env.NEW_DB_USER,
            password: process.env.NEW_DB_PASSWORD,
            server: process.env.NEW_DB_SERVER,
            database: process.env.NEW_DB_NAME,
            options: { encrypt: false, trustServerCertificate: true }
        });
        await newPool.connect();

        // 1. Get canonical list title
        const refDb = 'WSS_Content_eoffice_khkd';
        const refId = 'A769253C-E2D8-4188-AEF5-8841D04F42AE';
        let canonicalListTitle = null;
        try {
            const titleRes = await oldPool.request().query(`SELECT TOP 1 tp_Title FROM [${refDb}].[dbo].[AllLists] WHERE tp_ID = '${refId}'`);
            if (titleRes.recordset.length) {
                canonicalListTitle = titleRes.recordset[0].tp_Title;
                console.log(`Canonical List Title discovered: "${canonicalListTitle}"`);
            }
        } catch (err) {
            console.error('Failed to discover canonical title:', err.message);
        }

        // 2. Query target DB info
        console.log('\n--- TARGET DB (DiOffice) ---');
        
        // Sync Job Status
        const jobRes = await newPool.request().query("SELECT job_id, model_name, last_sync_time, last_sync_id, total_to_sync, total_processed, total_success, total_errors, status, message FROM sync_jobs WHERE model_name LIKE N'%họp%' OR job_id = 'STREAM_MEETING_COPY_MIGRATION'");
        console.log('Sync Job Status in sync_jobs:');
        console.log(JSON.stringify(jobRes.recordset, null, 2));

        // Staging Count
        const stagingTotalRes = await newPool.request().query("SELECT COUNT(*) as count FROM meeting_sync_staging");
        console.log(`Total records in meeting_sync_staging: ${stagingTotalRes.recordset[0].count}`);

        // Target Meetings Count
        const meetingsTotalRes = await newPool.request().query("SELECT COUNT(*) as count FROM meetings");
        console.log(`Total records in meetings table: ${meetingsTotalRes.recordset[0].count}`);

        const meetingsBakRes = await newPool.request().query("SELECT COUNT(*) as count FROM meetings WHERE table_bak = 1");
        console.log(`Records in meetings table with table_bak = 1: ${meetingsBakRes.recordset[0].count}`);

        // Staging Breakdown by source_db, MigrateFlg, MigrateErrFlg
        const stagingBreakdown = await newPool.request().query(`
            SELECT 
                source_db, 
                MigrateFlg, 
                MigrateErrFlg, 
                COUNT(*) as count
            FROM meeting_sync_staging
            GROUP BY source_db, MigrateFlg, MigrateErrFlg
            ORDER BY source_db, MigrateFlg, MigrateErrFlg
        `);
        console.log('\nBreakdown of meeting_sync_staging:');
        console.table(stagingBreakdown.recordset);

        // Errors in Staging
        const stagingErrors = await newPool.request().query(`
            SELECT TOP 10 
                source_db, ID, tp_ListId, MigrateErrMess, __sync_time
            FROM meeting_sync_staging
            WHERE MigrateErrFlg = 1 OR MigrateFlg = 3
        `);
        if (stagingErrors.recordset.length > 0) {
            console.log('\nSample Staging Errors:');
            console.table(stagingErrors.recordset);
        } else {
            console.log('\nNo staging errors (MigrateErrFlg = 1) found.');
        }

        // 3. Count in source databases
        console.log('\n--- SOURCE DATABASES (SharePoint Content DBs) ---');
        const databases = require('../src/sync-meeting copy/migrate/databases.json');
        
        let grandTotalSource = 0;
        const dbSummary = [];
        
        for (const db of databases) {
            let discoveredIds = [];
            if (canonicalListTitle) {
                try {
                    const rows = await oldPool.request().query(`SELECT tp_ID FROM [${db}].[dbo].[AllLists] WHERE tp_Title = N'${canonicalListTitle.replace(/'/g, "''")}' AND tp_DeleteTransactionId = 0x0`);
                    discoveredIds = rows.recordset.map(r => String(r.tp_ID).toUpperCase());
                } catch (e) {}
            }
            
            if (discoveredIds.length === 0) {
                const keywords = ['Lịch họp', 'Đăng ký họp', 'Lịchhọp', 'Lịch công tác'];
                const patterns = keywords.map(k => `tp_Title LIKE N'%${k}%'`).join(' OR ');
                const query = `
                    SELECT tp_ID
                    FROM [${db}].[dbo].[AllLists]
                    WHERE (${patterns})
                    AND tp_DeleteTransactionId = 0x0
                    AND tp_Title NOT LIKE N'%Đính kèm%'
                    AND tp_Title NOT LIKE N'%Văn bản%'
                    AND tp_Title NOT LIKE N'%Tài liệu%'
                `;
                try {
                    const rows = await oldPool.request().query(query);
                    discoveredIds = rows.recordset.map(r => String(r.tp_ID).toUpperCase());
                } catch (e) {}
            }
            
            if (discoveredIds.length > 0) {
                const listIdsStr = discoveredIds.map(id => `'${id}'`).join(',');
                const countQuery = `
                    SELECT COUNT(*) AS total
                    FROM [${db}].[dbo].[AllUserData] ud
                    WHERE ud.[tp_ListId] IN (${listIdsStr})
                    AND ud.tp_RowOrdinal = 0
                `;
                try {
                    const res = await oldPool.request().query(countQuery);
                    const total = res.recordset[0].total;
                    grandTotalSource += total;
                    dbSummary.push({ db, listsFound: discoveredIds.length, total });
                } catch (err) {
                    dbSummary.push({ db, error: err.message });
                }
            } else {
                dbSummary.push({ db, listsFound: 0, total: 0 });
            }
        }
        
        console.log(`Grand Total in all SharePoint source DBs: ${grandTotalSource}`);
        console.log('\nTop Databases by record count:');
        console.table(dbSummary.filter(d => d.total > 0).sort((a,b) => b.total - a.total));

        await oldPool.close();
        await newPool.close();
        process.exit(0);
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
}

check();
