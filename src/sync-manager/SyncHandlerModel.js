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
    return async (lastTime, lastSyncId = 0) => {
      // Lấy singleton instance của SyncManagerService để kiểm tra settings
      const syncManager = require('./SyncManagerService');
      const skipPull = syncManager.state && syncManager.state.settings && syncManager.state.settings.SKIP_PULL_FROM_OLD === true;

      // Nếu SKIP_PULL_FROM_OLD = OFF (mặc định), ta muốn đếm từ DB cũ để biết tổng số sẽ hút
      if (!skipPull) {
        if (typeof this.syncModel.countListFromOldDb === 'function') {
          return this.syncModel.countListFromOldDb(lastTime, lastSyncId);
        }
        // Fallback cho các model cũ chưa tách countListFromOldDb
        if (typeof this.syncModel.getCount === 'function') {
          return this.syncModel.getCount(lastTime, lastSyncId);
        }
      } else {
        // Nếu SKIP_PULL_FROM_OLD = ON, ta chỉ quan tâm những gì đang có trong staging
        if (typeof this.syncModel.getCount === 'function') {
          return this.syncModel.getCount(lastTime, lastSyncId);
        }
      }

      const records = await this.syncModel.fetchListFromOldDb(lastTime, lastSyncId);
      return Array.isArray(records) ? records.length : 0;
    };
  }

  /**
   * Builds a fetch function that prepares one staged job snapshot then emits virtual items by batch.
   * @returns {(lastTime: string, limit: number, _offset: number, cursor?: object) => Promise<object[]>}
   */
  createFetchFnIncremental() {
    const preparedJobs = new Map();

    return async (lastTime, limit, _offset, cursor = {}) => {
      const jobId = cursor.jobId;
      const lastSyncId = Number(cursor.lastSyncId || 0);
      if (!jobId) {
        throw new Error('[SyncHandlerModel] cursor.jobId is required for incremental model');
      }

      if (!preparedJobs.has(jobId)) {
        // Lấy singleton instance của SyncManagerService để kiểm tra settings
        const syncManager = require('./SyncManagerService');
        const skipPull = syncManager.state && syncManager.state.settings && syncManager.state.settings.SKIP_PULL_FROM_OLD === true;

        let listResult = null;
        if (skipPull) {
          logger.info(`[SyncHandlerModel][${this.syncModel.getName ? this.syncModel.getName() : 'Unknown'}] SKIP_PULL_FROM_OLD is ON. Skipping extraction, using existing staging data.`);
          const stagedCount = await this.syncModel.getCount(lastTime, lastSyncId);
          listResult = {
            totalCount: stagedCount,
            lastSyncTime: lastTime,
            lastSyncId: lastSyncId
          };
        } else {
          listResult = await this.syncModel.getList(lastTime, jobId, lastSyncId);
        }

        const resumeIndex = Number(cursor.totalProcessed || 0);

        // Khi Resume sau server restart, `nextIndex` bắt đầu từ số records đã xử lý (resumeIndex).
        // Tuy nhiên `listResult.totalCount` là số `pendingCount` thực tế CẦN XỬ LÝ TRONG STAGING ở thời điểm hiện tại.
        // Do đó tổng `totalCount` trong context của preparedJobs phải là (pendingCount + resumeIndex)
        // để đảm bảo `remaining = totalCount - processed = pendingCount`.
        const pendingCount = Number(listResult?.totalCount ?? listResult?.stagedCount ?? 0);

        preparedJobs.set(jobId, {
          totalCount: pendingCount + resumeIndex,
          syncTime: listResult?.lastSyncTime || lastTime,
          syncId: Number(listResult?.lastSyncId || lastSyncId || 0),
          sourceTime: listResult?.sourceLastSyncTime || lastTime,
          sourceId: Number(listResult?.sourceLastSyncId || lastSyncId || 0),
          nextIndex: resumeIndex
        });
        logger.info(`[SyncHandlerModel] getList() → pendingCount=${pendingCount}, jobId=${jobId}`);
        if (resumeIndex > 0) {
          logger.info(`[SyncHandlerModel] Resuming jobId=${jobId}: nextIndex restored to ${resumeIndex}`);
        }
      }

      const state = preparedJobs.get(jobId);
      const total = Number(state?.totalCount || 0);
      const processed = Number(state?.nextIndex || 0);
      const remaining = Math.max(0, total - processed);
      const take = Math.min(Number(limit || 1), remaining);

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
      state.nextIndex += take;

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
