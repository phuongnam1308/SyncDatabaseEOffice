const logger = require('../../utils/logger');
const dbConnection = require('../../db/connection');
const SyncTaskSharePointModel = require('../sync-tasks-sharepoint/models/SyncTaskSharePointModel');

class SyncTaskSharePointAdapter {
  constructor() {
    this._instanceId = process.env.SYNC_INSTANCE_ID || process.env.INSTANCE_ID || '1';
    this._name = `StreamTaskSharePoint_Instance_${this._instanceId}`;
    this._model = null;
    this._initialized = false;
    this.isBatchSync = true;
  }

  async initialize() {
    if (this._initialized) return;

    this._model = new SyncTaskSharePointModel();
    
    await this._model.initialize(this._instanceId, null);

    this._initialized = true;
    logger.info(`[SyncTaskSharePointAdapter] Initialized as ${this._name}`);
  }

  getName() {
    return this._name || 'StreamTaskSharePoint_Unknown';
  }

  async getCount(lastTime, lastSyncId = 0) {
    const stagingTable = `task_sharepoint_sync`;

    const stagingQuery = `
      SELECT COUNT(1) AS cnt
      FROM ${stagingTable}
      WHERE ISNULL(MigrateFlg, 0) = 0
        AND ISNULL(MigrateErrFlg, 0) = 0
    `;

    try {
      const pool = dbConnection.getNewPool();
      if (!pool) return 0;
      
      const stagingRes = await pool.request().query(stagingQuery);
      return Number(stagingRes.recordset?.[0]?.cnt || 0);
    } catch (error) {
      logger.error(`[SyncTaskSharePointAdapter] getCount error: ${error.message}`);
      return 0;
    }
  }

  async countListFromOldDb(lastSyncTime, lastSyncId = 0) {
    return this.getCount(lastSyncTime, lastSyncId);
  }

  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    logger.info(`[SyncTaskSharePointAdapter] getList start`);

    // Run the full extract from SharePoint API to Staging
    await this._model.extractor.runExtract();

    const stagedCount = await this.getCount(lastSyncTime, lastSyncId);

    logger.info(`[SyncTaskSharePointAdapter] getList done: staged=${stagedCount}`);

    return {
      lastSyncTime: new Date().toISOString(),
      lastSyncId: 0,
      stagedCount,
      totalCount: stagedCount
    };
  }

  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0, limit = null, offset = 0) {
    return []; // Handled entirely in getList -> runExtract
  }

  async processOne(syncJobId, options = {}) {
    try {
      const batchSize = 50; 
      const rows = await this._model.loader.fetchBatchFromStaging(batchSize);

      if (!rows || rows.length === 0) {
        return { done: true, affected: 0 };
      }

      const result = await this._model.loader.processRecords(rows);

      let affected = 0;
      if (result.successIds && result.successIds.length > 0) {
        affected += result.successIds.length;
      } 
      
      return { done: false, affected: affected };
    } catch (error) {
      logger.error(`[SyncTaskSharePointAdapter] processOne error: ${error.message}`);
      return { done: false, affected: 0, error: error.message };
    }
  }
}

module.exports = SyncTaskSharePointAdapter;
