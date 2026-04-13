const path = require('path');
const exeDir = process.cwd();
require('dotenv').config({ path: path.join(exeDir, '.env') });

const SyncStateRepository = require('../src/sync-manager/SyncStateRepository');
const logger = require('../utils/logger');

async function cleanup() {
  try {
    logger.info('🚀 Bắt đầu dọn dẹp Dashboard Database...');

    // 1. Xóa các Model rác
    // UNIT_TEST_*, 3_incoming, tintuc_*
    const queryModels = `
      DELETE FROM sync_models 
      WHERE model_name LIKE 'UNIT_TEST_%' 
         OR model_name = '3_incoming' 
         OR model_name LIKE 'tintuc_%'
    `;
    const resModels = await SyncStateRepository.queryNewDb(queryModels);
    logger.info(`✅ Đã xóa các Model rác khỏi sync_models.`);

    // 2. Xóa các Job liên quan (để Dashboard không nạp lại)
    const queryJobs = `
      DELETE FROM sync_jobs 
      WHERE model_name LIKE 'UNIT_TEST_%' 
         OR model_name = '3_incoming' 
         OR model_name LIKE 'tintuc_%'
    `;
    await SyncStateRepository.queryNewDb(queryJobs);
    logger.info(`✅ Đã xóa các Job liên quan từ sync_jobs.`);

    // 3. Xóa các lỗi liên quan
    const queryErrors = `
      DELETE FROM sync_job_errors 
      WHERE job_id NOT IN (SELECT job_id FROM sync_jobs)
    `;
    await SyncStateRepository.queryNewDb(queryErrors);
    logger.info(`✅ Đã dọn dẹp các lỗi mồ côi từ sync_job_errors.`);

    logger.info('🎉 Dọn dẹp HOÀN TẤT! Dashboard của đồng chí sẽ cực kỳ tinh gọn.');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Lỗi khi dọn dẹp:', error.message);
    process.exit(1);
  }
}

cleanup();
