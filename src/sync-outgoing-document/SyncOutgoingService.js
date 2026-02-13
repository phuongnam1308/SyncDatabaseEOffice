// sync-outgoing.service.js
const logger = require('../../utils/logger');
const SyncOutgoingModel = require('./SyncOutgoingModel');

class SyncOutgoingService {
  constructor() {
    this.model = null;
    this.defaultBatchSize = 100;
  }

  async initialize() {
    try {
      this.model = new SyncOutgoingModel();
      await this.model.initialize();
      logger.info('[SyncOutgoingService] Initialized successfully');
    } catch (error) {
      logger.error('[SyncOutgoingService] Initialize error:', error);
      throw new Error(`Không thể khởi tạo service: ${error.message}`);
    }
  }

  async getStatus() {
    if (!this.model) throw new Error('Service chưa được khởi tạo');
    return await this.model.getStatus();
  }

  async sync({ limit = 0, batch = this.defaultBatchSize, lastProcessedId = 0 } = {}) {
    if (!this.model) throw new Error('Service chưa được khởi tạo');
    if (batch <= 0) throw new Error('Batch size phải lớn hơn 0');
    if (limit < 0) throw new Error('Limit không được âm');

    const startTime = Date.now();
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalProcessed = 0;
    let batchCount = 0;
    let hasMore = true;

    logger.info('='.repeat(80));
    logger.info(`[SyncOutgoingService] BẮT ĐẦU SYNC`);
    logger.info(`├─ Limit: ${limit || 'ALL'}`);
    logger.info(`├─ Batch Size: ${batch}`);
    logger.info('='.repeat(80));

    try {
      while (hasMore) {
        batchCount++;
        const batchStartTime = Date.now();

        logger.info(`\n┌─ BATCH ${batchCount} ${'─'.repeat(40)}`);

        const syncRecords = await this.model.fetchBatchFromSync({ batch, lastId: lastProcessedId });

        if (!syncRecords || syncRecords.length === 0) {
          logger.info(`│  ℹ️  No more records to process`);
          hasMore = false;
          break;
        }

        logger.info(`│  ✓ Fetched ${syncRecords.length} records from sync table`);

        const batchResult = await this.model.insertBatchToMain(syncRecords);
        
        totalInserted += batchResult.inserted || 0;
        totalUpdated += batchResult.updated || 0;
        totalProcessed += syncRecords.length;

        if (syncRecords.length > 0) {
          lastProcessedId = syncRecords[syncRecords.length - 1].id;
        }

        const batchDuration = ((Date.now() - batchStartTime) / 1000).toFixed(2);
        logger.info(`│  ✓ Inserted: ${batchResult.inserted}, Updated: ${batchResult.updated}`);
        logger.info(`│  ⏱️  Batch duration: ${batchDuration}s`);
        logger.info(`└${'─'.repeat(50)}`);

        if (limit > 0 && totalProcessed >= limit) {
          logger.info(`\n⚠️  Reached limit (${limit}). Stopping...`);
          hasMore = false;
          break;
        }

        if (syncRecords.length < batch) {
          logger.info(`\nℹ️  Last batch (received ${syncRecords.length} < ${batch}). Stopping...`);
          hasMore = false;
          break;
        }
      }

      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      logger.info('\n' + '='.repeat(80));
      logger.info('✅ SYNC HOÀN TẤT THÀNH CÔNG');
      logger.info('─'.repeat(80));
      logger.info(`├─ Total Processed: ${totalProcessed}`);
      logger.info(`├─ Total Inserted: ${totalInserted}`);
      logger.info(`├─ Total Updated: ${totalUpdated}`);
      logger.info(`├─ Total Batches: ${batchCount}`);
      logger.info(`├─ Total Duration: ${totalDuration}s`);
      logger.info(`└─ Avg per batch: ${(parseFloat(totalDuration) / batchCount).toFixed(2)}s`);
      logger.info('='.repeat(80));

      return {
        inserted: totalInserted,
        updated: totalUpdated,
        totalProcessed,
        batches: batchCount,
        duration: totalDuration
      };

    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.error('\n' + '='.repeat(80));
      logger.error('❌ SYNC FAILED');
      logger.error('─'.repeat(80));
      logger.error(`├─ Error: ${error.message}`);
      logger.error(`├─ Processed before error: ${totalProcessed}`);
      logger.error(`└─ Duration: ${duration}s`);
      logger.error('='.repeat(80));
      throw error;
    }
  }
}

module.exports = SyncOutgoingService;