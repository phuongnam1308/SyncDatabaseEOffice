const logger = require('../../../utils/logger');
const StreamFileMigrationModel = require('./StreamFileMigrationModel');

class StreamFileMigrationService {
  constructor() {
    this.model = null;
    this.defaultBatchSize = 100;
  }

  async initialize() {
    try {
      this.model = new StreamFileMigrationModel();
      await this.model.initialize();
      logger.info('[StreamFileMigrationService] Initialized successfully');
    } catch (error) {
      logger.error('[StreamFileMigrationService] Initialize error:', error);
      throw new Error(`Khong the khoi tao service: ${error.message}`);
    }
  }

  async getStatus() {
    if (!this.model) {
      throw new Error('Service chua duoc khoi tao');
    }

    try {
      const status = await this.model.getStatus();

      return {
        totalInOldDb: status.totalInOldDb || 0,
        totalInNewDb: status.totalInNewDb || 0,
        remaining: status.remaining || 0,
        lastMigratedId: status.lastMigratedId || null
      };
    } catch (error) {
      logger.error('[StreamFileMigrationService.getStatus] Error:', error);
      throw error;
    }
  }

  async migrate({ limit = 0, batch = this.defaultBatchSize, lastProcessedId = '' } = {}) {
    const startTime = Date.now();

    if (!this.model) {
      throw new Error('Service chua duoc khoi tao. Goi initialize() truoc.');
    }

    if (batch <= 0) {
      throw new Error('Batch size phai lon hon 0');
    }

    if (limit < 0) {
      throw new Error('Limit khong duoc am');
    }

    let totalInserted = 0;
    let totalUpdated = 0;
    let totalProcessed = 0;
    let batchCount = 0;
    let hasMore = true;

    logger.info('[StreamFileMigrationService] Start migration');
    logger.info(`[StreamFileMigrationService] limit=${limit || 'ALL'}, batch=${batch}, lastProcessedId=${lastProcessedId}`);

    try {
      while (hasMore) {
        batchCount += 1;

        const oldRecords = await this.model.insertBatchToMain({
          batch,
          lastId: lastProcessedId
        });

        if (!oldRecords || oldRecords.length === 0) {
          hasMore = false;
          break;
        }

        const mappedRecords = await this.model.mapAndCleanBatch(oldRecords);
        const batchResult = await this.model.insertBatchToNewDb(mappedRecords);

        const inserted = batchResult.inserted || 0;
        const updated = batchResult.updated || 0;

        totalInserted += inserted;
        totalUpdated += updated;
        totalProcessed += oldRecords.length;

        if (oldRecords.length > 0) {
          lastProcessedId = String(oldRecords[oldRecords.length - 1].ID || '').trim();
        }

        if (limit > 0 && totalProcessed >= limit) {
          hasMore = false;
          break;
        }

        if (oldRecords.length < batch) {
          hasMore = false;
          break;
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('[StreamFileMigrationService] Migration completed');
      logger.info(`[StreamFileMigrationService] processed=${totalProcessed}, inserted=${totalInserted}, updated=${totalUpdated}, batches=${batchCount}, duration=${duration}s`);

      return {
        inserted: totalInserted,
        updated: totalUpdated,
        totalProcessed,
        batches: batchCount,
        duration
      };
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.error('[StreamFileMigrationService] Migration failed:', {
        message: error.message,
        duration: `${duration}s`
      });
      throw error;
    }
  }

  async rollback(options = {}) {
    if (!this.model) {
      throw new Error('Service chua duoc khoi tao');
    }

    try {
      logger.info('[StreamFileMigrationService] Starting rollback...');
      const result = await this.model.rollback(options);
      logger.info('[StreamFileMigrationService] Rollback completed');
      return result;
    } catch (error) {
      logger.error('[StreamFileMigrationService.rollback] Error:', error);
      throw error;
    }
  }
}

module.exports = StreamFileMigrationService;
