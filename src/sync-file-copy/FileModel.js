const BaseModel = require('../../models/BaseModel');
const logger = require('../../utils/logger');
const sql = require('mssql');

class FileModel extends BaseModel {
  constructor() {
    super();
    // Tên database mới lấy từ biến môi trường
    this.newDbName = process.env.NEW_DB_NAME;
    this.newSchema = 'dbo';
    this.newTable  = 'files';
  }

  /**
   * Trả về tên bảng đầy đủ kèm schema và database (nếu có)
   */
  getTableRef() {
    if (this.newDbName) return `${this.newDbName}.${this.newSchema}.${this.newTable}`;
    return `${this.newSchema}.${this.newTable}`;
  }

  /**
   * Chuẩn hóa giá trị trước khi bind vào tham số NVARCHAR(MAX).
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

  /**
   * Thực thi câu query với tham số đã được bind đúng kiểu dữ liệu.
   * Các field NVARCHAR(MAX) được bind tường minh để tránh SQL Server tự infer NVARCHAR(4000).
   * @param {string} query - Câu SQL cần thực thi
   * @param {object} params - Tham số truyền vào câu query
   * @param {sql.Transaction} transaction - Transaction (nếu có)
   */
  async queryDb(query, params = {}, transaction = null) {
    try {
      if (!transaction && !this.newPool) {
        throw new Error('Database pool chưa được khởi tạo. Hãy gọi initialize() trước.');
      }

      const request = transaction
        ? new sql.Request(transaction)
        : this.newPool.request();

      // Danh sách field cần bind kiểu NVARCHAR(MAX)
      const maxFields = [
        'file_name', 'file_path', 'description', 'storage_path',
        'id_bak', 'table_bak', 'type_doc', 'nguoikyvanban',
      ];

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
      logger.error(`[FileModel] Lỗi query: ${error.message}`);
      throw error;
    }
  }

  // ══════════════════════════════════════════════
  //  THÊM MỚI (INSERT)
  // ══════════════════════════════════════════════

  /**
   * Thêm mới một bản ghi vào bảng files.
   * - id          : tự động tăng (IDENTITY) do SQL Server tự sinh, không cần truyền
   * - created_at  : tự động lấy thời gian hiện tại (GETDATE()) nếu không truyền
   * - updated_at  : tự động lấy thời gian hiện tại (GETDATE()) nếu không truyền
   * - status      : mặc định 1 (hoạt động) nếu không truyền
   * - is_directory: mặc định 0 (không phải thư mục) nếu không truyền
   * - is_signed_file: mặc định 0 nếu không truyền
   * - isNumbered  : mặc định 0 nếu không truyền
   * - isBak       : mặc định 0 nếu không truyền
   * - is_important: mặc định 0 nếu không truyền
   *
   * @param {object} record - Dữ liệu bản ghi cần thêm
   * @param {string}  record.file_name             - Tên file (bắt buộc)
   * @param {string}  record.file_path             - Đường dẫn file
   * @param {string}  record.mime_type             - Loại MIME của file
   * @param {number}  record.file_size             - Kích thước file (bytes)
   * @param {string}  record.description           - Mô tả file
   * @param {number}  [record.is_directory=0]      - Có phải thư mục không (0/1)
   * @param {number}  record.parent_id             - ID thư mục cha
   * @param {string}  record.created_by            - Người tạo
   * @param {number}  [record.status=1]            - Trạng thái (1: hoạt động, 0: ẩn)
   * @param {number}  record.version               - Phiên bản file
   * @param {number}  [record.is_signed_file=0]    - Có phải file đã ký không
   * @param {number}  record.number_of_signed_file - Số lượng file đã ký
   * @param {string}  record.storage_path          - Đường dẫn lưu trữ thực tế
   * @param {string}  record.storage_type          - Loại lưu trữ (local/s3/...)
   * @param {number}  [record.isNumbered=0]        - Có đánh số không
   * @param {string}  record.typeSize              - Loại kích thước
   * @param {string}  record.id_bak               - ID backup từ hệ thống cũ
   * @param {string}  record.table_bak            - Tên bảng backup
   * @param {string}  record.type_doc             - Loại tài liệu
   * @param {number}  [record.isBak=0]            - Có phải bản backup không
   * @param {string}  record.nguoikyvanban        - Người ký văn bản
   * @param {number}  [record.is_important=0]     - Có phải tài liệu quan trọng không
   * @param {sql.Transaction} transaction - Transaction (nếu có)
   * @returns {Promise<{action: string, newId: number}>}
   */
  async insert(record, transaction = null) {
    try {
      const tableRef = this.getTableRef();

      const query = `
        INSERT INTO ${tableRef} (
          file_name, file_path, mime_type, file_size, description, is_directory,
          parent_id, created_by, created_at, updated_at, status, version,
          is_signed_file, number_of_signed_file, storage_path, storage_type,
          isNumbered, typeSize, id_bak, table_bak, type_doc, isBak,
          nguoikyvanban, is_important
        )
        VALUES (
          @file_name, @file_path, @mime_type, @file_size, @description, @is_directory,
          @parent_id, @created_by,
          ISNULL(@created_at, GETDATE()),   -- tự động lấy thời gian hiện tại nếu không truyền
          ISNULL(@updated_at, GETDATE()),   -- tự động lấy thời gian hiện tại nếu không truyền
          @status, @version,
          @is_signed_file, @number_of_signed_file, @storage_path, @storage_type,
          @isNumbered, @typeSize, @id_bak, @table_bak, @type_doc, @isBak,
          @nguoikyvanban, @is_important
        );
        -- Trả về id vừa được SQL Server tự sinh
        SELECT SCOPE_IDENTITY() AS new_id;
      `;

      const rows = await this.queryDb(query, this._mapParams(record), transaction);
      return { action: 'inserted', newId: rows?.[0]?.new_id ?? null };
    } catch (error) {
      logger.error('[FileModel] Lỗi insert:', error);
      throw error;
    }
  }

