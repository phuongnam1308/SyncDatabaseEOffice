const BaseModel = require('../../models/BaseModel');
const logger = require('../../utils/logger');
const sql = require('mssql');

class FileRelationsModel extends BaseModel {
  constructor() {
    super();
    // Tên database mới lấy từ biến môi trường
    this.newDbName    = process.env.NEW_DB_NAME;
    this.newSchema    = 'dbo';
    this.mainTable    = 'file_relations';   // bảng chính: strict types, có FK ràng buộc với files
    this.stagingTable = 'file_relations2';  // bảng staging: toàn bộ nvarchar(MAX), không có FK
    this._ensureColumnsDone = false;
  }

  /**
   * Tự động tạo các cột bị thiếu nếu cần
   */
  async ensureColumns(transaction = null) {
    if (this._ensureColumnsDone) return;
    try {
      const dbName = process.env.NEW_DB_NAME;
      
      // 1. Kiểm tra và tạo bảng chính file_relations nếu chưa có
      await this.queryDb(`
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${this.mainTable}')
        BEGIN
            CREATE TABLE ${dbName}.dbo.${this.mainTable} (
                id BIGINT IDENTITY(1,1) PRIMARY KEY,
                object_type VARCHAR(50) NULL,
                object_id VARCHAR(50) NULL,
                file_id BIGINT NULL,
                created_at DATETIME DEFAULT GETDATE(),
                status INT DEFAULT 1,
                is_certified_copy INT DEFAULT 0
            );
        END
      `, {}, transaction);

      // 2. Kiểm tra và bổ sung các cột missing cho bảng chính
      await this.queryDb(`
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.mainTable}' AND COLUMN_NAME = 'is_certified_copy')
            ALTER TABLE ${dbName}.dbo.${this.mainTable} ADD is_certified_copy INT DEFAULT 0 NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.mainTable}' AND COLUMN_NAME = 'object_id_bak')
            ALTER TABLE ${dbName}.dbo.${this.mainTable} ADD object_id_bak NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.mainTable}' AND COLUMN_NAME = 'file_id_bak')
            ALTER TABLE ${dbName}.dbo.${this.mainTable} ADD file_id_bak NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.mainTable}' AND COLUMN_NAME = 'table_bak')
            ALTER TABLE ${dbName}.dbo.${this.mainTable} ADD table_bak NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.mainTable}' AND COLUMN_NAME = 'type_doc')
            ALTER TABLE ${dbName}.dbo.${this.mainTable} ADD type_doc NVARCHAR(MAX) NULL;
      `, {}, transaction);

      // 3. Kiểm tra và tạo bảng staging file_relations2 nếu chưa có
      await this.queryDb(`
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${this.stagingTable}')
        BEGIN
            CREATE TABLE ${dbName}.dbo.${this.stagingTable} (
                id BIGINT IDENTITY(1,1) PRIMARY KEY,
                object_type NVARCHAR(MAX) NULL,
                object_id NVARCHAR(MAX) NULL,
                file_id NVARCHAR(MAX) NULL,
                created_at NVARCHAR(MAX) NULL,
                status NVARCHAR(MAX) NULL,
                object_id_bak NVARCHAR(MAX) NULL,
                file_id_bak NVARCHAR(MAX) NULL,
                file_id_bak2 NVARCHAR(MAX) NULL,
                table_bak NVARCHAR(MAX) NULL,
                type_doc NVARCHAR(MAX) NULL
            );
        END
      `, {}, transaction);

      // 4. Kiểm tra và bổ sung các cột missing cho bảng staging (phòng hờ bảng đã có nhưng thiếu cột)
      await this.queryDb(`
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.stagingTable}' AND COLUMN_NAME = 'object_id_bak')
            ALTER TABLE ${dbName}.dbo.${this.stagingTable} ADD object_id_bak NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.stagingTable}' AND COLUMN_NAME = 'file_id_bak')
            ALTER TABLE ${dbName}.dbo.${this.stagingTable} ADD file_id_bak NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.stagingTable}' AND COLUMN_NAME = 'file_id_bak2')
            ALTER TABLE ${dbName}.dbo.${this.stagingTable} ADD file_id_bak2 NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.stagingTable}' AND COLUMN_NAME = 'table_bak')
            ALTER TABLE ${dbName}.dbo.${this.stagingTable} ADD table_bak NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.stagingTable}' AND COLUMN_NAME = 'type_doc')
            ALTER TABLE ${dbName}.dbo.${this.stagingTable} ADD type_doc NVARCHAR(MAX) NULL;
      `, {}, transaction);

      this._ensureColumnsDone = true;
    } catch(err) {
      logger.warn(`[FileRelationsModel] ensureColumns failed: ${err.message}`);
    }
  }

