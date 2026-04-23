/**
 * SyncDraftDocumentAdapter - Wrapper để SyncDraftDocumentModel hoạt động với SyncManagerService
 *
 * SyncDraftDocumentModel cần được adapter để implement interface tương tự SyncOutgoingAdapter
 * để có thể đăng ký với SyncManagerService
 */

const logger = require('../../utils/logger');
const dbConnection = require('../../db/connection');
const SyncDraftDocumentModel = require('../sync-outgoing-v2/models/SyncDraftDocumentModel');

class SyncDraftDocumentAdapter {
  constructor() {
    this._instanceId = process.env.INSTANCE_ID || '1';
    this._name = `DraftDocument_Instance_${this._instanceId}`;
    this._model = null;
    this._initialized = false;
  }

  /**
   * Initialize - kết nối DB và khởi tạo model
   */
  async initialize() {
    if (this._initialized) return;

    // Tạo instance của SyncDraftDocumentModel
    this._model = new SyncDraftDocumentModel();

    // Gọi initialize của model để khởi tạo đầy đủ (pools, upsert handler, staging table)
    await this._model.initialize(this._instanceId);

    this._initialized = true;
    logger.info(`[SyncDraftDocumentAdapter] Initialized as ${this._name}`);
  }

  /**
   * Trả về tên định danh duy nhất cho instance này
   */
  getName() {
    return this._name || 'DraftDocument_Unknown';
  }

  /**
   * Implement interface - Đếm số bản ghi cần sync
   */
  async getCount(lastTime, lastSyncId = 0) {
    const stagingTable = `draft_documents_sync_${this._instanceId}`;

    const query = `
      SELECT COUNT(1) AS cnt
      FROM ${stagingTable}
      WHERE ISNULL(MigrateFlg, 0) = 0
        AND ISNULL(MigrateErrFlg, 0) = 0
    `;

    try {
      const pool = dbConnection.getNewPool();
      if (!pool) {
        logger.error(`[SyncDraftDocumentAdapter] getCount: New pool NOT connected!`);
        return 0;
      }
      const result = await pool.request().query(query);
      const count = Number(result.recordset?.[0]?.cnt || 0);
      logger.debug(`[SyncDraftDocumentAdapter] getCount from ${stagingTable}: ${count}`);
      return count;
    } catch (error) {
      logger.error(`[SyncDraftDocumentAdapter] getCount error on ${stagingTable}: ${error.message}`);
      return 0;
    }
  }

  /**
   * Implement interface - Fetch batch từ OLD DB và push vào staging
   */
  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    const batchSize = Number(process.env.STAGING_FETCH_BATCH_SIZE || 2000);
    let extractedCount = 0;
    let hasMore = true;
    // Default to max date (DESC ordering starts from newest)
    const DEFAULT_SYNC_TIME = '2999-12-31T23:59:59.999Z';

    // Handle epoch time (1970-01-01) or 1900-01-01 as "reset" - use default (2999) for DESC sync
    const lastSyncDate = new Date(lastSyncTime);
    const isDateValid = !isNaN(lastSyncDate.getTime());
    const isValidTime = lastSyncTime &&
                        lastSyncTime !== '1970-01-01T00:00:00.000Z' &&
                        isDateValid &&
                        lastSyncDate.getFullYear() > 2000;

    let cursorTime = isValidTime ? lastSyncTime : DEFAULT_SYNC_TIME;
    let cursorId = Number(lastSyncId || 0);

    logger.info(`[SyncDraftDocumentAdapter] getList start: cursorTime=${cursorTime}, lastSyncId=${cursorId}`);

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

    logger.info(`[SyncDraftDocumentAdapter] getList done: extracted=${extractedCount}, staged=${stagedCount}`);

