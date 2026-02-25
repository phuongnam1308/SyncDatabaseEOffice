const logger = require('../../../utils/logger');
const SyncFileModel = require('./SyncFileModel');

class SyncFileService {
  constructor() {
    this.model = null;
    this.defaultBatchSize = 100;
  }

  async initialize() {
    try {
      this.model = new SyncFileModel();
      await this.model.initialize();
      logger.info('[SyncFileService] Initialized successfully');
    } catch (error) {
      logger.error('[SyncFileService] Initialize error:', error);
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
    logger.info(`[SyncFileService] BẮT ĐẦU SYNC`);
    // ...logic sync file...
    logger.info(`[SyncFileService] KẾT THÚC SYNC`);
    return {
      inserted: totalInserted,
      updated: totalUpdated,
      totalProcessed,
      batches: batchCount,
      duration: ((Date.now() - startTime) / 1000).toFixed(2)
    };
  }
}

module.exports = SyncFileService;
