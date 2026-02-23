const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const STATE_FILE = path.join(__dirname, '../logs/sync_state_src.json');

class SyncManagerService {
  constructor() {
    this.registry = new Map();
    this.isRunning = false;
    this.batchSize = parseInt(process.env.BATCH_SIZE || '100', 10);
    this.state = this.loadState();
  }

  ensureStateDir() {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      }
    } catch (error) {
      logger.error('[SyncManagerService] Cannot read state file:', error);
    }
    return {};
  }

  saveState() {
    try {
      this.ensureStateDir();
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
    } catch (error) {
      logger.error('[SyncManagerService] Cannot save state file:', error);
    }
  }

  /**
   * @param {string} name
   * @param {(lastUpdatedAt: string, limit: number, offset: number) => Promise<Array>} fetchFn
   * @param {(record: any) => Promise<void>} processFn
   */
  register(name, fetchFn, processFn) {
    this.registry.set(name, { fetchFn, processFn });

    if (!this.state[name]) {
      this.state[name] = {
        lastSyncTime: null,
        totalSynced: 0,
        status: 'IDLE',
        lastRun: null,
        error: null
      };
    }

    this.saveState();
  }

  async start(reset = false) {
    if (this.isRunning) {
      logger.warn('[SyncManagerService] Sync is already running.');
      return;
    }

    this.isRunning = true;
    logger.info(`[SyncManagerService] Start sync manager (reset=${reset})`);

    try {
      for (const [name, handlers] of this.registry) {
        await this.syncEntity(name, handlers, reset);
      }
    } catch (error) {
      logger.error('[SyncManagerService] Unexpected error while running sync manager:', error);
    } finally {
      this.isRunning = false;
      this.saveState();
      logger.info('[SyncManagerService] Sync manager finished');
    }
  }

  async syncEntity(name, { fetchFn, processFn }, reset) {
    const entityState = this.state[name];
    entityState.status = 'RUNNING';
    entityState.lastRun = new Date().toISOString();
    entityState.error = null;

    if (reset) {
      entityState.lastSyncTime = null;
      entityState.totalSynced = 0;
    }
    this.saveState();

    const queryTime = entityState.lastSyncTime || '1970-01-01T00:00:00.000Z';
    let processedCount = 0;
    let hasMore = true;
    let offset = 0;

    while (hasMore) {
      try {
        const records = await fetchFn(queryTime, this.batchSize, offset);

        if (!records || records.length === 0) {
          hasMore = false;
          break;
        }

        let maxUpdatedAtInBatch = null;
        for (const record of records) {
          await processFn(record);

          const recordTime = record.updated_at || record.UpdatedAt || record.ModifiedDate;
          if (recordTime) {
            if (!maxUpdatedAtInBatch || new Date(recordTime) > new Date(maxUpdatedAtInBatch)) {
              maxUpdatedAtInBatch = recordTime;
            }
          }
        }

        processedCount += records.length;
        entityState.totalSynced += records.length;

        if (maxUpdatedAtInBatch) {
          const currentLastSync = entityState.lastSyncTime;
          if (!currentLastSync || new Date(maxUpdatedAtInBatch) > new Date(currentLastSync)) {
            entityState.lastSyncTime = maxUpdatedAtInBatch;
          }
        }

        offset += records.length;
        this.saveState();

        logger.info(`[SyncManagerService][${name}] Processed ${records.length} records (total=${entityState.totalSynced})`);

        if (records.length < this.batchSize) {
          hasMore = false;
        }
      } catch (error) {
        logger.error(`[SyncManagerService][${name}] Sync failed:`, error);
        entityState.status = 'ERROR';
        entityState.error = error.message;
        this.saveState();
        return;
      }
    }

    entityState.status = 'COMPLETED';
    this.saveState();
    logger.info(`[SyncManagerService][${name}] Completed. New records processed=${processedCount}`);
  }

  getDashboardData() {
    return {
      isRunning: this.isRunning,
      entities: this.state,
      registeredCount: this.registry.size
    };
  }
}

module.exports = new SyncManagerService();