  /**
   * Trả về tên bảng chính đầy đủ (file_relations)
   */
  getMainTableRef() {
    if (this.newDbName) return `${this.newDbName}.${this.newSchema}.${this.mainTable}`;
    return `${this.newSchema}.${this.mainTable}`;
  }

  /**
   * Trả về tên bảng staging đầy đủ (file_relations2)
   */
  getStagingTableRef() {
    if (this.newDbName) return `${this.newDbName}.${this.newSchema}.${this.stagingTable}`;
    return `${this.newSchema}.${this.stagingTable}`;
  }

  /**
   * Chuẩn hóa giá trị trước khi bind vào tham số NVARCHAR(MAX).
   * Tránh lỗi "Invalid string" khi giá trị là số, object, hoặc Date.
   */
  normalizeNVarCharValue(value) {
    if (value === null || value === undefined || value === 'NULL' || value === 'null') return null;
    if (typeof value === 'string') return value;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    if (typeof value === 'object') {
      try { return JSON.stringify(value); } catch (_) { return String(value); }
    }
    return String(value);
  }

  /**
   * Thực thi câu query với tham số được bind đúng kiểu dữ liệu.
   * Dùng cho bảng file_relations (kiểu strict: varchar, bigint, bit, datetime).
   * @param {string} query - Câu SQL cần thực thi
   * @param {object} params - Tham số truyền vào
   * @param {sql.Transaction} transaction - Transaction (nếu có)
   */
  /**
   * Chuẩn hóa giá trị datetime trước khi bind vào tham số sql.DateTime.
   * Chuyển string / timestamp / Date thành Date object hợp lệ, trả null nếu không parse được.
   * @param {string|Date|number|null} value
   * @returns {Date|null}
   */
  normalizeDateValue(value) {
    if (value === null || value === undefined || value === 'NULL' || value === 'null' || value === '') return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  async queryDb(query, params = {}, transaction = null) {
    try {
      if (!transaction && !this.newPool) {
        throw new Error('Database pool chưa được khởi tạo. Hãy gọi initialize() trước.');
      }

      const request = transaction
        ? new sql.Request(transaction)
        : this.newPool.request();

      // Các field NVARCHAR(MAX) trong bảng file_relations
      const maxFields = ['object_id_bak', 'file_id_bak', 'table_bak', 'type_doc'];

      // Các field datetime — bind explicit để tránh SQL Server fail convert từ string
      const dateFields = ['created_at', 'updated_at'];

      Object.keys(params || {}).forEach(key => {
        const value = params[key];
        if (maxFields.includes(key)) {
          request.input(key, sql.NVarChar(sql.MAX), this.normalizeNVarCharValue(value));
        } else if (dateFields.includes(key)) {
          request.input(key, sql.DateTime, this.normalizeDateValue(value));
        } else {
          request.input(key, value);
        }
      });

      const result = await request.query(query);
      return result.recordset;
    } catch (error) {
      logger.error(`[FileRelationsModel] Lỗi query: ${error.message}`);
      throw error;
    }
  }

  // ══════════════════════════════════════════════
  //  BẢNG CHÍNH: file_relations
  //  (strict types: varchar(50), bigint, bit, datetime)
  // ══════════════════════════════════════════════

  /**
   * Thêm mới một bản ghi vào bảng file_relations.
   * - id        : tự động tăng (IDENTITY) do SQL Server tự sinh, không cần truyền
   * - created_at: tự động lấy GETDATE() nếu không truyền
   * - status    : mặc định 1 nếu không truyền
   * - is_certified_copy: mặc định 0 nếu không truyền
   *
   * @param {object} record - Dữ liệu bản ghi cần thêm
   * @param {string} record.object_type          - Loại đối tượng liên kết (varchar 50, bắt buộc)
   * @param {string} record.object_id            - ID đối tượng liên kết (varchar 50, bắt buộc)
   * @param {number} record.file_id              - ID file liên kết (bigint, bắt buộc, FK → files.id)
   * @param {number} [record.status=1]           - Trạng thái (1: hoạt động, 0: ẩn)
   * @param {number} [record.is_certified_copy=0]- Có phải bản sao công chứng không (0/1)
   * @param {string} record.object_id_bak        - ID đối tượng backup từ hệ thống cũ
   * @param {string} record.file_id_bak          - ID file backup từ hệ thống cũ
   * @param {string} record.table_bak            - Tên bảng backup
   * @param {string} record.type_doc             - Loại tài liệu
   * @param {sql.Transaction} transaction - Transaction (nếu có)
   * @returns {Promise<{action: string, newId: number}>}
   */
  async insert(record, transaction = null) {
    try {
      await this.ensureColumns(transaction);
      const tableRef = this.getMainTableRef();

      const query = `
        INSERT INTO ${tableRef} (
          object_type, object_id, file_id, created_at,
          status, is_certified_copy,
          object_id_bak, file_id_bak, table_bak, type_doc
        )
        VALUES (
          @object_type, @object_id, @file_id,
          ISNULL(@created_at, GETDATE()),   -- tự động lấy thời gian hiện tại nếu không truyền
          @status, @is_certified_copy,
          @object_id_bak, @file_id_bak, @table_bak, @type_doc
        );
        -- Trả về id vừa được SQL Server tự sinh
        SELECT SCOPE_IDENTITY() AS new_id;
      `;

      const rows = await this.queryDb(query, this._mapMainParams(record), transaction);
      return { action: 'inserted', newId: rows?.[0]?.new_id ?? null };
    } catch (error) {
      logger.error('[FileRelationsModel] Lỗi insert:', error);
      throw error;
    }
  }

  /**
   * Cập nhật bản ghi trong bảng file_relations theo id.
   * - created_at không bị thay đổi để giữ nguyên thời gian tạo ban đầu
   *
   * @param {number} id - ID bản ghi cần cập nhật (bắt buộc)
   * @param {object} record - Dữ liệu cần cập nhật (các field giống insert)
   * @param {sql.Transaction} transaction - Transaction (nếu có)
   * @returns {Promise<{action: string, id: number}>}
   */
  async update(id, record, transaction = null) {
    try {
      await this.ensureColumns(transaction);
      const tableRef = this.getMainTableRef();
      const params = { ...this._mapMainParams(record), id: Number(id) };

      const query = `
        UPDATE ${tableRef}
        SET
          object_type        = @object_type,
          object_id          = @object_id,
          file_id            = @file_id,
          status             = @status,
          is_certified_copy  = @is_certified_copy,
          object_id_bak      = @object_id_bak,
          file_id_bak        = @file_id_bak,
          table_bak          = @table_bak,
          type_doc           = @type_doc
        WHERE id = @id
      `;

      await this.queryDb(query, params, transaction);
      return { action: 'updated', id };
    } catch (error) {
      logger.error(`[FileRelationsModel] Lỗi update id=${id}:`, error);
      throw error;
    }
  }

  /**
   * Xóa vĩnh viễn bản ghi khỏi bảng file_relations theo id.
   * Lưu ý: nếu file_id còn được tham chiếu bởi FK, cần xóa file trước.
   *
   * @param {number} id - ID bản ghi cần xóa (bắt buộc)
   * @param {sql.Transaction} transaction - Transaction (nếu có)
   * @returns {Promise<{action: string, id: number}>}
   */
  async delete(id, transaction = null) {
    try {
      const tableRef = this.getMainTableRef();
      const query = `DELETE FROM ${tableRef} WHERE id = @id`;
      await this.queryDb(query, { id: Number(id) }, transaction);
      return { action: 'deleted', id };
    } catch (error) {
      logger.error(`[FileRelationsModel] Lỗi delete id=${id}:`, error);
      throw error;
    }
  }

  // ══════════════════════════════════════════════
  //  BẢNG STAGING: file_relations2
  //  (toàn bộ nvarchar(MAX), không có FK, dùng để lưu raw data)
  // ══════════════════════════════════════════════

  /**
   * Thêm mới một bản ghi vào bảng file_relations2 (staging).
   * - id: tự động tăng (IDENTITY) do SQL Server tự sinh, không cần truyền
   * - Tất cả field đều là nvarchar(MAX) nên nhận mọi loại dữ liệu đầu vào
   * - Không có FK ràng buộc nên không cần file_id phải tồn tại trong bảng files
   *
   * @param {object} record - Dữ liệu bản ghi cần thêm
   * @param {string} record.object_type   - Loại đối tượng liên kết
   * @param {string} record.object_id     - ID đối tượng liên kết
   * @param {string} record.file_id       - ID file liên kết (lưu dạng string)
   * @param {string} record.created_at    - Thời gian tạo (lưu dạng string)
   * @param {string} record.status        - Trạng thái (lưu dạng string)
   * @param {string} record.object_id_bak - ID đối tượng backup từ hệ thống cũ
   * @param {string} record.file_id_bak   - ID file backup từ hệ thống cũ
   * @param {string} record.file_id_bak2  - ID file backup lần 2 (field riêng của staging)
   * @param {string} record.table_bak     - Tên bảng backup
   * @param {string} record.type_doc      - Loại tài liệu
   * @param {sql.Transaction} transaction - Transaction (nếu có)
   * @returns {Promise<{action: string, newId: number}>}
   */
  async insertStaging(record, transaction = null) {
    try {
      await this.ensureColumns(transaction);
      const tableRef = this.getStagingTableRef();

      const request = transaction
        ? new sql.Request(transaction)
        : this.newPool.request();

      // Toàn bộ field của staging đều là NVARCHAR(MAX) → bind hết cùng một kiểu
      const params = this._mapStagingParams(record);
      Object.keys(params).forEach(key => {
        request.input(key, sql.NVarChar(sql.MAX), this.normalizeNVarCharValue(params[key]));
      });

      const query = `
        INSERT INTO ${tableRef} (
          object_type, object_id, file_id, created_at, status,
          object_id_bak, file_id_bak, file_id_bak2, table_bak, type_doc
        )
        VALUES (
          @object_type, @object_id, @file_id, @created_at, @status,
          @object_id_bak, @file_id_bak, @file_id_bak2, @table_bak, @type_doc
        );
        -- Trả về id vừa được SQL Server tự sinh
        SELECT SCOPE_IDENTITY() AS new_id;
      `;

      const result = await request.query(query);
      return { action: 'inserted', newId: result.recordset?.[0]?.new_id ?? null };
    } catch (error) {
      logger.error('[FileRelationsModel] Lỗi insertStaging:', error);
      throw error;
    }
  }

  /**
   * Cập nhật bản ghi trong bảng file_relations2 (staging) theo id.
   *
   * @param {number} id - ID bản ghi cần cập nhật (bắt buộc)
   * @param {object} record - Dữ liệu cần cập nhật (các field giống insertStaging)
   * @param {sql.Transaction} transaction - Transaction (nếu có)
   * @returns {Promise<{action: string, id: number}>}
   */
  async updateStaging(id, record, transaction = null) {
    try {
      await this.ensureColumns(transaction);
      const tableRef = this.getStagingTableRef();

      const request = transaction
        ? new sql.Request(transaction)
        : this.newPool.request();

      // Toàn bộ field staging đều là NVARCHAR(MAX)
      const params = this._mapStagingParams(record);
      Object.keys(params).forEach(key => {
        request.input(key, sql.NVarChar(sql.MAX), this.normalizeNVarCharValue(params[key]));
      });
      request.input('id', Number(id));

      const query = `
        UPDATE ${tableRef}
        SET
          object_type   = @object_type,
          object_id     = @object_id,
          file_id       = @file_id,
          created_at    = @created_at,
          status        = @status,
          object_id_bak = @object_id_bak,
          file_id_bak   = @file_id_bak,
          file_id_bak2  = @file_id_bak2,
          table_bak     = @table_bak,
          type_doc      = @type_doc
        WHERE id = @id
      `;

      await request.query(query);
      return { action: 'updated', id };
    } catch (error) {
      logger.error(`[FileRelationsModel] Lỗi updateStaging id=${id}:`, error);
      throw error;
    }
  }

  /**
   * Xóa vĩnh viễn bản ghi khỏi bảng file_relations2 (staging) theo id.
   *
   * @param {number} id - ID bản ghi cần xóa (bắt buộc)
   * @param {sql.Transaction} transaction - Transaction (nếu có)
   * @returns {Promise<{action: string, id: number}>}
   */
  async deleteStaging(id, transaction = null) {
    try {
      const tableRef = this.getStagingTableRef();

      const request = transaction
        ? new sql.Request(transaction)
        : this.newPool.request();

      request.input('id', Number(id));
      await request.query(`DELETE FROM ${tableRef} WHERE id = @id`);
      return { action: 'deleted', id };
    } catch (error) {
      logger.error(`[FileRelationsModel] Lỗi deleteStaging id=${id}:`, error);
      throw error;
    }
  }

  // ══════════════════════════════════════════════
  //  MAPPER NỘI BỘ
  // ══════════════════════════════════════════════

  /**
   * Chuẩn hóa params cho bảng file_relations (strict types).
   * Các field không truyền sẽ về null hoặc giá trị mặc định.
   * @param {object} record
   * @returns {object}
   */
  _mapMainParams(record) {
    return {
      object_type:       record.object_type        ?? null,
      object_id:         record.object_id          ?? null,
      file_id:           record.file_id            ?? null,
      created_at:        record.created_at         ?? null,    // null → GETDATE() trong SQL
      status:            record.status             ?? 1,       // mặc định: hoạt động
      is_certified_copy: record.is_certified_copy  ?? 0,       // mặc định: không phải bản công chứng
      object_id_bak:     record.object_id_bak      ?? null,
      file_id_bak:       record.file_id_bak        ?? null,
      table_bak:         record.table_bak          ?? null,
      type_doc:          record.type_doc           ?? null,
    };
  }

  /**
   * Chuẩn hóa params cho bảng file_relations2 (staging, toàn nvarchar MAX).
   * Tất cả giá trị đều được chuyển sang string trước khi bind.
   * @param {object} record
   * @returns {object}
   */
  _mapStagingParams(record) {
    return {
      object_type:   record.object_type   ?? null,
      object_id:     record.object_id     ?? null,
      file_id:       record.file_id       ?? null,
      created_at:    record.created_at    ?? null,
      status:        record.status        ?? null,
      object_id_bak: record.object_id_bak ?? null,
      file_id_bak:   record.file_id_bak   ?? null,
      file_id_bak2:  record.file_id_bak2  ?? null,  // field riêng chỉ có ở staging
      table_bak:     record.table_bak     ?? null,
      type_doc:      record.type_doc      ?? null,
    };
  }
}

module.exports = FileRelationsModel;