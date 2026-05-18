const logger = require('../../utils/logger');
const BaseIncrementalSyncInterface = require('./BaseIncrementalSyncInterface');

class SyncHandlerModel {
  /**
   * Wraps one incremental model and exposes adapter handlers for SyncManagerService.
   * @param {BaseIncrementalSyncInterface} syncModel
   */
  constructor(syncModel) {
    this.syncModel = syncModel;
  }

  /**
   * Builds a count function based on incremental source query.
   * @returns {(lastTime: string, lastSyncId?: number) => Promise<number>}
   */
  createCountFnIncremental() {
    // DEFAULT_SYNC_TIME dùng khi full resync: hút từ đầu lịch sử
    const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

    // opts: { forceFullSync, syncMode } — được truyền từ SyncManagerService.runJob()
    return async (lastTime, lastSyncId = 0, opts = {}) => {
      // Lấy singleton instance của SyncManagerService để kiểm tra settings
      const syncManager = require('./SyncManagerService');
      const skipPull = syncManager.state && syncManager.state.settings && syncManager.state.settings.SKIP_PULL_FROM_OLD === true;

      // Xác định chế độ đếm:
      // - forceFullSync=true → dùng DEFAULT_SYNC_TIME để đếm tất cả bản ghi (past + future)
      // - forceFullSync=false → dùng lastTime để chỉ đếm bản ghi mới (incremental)
      const forceFullSync = opts.forceFullSync === true; // mặc định false khi không truyền
      const effectiveTime = forceFullSync ? DEFAULT_SYNC_TIME : lastTime;
      const effectiveSyncId = forceFullSync ? 0 : lastSyncId;

      const modelLabel = this.syncModel.getName ? this.syncModel.getName() : (this.syncModel.modelName || 'Unknown');

      if (forceFullSync) {
        const logger = require('../../utils/logger');
        logger.info(`[SyncHandlerModel][${modelLabel}] countFn: FULL RESYNC mode — dùng DEFAULT_SYNC_TIME thay vì ${lastTime}`);
      }

      // Nếu SKIP_PULL_FROM_OLD = OFF (mặc định), đếm từ DB cũ
      if (!skipPull) {
        if (typeof this.syncModel.countListFromOldDb === 'function') {
          return this.syncModel.countListFromOldDb(effectiveTime, effectiveSyncId);
        }
        // Fallback cho các model cũ chưa tách countListFromOldDb
        if (typeof this.syncModel.getCount === 'function') {
          return this.syncModel.getCount(effectiveTime, effectiveSyncId);
        }
      } else {
        // Nếu SKIP_PULL_FROM_OLD = ON, chỉ quan tâm những gì đang có trong staging
        if (typeof this.syncModel.getCount === 'function') {
          return this.syncModel.getCount(effectiveTime, effectiveSyncId);
        }
      }

      const records = await this.syncModel.fetchListFromOldDb(effectiveTime, effectiveSyncId);
      return Array.isArray(records) ? records.length : 0;
    };
  }

