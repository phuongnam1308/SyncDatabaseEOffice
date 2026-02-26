const logger = require('../../utils/logger');

/**
 * Base model for sync handlers
 * Provides common fetch, count, and process functions for sync models
 */
class SyncHandlerModel {
    constructor(syncModel) {
        this.syncModel = syncModel;
        this.dbName = process.env.NEW_DB_NAME;
        this.dbOldName = 'DataEOfficeSNP';
    }

    /**
     * Generate fetch function for fetching records from sync table
     * @param {string} schemaName - Schema name (e.g., 'dbo')
     * @param {string} tableName - Table name (e.g., 'outgoing_documents_sync')
     * @returns {Function} Fetch function
     */
    createFetchFn(schemaName, tableName) {
        return async (lastTime, limit, _offset, cursor = {}) => {
            const lastSyncId = Number(cursor.lastSyncId || 0);
            const query = `
        SELECT TOP (@limit) *
        FROM (
          SELECT
            *,
            COALESCE(updated_at, created_at) AS __sync_time,
            ISNULL(CAST(id AS BIGINT), 0) AS __sync_id
          FROM ${this.dbName}.${schemaName}.${tableName}
        ) src
        WHERE (
          src.__sync_time > @lastTime
          OR (src.__sync_time = @lastTime AND src.__sync_id > @lastSyncId)
        )
        ORDER BY src.__sync_time ASC, src.__sync_id ASC
      `;

            const records = await this.syncModel.queryNewDbTx(query, {
                lastTime,
                lastSyncId,
                limit
            });

            return records.map((record) => ({
                ...record,
                updated_at: record.updated_at || record.__sync_time,
                __sync_id: record.__sync_id
            }));
        };
    }

    /**
     * Generate fetch function for fetching records from old DB table
     * @param {string} schemaName - Schema name (e.g., 'dbo')
     * @param {string} tableName - Table name (e.g., 'VanBanDi')
     * @returns {Function} Fetch function
     */
    createFetchFnOld(schemaName, tableName) {
        return async (lastTime, limit, _offset, cursor = {}) => {

            if (!tableName || typeof tableName !== 'string') {
                throw new Error(
                    `[MigrationModel] Invalid tableName: ${tableName}`
                );
            }

            const lastSyncId = Number(cursor.lastSyncId || 0);

            const timeColumn = tableName.includes('LuanChuyen')
                ? 'NgayTao'
                : 'Created';

            const query = `
            SELECT TOP (@limit)
                *,
                [${timeColumn}] AS __sync_time,
                ISNULL(CAST(id AS BIGINT), 0) AS __sync_id
            FROM ${this.dbOldName}.${schemaName}.${tableName}
            WHERE (
            [${timeColumn}] > @lastTime
            OR ([${timeColumn}] = @lastTime AND id > @lastSyncId)
            )
            ORDER BY [${timeColumn}] ASC, id ASC
            `;

            const records = await this.syncModel.queryOldDb(query, {
                lastTime,
                lastSyncId,
                limit
            });

            return records.map((record) => ({
                ...record,
                updated_at: record.updated_at || record.__sync_time,
                __sync_id: record.__sync_id
            }));
        };
    }

    /**
     * Generate process function for inserting records to main table (new DB flow: sync → main)
     * @returns {Function} Process function
     */
    createProcessFn() {
        return async (record) => {
            await this.syncModel.insertBatchToMain([record]);
        };
    }

    /**
     * Generate process function for inserting records from old DB.
     *
     * Hỗ trợ hai trường hợp:
     *   1. Model thông thường: insertBatchToNewDb([record]) → { inserted, updated }
     *   2. Document model mới: insertBatchToNewDb([record]) → { inserted, updated, skipped,
     *        auditInserted, auditUpdated, auditSkipped,
     *        commentInserted, commentUpdated, commentSkipped }
     *
     * Kết quả mở rộng được log nhưng không ảnh hưởng đến SyncManagerService
     * (vốn chỉ nhìn vào inserted + updated).
     *
     * @returns {Function} Process function
     */
    createProcessFnOld() {
        return async (record) => {
            const result = await this.syncModel.insertBatchToNewDb([record]);

            // Log thêm thống kê audit/comment nếu có (document-centric model)
            if (result && (result.auditInserted !== undefined || result.commentInserted !== undefined)) {
                logger.debug(
                    `[SyncHandlerModel] Document ID=${record?.ID} ` +
                    `→ doc(i=${result.inserted},u=${result.updated}) ` +
                    `audit(i=${result.auditInserted},u=${result.auditUpdated},s=${result.auditSkipped}) ` +
                    `comment(i=${result.commentInserted},u=${result.commentUpdated},s=${result.commentSkipped})`
                );
            }

            return result;
        };
    }

