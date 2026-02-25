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
     * Generate fetch function for fetching records from sync table
     * @param {string} schemaName - Schema name (e.g., 'dbo')
     * @param {string} tableName - Table name (e.g., 'outgoing_documents_sync')
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
     * Generate process function for inserting records to main table
     * @returns {Function} Process function
     */
    createProcessFn(record) {
        return async (record) => {
            await this.syncModel.insertBatchToMain([record]);
        };
    }

    /**
     * Generate process function for inserting records to main table
     * @returns {Function} Process function
     */
    createProcessFnOld(record) {
        return async (record) => {
            await this.syncModel.insertBatchToNewDb([record]);
        };
    }

    /**
     * Generate count function for counting remaining records to sync
     * @param {string} schemaName - Schema name
     * @param {string} tableName - Table name
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
     * Generate count function for counting remaining records to sync
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
     * Register model handlers with SyncManagerService
     * @param {SyncManagerService} syncManagerService - Sync manager service instance
     * @param {string} modelName - Name for registration (e.g., 'SYNC_OUTGOING_DOCUMENT')
     */
    async registerHandlers(syncManagerService, modelName) {
        try {
            const schemaName = this.syncModel.syncSchema || this.syncModel.oldDbSchema;
            const tableName = this.syncModel.syncTable || this.syncModel.oldDbTable;
            let fetchFn, countFn, processFn;

            if (this.syncModel.syncSchema) {
                countFn = this.createCountFn(
                    schemaName,
                    tableName
                );
                fetchFn = this.createFetchFn(
                    schemaName,
                    tableName
                );
                processFn = this.createProcessFn();
            } else {
                countFn = this.createCountFnOld(
                    schemaName,
                    tableName
                );
                fetchFn = this.createFetchFnOld(
                    schemaName,
                    tableName
                );
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
