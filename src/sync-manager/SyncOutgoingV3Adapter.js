/**
 * SyncOutgoingV3Adapter - Wrapper để SyncOutgoingV3Model hoạt động với SyncManagerService
 *
 * Hỗ trợ xử lý theo lô (processBatch) thay vì tuần tự (processOne)
 */

const logger = require('../../utils/logger');
const dbConnection = require('../../db/connection');
const SyncOutgoingModel = require('../sync-outgoing-v3/models/SyncOutgoingModel');

class SyncOutgoingV3Adapter {
  constructor() {
    this._instanceId = process.env.SYNC_INSTANCE_ID || process.env.INSTANCE_ID || '1';
    this._name = `StreamOutgoingV3_Instance_${this._instanceId}`;
    this._model = null;
    this._initialized = false;
    this.isBatchSync = true; // Đánh dấu đây là module xử lý theo lô để SyncHandlerModel điều chỉnh hiển thị Dashboard
  }

  /**
   * Initialize - kết nối DB và khởi tạo model
   */
  async initialize() {
    if (this._initialized) return;

    // Tạo instance của SyncOutgoingModel v3
    this._model = new SyncOutgoingModel();
    
    // Gọi initialize của model để khởi tạo đầy đủ (pools, loader, staging table)
    await this._model.initialize(this._instanceId);

    this._initialized = true;
    logger.info(`[SyncOutgoingV3Adapter] Initialized as ${this._name}`);
  }

  /**
   * Trả về tên định danh duy nhất cho instance này
   */
  getName() {
    return this._name || 'StreamOutgoingV3_Unknown';
  }

  /**
   * Implement BaseIncrementalSyncInterface.getCount()
   * Đếm tổng số bản ghi cần sync (bao gồm cả trong source DB và đang chờ trong staging)
   */
  async getCount(lastTime, lastSyncId = 0) {
    const stagingTable = `outgoing_documents_sync_${this._instanceId}`;

    // 1. Đếm số bản ghi đang chờ xử lý trong staging
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
      const inStaging = Number(stagingRes.recordset?.[0]?.cnt || 0);

      // 2. Đếm số bản ghi còn lại trong OLD DB chưa được fetch vào staging cho instance này
      const inSource = await this._model.extractor.getTotalCount(lastTime, lastSyncId);

      const total = inStaging + inSource;
      logger.info(`[SyncOutgoingV3Adapter] getCount: ${total} (Staging: ${inStaging}, Source: ${inSource})`);
      return total;
    } catch (error) {
      logger.error(`[SyncOutgoingV3Adapter] getCount error: ${error.message}`);
      return 0;
    }
  }

  /**
   * Implement countListFromOldDb - required for dashboard in Full Sync mode
   */
  async countListFromOldDb(lastSyncTime, lastSyncId = 0) {
    // Để hiển thị đúng tổng số record trên Dashboard (x/Total), 
    // ta cần trả về tổng của cả Staging và Source DB giống như getCount.
    return this.getCount(lastSyncTime, lastSyncId);
  }

  /**
   * Implement BaseIncrementalSyncInterface.getList()
   * Fetch batch từ OLD DB và push vào staging
   */
  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    const batchSize = Number(process.env.STAGING_FETCH_BATCH_SIZE || 2000);
    let extractedCount = 0;
    let hasMore = true;
    const DEFAULT_SYNC_TIME = '2999-12-31T23:59:59.999Z';

    const lastSyncDate = new Date(lastSyncTime);
    const isDateValid = !isNaN(lastSyncDate.getTime());
    const isValidTime = lastSyncTime && 
                        lastSyncTime !== '1970-01-01T00:00:00.000Z' &&
                        isDateValid &&
                        lastSyncDate.getFullYear() > 2000;

    let cursorTime = isValidTime ? lastSyncTime : DEFAULT_SYNC_TIME;
    let cursorId = Number(lastSyncId || 0);

    logger.info(`[SyncOutgoingV3Adapter] getList start: cursorTime=${cursorTime}, lastSyncId=${cursorId}`);

    while (hasMore) {
      let batch;
      try {
        batch = await this._model.extractor.fetchBatchFromOldDb(
          cursorTime,
          cursorId,
          batchSize
        );
      } catch (fetchErr) {
        logger.error(`[SyncOutgoingV3Adapter] fetchBatchFromOldDb failed, stopping extraction: ${fetchErr.message}`);
        hasMore = false;
        break;
      }

      if (!batch || batch.length === 0) {
        hasMore = false;
        break;
      }

      try {
        await this._model.extractor.syncBatchToStaging(batch, this._instanceId);
        extractedCount += batch.length;
      } catch (stagingErr) {
        // Log lỗi nhưng KHÔNG throw ra ngoài — skip batch này, tiến cursor
        // để tránh vòng lặp vô hạn trên cùng một batch lỗi.
        logger.warn(
          `[SyncOutgoingV3Adapter] syncBatchToStaging failed for batch of ${batch.length} rows ` +
          `(cursorTime=${cursorTime}, cursorId=${cursorId}): ${stagingErr.message}. Skipping batch.`
        );
        // Vẫn tiến cursor theo last row của batch để không bị mắc kẹt
        const lastRow = batch[batch.length - 1];
        cursorTime = lastRow.__sync_time || cursorTime;
        cursorId = lastRow.__sync_id || cursorId;
        if (batch.length < batchSize) {
          hasMore = false;
        }
        continue;
      }

      const lastRow = batch[batch.length - 1];
      cursorTime = lastRow.__sync_time;
      cursorId = lastRow.__sync_id;

      if (batch.length < batchSize) {
        hasMore = false;
      }
    }

    const stagedCount = await this.getCount(cursorTime, cursorId);

    logger.info(`[SyncOutgoingV3Adapter] getList done: extracted=${extractedCount}, staged=${stagedCount}`);

    return {
      lastSyncTime: cursorTime,
      lastSyncId: cursorId,
      stagedCount,
      totalCount: stagedCount
    };
  }

  /**
   * Implement fetchListFromOldDb
   */
  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0, limit = null, offset = 0) {
    const batchSize = Number(limit) || Number(process.env.STAGING_FETCH_BATCH_SIZE || 2000);
    const effectiveOffset = Number(offset) || 0;
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
   * Ở bản V3, processOne thực chất là processBatch ngầm
   */
  async processOne(syncJobId, options = {}) {
    try {
      const batchSize = 50; // Hardcode size 50
      const rows = await this._model.loader.fetchBatchFromStaging(this._instanceId, batchSize);

      if (!rows || rows.length === 0) {
        return { done: true, affected: 0 };
      }

      const result = await this._model.loader.processBatch(rows);

      let affected = 0;
      if (result.successIds && result.successIds.length > 0) {
        await this._model.loader.markBatchSuccess(this._instanceId, result.successIds);
        affected += result.successIds.length;
      } 
      
      if (result.failedRecords && result.failedRecords.length > 0) {
        await this._model.loader.markBatchFailed(this._instanceId, result.failedRecords);
      }
      
      return { done: false, affected: affected };
    } catch (error) {
      logger.error(`[SyncOutgoingV3Adapter] processOne error: ${error.message}`);
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
    logger.debug(`[SyncOutgoingV3Adapter] Heartbeat update`);
  }

  async getSyncJobState(syncJobId) {
    return null;
  }

  async getStats() {
    if (!this._model?.loader) {
      return { pending: 0, processing: 0, success: 0, failed: 0 };
    }
    return this._model.loader.getStats(this._instanceId);
  }
}

module.exports = SyncOutgoingV3Adapter;