  /**
   * @returns {(lastTime: string, limit: number, _offset: number, cursor: object) => Promise<object[]>}
   */
  createFetchFnIncremental() {
    const preparedJobs = new Map();
    // DEFAULT_SYNC_TIME dùng khi full resync
    const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

    return async (lastTime, limit, _offset, cursor = {}) => {
      const jobId = cursor.jobId;
      const lastSyncId = Number(cursor.lastSyncId || 0);
      if (!jobId) {
        throw new Error('[SyncHandlerModel] cursor.jobId is required for incremental model');
      }

      // Đọc flag từ cursor (do SyncManagerService.runJob() truyền xuống)
      // forceFullSync=true → gọi getList(DEFAULT_SYNC_TIME) để hút toàn bộ past records
      // forceFullSync=false (hoặc không có) → dùng lastTime như cũ (incremental)
      const forceFullSync = cursor.forceFullSync === true; // mặc định false
      const effectiveTime = forceFullSync ? DEFAULT_SYNC_TIME : lastTime;
      const effectiveSyncId = forceFullSync ? 0 : lastSyncId;

      if (!preparedJobs.has(jobId)) {
        // Lấy singleton instance của SyncManagerService để kiểm tra settings
        const syncManager = require('./SyncManagerService');
        const skipPull = syncManager.state && syncManager.state.settings && syncManager.state.settings.SKIP_PULL_FROM_OLD === true;
        const logger = require('../../utils/logger');

        let listResult = null;
        if (skipPull) {
          const modelLabel = this.syncModel.getName ? this.syncModel.getName() : (this.syncModel.modelName || 'Unknown');
          logger.info(`[SyncHandlerModel][${modelLabel}] SKIP_PULL_FROM_OLD is ON. Skipping extraction, using existing staging data.`);
          const stagedCount = await this.syncModel.getCount(effectiveTime, effectiveSyncId);
          listResult = {
            totalCount: stagedCount,
            lastSyncTime: effectiveTime,
            lastSyncId: effectiveSyncId
          };
        } else {
          // Gọi getList với effectiveTime:
          // - forceFullSync=true → effectiveTime = DEFAULT_SYNC_TIME → hút từ đầu
          // - forceFullSync=false → effectiveTime = lastTime → chỉ hút mới
          const modelLabel = this.syncModel.getName ? this.syncModel.getName() : (this.syncModel.modelName || 'Unknown');
          if (forceFullSync) {
            logger.info(
              `[SyncHandlerModel][${modelLabel}] 🔄 fetchFn: FULL RESYNC — getList(DEFAULT_SYNC_TIME) thay vì getList(${lastTime})`
            );
          } else {
            logger.info(
              `[SyncHandlerModel][${modelLabel}] ⬆️ fetchFn: INCREMENTAL — getList(${effectiveTime})`
            );
          }
          listResult = await this.syncModel.getList(effectiveTime, jobId, effectiveSyncId);
        }

        const resumeIndex = Number(cursor.totalProcessed || 0);

        // Khi Resume sau server restart, `nextIndex` bắt đầu từ số records đã xử lý (resumeIndex).
        // Tuy nhiên `listResult.totalCount` là số `pendingCount` thực tế CẦN XẬ LÝ TRONG STAGING ở thời điểm hiện tại.
        // Do đó tổng `totalCount` trong context của preparedJobs phải là (pendingCount + resumeIndex)
        // để đảm bảo `remaining = totalCount - processed = pendingCount`.
        const pendingCount = Number(listResult?.totalCount ?? listResult?.stagedCount ?? 0);

        preparedJobs.set(jobId, {
          totalCount: pendingCount + resumeIndex,
          syncTime: listResult?.lastSyncTime || effectiveTime,
          syncId: Number(listResult?.lastSyncId || effectiveSyncId || 0),
          sourceTime: listResult?.sourceLastSyncTime || effectiveTime,
          sourceId: Number(listResult?.sourceLastSyncId || effectiveSyncId || 0),
          nextIndex: resumeIndex
        });
        const logger2 = require('../../utils/logger');
        logger2.info(`[SyncHandlerModel] getList() → pendingCount=${pendingCount}, forceFullSync=${forceFullSync}, jobId=${jobId}`);
        if (resumeIndex > 0) {
          logger2.info(`[SyncHandlerModel] Resuming jobId=${jobId}: nextIndex restored to ${resumeIndex}`);
        }
      }

      const state = preparedJobs.get(jobId);
      const total = Number(state?.totalCount || 0);
      const processed = Number(state?.nextIndex || 0);
      const remaining = Math.max(0, total - processed);

      // Chỉ áp dụng logic "Virtual Item đại diện cho Batch" nếu model có cờ isBatchSync
      const isBatch = this.syncModel.isBatchSync === true;
      const take = isBatch 
        ? Math.min(Number(process.env.SYNC_CONCURRENCY || 3), Math.ceil(remaining / limit)) 
        : Math.min(Number(limit || 1), remaining);

      if (take <= 0) {
        // ★ KHI take <= 0: Trước khi trả [] và kết thúc job, recheck actual staging count.
        // Lý do: với CONCURRENCY > 1, nhiều virtual items có thể "lãng phí" (không claim được record
        // vì worker khác đang giữ lock), dẫn đến totalCount bị tiêu thụ hết trước khi staging xong.
        let stagingRemaining = 0;
        try {
          if (typeof this.syncModel.getStagingRemainingCount === 'function') {
            stagingRemaining = await this.syncModel.getStagingRemainingCount();
          }
        } catch (recheckErr) {
          logger.warn(`[SyncHandlerModel] getStagingRemainingCount error: ${recheckErr.message}`);
        }

        if (stagingRemaining > 0) {
          // Staging vẫn còn records → mở rộng totalCount để tiếp tục xử lý
          state.totalCount += stagingRemaining;
          const extendedRemaining = Math.max(0, state.totalCount - processed);
          const extendedTake = Math.min(Number(limit || 1), extendedRemaining);
          logger.info(
            `[SyncHandlerModel] Virtual items exhausted but staging still has ${stagingRemaining} remaining. ` +
            `Extended totalCount to ${state.totalCount}, take=${extendedTake}`
          );
          if (extendedTake <= 0) {
            preparedJobs.delete(jobId);
            return [];
          }
          // Tiếp tục generate items với take mới
          const syncTime = state?.syncTime || lastTime;
          const startIndex = processed;
          state.nextIndex += extendedTake;
          return Array.from({ length: extendedTake }, (_, idx) => ({
            id: startIndex + idx + 1,
            __item_index: startIndex + idx,
            __sync_id: Number(state?.syncId || 0),
            __sync_time: syncTime,
            __source_sync_time: state?.sourceTime || lastTime,
            __source_sync_id: Number(state?.sourceId || lastSyncId || 0),
            updated_at: syncTime
          }));
        }

        // Staging thực sự hết → kết thúc job
        logger.warn(`[SyncHandlerModel] take=${take}, total=${total}, processed=${processed}, stagingRemaining=${stagingRemaining} → delete preparedJobs, return empty`);
        preparedJobs.delete(jobId);
        return [];
      }

      const syncTime = state?.syncTime || lastTime;
      const startIndex = processed;
      
      // Quan trọng: Tăng nextIndex theo 'limit' nếu là lô, ngược lại tăng theo 'take'
      state.nextIndex += isBatch 
        ? Math.min(limit, remaining) 
        : take;

      return Array.from({ length: take }, (_, idx) => ({
        id: startIndex + idx + 1,
        __item_index: startIndex + idx,
        __sync_id: Number(state?.syncId || 0),
        __sync_time: syncTime,
        __source_sync_time: state?.sourceTime || lastTime,
        __source_sync_id: Number(state?.sourceId || lastSyncId || 0),
        updated_at: syncTime
      }));
    };
  }

