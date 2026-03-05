const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const { v4: uuidv4 } = require('uuid');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

/**
 * Đồng bộ phòng ban từ CSDL cũ (PersonalProfile) sang bảng organization_units.
 *
 * Nguồn dữ liệu là câu truy vấn tổng hợp DISTINCT từ PersonalProfile:
 *   - DonVi  → code  (phần sau dấu cách đầu tiên trong Code)
 *   - Department → name
 *
 * Logic đồng bộ:
 *   - Stage toàn bộ danh sách distinct (code, name) vào bảng trung gian `dept_sync`.
 *   - processOne: với mỗi record trong staging, nếu code CHƯA tồn tại trong
 *     organization_units thì INSERT, ngược lại SKIP.
 */
class StreamDepartmentMigrationModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_DEPARTMENT_MIGRATION' });
    this.newDbName   = process.env.NEW_DB_NAME;
    this.oldDbName   = process.env.OLD_DB_NAME;
    this.oldDbSchema = 'dbo';
    this.oldDbTable  = 'PersonalProfile';
    this.newDbSchema = 'dbo';
    this.newTableSync = 'dept_sync';          // Bảng trung gian staging
    this.newDbTable   = 'organization_units'; // Bảng đích
  }

  /**
   * Override initialize: kết nối DB xong tự động tạo bảng staging nếu chưa có.
   */
  async initialize() {
    await super.initialize();
    await this.ensureStagingTable();
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  getStagingTableRef() {
    return this.newDbName
      ? `${this.newDbName}.${this.newDbSchema}.${this.newTableSync}`
      : `${this.newDbSchema}.${this.newTableSync}`;
  }

  getTargetTableRef() {
    return this.newDbName
      ? `${this.newDbName}.${this.newDbSchema}.${this.newDbTable}`
      : `${this.newDbSchema}.${this.newDbTable}`;
  }

  normalizeSyncTime(value) {
    if (!value) return DEFAULT_SYNC_TIME;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? DEFAULT_SYNC_TIME : d.toISOString();
  }

  extractRowSyncTime(row) {
    const raw = row?.__sync_time || null;
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  extractRowSyncId(row) {
    return Number(row?.__sync_id || 0);
  }

  isCursorAhead(aTime, aId, bTime, bId) {
    const ta = new Date(aTime || DEFAULT_SYNC_TIME).getTime();
    const tb = new Date(bTime || DEFAULT_SYNC_TIME).getTime();
    if (ta > tb) return true;
    if (ta < tb) return false;
    return Number(aId || 0) > Number(bId || 0);
  }

  safeString(value) {
    if (value === 'NULL' || value === 'null' || value === null || value === undefined) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    return String(value).trim();
  }

  // ─── Đảm bảo bảng staging tồn tại (tự tạo nếu chưa có) ──────────────────

  /**
   * Tạo bảng `dept_sync` nếu chưa tồn tại.
   * Cột `code` là khoá tự nhiên (UNIQUE), `seq_id` là số thứ tự để fetch tuần tự.
   */
  async ensureStagingTable() {
    const ref = this.getStagingTableRef();
    const sql = `
      IF OBJECT_ID('${ref}', 'U') IS NULL
      BEGIN
        CREATE TABLE ${ref} (
          seq_id     INT IDENTITY(1,1) PRIMARY KEY,
          code       NVARCHAR(255)    NOT NULL,
          name       NVARCHAR(500)    NOT NULL,
          created_at DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          CONSTRAINT UQ_dept_sync_code UNIQUE (code)
        );
      END
    `;
    await this.queryNewDb(sql);
  }

  // ─── fetchListFromOldDb ───────────────────────────────────────────────────

  /**
   * Lấy danh sách DISTINCT (code, name) từ PersonalProfile.
   *
   * SQL gốc (logic trích xuất DonVi):
   *   Code = phần sau dấu cách đầu tiên trong LTRIM(RTRIM(SUBSTRING(FullName, CHARINDEX(' - ', FullName)+3, ...)))
   *   Department = tên phòng ban
   *
   * Trả về mảng { code, name, __sync_id, __sync_time }.
   * __sync_time luôn là thời điểm query (các phòng ban không có cột Modified).
   * __sync_id là ROW_NUMBER() để cursor hoạt động đúng.
   *
   * `lastSyncId` dùng để phân trang / tiếp tục từ điểm dừng:
   *   - Lần đầu (lastSyncId = 0): lấy toàn bộ.
   *   - Lần tiếp theo: chỉ lấy những row có seq_id > lastSyncId trong staging.
   *     (Ở fetchListFromOldDb ta luôn lấy toàn bộ DISTINCT để staging có đủ dữ liệu,
   *      rồi syncOldToStaging sẽ bỏ qua code đã tồn tại.)
   *
   * @param {string}  _lastSyncTime - không dùng (phòng ban không có cột Modified)
   * @param {number}  _lastSyncId   - không dùng
   * @returns {Promise<Array<{code:string,name:string,__sync_id:number,__sync_time:string}>>}
   */
  async fetchListFromOldDb(_lastSyncTime, _lastSyncId = 0) {
    const oldDbPrefix = this.oldDbName ? `${this.oldDbName}.` : '';
    const query = `
      ;WITH raw AS (
        SELECT
          LTRIM(RTRIM(
            SUBSTRING(FullName, CHARINDEX(' - ', FullName) + 3, LEN(FullName))
          )) AS RawCode,
          Department
        FROM ${oldDbPrefix}${this.oldDbSchema}.${this.oldDbTable}
        WHERE CHARINDEX(' - ', FullName) > 0
          AND LTRIM(RTRIM(Department)) <> ''
          AND Department IS NOT NULL
      ),
      parsed AS (
        SELECT
          CASE
            WHEN CHARINDEX(' ', RawCode) > 0
              THEN LTRIM(RTRIM(SUBSTRING(RawCode, CHARINDEX(' ', RawCode) + 1, LEN(RawCode))))
            ELSE RawCode
          END AS DonVi,
          Department
        FROM raw
        WHERE LTRIM(RTRIM(RawCode)) <> ''
      ),
      distinct_rows AS (
        SELECT DISTINCT
          DonVi  AS code,
          Department AS name
        FROM parsed
        WHERE LTRIM(RTRIM(DonVi)) <> ''
      )
      SELECT
        code,
        name,
        ROW_NUMBER() OVER (ORDER BY code ASC) AS __sync_id,
        SYSDATETIME()                          AS __sync_time
      FROM distinct_rows
      ORDER BY __sync_id ASC
    `;
    return this.queryOldDb(query, {});
  }

  // ─── syncOldToStaging ────────────────────────────────────────────────────

  /**
   * Ghi toàn bộ rows vào bảng staging `dept_sync`.
   * Dùng `code` làm khoá: nếu đã tồn tại thì cập nhật `name`, nếu chưa có thì INSERT.
   * @param {Array}  rows
   * @returns {Promise<{stagedCount:number}>}
   */
  async syncOldToStaging(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return { stagedCount: 0 };

    await this.ensureStagingTable();
    const ref = this.getStagingTableRef();

    for (const row of rows) {
      const code = this.safeString(row.code);
      const name = this.safeString(row.name);
      if (!code || !name) continue;

      await this.queryNewDb(
        `
        IF EXISTS (SELECT 1 FROM ${ref} WHERE code = @code)
          UPDATE ${ref} SET name = @name WHERE code = @code
        ELSE
          INSERT INTO ${ref} (code, name) VALUES (@code, @name)
        `,
        { code, name }
      );
    }

    return { stagedCount: rows.length };
  }

  // ─── getList ─────────────────────────────────────────────────────────────

  /**
   * Lấy danh sách phòng ban từ CSDL cũ, stage vào bảng trung gian,
   * và trả về thông tin để SyncHandlerModel điều phối processOne.
   *
   * Lưu ý về cursor:
   *   - __sync_time: luôn là SYSDATETIME() tại thời điểm fetch → dùng để xác định
   *     "lần chạy mới" khi reset, không dùng để lọc thêm bản ghi.
   *   - lastSyncId: là __sync_id lớn nhất trong batch, tức là row cuối đã stage.
   *
   * @param {string}  lastSyncTime
   * @param {string}  syncJobId
   * @param {number}  lastSyncId
   */
  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    if (!syncJobId) throw new Error('syncJobId is required');

    const rows = await this.fetchListFromOldDb(lastSyncTime, lastSyncId);
    const stageResult = await this.syncOldToStaging(rows);

    let nextSyncTime = this.normalizeSyncTime(lastSyncTime);
    let nextSyncId   = Number(lastSyncId || 0);

    for (const row of rows) {
      const rowTime = this.extractRowSyncTime(row);
      const rowId   = this.extractRowSyncId(row);
      if (!rowTime) continue;
      if (this.isCursorAhead(rowTime, rowId, nextSyncTime, nextSyncId)) {
        nextSyncTime = rowTime;
        nextSyncId   = rowId;
      }
    }

    return {
      syncJobId,
      rows,
      totalCount:          rows.length,
      stagedCount:         Number(stageResult?.stagedCount || 0),
      sourceLastSyncTime:  this.normalizeSyncTime(lastSyncTime),
      sourceLastSyncId:    Number(lastSyncId || 0),
      lastSyncTime:        nextSyncTime,
      lastSyncId:          nextSyncId
    };
  }

  // ─── getSyncJobState ──────────────────────────────────────────────────────

  async getSyncJobState(syncJobId) {
    if (!syncJobId) throw new Error('syncJobId is required');
    const rows = await this.queryNewDb(
      `SELECT TOP 1 job_id, total_to_sync, total_processed, total_success,
              total_errors, last_sync_time, last_sync_id
       FROM sync_jobs WHERE job_id = @syncJobId`,
      { syncJobId }
    );
    return rows?.[0] || null;
  }

  // ─── fetchOneFromStaging ──────────────────────────────────────────────────

  /**
   * Lấy một record trong staging theo `seq_id` (= itemIndex + 1).
   * Không lọc theo lastSyncTime vì phòng ban không có Modified;
   * toàn bộ staging đều thuộc một "batch" duy nhất.
   *
   * @param {{itemIndex?:number}} opts
   * @returns {Promise<{seq_id,code,name}|null>}
   */
  async fetchOneFromStaging({ itemIndex = 0 } = {}) {
    const rowNumber = Number(itemIndex || 0) + 1;
    const ref       = this.getStagingTableRef();

    const rows = await this.queryNewDb(
      `
      SELECT seq_id, code, name
      FROM ${ref}
      ORDER BY seq_id ASC
      OFFSET @offset ROWS
      FETCH NEXT 1 ROWS ONLY
      `,
      { offset: rowNumber - 1 }
    );

    return rows?.length ? rows[0] : null;
  }

  // ─── processOne ───────────────────────────────────────────────────────────

  /**
   * Xử lý một phòng ban trong staging theo thứ tự seq_id.
   * @param {string} syncJobId
   * @param {{itemIndex?:number}} options
   */
  async processOne(syncJobId, options = {}) {
    if (!syncJobId) throw new Error('syncJobId is required');

    const jobState  = await this.getSyncJobState(syncJobId);
    const itemIndex = Number(
      options.itemIndex != null ? options.itemIndex : (jobState?.total_processed || 0)
    );

    const rowData = await this.fetchOneFromStaging({ itemIndex });

    if (!rowData) {
      return { syncJobId, itemIndex, processed: false, done: true };
    }

    const result = await this.processRowData(rowData);
    return {
      syncJobId,
      itemIndex,
      processed: true,
      done:      false,
      code:      rowData.code,
      result
    };
  }

  // ─── processRowData ───────────────────────────────────────────────────────

  /**
   * Insert một phòng ban vào `organization_units` nếu `code` chưa tồn tại.
   * Nếu đã có → SKIP (không cập nhật gì).
   *
   * Các trường mặc định:
   *   - id         : UUID v4 uppercase
   *   - type       : null (không xác định được từ nguồn)
   *   - status     : 1 (active)
   *   - display_order : 0
   *   - mpath, parentId, leader, position, phone_number, email,
   *     address, description : null
   *   - Id_backups : seq_id của staging row
   *   - table_backups : 'PersonalProfile'
   *
   * @param {{seq_id:number, code:string, name:string}} rowData
   * @returns {Promise<{action:'inserted'|'skipped', code:string}>}
   */
  async processRowData(rowData) {
    const code = this.safeString(rowData?.code);
    const name = this.safeString(rowData?.name);

    if (!code || !name) {
      throw new Error(`[StreamDepartmentMigrationModel] code và name là bắt buộc (got code=${code}, name=${name})`);
    }

    const targetRef = this.getTargetTableRef();
    const newId     = uuidv4().toUpperCase();
    const now       = new Date();

    const query = `
      IF NOT EXISTS (
        SELECT 1 FROM ${targetRef} WHERE LTRIM(RTRIM(code)) = @code
      )
      BEGIN
        INSERT INTO ${targetRef} (
          id, name, code, [type],
          phone_number, email, leader, [position],
          address, description, display_order, status,
          mpath, parentId,
          created_at, updated_at,
          Id_backups, table_backups
        )
        VALUES (
          @id, @name, @code, NULL,
          NULL, NULL, NULL, NULL,
          NULL, NULL, 0, 1,
          NULL, NULL,
          @created_at, @updated_at,
          @Id_backups, @table_backups
        );
        SELECT 'inserted' AS action;
      END
      ELSE
      BEGIN
        SELECT 'skipped' AS action;
      END
    `;

    const result = await this.queryNewDb(query, {
      id:            newId,
      name,
      code,
      created_at:    now,
      updated_at:    now,
      Id_backups:    String(rowData.seq_id || ''),
      table_backups: 'PersonalProfile'
    });

    const action = result?.[0]?.action || 'skipped';
    return { action, code, name };
  }

  // ─── countNewDepts ────────────────────────────────────────────────────────

  /**
   * Đếm số phòng ban hiện có trong bảng đích.
   * @returns {Promise<number>}
   */
  async countNewDepts() {
    const rows = await this.queryNewDb(
      `SELECT COUNT(1) AS total FROM ${this.getTargetTableRef()}`
    );
    return Number(rows?.[0]?.total || 0);
  }
}

module.exports = StreamDepartmentMigrationModel;