  // ══════════════════════════════════════════════
  //  CẬP NHẬT (UPDATE)
  // ══════════════════════════════════════════════

  /**
   * Cập nhật bản ghi trong bảng files theo id.
   * - updated_at luôn tự động cập nhật thành thời gian hiện tại (GETDATE())
   * - id         : bắt buộc phải truyền, không thay đổi
   * - created_at : không cập nhật để giữ nguyên thời gian tạo ban đầu
   *
   * @param {number} id - ID bản ghi cần cập nhật (bắt buộc)
   * @param {object} record - Dữ liệu cần cập nhật (các field giống insert)
   * @param {sql.Transaction} transaction - Transaction (nếu có)
   * @returns {Promise<{action: string, id: number}>}
   */
  async update(id, record, transaction = null) {
    try {
      const tableRef = this.getTableRef();
      const params = { ...this._mapParams(record), id: Number(id) };

      const query = `
        UPDATE ${tableRef}
        SET
          file_name             = @file_name,
          file_path             = @file_path,
          mime_type             = @mime_type,
          file_size             = @file_size,
          description           = @description,
          is_directory          = @is_directory,
          parent_id             = @parent_id,
          created_by            = @created_by,
          updated_at            = GETDATE(),    -- luôn tự cập nhật thời gian hiện tại
          status                = @status,
          version               = @version,
          is_signed_file        = @is_signed_file,
          number_of_signed_file = @number_of_signed_file,
          storage_path          = @storage_path,
          storage_type          = @storage_type,
          isNumbered            = @isNumbered,
          typeSize              = @typeSize,
          table_bak             = @table_bak,
          type_doc              = @type_doc,
          isBak                 = @isBak,
          nguoikyvanban         = @nguoikyvanban,
          is_important          = @is_important
        WHERE id = @id
      `;

      await this.queryDb(query, params, transaction);
      return { action: 'updated', id };
    } catch (error) {
      logger.error(`[FileModel] Lỗi update id=${id}:`, error);
      throw error;
    }
  }

  // ══════════════════════════════════════════════
  //  XÓA (DELETE)
  // ══════════════════════════════════════════════

  /**
   * Xóa vĩnh viễn bản ghi khỏi bảng files theo id.
   * Lưu ý: thao tác này không thể hoàn tác. Cân nhắc dùng update status = 0 thay thế.
   *
   * @param {number} id - ID bản ghi cần xóa (bắt buộc)
   * @param {sql.Transaction} transaction - Transaction (nếu có)
   * @returns {Promise<{action: string, id: number}>}
   */
  async delete(id, transaction = null) {
    try {
      const tableRef = this.getTableRef();
      const query = `DELETE FROM ${tableRef} WHERE id = @id`;
      await this.queryDb(query, { id: Number(id) }, transaction);
      return { action: 'deleted', id };
    } catch (error) {
      logger.error(`[FileModel] Lỗi delete id=${id}:`, error);
      throw error;
    }
  }

  // ══════════════════════════════════════════════
  //  MAPPER NỘI BỘ
  // ══════════════════════════════════════════════

  /**
   * Chuẩn hóa object record thành params để truyền vào câu query.
   * Các field không truyền sẽ về null hoặc giá trị mặc định tương ứng.
   * @param {object} record
   * @returns {object}
   */
  _mapParams(record) {
    return {
      file_name:             record.file_name             ?? null,
      file_path:             record.file_path             ?? null,
      mime_type:             record.mime_type             ?? null,
      file_size:             record.file_size             ?? null,
      description:           record.description           ?? null,
      is_directory:          record.is_directory          ?? 0,       // mặc định: không phải thư mục
      parent_id:             record.parent_id             ?? null,
      created_by:            record.created_by            ?? null,
      created_at:            record.created_at            ?? null,    // null → GETDATE() trong SQL
      updated_at:            record.updated_at            ?? null,    // null → GETDATE() trong SQL
      status:                record.status                ?? 1,       // mặc định: hoạt động
      version:               record.version               ?? null,
      is_signed_file:        record.is_signed_file        ?? 0,       // mặc định: chưa ký
      number_of_signed_file: record.number_of_signed_file ?? null,
      storage_path:          record.storage_path          ?? null,
      storage_type:          record.storage_type          ?? null,
      isNumbered:            record.isNumbered            ?? 0,       // mặc định: không đánh số
      typeSize:              record.typeSize              ?? null,
      id_bak:                record.id_bak                ?? null,
      table_bak:             record.table_bak             ?? null,
      type_doc:              record.type_doc              ?? null,
      isBak:                 record.isBak                 ?? 0,       // mặc định: không phải bản backup
      nguoikyvanban:         record.nguoikyvanban         ?? null,
      is_important:          record.is_important          ?? 0,       // mặc định: không quan trọng
    };
  }
}

module.exports = FileModel;