/**
 * TEST FILE: Check if ASPX files are being fetched from SharePoint database
 * Mục đích: Kiểm tra dữ liệu từ DB cũ (AllDocs)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const StreamNewsAspxPageMigrationService = require('./services/StreamNewsAspxPageMigrationService');
const logger = require('../../utils/logger');

class CheckDataFetch {
  constructor() {
    this.service = new StreamNewsAspxPageMigrationService();
  }

  async test1_CheckSharePointDb() {
    console.log('\n[TEST 1] Checking SharePoint Database Connection...');

    try {
      await this.service.initialize();
      const model = this.service.model;

      console.log('SharePoint DB:', model.sharePointDb);

      // Try to query SharePoint DB
      const query = `SELECT TOP 1 * FROM [${model.sharePointDb}].[dbo].[AllWebs]`;
      const rows = await model.queryOldDb(query);

      console.log('✓ Connected to SharePoint DB');
      console.log('  Sample web:', rows[0]?.FullUrl);

      return true;
    } catch (err) {
      console.error('✗ Failed to connect:', err.message);
      return false;
    }
  }

  async test2_CountAspxFiles() {
    console.log('\n[TEST 2] Counting ASPX files in SharePoint...');

    try {
      await this.service.initialize();
      const model = this.service.model;

      const query = `
                SELECT COUNT(1) as cnt
                FROM [${model.sharePointDb}].[dbo].[AllDocs] d
                INNER JOIN [${model.sharePointDb}].[dbo].[AllWebs] w
                  ON d.[SiteId] = w.[SiteId] AND d.[WebId] = w.[Id]
                WHERE
                  d.[DeleteTransactionId] = 0x0
                  AND d.[IsCurrentVersion] = 1
                  AND w.[FullUrl] LIKE '%tintuc%'
                  AND d.[LeafName] LIKE '%.aspx'
            `;

      const rows = await model.queryOldDb(query);
      const count = rows[0]?.cnt || 0;

      console.log('✓ Total ASPX files found:', count);

      if (count === 0) {
        console.warn('⚠ No ASPX files found! Check:');
        console.warn('  - Is there a tintuc site in SharePoint?');
        console.warn('  - Are there any ASPX files?');
      }

      return count;
    } catch (err) {
      console.error('✗ Failed:', err.message);
      return 0;
    }
  }

  async test3_GetSampleAspxFiles() {
    console.log('\n[TEST 3] Fetching sample ASPX files...');

    try {
      await this.service.initialize();
      const model = this.service.model;

      const query = `
                SELECT TOP 5
                    d.[Id] as DocId,
                    d.[LeafName],
                    d.[DirName],
                    d.[TimeLastModified],
                    w.[FullUrl] as WebUrl
                FROM [${model.sharePointDb}].[dbo].[AllDocs] d
                INNER JOIN [${model.sharePointDb}].[dbo].[AllWebs] w
                  ON d.[SiteId] = w.[SiteId] AND d.[WebId] = w.[Id]
                WHERE
                  d.[DeleteTransactionId] = 0x0
                  AND d.[IsCurrentVersion] = 1
                  AND w.[FullUrl] LIKE '%tintuc%'
                  AND d.[LeafName] LIKE '%.aspx'
                ORDER BY d.[TimeLastModified] DESC
            `;

      const rows = await model.queryOldDb(query);

      console.log(`✓ Found ${rows.length} sample files:`);
      rows.forEach((row, idx) => {
        console.log(`\n  [${idx + 1}] ${row.LeafName}`);
        console.log(`      ID: ${row.DocId}`);
        console.log(`      Web: ${row.WebUrl}`);
        console.log(`      Dir: ${row.DirName}`);
        console.log(`      Modified: ${row.TimeLastModified}`);
      });

      return rows;
    } catch (err) {
      console.error('✗ Failed:', err.message);
      return [];
    }
  }

  async test4_GetListSyncState() {
    console.log('\n[TEST 4] Getting list sync state...');

    try {
      await this.service.initialize();

      const result = await this.service.testGetList();

      console.log('✓ Sync state:');
      console.log('  Total to process:', result.totalCount);
      console.log('  Staged count:', result.stagedCount);
      console.log('  Processing:', result.processingItem);
      console.log('  Last sync time:', result.lastSyncTime);
      console.log('  Last sync ID:', result.lastSyncId);

      return result;
    } catch (err) {
      console.error('✗ Failed:', err.message);
      return null;
    }
  }

  async test5_CheckStagingAfterList() {
    console.log('\n[TEST 5] Checking staging table after getList()...');

    try {
      await this.service.initialize();
      const model = this.service.model;

      const query = `
                SELECT COUNT(1) as pending
                FROM ${model.getStagingTableRef()}
                WHERE ISNULL(DownloadStatus, '') NOT IN ('OK', 'ERROR')
            `;

      const rows = await model.queryNewDb(query);
      const pending = rows[0]?.pending || 0;

      console.log('✓ Staging table status:');
      console.log('  Pending items:', pending);

      if (pending === 0) {
        console.warn('⚠ No pending items in staging! The getList() might not have fetched data.');
      }

      // Also get sample rows
      const sampleQuery = `
                SELECT TOP 3
                    DocId,
                    LeafName,
                    DownloadStatus,
                    TimeLastModified
                FROM ${model.getStagingTableRef()}
                ORDER BY TimeLastModified DESC
            `;

      const samples = await model.queryNewDb(sampleQuery);
      console.log(`\n  Sample rows in staging (${samples.length}):`);
      samples.forEach((row, idx) => {
        console.log(
          `    [${idx + 1}] ${row.LeafName} | Status: ${row.DownloadStatus || 'PENDING'}`,
        );
      });

      return pending;
    } catch (err) {
      console.error('✗ Failed:', err.message);
      return 0;
    }
  }

  async test6_ManualFetchList() {
    console.log('\n[TEST 6] Manually fetching list from SharePoint...');

    try {
      await this.service.initialize();
      const model = this.service.model;

      // Fetch without staging - directly from AllDocs
      const rows = await model.fetchListFromOldDb(
        '1900-01-01T00:00:00.000Z', // Start from beginning
        0,
        10, // Just get 10 items
        0,
        'ASC', // Go forward
      );

      console.log(`✓ Fetched ${rows.length} items from SharePoint`);
      rows.forEach((row, idx) => {
        console.log(`\n  [${idx + 1}] ${row.LeafName}`);
        console.log(`      DocId: ${row.DocId}`);
        console.log(`      Web: ${row.WebUrl}`);
        console.log(`      Modified: ${row.TimeLastModified}`);
        console.log(`      SyncId: ${row.__sync_id}`);
      });

      return rows;
    } catch (err) {
      console.error('✗ Failed:', err.message);
      console.error('Stack:', err.stack);
      return [];
    }
  }

  async test7_CheckEnvironmentVariables() {
    console.log('\n[TEST 7] Checking environment variables...');

    const vars = [
      'OLD_DB_SERVER',
      'SHAREPOINT_DB_NAME',
      'NEW_DB_NAME',
      'NEW_DB_SERVER',
      'NEW_DB_USER',
      'BASE_URL',
      'TINTUCRAW_DIR',
      'COMPLETED_LIMIT',
      'BEGIN_LIMIT',
    ];

    vars.forEach((v) => {
      const value = process.env[v];
      const display = value
        ? v.includes('PASSWORD') || v.includes('USER')
          ? '***'
          : value
        : '(not set)';
      console.log(`  ${v}: ${display}`);
    });

    return true;
  }

  async runAll() {
    console.log('='.repeat(70));
    console.log('CHECK DATA FETCH FROM SHAREPOINT');
    console.log('Started:', new Date().toISOString());
    console.log('='.repeat(70));

    await this.test7_CheckEnvironmentVariables();
    await this.test1_CheckSharePointDb();

    const count = await this.test2_CountAspxFiles();
    if (count === 0) {
      console.warn('\n✗ No ASPX files found. Cannot continue testing.');
      process.exit(1);
    }

    await this.test3_GetSampleAspxFiles();
    await this.test6_ManualFetchList();
    await this.test4_GetListSyncState();
    await this.test5_CheckStagingAfterList();

    console.log('\n' + '='.repeat(70));
    console.log('DATA FETCH TEST COMPLETED');
    console.log('='.repeat(70));
  }
}

// Run
const tester = new CheckDataFetch();
tester
  .runAll()
  .then(() => {
    console.log('\n✓ All tests complete');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n✗ Test failed:', err.message);
    process.exit(1);
  });
