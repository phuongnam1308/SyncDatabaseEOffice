const logger = require('../utils/logger');
const SyncManager = require('../sync-manager/SyncManager');

class BaseIncrementalSyncService {
  constructor(model) {
    this.model = model;
    this.syncManager = new SyncManager(this.model.modelName);
  }

  async start() {
    try {
      await this.syncManager.run(async (lastSyncTime, job) => {
        const rows = await this.model.fetchListFromOldDb(lastSyncTime);
        if (!rows || rows.length === 0) {
          logger.info(`[${this.model.modelName}] No new data to sync.`);
          return;
        }

        await this.model.syncOldToStaging(rows, { transaction: null });
        job.totalItems = rows.length;
        await job.updateProgress(0);

        for (let i = 0; i < rows.length; i++) {
          const rowData = await this.model.fetchOneFromStaging({
            lastSyncTime,
            itemIndex: i,
            transaction: null
          });
          if (rowData) {
            await this.model.processRowData(rowData, { transaction: null });
          }
          await job.updateProgress(i + 1);
        }
      });
      return { success: true };
    } catch (error) {
      logger.error(`[${this.model.modelName}] Sync failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

module.exports = BaseIncrementalSyncService;
