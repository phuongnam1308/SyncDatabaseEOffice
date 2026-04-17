const { queryNewDb } = require('./utils/dbUtils');

async function checkStatus() {
  try {
    const jobKey = 'Đồng bộ lịch họp';
    const rows = await queryNewDb(`
      SELECT job_id, model_name, total_to_sync, total_processed, total_success, total_errors, last_sync_time, last_sync_id, created_at, updated_at
      FROM sync_jobs
      WHERE model_name = @jobKey
    `, { jobKey });

    if (rows.length === 0) {
      console.log('No sync job found for:', jobKey);
      // Try technical key
      const technicalKey = 'STREAM_MEETING_COPY_MIGRATION';
      const rows2 = await queryNewDb(`
        SELECT job_id, model_name, total_to_sync, total_processed, total_success, total_errors, last_sync_time, last_sync_id, created_at, updated_at
        FROM sync_jobs
        WHERE model_name = @technicalKey
      `, { technicalKey });
      
      if (rows2.length === 0) {
        console.log('No sync job found for technical key:', technicalKey);
      } else {
        console.log('Status for technical key:', JSON.stringify(rows2[0], null, 2));
      }
    } else {
      console.log('Status for:', jobKey, JSON.stringify(rows[0], null, 2));
    }
    
    // Check some samples in meetings table
    const meetingSamples = await queryNewDb(`
        SELECT TOP 5 id, title, started_at, chairman_id, created_at
        FROM meetings
        ORDER BY created_at DESC
    `);
    console.log('Latest meetings:', JSON.stringify(meetingSamples, null, 2));

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    process.exit(0);
  }
}

checkStatus();
