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
      // Nếu model có hàm getCount riêng thì ưu tiên dùng (tối ưu hơn)
      if (typeof this.syncModel.getCount === 'function') {
        return this.syncModel.getCount(lastTime, lastSyncId);
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
        const listResult = await this.syncModel.getList(lastTime, jobId, lastSyncId);
        // Khi Resume sau server restart, `nextIndex` phải bắt đầu từ số records đã xử lý trước đó
        // (context.totalProcessed) chứ không phải 0, để SyncManagerService không emit lại từ đầu.
        const resumeIndex = Number(cursor.totalProcessed || 0);

        // ★ DÙNG stagedCount thay vì totalCount (pendingCount sau getList = 0)
        // vì getList sau khi xong → tất cả đã staged, pending = 0
        // stagedCount = tổng records đã đẩy vào staging, dùng để loop processOne()
        const stagedCount = Number(listResult?.stagedCount || 0)
          || Number(listResult?.totalCount || 0);

        preparedJobs.set(jobId, {
          totalCount: stagedCount,
          syncTime: listResult?.lastSyncTime || lastTime,
          syncId: Number(listResult?.lastSyncId || lastSyncId || 0),
          sourceTime: listResult?.sourceLastSyncTime || lastTime,
          sourceId: Number(listResult?.sourceLastSyncId || lastSyncId || 0),
          nextIndex: resumeIndex
        });
        logger.info(`[SyncHandlerModel] getList() → stagedCount=${stagedCount}, jobId=${jobId}`);
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
        // ★ KHI take <= 0: XÓA preparedJobs để buộc getList() chạy lại lần sau
        // Điều này quan trọng khi processOne() trả về {done: true} vì staging đã hết
        // mà không phải lỗi logic - sẽ không bị infinite loop
        logger.warn(`[SyncHandlerModel] take=${take}, total=${total}, processed=${processed} → delete preparedJobs, return empty`);
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
