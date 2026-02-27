const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const { tableMappings } = require('./config');
const { v4: uuidv4 } = require('uuid');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class StreamSocialMigrationModel extends BaseIncrementalSyncInterface {
    constructor() {
        super({ modelName: 'STREAM_SOCIAL_RESOURCE_MIGRATION' });

        // Config bảng cũ
        this.oldConfig = tableMappings.news;

        this.oldDbName = this.oldConfig.oldDatabase;
        this.oldDbSchema = this.oldConfig.oldSchema;
        this.oldDbTable = this.oldConfig.oldTable;

        // Bảng staging tạm thời
        this.newDbName = this.oldConfig.newDatabase;
        this.newDbSchema = this.oldConfig.newSchema;
        this.newTableSync = 'social_resource_sync';
    }

    getStagingTableRef() {
        if (this.newDbName) {
            return `${this.newDbName}.${this.newDbSchema}.${this.newTableSync}`;
        }
        return `${this.newDbSchema}.${this.newTableSync}`;
    }

    sanitizeColumnName(column) {
        if (!/^[A-Za-z0-9_]+$/.test(column)) {
            throw new Error(`Invalid column name from source: ${column}`);
        }
        return `[${column}]`;
    }

    normalizeSyncTime(value) {
        if (!value) return DEFAULT_SYNC_TIME;
        const dateValue = new Date(value);
        if (Number.isNaN(dateValue.getTime())) return DEFAULT_SYNC_TIME;
        return dateValue.toISOString();
    }

    extractRowSyncTime(row) {
        const raw = row?.__sync_time || row?.Modified || row?.Created || row?.PostTime || null;
        if (!raw) return null;
        const dateValue = new Date(raw);
        if (Number.isNaN(dateValue.getTime())) return null;
        return dateValue.toISOString();
    }

    extractRowSyncId(row) {
        // ID cũ là string (UUID), convert sang numeric/hash để sort index cho đúng (nếu cần)
        // Tạm thời để string so sánh, hoặc dùng checksum bigint.
        return row?.__sync_id_num || 0;
    }

    isCursorAhead(aTime, aId, bTime, bId) {
        const ta = new Date(aTime || DEFAULT_SYNC_TIME).getTime();
        const tb = new Date(bTime || DEFAULT_SYNC_TIME).getTime();
        if (ta > tb) return true;
        if (ta < tb) return false;
        return Number(aId || 0) > Number(bId || 0);
    }

    async fetchListFromOldDb(lastSyncTime, lastSyncId = 0) {
        // Giả định bảng cũ là Social_otherResource (DataEOfficeSNP)
        const query = `
      ;WITH source_rows AS (
        SELECT
          *,
          COALESCE(TRY_CONVERT(datetime2, Modified), TRY_CONVERT(datetime2, Created), TRY_CONVERT(datetime2, PostTime)) AS __sync_time,
          CHECKSUM(ID) AS __sync_id_num
        FROM ${this.oldDbName}.${this.oldDbSchema}.${this.oldDbTable}
      )
      SELECT
        *,
        ISNULL(__sync_id_num, 0) AS __sync_id
      FROM source_rows
      WHERE (
        __sync_time > @lastSyncTime
        OR (
          __sync_time = @lastSyncTime
          AND ISNULL(__sync_id_num, -2147483648) > @lastSyncId
        )
      )
      ORDER BY
        __sync_time ASC,
        ISNULL(__sync_id_num, -2147483648) ASC
    `;

        return this.queryOldDb(query, {
            lastSyncTime,
            lastSyncId: Number(lastSyncId || 0)
        });
    }

    async syncOldToStaging(rows, { transaction } = {}) {
        if (!Array.isArray(rows) || rows.length === 0) {
            return { stagedCount: 0 };
        }

        const internalColumns = new Set(['__sync_time', '__sync_id', '__sync_id_num']);
        const columns = Object.keys(rows[0] || {}).filter((column) => !internalColumns.has(column));
        if (!columns.length) return { stagedCount: 0 };

        if (!columns.includes('ID')) {
            throw new Error('Staging sync requires source column "ID"');
        }

        // Tạo nhanh bảng staging tự động nếu chưa có
        const createStagingTableQuery = `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'${this.newDbName}.${this.newDbSchema}.${this.newTableSync}') AND type in (N'U'))
      BEGIN
        CREATE TABLE ${this.newDbName}.${this.newDbSchema}.${this.newTableSync}(
          [SY_SyncId] int identity(1,1) primary key,
          [__sync_time] datetime2 null,
          [__sync_id_num] bigint null,
          ${columns.map(c => this.sanitizeColumnName(c) + ' nvarchar(max) null').join(',\n')}
        )
      END
    `;
        await this.queryNewDbTx(createStagingTableQuery, {}, transaction);

        const safeColumns = columns.map((column) => this.sanitizeColumnName(column));
        const nonIdColumns = columns.filter((column) => column !== 'ID');
        const safeNonIdColumns = nonIdColumns.map((column) => this.sanitizeColumnName(column));
        const stagingTableRef = this.getStagingTableRef();

        for (const row of rows) {
            const params = {};
            for (const column of columns) {
                params[column] = row[column] != null ? String(row[column]) : null;
            }
            params.__sync_time = row.__sync_time || null;
            params.__sync_id_num = row.__sync_id_num || 0;

            const updateClause = safeNonIdColumns
                .map((columnName, idx) => `${columnName} = @${nonIdColumns[idx]}`)
                .join(', ');

            const query = `
        IF EXISTS (SELECT 1 FROM ${stagingTableRef} WHERE ID = @ID)
        BEGIN
          ${nonIdColumns.length > 0 ? `
          UPDATE ${stagingTableRef}
          SET ${updateClause}, __sync_time = @__sync_time, __sync_id_num = @__sync_id_num
          WHERE ID = @ID;` : `SELECT 1 AS noop;`}
        END
        ELSE
        BEGIN
          INSERT INTO ${stagingTableRef} (${safeColumns.join(', ')}, [__sync_time], [__sync_id_num])
          VALUES (${columns.map((column) => `@${column}`).join(', ')}, @__sync_time, @__sync_id_num);
        END
      `;

            await this.queryNewDbTx(query, params, transaction);
        }

        return { stagedCount: rows.length };
    }

    async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
        if (!syncJobId) throw new Error('syncJobId is required');

        const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
        const normalizedLastSyncId = Number(lastSyncId || 0);

        // Đọc data Cũ về Staging
        const rows = await this.fetchListFromOldDb(normalizedLastSyncTime, normalizedLastSyncId);
        const stageResult = await this.syncOldToStaging(rows);

        let nextSyncTime = normalizedLastSyncTime;
        let nextSyncId = normalizedLastSyncId;

        for (const row of rows) {
            const rowTime = this.extractRowSyncTime(row);
            const rowId = this.extractRowSyncId(row);
            if (!rowTime) continue;
            if (this.isCursorAhead(rowTime, rowId, nextSyncTime, nextSyncId)) {
                nextSyncTime = rowTime;
                nextSyncId = rowId;
            }
        }

        return {
            syncJobId, rows,
            totalCount: rows.length,
            stagedCount: Number(stageResult?.stagedCount || 0),
            sourceLastSyncTime: normalizedLastSyncTime,
            sourceLastSyncId: normalizedLastSyncId,
            lastSyncTime: nextSyncTime,
            lastSyncId: nextSyncId
        };
    }

    async getSyncJobState(syncJobId) {
        if (!syncJobId) throw new Error('syncJobId is required');
        const rows = await this.queryNewDb(
            `SELECT TOP 1 job_id, total_to_sync, total_processed, total_success, total_errors, last_sync_time, last_sync_id
       FROM sync_jobs WHERE job_id = @syncJobId`,
            { syncJobId }
        );
        return rows?.[0] || null;
    }

    async fetchOneFromStaging({ lastSyncTime, lastSyncId = 0, itemIndex, transaction } = {}) {
        const rowNumber = Number(itemIndex || 0) + 1;
        const stagingTableRef = this.getStagingTableRef();
        const query = `
      ;WITH staged AS (
        SELECT *, ROW_NUMBER() OVER (
            ORDER BY __sync_time ASC, ISNULL(__sync_id_num, -2147483648) ASC, ID ASC
        ) AS rn
        FROM ${stagingTableRef}
        WHERE (__sync_time > @lastSyncTime OR (__sync_time = @lastSyncTime AND ISNULL(__sync_id_num, -2147483648) > @lastSyncId))
      )
      SELECT TOP 1 * FROM staged WHERE rn = @rowNumber
    `;

        const rows = await this.queryNewDbTx(query, {
            lastSyncTime, lastSyncId: Number(lastSyncId || 0), rowNumber
        }, transaction);

        if (!rows?.length) return null;
        const row = { ...rows[0] };
        delete row.rn;
        return row;
    }

    async processOne(syncJobId, options = {}) {
        if (!syncJobId) throw new Error('syncJobId is required');

        const jobState = await this.getSyncJobState(syncJobId);
        const itemIndex = Number(options.itemIndex != null ? options.itemIndex : (jobState?.total_processed || 0));
        const sourceLastSyncTime = this.normalizeSyncTime(options.sourceLastSyncTime || options.lastSyncTime || jobState?.last_sync_time || DEFAULT_SYNC_TIME);
        const sourceLastSyncId = Number(options.sourceLastSyncId != null ? options.sourceLastSyncId : (jobState?.last_sync_id || 0));

        const rowData = await this.fetchOneFromStaging({
            lastSyncTime: sourceLastSyncTime,
            lastSyncId: sourceLastSyncId,
            itemIndex,
        });

        if (!rowData) {
            return { syncJobId, itemIndex, processed: false, done: true };
        }

        const result = await this.processRowData(rowData);
        return {
            syncJobId, itemIndex, processed: true, done: false,
            rowId: rowData.ID || null,
            result
        };
    }

    /**
     * processFn cốt lõi để transform và nạp vào 4 bảng mới
     */
    async processRowData(rowData, { transaction } = {}) {
        if (!rowData?.ID) throw new Error('ID from old record is required (Social_otherResource.ID)');

        const recordId = String(rowData.ID);
        let totalAffected = 0;
        const actionLogs = [];

        // 1. Sync News table
        const resultNews = await this.upsertDataToNewDB(rowData, tableMappings.news, 'topic', recordId, transaction);
        totalAffected += resultNews.affected;
        actionLogs.push({ table: 'news', action: resultNews.action });

        return {
            backupId: recordId,
            affected: totalAffected,
            logs: actionLogs
        };
    }

    async upsertDataToNewDB(rawData, config, externalKeyField, externalKeyValue, transaction) {
        const { newTable, newSchema, newDatabase, fieldMapping, defaultValues } = config;

        // Prepare Data
        const params = {};
        const cols = [];
        const vals = [];
        const updateClauses = [];

        for (const [oldField, newField] of Object.entries(fieldMapping)) {
            if (rawData[oldField] !== undefined) {
                params[newField] = rawData[oldField];
                cols.push(this.sanitizeColumnName(newField));
                vals.push(`@${newField}`);
                updateClauses.push(`${this.sanitizeColumnName(newField)} = @${newField}`);
            }
        }

        for (const [newField, valueFn] of Object.entries(defaultValues || {})) {
            if (!params.hasOwnProperty(newField)) {
                params[newField] = typeof valueFn === 'function' ? valueFn(rawData) : valueFn;
                cols.push(this.sanitizeColumnName(newField));
                vals.push(`@${newField}`);
            }
        }

        // Upsert query pattern based on external key (vd: topic = ID UUID)
        params._externalKeyValue = externalKeyValue;

        const query = `
      IF EXISTS (SELECT 1 FROM ${newDatabase}.${newSchema}.${newTable} WHERE ${this.sanitizeColumnName(externalKeyField)} = @_externalKeyValue)
      BEGIN
        UPDATE ${newDatabase}.${newSchema}.${newTable}
        SET ${updateClauses.join(', ')}
        WHERE ${this.sanitizeColumnName(externalKeyField)} = @_externalKeyValue;
        SELECT @@ROWCOUNT AS affected, 'updated' AS action;
      END
      ELSE
      BEGIN
        INSERT INTO ${newDatabase}.${newSchema}.${newTable} (${cols.join(', ')})
        VALUES (${vals.join(', ')});
        SELECT @@ROWCOUNT AS affected, 'inserted' AS action;
      END
    `;

        const result = await this.queryNewDbTx(query, params, transaction);
        const row = Array.isArray(result) && result[0] ? result[0] : result;
        return {
            action: row?.action || (row?.affected ? 'updated' : 'none'),
            affected: Number(row?.affected || 0)
        };
    }

}

module.exports = StreamSocialMigrationModel;