  /**
   * Builds a process function that delegates one item to model.processOne().
   * @returns {(record: object, context?: object) => Promise<any>}
   */
  createProcessFnIncremental() {
    return async (record, context = {}) => {
      const jobId = context.jobId;
      if (!jobId) {
        throw new Error('[SyncHandlerModel] jobId is required for incremental process');
      }

      const itemIndex = Math.max(
        0,
        Number((record && (record.__item_index ?? (record.id ? record.id - 1 : 0))) || 0)
      );

      return this.syncModel.processOne(jobId, {
        itemIndex,
        sourceLastSyncTime: record?.__source_sync_time || context.lastSyncTime || null,
        sourceLastSyncId: Number(record?.__source_sync_id || context.lastSyncId || 0)
      });
    };
  }

  /**
   * Checks whether a method is really implemented by target model (not inherited default stub).
   * @param {string} methodName
   * @returns {boolean}
   */
  hasImplementedMethod(methodName) {
    const targetFn = this.syncModel?.[methodName];
    if (typeof targetFn !== 'function') return false;
    const baseFn = BaseIncrementalSyncInterface.prototype[methodName];
    return targetFn !== baseFn;
  }

  /**
   * Validates required incremental methods and registers count/fetch/process handlers to SyncManagerService.
   * @param {import('./SyncManagerService')} syncManagerService
   * @param {string} modelName
   * @returns {Promise<void>}
   */
  async registerHandlers(syncManagerService, modelName) {
    try {
      const requiredMethods = ['fetchListFromOldDb', 'getList', 'processOne'];
      const missingMethods = requiredMethods.filter(
        (methodName) => !this.hasImplementedMethod(methodName)
      );

      if (missingMethods.length > 0) {
        throw new Error(
          `[SyncHandlerModel] ${modelName} must implement incremental flow methods: ${missingMethods.join(', ')}`
        );
      }

      const countFn = this.createCountFnIncremental();
      const fetchFn = this.createFetchFnIncremental();
      const processFn = this.createProcessFnIncremental();

      syncManagerService.register(modelName, fetchFn, processFn, { countFn });
      logger.info(`[SyncHandlerModel] Registered incremental handler for ${modelName}`);
    } catch (error) {
      logger.error(`[SyncHandlerModel] Failed to register ${modelName}:`, error);
      throw error;
    }
  }
}

module.exports = SyncHandlerModel;
