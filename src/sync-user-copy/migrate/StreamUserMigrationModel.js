const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');

class StreamUserMigrationModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_USER_COPY_MIGRATION' });
    this.newDbName = process.env.NEW_DB_NAME;
    this.oldDbSchema = 'dbo';
    this.oldDbTable = 'PersonalProfile';
    this.newDbSchema = 'dbo';
    this.newTableSync = 'user_sync'; //Bảng trung gian lưu data raw dùng để sync dần vào bảng chính `user_clone_for_sync`
    this.newDbTable = 'user_clone_for_sync';
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

  /**
   * Lấy danh sách user từ CSDL cũ sau `lastSyncTime`.
   * Trả về mảng bản ghi (ID, AccountName, FullName, Modified, NgayTao) đã sắp xếp theo thời gian sửa/tao.
   * @param {string} lastSyncTime - ISO datetime hoặc giá trị mặc định để lấy từ thời điểm đó về sau
   * @returns {Promise<Array>} danh sách bản ghi từ CSDL cũ
   */
  async fetchListFromOldDb(lastSyncTime) {
    const query = `
      SELECT
        *
      FROM ${this.oldDbSchema}.${this.oldDbTable}
      WHERE COALESCE(TRY_CONVERT(datetime2, Modified), TRY_CONVERT(datetime2, NgayTao)) > @lastSyncTime
      ORDER BY
        COALESCE(TRY_CONVERT(datetime2, Modified), TRY_CONVERT(datetime2, NgayTao)) ASC,
        ID ASC
    `;

    return this.queryOldDb(query, { lastSyncTime });
  }

  async syncOldToStaging(rows, { transaction } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { stagedCount: 0 };
    }

    const columns = Object.keys(rows[0] || {});
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

      await this.queryNewDbTx(query, row, transaction);
    }

    return { stagedCount: rows.length };
  }

  async fetchOneFromStaging({ lastSyncTime, itemIndex, transaction } = {}) {
    const rowNumber = Number(itemIndex || 0) + 1;
    const stagingTableRef = this.getStagingTableRef();
    const query = `
      ;WITH staged AS (
        SELECT
          *,
          ROW_NUMBER() OVER (
            ORDER BY
              COALESCE(TRY_CONVERT(datetime2, Modified), TRY_CONVERT(datetime2, NgayTao)) ASC,
              ID ASC
          ) AS rn
        FROM ${stagingTableRef}
        WHERE COALESCE(TRY_CONVERT(datetime2, Modified), TRY_CONVERT(datetime2, NgayTao)) > @lastSyncTime
      )
      SELECT TOP 1 *
      FROM staged
      WHERE rn = @rowNumber
    `;

    const rows = await this.queryNewDbTx(
      query,
      {
        lastSyncTime,
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
   * Xử lý một bản ghi user từ CSDL cũ.
   * - Chuẩn bị `backupId` và `fallbackName`.
   * - Gọi `upsertUserById` để chèn hoặc cập nhật vào `user_clone_for_sync` trong schema `camunda`.
   * @param {Object} rowData - bản ghi đầu vào từ CSDL cũ
   * @param {{transaction?: Object}} [options]
   * @returns {Promise<{action:string,backupId:string,affected:number}>}
   */
  async processRowData(rowData, { transaction } = {}) {
    if (!rowData?.ID) {
      throw new Error('ID from old record is required');
    }

    const backupId = String(rowData.ID);
    const fallbackName = String(rowData.FullName || rowData.AccountName || '').trim();
    // Use upsert helper to insert or update by id
    const res = await this.upsertUserById(backupId, fallbackName, transaction);

    return {
      action: res.action || 'upsert',
      backupId,
      affected: Number(res.affected || 0)
    };
  }

  /**
   * Chèn hoặc cập nhật một user theo `id` trong `{newDbName}.{schema}.user_clone_for_sync`.
   * - Nếu tồn tại: cập nhật trường `name` (viết hoa) và `updated_at`.
   * - Nếu chưa có: chèn hàng mới với `id`, `name`, `created_at`, `updated_at`.
   * Hàm hỗ trợ nhận `transaction` (nếu được truyền sẽ thực hiện trong transaction đó).
   * @param {string} backupId - id người dùng (từ CSDL cũ)
   * @param {string} fallbackName - tên thay thế nếu name hiện tại rỗng
   * @param {Object} [transaction] - transaction của kết nối mới (nếu có)
   * @returns {Promise<{action:string,affected:number}>}
   */
  async upsertUserById(backupId, fallbackName, transaction) {
    if (!backupId) throw new Error('backupId is required');

    const query = `
      IF EXISTS (SELECT 1 FROM ${this.newDbName}.${this.newDbSchema}.${this.newDbTable} WHERE id = @id)
      BEGIN
        UPDATE ${this.newDbName}.${this.newDbSchema}.${this.newDbTable}
        SET name = UPPER(COALESCE(NULLIF(name, ''), NULLIF(@fallbackName, ''), name)),
            updated_at = GETDATE()
        WHERE id = @id;
        SELECT @@ROWCOUNT AS affected, 'updated' AS action;
      END
      ELSE
      BEGIN
        INSERT INTO ${this.newDbName}.${this.newDbSchema}.${this.newDbTable} (id, name, created_at, updated_at)
        VALUES (@id, UPPER(NULLIF(@fallbackName, '')), GETDATE(), GETDATE());
        SELECT @@ROWCOUNT AS affected, 'inserted' AS action;
      END
    `;

    const params = { id: backupId, fallbackName };
    const result = await this.queryNewDbTx(query, params, transaction);
    const row = Array.isArray(result) && result[0] ? result[0] : result;
    return {
      action: row?.action || (row?.affected ? 'updated' : 'none'),
      affected: Number(row?.affected || 0)
    };
  }

  /**
   * Đếm số user hiện có trong bảng `user_clone_for_sync` (schema mặc định của service).
   * @returns {Promise<number>} tổng số bản ghi
   */
  async countNewUsers() {
    const rows = await this.queryNewDb(
      `
      SELECT COUNT(1) AS total
      FROM ${this.newDbSchema}.${this.newDbTable}
      `
    );
    return Number(rows?.[0]?.total || 0);
  }
}

module.exports = StreamUserMigrationModel;
