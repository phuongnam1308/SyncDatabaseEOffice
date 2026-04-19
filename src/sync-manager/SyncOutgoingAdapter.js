/**
 * SyncOutgoingAdapter - Wrapper để SyncOutgoingModel v2 hoạt động với SyncManagerService
 *
 * SyncOutgoingModel v2 (standalone) cần được adapter để implement BaseIncrementalSyncInterface
 * để có thể đăng ký với SyncHandlerModel/SyncManagerService
 */

const logger = require('../../utils/logger');
const dbConnection = require('../../db/connection');
const SyncOutgoingModel = require('../sync-outgoing-v2/models/SyncOutgoingModel');

class SyncOutgoingAdapter {
  constructor() {
    this._model = null;
    this._initialized = false;
  }

  /**
   * Initialize - kết nối DB và khởi tạo model
   */
  async initialize() {
    if (this._initialized) return;

    // Initialize instance ID cho multi-terminal support
    this._instanceId = process.env.INSTANCE_ID || '1';

    // Tạo instance của SyncOutgoingModel v2
    this._model = new SyncOutgoingModel();

    // Gọi initialize của model để khởi tạo đầy đủ (pools, loader, staging table)
    await this._model.initialize(this._instanceId);

    this._initialized = true;
    logger.info(`[SyncOutgoingAdapter] Initialized with instanceId=${this._instanceId}`);
  }

  /**
   * Implement BaseIncrementalSyncInterface.getCount()
   * Đếm số bản ghi cần sync
   */
  async getCount(lastTime, lastSyncId = 0) {
    const stagingTable = `outgoing_documents_sync_${this._instanceId}`;

    const query = `
      SELECT COUNT(1) AS cnt
      FROM ${stagingTable}
      WHERE ISNULL(MigrateFlg, 0) = 0
        AND ISNULL(MigrateErrFlg, 0) = 0
    `;

    try {
      const pool = dbConnection.getNewPool();
      if (!pool) {
        logger.error(`[SyncOutgoingAdapter] getCount: New pool NOT connected!`);
        return 0;
      }
      const result = await pool.request().query(query);
      const count = Number(result.recordset?.[0]?.cnt || 0);
      logger.debug(`[SyncOutgoingAdapter] getCount from ${stagingTable}: ${count}`);
      return count;
    } catch (error) {
      logger.error(`[SyncOutgoingAdapter] getCount error on ${stagingTable}: ${error.message}`);
      return 0;
    }
  }

  /**
   * Implement BaseIncrementalSyncInterface.getList()
   * Fetch batch từ OLD DB và push vào staging
   */
  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    const batchSize = Number(process.env.STAGING_FETCH_BATCH_SIZE || 2000);
    let extractedCount = 0;
    let hasMore = true;
    // Default to max date (DESC ordering starts from newest)
    const DEFAULT_SYNC_TIME = '2999-12-31T23:59:59.999Z';

    // Handle epoch time (1970-01-01) as "not set" - use default
    const isValidTime = lastSyncTime && lastSyncTime !== '1970-01-01T00:00:00.000Z';
    let cursorTime = isValidTime ? lastSyncTime : DEFAULT_SYNC_TIME;
    let cursorId = Number(lastSyncId || 0);

    logger.info(`[SyncOutgoingAdapter] getList start: cursorTime=${cursorTime}, lastSyncId=${cursorId}`);

    while (hasMore) {
      const batch = await this._model.extractor.fetchBatchFromOldDb(
        cursorTime,
        cursorId,
        batchSize
      );

      if (!batch || batch.length === 0) {
        hasMore = false;
        break;
      }

      await this._model.extractor.syncBatchToStaging(batch, this._instanceId);
      extractedCount += batch.length;

      const lastRow = batch[batch.length - 1];
      cursorTime = lastRow.__sync_time;
      cursorId = lastRow.__sync_id;

      if (batch.length < batchSize) {
        hasMore = false;
      }
    }

    const stagedCount = await this.getCount(cursorTime, cursorId);

    logger.info(`[SyncOutgoingAdapter] getList done: extracted=${extractedCount}, staged=${stagedCount}`);

    return {
      lastSyncTime: cursorTime,
      lastSyncId: cursorId,
      stagedCount,
      totalCount: stagedCount
    };
  }

  /**
   * Implement fetchListFromOldDb - required by SyncHandlerModel
   * Returns paginated list from OLD DB
   */
  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0, limit = null, offset = 0) {
    const batchSize = Number(limit) || Number(process.env.STAGING_FETCH_BATCH_SIZE || 2000);
    const effectiveOffset = Number(offset) || 0;
    // Handle epoch time as "not set"
    const DEFAULT_SYNC_TIME = '2999-12-31T23:59:59.999Z';
    const isValidTime = lastSyncTime && lastSyncTime !== '1970-01-01T00:00:00.000Z';
    const effectiveSyncTime = isValidTime ? lastSyncTime : DEFAULT_SYNC_TIME;

    const rows = await this._model.extractor.fetchBatchFromOldDb(
      effectiveSyncTime,
      lastSyncId,
      batchSize,
      effectiveOffset
    );

    return rows || [];
  }

  /**
   * Implement BaseIncrementalSyncInterface.processOne()
   * Xử lý một bản ghi từ staging
   */
  async processOne(syncJobId, options = {}) {
    try {
      // Fetch one pending record from staging
      const row = await this._model.loader.fetchOneFromStaging(this._instanceId);

      if (!row) {
        return { done: true, affected: 0 };
      }

      // Process the record
      const result = await this._model.loader.processRecord(row);

      if (result.success) {
        await this._model.loader.markSuccess(this._instanceId, row.ID);
        return { done: false, affected: 1, documentId: result.documentId };
      } else {
        await this._model.loader.markFailed(this._instanceId, row.ID, result.error);
        return { done: false, affected: 0, error: result.error };
      }
    } catch (error) {
      logger.error(`[SyncOutgoingAdapter] processOne error: ${error.message}`);
      return { done: false, affected: 0, error: error.message };
    }
  }

  /**
   * Override processOne với heartbeat support cho SyncManagerService
   */
  async processWithHeartbeat(syncJobId, options = {}) {
    const job = await this.getSyncJobState(syncJobId);
    if (!job) {
      return { done: true, affected: 0 };
    }

    // Start heartbeat timer
    let heartbeatTimer = null;
    const startHeartbeat = async () => {
      const interval = setInterval(async () => {
        await this.updateHeartbeat();
      }, 30000);
      heartbeatTimer = interval;
    };
    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    startHeartbeat();

    try {
      const result = await this.processOne(syncJobId, options);
      stopHeartbeat();
      return result;
    } catch (error) {
      stopHeartbeat();
      throw error;
    }
  }

  /**
   * Update heartbeat để tránh bị coi là stale
   */
  async updateHeartbeat() {
    // Heartbeat được xử lý bởi loader
    logger.debug(`[SyncOutgoingAdapter] Heartbeat update`);
  }

  /**
   * Get job state từ SyncManagerService
   */
  async getSyncJobState(syncJobId) {
    // Được gọi từ SyncManagerService - state đã có trong job context
    return null;
  }

  /**
   * Lấy stats hiện tại
   */
  async getStats() {
    if (!this._model?.loader) {
      return { pending: 0, processing: 0, success: 0, failed: 0 };
    }
    return this._model.loader.getStats(this._instanceId);
  }
}

module.exports = SyncOutgoingAdapter;