    /**
     * Generate count function for counting remaining records to sync
     * @param {string} schemaName - Schema name
     * @param {string} tableName - Table name
     * @param {string} mode - 'new' or 'old'
     * @returns {Function} Count function
     */
    createCountFn(schemaName, tableName, mode = 'new') {
        return async (lastTime, lastSyncId = 0) => {

            const schema =
                mode === 'old'
                    ? this.syncModel.oldDbSchema
                    : (schemaName || this.syncModel.newDbSchema);

            const table =
                mode === 'old'
                    ? this.syncModel.oldDbTable
                    : (tableName || this.syncModel.newDbTable);

            if (!schema || !table) {
                throw new Error(
                    `[SyncHandlerModel] Missing schema/table for mode=${mode}`
                );
            }

            const query = `
        SELECT COUNT(1) AS total
        FROM (
          SELECT
            COALESCE(updated_at, created_at) AS __sync_time,
            ISNULL(CAST(id AS BIGINT), 0) AS __sync_id
          FROM ${this.dbName}.${schemaName}.${tableName}
        ) src
        WHERE (
          src.__sync_time > @lastTime
          OR (src.__sync_time = @lastTime AND src.__sync_id > @lastSyncId)
        )
      `;

            const rows = await this.syncModel.queryNewDbTx(query, {
                lastTime,
                lastSyncId: Number(lastSyncId || 0)
            });

            return Number(rows?.[0]?.total || 0);
        };
    }

    /**
     * Generate count function for counting remaining records in old DB
     * @param {string} schemaName - Schema name
     * @param {string} tableName - Table name
     * @returns {Function} Count function
     */
    createCountFnOld(schemaName, tableName) {
        return async (lastTime, lastSyncId = 0) => {

            if (!tableName || typeof tableName !== 'string') {
                throw new Error(
                    `[MigrationModel] Invalid tableName: ${tableName}`
                );
            }

            const timeColumn = tableName.includes('LuanChuyen')
                ? 'NgayTao'
                : 'Created';

            const query = `
            SELECT COUNT(1) AS total
            FROM ${this.dbOldName}.${schemaName}.${tableName}
            WHERE (
            [${timeColumn}] > @lastTime
            OR ([${timeColumn}] = @lastTime AND id > @lastSyncId)
            )
            `;

            const rows = await this.syncModel.queryOldDb(query, {
                lastTime,
                lastSyncId: Number(lastSyncId || 0)
            });

            return Number(rows?.[0]?.total || 0);
        };
    }

    /**
     * Generate count function for incremental staging models.
     * Count is based on source old DB records after lastTime.
     * @returns {Function}
     */
    createCountFnIncremental() {
        return async (lastTime, lastSyncId = 0) => {
            const records = await this.syncModel.fetchListFromOldDb(lastTime, lastSyncId);
            return Array.isArray(records) ? records.length : 0;
        };
    }

    /**
     * Generate fetch function for incremental staging models.
     * First call for a job stages records via getList(); subsequent calls
     * return lightweight tokens representing remaining items to process.
     * @returns {Function}
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
                preparedJobs.set(jobId, {
                    totalCount: Number(listResult?.totalCount || 0),
                    syncTime: listResult?.lastSyncTime || lastTime,
                    syncId: Number(listResult?.lastSyncId || lastSyncId || 0),
                    sourceTime: listResult?.sourceLastSyncTime || lastTime,
                    sourceId: Number(listResult?.sourceLastSyncId || lastSyncId || 0),
                    nextIndex: 0
                });
            }

            const state = preparedJobs.get(jobId);
            const total = Number(state?.totalCount || 0);
            const processed = Number(state?.nextIndex || 0);
            const remaining = Math.max(0, total - processed);
            const take = Math.min(Number(limit || 1), remaining);

            if (take <= 0) {
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
                __source_sync_id: Number(state?.sourceId || 0),
                updated_at: syncTime
            }));
        };
    }

    /**
     * Generate process function for incremental staging models.
     * Each token means: process one staged record for the current jobId.
     * @returns {Function}
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
     * Register model handlers with SyncManagerService
     * @param {SyncManagerService} syncManagerService - Sync manager service instance
     * @param {string} modelName - Name for registration (e.g., 'SYNC_OUTGOING_DOCUMENT')
     */
    async registerHandlers(syncManagerService, modelName) {
        try {
            const schemaName = this.syncModel.syncSchema || this.syncModel.oldDbSchema;
            const tableName = this.syncModel.syncTable || this.syncModel.oldDbTable;
            let fetchFn, countFn, processFn;

            const isIncrementalModel =
                typeof this.syncModel.getList === 'function' &&
                typeof this.syncModel.processOne === 'function' &&
                typeof this.syncModel.fetchListFromOldDb === 'function';

            if (isIncrementalModel) {
                countFn = this.createCountFnIncremental();
                fetchFn = this.createFetchFnIncremental();
                processFn = this.createProcessFnIncremental();
            } else if (this.syncModel.syncSchema) {
                // Flow: sync table → main (apply)
                countFn = this.createCountFn(schemaName, tableName);
                fetchFn = this.createFetchFn(schemaName, tableName);
                processFn = this.createProcessFn();
            } else {
                // Flow: old DB → (sync + main) — document-centric hoặc migration thông thường
                countFn = this.createCountFnOld(schemaName, tableName);
                fetchFn = this.createFetchFnOld(schemaName, tableName);
                processFn = this.createProcessFnOld();
            }

            syncManagerService.register(modelName, fetchFn, processFn, { countFn });

            logger.info(`[SyncHandlerModel] Registered ${modelName}`);
        } catch (error) {
            logger.error(`[SyncHandlerModel] Failed to register ${modelName}:`, error);
            throw error;
        }
    }
}

module.exports = SyncHandlerModel;