    return {
      lastSyncTime: cursorTime,
      lastSyncId: cursorId,
      stagedCount,
      totalCount: stagedCount
    };
  }

  /**
   * Fetch batch từ staging table
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
   * Implement interface - Xử lý một bản ghi từ staging
   */
  async processOne(syncJobId, options = {}) {
    try {
      // Fetch one pending record from staging
      const stagingTable = `draft_documents_sync_${this._instanceId}`;

      const selectQuery = `
        SELECT TOP (1) *
        FROM ${stagingTable}
        WHERE ISNULL(MigrateFlg, 0) = 0
          AND ISNULL(MigrateErrFlg, 0) = 0
        ORDER BY Modified DESC, ID DESC
      `;

      const pool = dbConnection.getNewPool();
      const rows = await pool.request().query(selectQuery);

      if (!rows.recordset?.length) {
        return { done: true, affected: 0 };
      }

      const row = rows.recordset[0];

      // Mark as processing
      const updateQuery = `
        UPDATE ${stagingTable} WITH (ROWLOCK)
        SET MigrateFlg = 2,
            MigrateErrMess = 'Processing...',
            processing_owner = @owner,
            processing_started_at = SYSUTCDATETIME(),
            processing_heartbeat_at = SYSUTCDATETIME()
        WHERE ID = @ID AND ISNULL(MigrateFlg, 0) = 0
      `;

      await pool.request()
        .input('ID', row.ID)
        .input('owner', `pid_${process.pid}_${syncJobId}`)
        .query(updateQuery);

      // Process the record using upsert handler
      const result = await this._model.upsertHandler.processRecord(row);

      if (result.success) {
        await this._markSuccess(stagingTable, row.ID);
        return { done: false, affected: 1, documentId: result.documentId };
      } else {
        await this._markFailed(stagingTable, row.ID, result.error);
        return { done: false, affected: 0, error: result.error };
      }
    } catch (error) {
      logger.error(`[SyncDraftDocumentAdapter] processOne error: ${error.message}`);
      return { done: false, affected: 0, error: error.message };
    }
  }

  /**
   * Mark record as success
   */
  async _markSuccess(stagingTable, id) {
    const query = `
      UPDATE ${stagingTable} WITH (ROWLOCK)
      SET MigrateFlg = 1,
          MigrateErrFlg = 0,
          MigrateErrMess = NULL
      WHERE ID = @ID
    `;
    await dbConnection.getNewPool().request().input('ID', id).query(query);
  }

  /**
   * Mark record as failed
   */
  async _markFailed(stagingTable, id, errorMessage) {
    const query = `
      UPDATE ${stagingTable} WITH (ROWLOCK)
      SET MigrateFlg = 3,
          MigrateErrFlg = 1,
          MigrateErrMess = @errorMessage
      WHERE ID = @ID
    `;
    await dbConnection.getNewPool().request()
      .input('ID', id)
      .input('errorMessage', errorMessage)
      .query(query);
  }

  /**
   * Update heartbeat để tránh bị coi là stale
   */
  async updateHeartbeat() {
    logger.debug(`[SyncDraftDocumentAdapter] Heartbeat update`);
  }

  /**
   * Get job state từ SyncManagerService
   */
  async getSyncJobState(syncJobId) {
    return null;
  }

  /**
   * Lấy stats hiện tại
   */
  async getStats() {
    const stagingTable = `draft_documents_sync_${this._instanceId}`;

    const query = `
      SELECT
        SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 0 AND ISNULL(MigrateErrFlg, 0) = 0 THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 2 THEN 1 ELSE 0 END) AS processing,
        SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 1 THEN 1 ELSE 0 END) AS success,
        SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 3 OR ISNULL(MigrateErrFlg, 0) = 1 THEN 1 ELSE 0 END) AS failed
      FROM ${stagingTable}
    `;

    try {
      const pool = dbConnection.getNewPool();
      const result = await pool.request().query(query);
      const row = result.recordset?.[0] || {};
      return {
        pending: Number(row.pending || 0),
        processing: Number(row.processing || 0),
        success: Number(row.success || 0),
        failed: Number(row.failed || 0)
      };
    } catch (error) {
      logger.error(`[SyncDraftDocumentAdapter] getStats error: ${error.message}`);
      return { pending: 0, processing: 0, success: 0, failed: 0 };
    }
  }
}

module.exports = SyncDraftDocumentAdapter;