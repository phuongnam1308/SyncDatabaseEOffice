const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const MigrationHelper = require('../../helpers/MigrationHelper');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

/**
 * Department migration model.
 * Extracts departments from PersonalProfile, parses DonVi (code) and Department (name),
 * stages to user_sync, then syncs to organization_units.
 */
class StreamDepartmentMigrationModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_DEPARTMENT_MIGRATION' });
    this.newDbName = process.env.NEW_DB_NAME || 'camunda';
    this.oldDbSchema = 'dbo';
    this.oldDbTable = 'PersonalProfile';
    this.newDbSchema = 'dbo';
    this.newTableSync = 'user_sync'; // staging table
    this.newDbTable = 'organization_units'; // target table
    this.migrationHelper = new MigrationHelper(
      (...args) => this.queryNewDbTx(...args),
      (...args) => this.queryOldDb?.(...args) ?? null
    );
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
    const raw = row?.__sync_time || row?.Modified || row?.NgayTao || row?.updated_at || null;
    if (!raw) return null;
    const dateValue = new Date(raw);
    if (Number.isNaN(dateValue.getTime())) return null;
    return dateValue.toISOString();
  }

  extractRowSyncId(row) {
    return Number(row?.__sync_id || row?.ID || 0);
  }

  isCursorAhead(aTime, aId, bTime, bId) {
    const ta = new Date(aTime || DEFAULT_SYNC_TIME).getTime();
    const tb = new Date(bTime || DEFAULT_SYNC_TIME).getTime();
    if (ta > tb) return true;
    if (ta < tb) return false;
    return Number(aId || 0) > Number(bId || 0);
  }

  safeString(value) {
    if (value === 'NULL' || value === 'null' || value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string' && value.trim() === '') {
      return null;
    }
    return String(value).trim();
  }

  safeNumber(value, defaultValue = 0) {
    if (value === 'NULL' || value === 'null' || value === null || value === undefined) {
      return defaultValue;
    }
    const num = Number(value);
    return Number.isNaN(num) ? defaultValue : num;
  }

  /**
   * Parse DonVi (code) and Department (name) from FullName and Department fields.
   */
  parseCodeAndName(record) {
    if (!record) return { code: null, name: null };

    const fullName = this.safeString(record.FullName) || '';
    const department = this.safeString(record.Department) || '';

    // Extract code from FullName: "ID - CODE DEPARTMENT"
    let code = '';
    const hyphenIdx = fullName.indexOf('-');
    if (hyphenIdx > -1) {
      code = fullName.substring(hyphenIdx + 1).trim();
      // Remove middle part if exists: "CODE DEPARTMENT" → "DEPARTMENT"
      const spaceIdx = code.indexOf(' ');
      if (spaceIdx > -1) {
        code = code.substring(spaceIdx + 1).trim();
      }
    } else {
      code = fullName;
    }

    return {
      code: code ? code.trim() : null,
      name: department ? department.trim() : null
    };
  }

  mapRecordForUpsert(oldRecord) {
    const { code, name } = this.parseCodeAndName(oldRecord);

    return {
      code: code || null,
      name: name || null,
      type: null,
      phone_number: null,
      email: null,
      leader: null,
      position: null,
      address: null,
      description: null,
      display_order: 0,
      status: 1,
      mpath: null,
      parentId: null,
      created_at: new Date(),
      updated_at: new Date(),
      table_backups: 'PersonalProfile'
    };
  }

  /**
   * Fetch departments from old DB (PersonalProfile).
   */
  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0) {
    const query = `
      ;WITH source_rows AS (
        SELECT DISTINCT
          ID,
          FullName,
          Department,
          COALESCE(TRY_CONVERT(datetime2, Modified), TRY_CONVERT(datetime2, NgayTao)) AS __sync_time,
          TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), '')) AS __sync_id_num
        FROM ${this.oldDbSchema}.${this.oldDbTable}
        WHERE CHARINDEX(' - ', FullName) > 0 AND Department IS NOT NULL AND Department <> ''
      )
      SELECT
        *,
        ISNULL(__sync_id_num, 0) AS __sync_id
      FROM source_rows
      WHERE (
        __sync_time > @lastSyncTime
        OR (
          __sync_time = @lastSyncTime
          AND ISNULL(__sync_id_num, -9223372036854775808) > @lastSyncId
        )
      )
      ORDER BY __sync_time ASC, ISNULL(__sync_id_num, -9223372036854775808) ASC, ID ASC
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

    const safeColumns = columns.map((column) => this.sanitizeColumnName(column));
    const nonIdColumns = columns.filter((column) => column !== 'ID');
    const safeNonIdColumns = nonIdColumns.map((column) => this.sanitizeColumnName(column));
    const stagingTableRef = this.getStagingTableRef();

    for (const row of rows) {
      const params = {};
      for (const column of columns) {
        params[column] = row[column];
      }

      const updateClause = safeNonIdColumns
        .map((columnName, idx) => `${columnName} = @${nonIdColumns[idx]}`)
        .join(', ');

      const query = `
        IF EXISTS (SELECT 1 FROM ${stagingTableRef} WHERE ID = @ID)
        BEGIN
          ${nonIdColumns.length > 0 ? `
          UPDATE ${stagingTableRef}
          SET ${updateClause}
          WHERE ID = @ID;` : `
          SELECT 1 AS noop;`}
        END
        ELSE
        BEGIN
          INSERT INTO ${stagingTableRef} (${safeColumns.join(', ')})
          VALUES (${columns.map((column) => `@${column}`).join(', ')});
        END
      `;

      await this.queryNewDbTx(query, params, transaction);
    }

    return { stagedCount: rows.length };
  }

  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    if (!syncJobId) {
      throw new Error('syncJobId is required');
    }

    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);
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
      syncJobId,
      rows,
      totalCount: rows.length,
      stagedCount: Number(stageResult?.stagedCount || 0),
      sourceLastSyncTime: normalizedLastSyncTime,
      sourceLastSyncId: normalizedLastSyncId,
      lastSyncTime: nextSyncTime,
      lastSyncId: nextSyncId
    };
  }

  async getSyncJobState(syncJobId) {
    if (!syncJobId) {
      throw new Error('syncJobId is required');
    }

    const rows = await this.queryNewDb(
      `SELECT TOP 1 job_id, total_to_sync, total_processed, total_success, total_errors, last_sync_time, last_sync_id FROM sync_jobs WHERE job_id = @syncJobId`,
      { syncJobId }
    );

    return rows?.[0] || null;
  }

  /**
   * Process one department: parse code/name, check for duplicates, insert if new.
   */
  async processOne(syncJobId, options = {}) {
    if (!syncJobId) {
      throw new Error('syncJobId is required');
    }

    const jobState = await this.getSyncJobState(syncJobId);
    const itemIndex = Number(options.itemIndex != null ? options.itemIndex : 0);

    let stagingRow = null;
    let result = { itemIndex, syncJobId, processed: 0, inserted: 0, skipped: 0 };

    // Fetch one staged record
    const stagingTableRef = this.getStagingTableRef();
    const stagingRows = await this.queryNewDb(
      `SELECT TOP 1 * FROM ${stagingTableRef} ORDER BY ID OFFSET ${itemIndex} ROWS FETCH NEXT 1 ROW ONLY`
    );

    if (!Array.isArray(stagingRows) || stagingRows.length === 0) {
      result.status = 'COMPLETED';
      return result;
    }

    stagingRow = stagingRows[0];
    const { code, name } = this.parseCodeAndName(stagingRow);

    if (!code && !name) {
      result.skipped = 1;
      result.status = 'SKIPPED_EMPTY';
      return result;
    }

    // Check if already exists in target
    const checkRows = await this.queryNewDb(
      `SELECT TOP 1 id FROM ${this.newDbName}.${this.newDbSchema}.${this.newDbTable} WHERE (code = @code AND @code <> '') OR (name = @name AND @name <> '')`,
      { code: code || '', name: name || '' }
    );

    if (Array.isArray(checkRows) && checkRows.length > 0) {
      result.skipped = 1;
      result.status = 'DUPLICATE_SKIPPED';
      return result;
    }

    // Insert new department
    await this.queryNewDb(
      `INSERT INTO ${this.newDbName}.${this.newDbSchema}.${this.newDbTable} (name, code, display_order, status, created_at, updated_at, table_backups) VALUES (@name, @code, 0, 1, GETDATE(), GETDATE(), 'PersonalProfile')`,
      { code: code || null, name: name || null }
    );

    result.inserted = 1;
    result.processed = 1;
    result.status = 'INSERTED';
    return result;
  }
}

module.exports = StreamDepartmentMigrationModel;
