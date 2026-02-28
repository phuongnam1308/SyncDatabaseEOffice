const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class StreamTaskMigrationModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_TASK_COPY_MIGRATION' });
    this.newDbName = process.env.NEW_DB_NAME;
    this.oldDbSchema = 'dbo';
    this.oldDbTable = 'TaskVBDen'; //Bảng nguồn cũ cần đồng bộ
    this.newDbSchema = 'dbo';
    this.newTableSync = 'task_sync'; //Bảng trung gian lưu data raw dùng để sync dần vào bảng chính `task_clone_for_sync`
    this.newDbTable = 'task';
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

  /**
   * Lấy danh sách task từ CSDL cũ sau `lastSyncTime`.
   * Trả về mảng bản ghi (ID, AccountName, FullName, Modified, Created) đã sắp xếp theo thời gian sửa/tao.
   * @param {string} lastSyncTime - ISO datetime hoặc giá trị mặc định để lấy từ thời điểm đó về sau
   * @returns {Promise<Array>} danh sách bản ghi từ CSDL cũ
   */
  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0) {
    const query = `
      ;WITH source_rows AS (
        SELECT TOP 20
          *,
          COALESCE(TRY_CONVERT(datetime2, Modified), TRY_CONVERT(datetime2, Created)) AS __sync_time,
          TRY_CONVERT(
            BIGINT,
            NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), '')
          ) AS __sync_id_num
        FROM ${this.oldDbSchema}.${this.oldDbTable}

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
      ORDER BY
        __sync_time ASC,
        ISNULL(__sync_id_num, -9223372036854775808) ASC,
        ID ASC
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
    if (!columns.length) {
      return { stagedCount: 0 };
    }

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
    console.log('row', rows.length);
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
      `
      SELECT TOP 1
        job_id,
        total_to_sync,
        total_processed,
        total_success,
        total_errors,
        last_sync_time,
        last_sync_id
      FROM sync_jobs
      WHERE job_id = @syncJobId
      `,
      { syncJobId }
    );

    return rows?.[0] || null;
  }

  async processOne(syncJobId, options = {}) {
    if (!syncJobId) {
      throw new Error('syncJobId is required');
    }

    const jobState = await this.getSyncJobState(syncJobId);
    const itemIndex = Number(
      options.itemIndex != null
        ? options.itemIndex
        : (jobState?.total_processed || 0)
    );

    const sourceLastSyncTime = this.normalizeSyncTime(
      options.sourceLastSyncTime || options.lastSyncTime || jobState?.last_sync_time || DEFAULT_SYNC_TIME
    );
    const sourceLastSyncId = Number(
      options.sourceLastSyncId != null
        ? options.sourceLastSyncId
        : (jobState?.last_sync_id || 0)
    );

    const rowData = await this.fetchOneFromStaging({
      lastSyncTime: sourceLastSyncTime,
      lastSyncId: sourceLastSyncId,
      itemIndex,
    });

    if (!rowData) {
      return {
        syncJobId,
        itemIndex,
        processed: false,
        done: true
      };
    }

    const result = await this.processRowData(rowData);
    return {
      syncJobId,
      itemIndex,
      processed: true,
      done: false,
      rowId: rowData.ID || null,
      result
    };
  }

  async fetchOneFromStaging({ lastSyncTime, lastSyncId = 0, itemIndex, transaction } = {}) {
    const rowNumber = Number(itemIndex || 0) + 1;
    const stagingTableRef = this.getStagingTableRef();
    const query = `
      ;WITH source_rows AS (
        SELECT
          *,
          COALESCE(TRY_CONVERT(datetime2, Modified), TRY_CONVERT(datetime2, Created)) AS __sync_time,
          TRY_CONVERT(
            BIGINT,
            NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), '')
          ) AS __sync_id_num
        FROM ${stagingTableRef}
      ),
      staged AS (
        SELECT
          *,
          ROW_NUMBER() OVER (
            ORDER BY
              __sync_time ASC,
              ISNULL(__sync_id_num, -9223372036854775808) ASC,
              ID ASC
          ) AS rn
        FROM source_rows
        WHERE (
          __sync_time > @lastSyncTime
          OR (
            __sync_time = @lastSyncTime
            AND ISNULL(__sync_id_num, -9223372036854775808) > @lastSyncId
          )
        )
      )
      SELECT TOP 1 *
      FROM staged
      WHERE rn = @rowNumber
    `;

    const rows = await this.queryNewDbTx(
      query,
      {
        lastSyncTime,
        lastSyncId: Number(lastSyncId || 0),
        rowNumber
      },
      transaction
    );

    if (!rows?.length) {
      return null;
    }

    const row = { ...rows[0] };
    delete row.rn;
    return row;
  }

  /**
   * Xử lý một bản ghi task từ CSDL cũ.
   * - Chuẩn bị `backupId` và `fallbackName`.
   * - Gọi `upsertTaskById` để chèn hoặc cập nhật vào `task_clone_for_sync` trong schema `camunda`.
   * @param {Object} rowData - bản ghi đầu vào từ CSDL cũ
   * @param {{transaction?: Object}} [options]
   * @returns {Promise<{action:string,backupId:string,affected:number}>}
   */
  async processRowData(rowData, { transaction } = {}) {
    if (!rowData?.ID) {
      throw new Error('ID from old record is required');
    }

    // map dữu liệu từ db cũ sang db mới
    // map process_status
    let status = '';
    let priority = '';
    if (rowData.TrangThai === 'Chưa bắt đầu') {
      status = 1;
    } else if (rowData.TrangThai === 'Đang thực hiện') {
      status = 2;
    } else if (rowData.TrangThai === 'Hủy') {
      status = 8;
    } else if (rowData.TrangThai === 'Hoàn tất') {
      status = 4;
    } else {
      status = '';
    }

    // map priority
    if (rowData.Priority === '0') {
      priority = 'binhthuong';
    } else {
      priority = 'gap';
    }

    const obj = {
      'id': String(rowData.ID),
      'doc_id': rowData.VBId,
      'name': String(rowData.Title || '').trim(),
      'start_date': rowData.StartDate,
      'end_date': rowData.DueDate,
      'progress': rowData.Percent,
      'process_status': status,
      'priority': priority,
      'note': rowData.YKienChiDao,
      'created_at': rowData.Created,
      'updated_at': rowData.Modified,
      'updated_by': rowData.ModifiedBy,
      'created_by': rowData.CreatedBy,
      'parent': rowData.ParentTaskID
    }

    // Use upsert helper to insert or update by id
    const res = await this.upsertTaskById(obj, transaction);

    return {
      action: res.action || 'upsert',
      backupId: obj.id,
      affected: Number(res.affected || 0)
    };
  }

  /**
   * Chèn hoặc cập nhật một task theo `id` trong `{newDbName}.{schema}.task_clone_for_sync`.
   * - Nếu tồn tại: cập nhật tất cả các trường và `updated_at`.
   * - Nếu chưa có: chèn hàng mới với tất cả các trường.
   * Hàm hỗ trợ nhận `transaction` (nếu được truyền sẽ thực hiện trong transaction đó).
   * @param {Object} obj - object chứa các trường cần upsert (id, name, doc_id, start_date, end_date, progress, process_status, priority, note, created_at, updated_at, updated_by, created_by, parent)
   * @param {Object} [transaction] - transaction của kết nối mới (nếu có)
   * @returns {Promise<{action:string,affected:number}>}
   */
  async upsertTaskById(obj, transaction) {
    if (!obj || !obj.id) throw new Error('obj.id is required');
    
    const query = `
      IF EXISTS (SELECT 1 FROM ${this.newDbName}.${this.newDbSchema}.${this.newDbTable} WHERE id_sync = @id)
      BEGIN
        UPDATE ${this.newDbName}.${this.newDbSchema}.${this.newDbTable}
        SET 
          doc_id = @doc_id,
          name = UPPER(NULLIF(@name, '')),
          start_date = TRY_CONVERT(datetime2, NULLIF(@start_date, '')),
          end_date = TRY_CONVERT(datetime2, NULLIF(@end_date, '')),
          progress = @progress,
          process_status = @process_status,
          priority = @priority,
          note = @note,
          created_at = TRY_CONVERT(datetime2, NULLIF(@created_at, '')),
          updated_by = @updated_by,
          created_by = @created_by,
          update_at = GETDATE()
        WHERE id_sync = @id;
        SELECT @@ROWCOUNT AS affected, 'updated' AS action;
      END
      ELSE
      BEGIN
        INSERT INTO ${this.newDbName}.${this.newDbSchema}.${this.newDbTable} 
        (doc_id, name, start_date, end_date, progress, process_status, priority, note, created_at, update_at, updated_by, created_by, id_sync, status, type_task)
        VALUES (@doc_id, UPPER(NULLIF(@name, '')), 
        TRY_CONVERT(datetime2, NULLIF(@start_date, '')), 
        TRY_CONVERT(datetime2, NULLIF(@end_date, '')),
        @progress, @process_status, @priority, @note, 
        TRY_CONVERT(datetime2, NULLIF(@created_at, '')),
        GETDATE(), @updated_by, @created_by, @id, 1, 'form_doc');
        SELECT @@ROWCOUNT AS affected, 'inserted' AS action;
      END
    `;

    const params = {
      id: obj.id,
      doc_id: obj.doc_id || null,
      name: obj.name || '',
      start_date: obj.start_date || null,
      end_date: obj.end_date || null,
      progress: obj.progress || 0,
      process_status: obj.process_status || null,
      priority: obj.priority || 0,
      note: obj.note || null,
      created_at: obj.created_at || null,
      updated_by: obj.updated_by || null,
      created_by: obj.created_by || null,
      parent: obj.parent || null
    };
    const result = await this.queryNewDbTx(query, params, transaction);
    const row = Array.isArray(result) && result[0] ? result[0] : result;
    return {
      action: row?.action || (row?.affected ? 'updated' : 'none'),
      affected: Number(row?.affected || 0)
    };
  }

  /**
   * Đếm số task hiện có trong bảng `task_clone_for_sync` (schema mặc định của service).
   * @returns {Promise<number>} tổng số bản ghi
   */
  async countNewTasks() {
    const rows = await this.queryNewDb(
      `
      SELECT COUNT(1) AS total
      FROM ${this.newDbSchema}.${this.newTableSync}
      `
    );
    return Number(rows?.[0]?.total || 0);
  }
}

module.exports = StreamTaskMigrationModel;
