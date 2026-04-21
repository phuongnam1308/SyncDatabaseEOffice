/**
 * SyncIncomingAdapter - Wrapper để SyncIncomingModel v2 hoạt động với SyncManagerService
 *
 * SyncIncomingModel v2 (standalone) cần được adapter để implement BaseIncrementalSyncInterface
 * để có thể đăng ký với SyncHandlerModel/SyncManagerService
 *
 * KEY DIFFERENCES vs SyncOutgoingAdapter:
 * - Cursor direction: ASC (oldest first, from 1753-01-01)
 * - Source: VanBanDen (not VanBanBanHanh)
 * - Staging table: incomming_documents_sync_{instanceId}
 * - Main table: incomming_documents (not outgoing_documents)
 * - Default sync time: 1753-01-01 (very old)
 */

const logger = require('../../utils/logger');
const dbConnection = require('../../db/connection');
const SyncIncomingModel = require('../sync-incoming-v2/models/SyncIncomingModel');

class SyncIncomingAdapter {
  constructor() {
    this._instanceId = process.env.INSTANCE_ID || '1';
    this._name = `StreamIncomingV2_Instance_${this._instanceId}`;
    this._model = null;
    this._initialized = false;
  }

  /**
   * Initialize - kết nối DB và khởi tạo model
   */
  async initialize() {
    if (this._initialized) return;

    // Tạo instance của SyncIncomingModel v2
    this._model = new SyncIncomingModel();
    
    // Gọi initialize để khởi tạo đầy đủ (pools, loader, staging table)
    await this._model.initialize(this._instanceId);

    this._initialized = true;
    logger.info(`[SyncIncomingAdapter] Initialized as ${this._name}`);
  }

  /**
   * Trả về tên định danh duy nhất cho instance này
   */
  getName() {
    return this._name || 'StreamIncomingV2_Unknown';
  }

  /**
   * Implement BaseIncrementalSyncInterface.getCount()
   * Đếm số bản ghi cần sync trong staging
   */
  async getCount(lastTime, lastSyncId = 0) {
    const stagingTable = `incomming_documents_sync_${this._instanceId}`;

    const query = `
      SELECT COUNT(1) AS cnt
      FROM ${stagingTable}
      WHERE ISNULL(MigrateFlg, 0) = 0
        AND ISNULL(MigrateErrFlg, 0) = 0
    `;

    try {
      const pool = dbConnection.getNewPool();
      if (!pool) {
        logger.error(`[SyncIncomingAdapter] getCount: New pool NOT connected!`);
        return 0;
      }
      const result = await pool.request().query(query);
      const count = Number(result.recordset?.[0]?.cnt || 0);
      logger.debug(`[SyncIncomingAdapter] getCount from ${stagingTable}: ${count}`);
      return count;
    } catch (error) {
      logger.error(`[SyncIncomingAdapter] getCount error on ${stagingTable}: ${error.message}`);
      return 0;
    }
  }

  /**
   * Implement BaseIncrementalSyncInterface.getList()
   * Fetch batch từ VanBanDen OLD DB và push vào staging
   *
   * **KEY:** Incoming direction = ASC (oldest first, from 1753-01-01 forward)
   */
  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    const batchSize = Number(process.env.STAGING_FETCH_BATCH_SIZE || 1000);
    const parallelBatches = Number(process.env.STAGING_PARALLEL_BATCHES || 3);
    let extractedCount = 0;
    let hasMore = true;

    // Default to min date (ASC ordering starts from oldest)
    const DEFAULT_SYNC_TIME = '1753-01-01T00:00:00.000Z';

    // Handle max date (2100-01-01) or invalid as "reset" - use default (1753) for ASC sync
    const lastSyncDate = new Date(lastSyncTime);
    const isDateValid = !isNaN(lastSyncDate.getTime());
    const isValidTime = lastSyncTime && 
                        lastSyncTime !== '2100-01-01T00:00:00.000Z' &&
                        isDateValid &&
                        lastSyncDate.getFullYear() > 1900 &&
                        lastSyncDate.getFullYear() < 2100; // Reasonable range

    let cursorTime = isValidTime ? lastSyncTime : DEFAULT_SYNC_TIME;
    let cursorId = Number(lastSyncId || 0);

    logger.info(
      `[SyncIncomingAdapter] getList start: cursorTime=${cursorTime}, lastSyncId=${cursorId} ` +
      `(Raw lastSyncTime: ${lastSyncTime}) [ASC direction]`
    );

    while (hasMore) {
      // Parallel batches for faster extraction
      const batchPromises = [];
      for (let p = 0; p < parallelBatches && hasMore; p++) {
        batchPromises.push(
          this._model.extractor.fetchBatchFromOldDb(
            cursorTime,
            cursorId,
            batchSize,
            p * batchSize
          )
        );
      }

      const batchResults = await Promise.all(batchPromises);
      let anyRows = false;

      for (const batch of batchResults) {
        if (!batch || batch.length === 0) continue;
        anyRows = true;

        await this._model.extractor.syncBatchToStaging(batch, this._instanceId);
        extractedCount += batch.length;

        const lastRow = batch[batch.length - 1];
        cursorTime = lastRow.__sync_time;
        cursorId = lastRow.__sync_id;

        if (batch.length < batchSize) {
          hasMore = false;
        }
      }

      if (!anyRows) hasMore = false;
    }

    const stagedCount = await this.getCount(cursorTime, cursorId);

    logger.info(
      `[SyncIncomingAdapter] getList done: extracted=${extractedCount}, staged=${stagedCount}, ` +
      `syncJobId=${syncJobId}`
    );

    return {
      lastSyncTime: cursorTime,
      lastSyncId: cursorId,
      stagedCount,
      totalCount: stagedCount
    };
  }

  /**
   * Implement fetchListFromOldDb - required by SyncHandlerModel
   * Returns paginated list from OLD DB (VanBanDen)
   */
  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0, limit = null, offset = 0) {
    const batchSize = Number(limit) || Number(process.env.STAGING_FETCH_BATCH_SIZE || 1000);
    const effectiveOffset = Number(offset) || 0;
    // Incoming: default to min date (1753)
    const DEFAULT_SYNC_TIME = '1753-01-01T00:00:00.000Z';
    const isValidTime = lastSyncTime && 
                        lastSyncTime !== '2100-01-01T00:00:00.000Z' &&
                        lastSyncTime !== '1970-01-01T00:00:00.000Z';
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
   * Xử lý một bản ghi từ staging (incomming_documents_sync)
   */
  async processOne(syncJobId, options = {}) {
    try {
      // Fetch one pending record from staging
      const row = await this._model.loader.fetchOneFromStaging(this._instanceId);

      if (!row) {
        return { done: true, affected: 0 };
      }

      // Process the record (includes upsert + audit + files + comments)
      const result = await this._model.loader.processRecord(row);

      if (result.success) {
        await this._model.loader.markSuccess(this._instanceId, row.ID);
        return { done: false, affected: 1, documentId: result.documentId };
      } else {
        await this._model.loader.markFailed(this._instanceId, row.ID, result.error);
        return { done: false, affected: 0, error: result.error };
      }
    } catch (error) {
      logger.error(`[SyncIncomingAdapter] processOne error: ${error.message}`);
      return { done: false, affected: 0, error: error.message };
    }
  }

  /**
   * Return model name for logging
   */
  get modelName() {
    return this._name;
  }
}

module.exports = SyncIncomingAdapter;
