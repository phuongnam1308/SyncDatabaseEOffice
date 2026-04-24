/**
 * SyncUnitDraftAdapter - Wrapper để SyncUnitDraftModel hoạt động với SyncManagerService
 *
 * SyncUnitDraftModel lấy dữ liệu từ SharePoint List "Văn bản đi"
 * (thay vì SQL như SyncDraftDocumentModel)
 */

const dbConnection = require('../../db/connection');
const SyncUnitDraftModel = require('../sync-outgoing-v2/models/SyncUnitDraftModel');
const UnitDraftUpsertHandler = require('../sync-outgoing-v2/models/UnitDraftUpsertHandler');

class SyncUnitDraftAdapter {
  constructor() {
    this._instanceId = process.env.INSTANCE_ID || '1';
    this._name = `UnitDraft_Instance_${this._instanceId}`;
    this._model = null;
    this._handler = null;
    this._initialized = false;
  }

  /**
   * Initialize - kết nối DB và khởi tạo model
   */
  async initialize() {
    if (this._initialized) return;

    // Tạo instance của SyncUnitDraftModel
    this._model = new SyncUnitDraftModel();

    // Gọi initialize của model
    await this._model.initialize(this._instanceId);

    // Khởi tạo handler để sync qua main table
    this._handler = new UnitDraftUpsertHandler(
      dbConnection.getNewPool(),
      dbConnection.getOldPool()
    );

    this._initialized = true;
    logger.info(`[SyncUnitDraftAdapter] Initialized as ${this._name} with Handler`);
  }

  /**
   * Trả về tên định danh duy nhất cho instance này
   */
  getName() {
    return this._name || 'UnitDraft_Unknown';
  }

  /**
   * Implement interface - Đếm tổng số bản ghi cần sync (bao gồm staging và SharePoint source)
   */
  async getCount(lastTime, lastSyncId = 0) {
    const stagingTable = `draft_documents_unit_sync_${this._instanceId}`;

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

      // 2. Đếm số bản ghi trong SharePoint (Tổng số lượng)
      const inSource = await this._model.extractor.getTotalCount(lastTime, lastSyncId);

      const total = inStaging + inSource;
      logger.info(`[SyncUnitDraftAdapter] getCount: ${total} (Staging: ${inStaging}, SharePoint: ${inSource})`);
      return total;
    } catch (error) {
      logger.error(`[SyncUnitDraftAdapter] getCount error: ${error.message}`);
      return 0;
    }
  }

  /**
   * Implement interface - Fetch batch từ SharePoint List và push vào staging
   */
  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    const batchSize = 10; // HARDCODED for testing as requested
    let extractedCount = 0;
    let hasMore = true;
    const DEFAULT_SYNC_TIME = '2999-12-31T23:59:59.999Z';

    // Handle epoch time - use default for DESC ordering
    const lastSyncDate = new Date(lastSyncTime);
    const isDateValid = !isNaN(lastSyncDate.getTime());
    const isValidTime = lastSyncTime &&
                        lastSyncTime !== '1970-01-01T00:00:00.000Z' &&
                        isDateValid &&
                        lastSyncDate.getFullYear() > 2000;

    let cursorTime = isValidTime ? lastSyncTime : DEFAULT_SYNC_TIME;
    let cursorId = Number(lastSyncId || 0);

    logger.info(`[SyncUnitDraftAdapter] getList start: cursorTime=${cursorTime}, lastSyncId=${cursorId}`);

    try {
      // First check which sites have data
      const { sitesWithData } = await this._model.checkSitesWithData();

      if (sitesWithData.length === 0) {
        logger.warn(`[SyncUnitDraftAdapter] No sites have data to sync`);
        return {
          lastSyncTime: cursorTime,
          lastSyncId: cursorId,
          stagedCount: 0,
          totalCount: 0
        };
      }

      // Update model to only use sites with data
      this._model.extractor.sites = sitesWithData;

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
        cursorId = lastRow.ID;

        if (batch.length < batchSize) {
          hasMore = false;
        }
      }

      const stagedCount = await this.getCount(cursorTime, cursorId);

      logger.info(`[SyncUnitDraftAdapter] getList done: extracted=${extractedCount}, staged=${stagedCount}, sites=${sitesWithData.length}`);

      return {
        lastSyncTime: cursorTime,
        lastSyncId: cursorId,
        stagedCount,
        totalCount: stagedCount,
        sitesSynced: sitesWithData.length
      };
    } catch (error) {
      logger.error(`[SyncUnitDraftAdapter] getList error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch batch từ SharePoint List (cho extract phase)
   */
  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0, limit = null, offset = 0) {
    const batchSize = 10; // HARDCODED for testing as requested
    const effectiveOffset = Number(offset) || 0;
    const DEFAULT_SYNC_TIME = '2999-12-31T23:59:59.999Z';

    const lastSyncDate = new Date(lastSyncTime);
    const isDateValid = !isNaN(lastSyncDate.getTime());
    const isValidTime = lastSyncTime &&
                        lastSyncTime !== '1970-01-01T00:00:00.000Z' &&
                        isDateValid &&
                        lastSyncDate.getFullYear() > 2000;

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
   * Lưu ý: Unit Draft không có upsert handler riêng, chỉ extract vào staging
   */
  async processOne(syncJobId, options = {}) {
    try {
      const stagingTable = `draft_documents_unit_sync_${this._instanceId}`;

      const selectQuery = `
        SELECT TOP (1) *
        FROM ${stagingTable}
        WHERE ISNULL(MigrateFlg, 0) = 0
          AND ISNULL(MigrateErrFlg, 0) = 0
        ORDER BY __sync_time DESC, ID DESC
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

      // Thực hiện sync qua main table sử dụng handler
      const syncResult = await this._handler.processRecord(row);

      if (syncResult.success) {
        await this._markSuccess(stagingTable, row.ID);
        return { done: false, affected: 1, documentId: syncResult.documentId, action: syncResult.action };
      } else {
        await this._markFailed(stagingTable, row.ID, syncResult.error);
        return { done: false, affected: 0, error: syncResult.error };
      }
    } catch (error) {
      logger.error(`[SyncUnitDraftAdapter] processOne error: ${error.message}`);
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
    logger.debug(`[SyncUnitDraftAdapter] Heartbeat update`);
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
    const stagingTable = `draft_documents_unit_sync_${this._instanceId}`;

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
      logger.error(`[SyncUnitDraftAdapter] getStats error: ${error.message}`);
      return { pending: 0, processing: 0, success: 0, failed: 0 };
    }
  }
}

module.exports = SyncUnitDraftAdapter;