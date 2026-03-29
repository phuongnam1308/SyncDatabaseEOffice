const MigrationHelper = require('../../helpers/MigrationHelper');
const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const { tableMappings } = require('./config');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class StreamMissionMigrationModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_MISSION_MIGRATION' });
    this.oldConfig = tableMappings.mission;
    this.oldDbName = this.oldConfig.oldDatabase;
    this.oldDbSchema = this.oldConfig.oldSchema;
    this.oldDbTable = this.oldConfig.oldTable;
    this.oldUserDb = this.oldConfig.oldUserDatabase || 'WSS_Content_eoffice';
    this.newDbName = this.oldConfig.newDatabase || 'camunda';
    this.newDbSchema = this.oldConfig.newSchema || 'dbo';
    this.newTableSync = 'mission_schedule_sync_staging';
    this.helper = new MigrationHelper(this.queryNewDbTx.bind(this), this.queryOldDb.bind(this));
  }

  async initialize() {
    await super.initialize();
    await this.ensureStagingTableExists();
    await this.ensureTargetColumnsExist();
  }

  async ensureTargetColumnsExist() {
    try {
      const table = this.oldConfig.newTable;
      const query = `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}' AND COLUMN_NAME = 'table_bak')
          ALTER TABLE dbo.${table} ADD table_bak INT NULL;

      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}' AND COLUMN_NAME = 'id_sp_bak')
          ALTER TABLE dbo.${table} ADD id_sp_bak NVARCHAR(255) NULL;

      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_${table}_id_sp_bak')
          CREATE INDEX IX_${table}_id_sp_bak ON dbo.${table}(id_sp_bak);
      `;
      await this.queryNewDb(query);
      console.log(`[ensureTargetColumnsExist] OK: Checked id_sp_bak for ${table}`);
    } catch (err) {
      console.error(`[ensureTargetColumnsExist] ERROR: ${err.message}`);
    }
  }

  async ensureStagingTableExists() {
    try {
      const stagingTableRef = this.getStagingTableRef();
      const table = this.newTableSync;
      const schema = this.newDbSchema || 'dbo';

      const createQuery = `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${table}')
      BEGIN
          CREATE TABLE ${stagingTableRef} (
              [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
              [__sync_time] DATETIME2 NULL,
              [__sync_id_num] BIGINT NULL,
              [ID] BIGINT NOT NULL
          );
          CREATE UNIQUE INDEX IX_${table}_ID ON ${stagingTableRef}([ID]);
      END
      `;
      await this.queryNewDb(createQuery);

      // 2. Danh sách các cột cần đảm bảo (Đã chuyển sang tiếng Anh cho đồng bộ)
      const columnsToAdd = [
          { name: 'ListName', type: 'NVARCHAR(500)' },
          { name: 'CreatedDate', type: 'NVARCHAR(500)' },
          { name: 'ModifiedDate', type: 'NVARCHAR(500)' },
          { name: 'tp_Created', type: 'NVARCHAR(500)' },
          { name: 'tp_Modified', type: 'NVARCHAR(500)' },
          { name: 'Title', type: 'NVARCHAR(MAX)' },
          { name: 'StartDate', type: 'NVARCHAR(500)' },
          { name: 'EndDate', type: 'NVARCHAR(500)' },
          { name: 'Location', type: 'NVARCHAR(MAX)' },
          { name: 'Description', type: 'NVARCHAR(MAX)' },
          { name: 'Organizer', type: 'NVARCHAR(500)' },
          { name: 'AuthorName', type: 'NVARCHAR(500)' },
          { name: 'AuthorAccount', type: 'NVARCHAR(500)' },
          { name: 'AuthorEmail', type: 'NVARCHAR(500)' },
          { name: 'EditorName', type: 'NVARCHAR(500)' },
          { name: 'EditorAccount', type: 'NVARCHAR(500)' }
      ];

      for (const col of columnsToAdd) {
          const alterQuery = `
          IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}' AND TABLE_SCHEMA = '${schema}' AND COLUMN_NAME = '${col.name}')
          BEGIN
              ALTER TABLE ${stagingTableRef} ADD [${col.name}] ${col.type} NULL;
          END
          `;
          await this.queryNewDb(alterQuery);
      }
    } catch (err) {
      console.error(`[ensureStagingTableExists] ERROR: ${err.message}`);
      throw err;
    }
  }

  getStagingTableRef() {
    const ref = this.newDbName
      ? `${this.newDbName}.${this.newDbSchema}.${this.newTableSync}`
      : `${this.newDbSchema}.${this.newTableSync}`;
    return ref;
  }

  normalizeSyncTime(value) {
    if (!value) return DEFAULT_SYNC_TIME;
    const dateValue = new Date(value);
    if (Number.isNaN(dateValue.getTime())) return DEFAULT_SYNC_TIME;
    return dateValue.toISOString();
  }

  extractRowSyncTime(row) {
    const raw = row?.__sync_time || row?.Modified || row?.Created || null;
    if (!raw) return null;
    const dateVal = new Date(raw);
    if (Number.isNaN(dateVal.getTime())) return null;
    return dateVal.toISOString();
  }

  extractRowSyncId(row) {
    return Number(row?.__sync_id_num ?? row?.ID ?? 0);
  }

  isCursorAhead(aTime, aId, bTime, bId) {
    const ta = new Date(aTime || DEFAULT_SYNC_TIME).getTime();
    const tb = new Date(bTime || DEFAULT_SYNC_TIME).getTime();
    if (ta > tb) return true;
    if (ta < tb) return false;
    return Number(aId || 0) > Number(bId || 0);
  }

  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0) {
    const listIds = this.oldConfig.listIds || [];
    const listIdsStr = listIds.map(id => `'${id}'`).join(',');
    const query = `
        SELECT TOP 500
            l.[tp_Title] AS ListName,
            ud.[tp_ID] AS ID,
            ud.[tp_Created] AS CreatedDate,
            ud.[tp_Modified] AS ModifiedDate,    
            ui_author.[tp_Title] AS AuthorName,
            ui_author.[tp_Login] AS AuthorAccount,
            ui_author.[tp_Email] AS AuthorEmail,
            ui_editor.[tp_Title] AS EditorName,
            ui_editor.[tp_Login] AS EditorAccount,
            ud.[nvarchar1] AS Title,
            ud.[datetime1] AS StartDate,
            ud.[datetime2] AS EndDate,
            ud.[nvarchar2] AS Location,
            ud.[nvarchar3] AS Description,
            ud.[nvarchar4] AS Organizer,
            
            -- Sync Tracking
            ud.[tp_Modified] AS __sync_time,
            ud.[tp_ID] AS __sync_id_num

        FROM [${this.oldDbName}].[dbo].[AllUserData] ud
        INNER JOIN [${this.oldDbName}].[dbo].[AllLists] l
            ON ud.[tp_ListId] = l.[tp_ID]
        LEFT JOIN [${this.oldUserDb}].[dbo].[UserInfo] ui_author 
            ON ud.[tp_Author] = ui_author.[tp_ID]
        LEFT JOIN [${this.oldUserDb}].[dbo].[UserInfo] ui_editor 
            ON ud.[tp_Editor] = ui_editor.[tp_ID]
        WHERE ud.[tp_ListId] IN (${listIdsStr})
        AND ud.[tp_IsCurrent] = 1
        AND ud.[tp_DeleteTransactionId] = 0x0
        AND (
            ud.[tp_Modified] > @lastSyncTime
            OR (
                ud.[tp_Modified] = @lastSyncTime
                AND ud.[tp_ID] > @lastSyncId
            )
        )
        ORDER BY ud.[tp_Modified] ASC, ud.[tp_ID] ASC
    `;
    return this.queryOldDb(query, { lastSyncTime, lastSyncId: Number(lastSyncId || 0) });
  }

  async syncOldToStaging(rows, { transaction } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return { stagedCount: 0 };
    const internalColumns = new Set(['__sync_time', '__sync_id_num']);
    const columns = Object.keys(rows[0]).filter(c => !internalColumns.has(c));
    const keyColumn = 'ID';
    const stagingTableRef = this.getStagingTableRef();

    for (const row of rows) {
      const params = {};
      for (const column of columns) {
        params[column] = row[column] != null ? String(row[column]) : null;
      }
      params.__sync_time = row.__sync_time;
      params.__sync_id_num = row.__sync_id_num;
      const updateSet = columns.filter(c => c !== keyColumn).map(c => `[${c}] = @${c}`).join(', ');
      const query = `
      IF EXISTS (SELECT 1 FROM ${stagingTableRef} WHERE [${keyColumn}] = @${keyColumn})
      BEGIN
          UPDATE ${stagingTableRef} SET ${updateSet}, __sync_time = @__sync_time, __sync_id_num = @__sync_id_num WHERE [${keyColumn}] = @${keyColumn}
      END
      ELSE
      BEGIN
          INSERT INTO ${stagingTableRef} (${columns.map(c => `[${c}]`).join(',')}, __sync_time, __sync_id_num)
          VALUES (${columns.map(c => `@${c}`).join(',')}, @__sync_time, @__sync_id_num)
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

    const rows = await this.fetchListFromOldDb(normalizedLastSyncTime, normalizedLastSyncId);
    await this.syncOldToStaging(rows);

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
    return { syncJobId, rows, totalCount: rows.length, lastSyncTime: nextSyncTime, lastSyncId: nextSyncId };
  }

  async fetchOneFromSource({ lastSyncTime, lastSyncId }) {
    const listIds = this.oldConfig.listIds || [];
    const listIdsStr = listIds.map(id => `'${id}'`).join(',');
    const query = `
        SELECT TOP 1
            ud.[tp_ID] AS ID,
            ud.[tp_Created] AS tp_Created,
            ud.[tp_Modified] AS tp_Modified,    
            ui_author.[tp_Title] AS AuthorName,
            ui_author.[tp_Login] AS AuthorAccount,
            ui_author.[tp_Email] AS AuthorEmail,
            ud.[nvarchar1] AS TieuDe,
            ud.[datetime1] AS BatDau,
            ud.[datetime2] AS KetThuc,
            ud.[nvarchar2] AS DiaDiem,
            ud.[nvarchar4] AS ChuTri,
            ud.[tp_Modified] AS __sync_time,
            ud.[tp_ID] AS __sync_id_num
        FROM [${this.oldDbName}].[dbo].[AllUserData] ud
        LEFT JOIN [${this.oldUserDb}].[dbo].[UserInfo] ui_author ON ud.[tp_Author] = ui_author.[tp_ID]
        WHERE ud.[tp_ListId] IN (${listIdsStr})
        AND ud.tp_RowOrdinal = 0
        AND ud.[tp_IsCurrentVersion] = 1
        AND (ud.[tp_Modified] > @lastSyncTime OR (ud.[tp_Modified] = @lastSyncTime AND ud.[tp_ID] > @lastSyncId))
        ORDER BY ud.[tp_Modified] ASC, ud.[tp_ID] ASC
    `;
    const rows = await this.queryOldDb(query, { lastSyncTime, lastSyncId });
    return rows?.[0] || null;
  }

  async getSyncJobState(syncJobId) {
    const rows = await this.queryNewDb(`SELECT TOP 1 * FROM sync_jobs WHERE job_id = @syncJobId`, { syncJobId });
    return rows?.[0] || null;
  }

  async processOne(syncJobId) {
    const jobState = await this.getSyncJobState(syncJobId);
    if (!jobState) throw new Error(`Job state not found: ${syncJobId}`);
    const rowData = await this.fetchOneFromSource({
      lastSyncTime: this.normalizeSyncTime(jobState.last_sync_time || DEFAULT_SYNC_TIME),
      lastSyncId: Number(jobState.last_sync_id || 0)
    });
    if (!rowData) return { syncJobId, processed: false, done: true };

    await this.processRowData(rowData);

    await this.queryNewDb(
      `UPDATE sync_jobs SET total_processed = ISNULL(total_processed,0) + 1, total_success = ISNULL(total_success,0) + 1,
       last_sync_time = @lastSyncTime, last_sync_id = @lastSyncId WHERE job_id = @syncJobId`,
      { syncJobId, lastSyncTime: this.extractRowSyncTime(rowData), lastSyncId: this.extractRowSyncId(rowData) }
    );
    return { syncJobId, processed: true, done: false };
  }

  async processRowData(rowData, { transaction } = {}) {
    if (!rowData?.ID) throw new Error('ID is required');
    const recordId = String(rowData.ID);
    const { externalKey } = this.oldConfig;

    // Mapping Người tạo (Created by)
    if (rowData.AuthorAccount) {
      rowData.AuthorAccount = await this.helper.mapUserName(rowData.AuthorAccount, transaction);
    }

    // Mapping Người chủ trì (Leader/Chairman)
    if (rowData.Organizer) {
      rowData.Organizer = await this.helper.mapUserWithLikeSearch(rowData.Organizer, transaction);
    }

    const result = await this.upsertDataToNewDB(rowData, this.oldConfig, externalKey, recordId, transaction);
    return { 
        backupId: recordId, 
        affected: result.affected, 
        logs: [{ table: this.oldConfig.newTable, action: result.action }] 
    };
  }

  async getExistingColumns(tableName, schema = 'dbo') {
    const result = await this.queryNewDb(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @tableName AND TABLE_SCHEMA = @schema`, { tableName, schema });
    return new Set(result.map(r => r.COLUMN_NAME));
  }

  async upsertDataToNewDB(rawData, config, externalKeyField, externalKeyValue, transaction) {
    const { newTable, newSchema, fieldMapping, defaultValues } = config;
    const existingCols = await this.getExistingColumns(newTable, newSchema);

    const params = {};
    const insertCols = [];
    const insertVals = [];
    const updateSet = [];

    for (const [oldField, newField] of Object.entries(fieldMapping)) {
      if (!existingCols.has(newField)) continue;
      const value = rawData[oldField];
      if (value === undefined || value === null) continue;
      params[newField] = value;
      insertCols.push(`[${newField}]`);
      insertVals.push(`@${newField}`);
      updateSet.push(`[${newField}] = @${newField}`);
    }

    for (const [newField, valueFn] of Object.entries(defaultValues || {})) {
      if (!existingCols.has(newField)) continue;
      if (!params.hasOwnProperty(newField)) {
        params[newField] = typeof valueFn === 'function' ? valueFn(rawData) : valueFn;
        insertCols.push(`[${newField}]`);
        insertVals.push(`@${newField}`);
        updateSet.push(`[${newField}] = @${newField}`);
      }
    }

    params._externalKeyValue = externalKeyValue;
    const tableRef = `[${this.newDbName}].[${newSchema}].[${newTable}]`;
    const query = `
      IF EXISTS (SELECT 1 FROM ${tableRef} WHERE [${externalKeyField}] = @_externalKeyValue)
      BEGIN
          UPDATE ${tableRef} SET ${updateSet.length ? updateSet.join(', ') : `${externalKeyField} = ${externalKeyField}`}
          WHERE [${externalKeyField}] = @_externalKeyValue;
          SELECT @@ROWCOUNT AS affected, 'updated' AS action;
      END
      ELSE
      BEGIN
          INSERT INTO ${tableRef} (${insertCols.join(', ')})
          VALUES (${insertVals.join(', ')});
          SELECT @@ROWCOUNT AS affected, 'inserted' AS action;
      END
    `;
    const result = await this.queryNewDbTx(query, params, transaction);
    const row = Array.isArray(result) ? result[0] : result;
    return { id: row?.id || null, action: row?.action || 'none', affected: Number(row?.affected || 0) };
  }
}

module.exports = StreamMissionMigrationModel;
