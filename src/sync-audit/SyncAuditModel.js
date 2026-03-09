// Import các module cần thiết
const BaseModel = require("../../models/BaseModel");
const logger = require("../../utils/logger");
const MigrationHelper = require("../helpers/MigrationHelper");
const sql = require("mssql");

// Định nghĩa các hằng số cho danh mục (Category) của văn bản đi
const CATEGORY_RELEASE_DV = "Phát hành văn bản ĐV";
const CATEGORY_RELEASE_TCT = "Phát hành văn bản TCT";
const CATEGORY_OUTGOING = "Văn bản đi";

// Định nghĩa các hằng số cho danh mục (Category) của văn bản đến
const CATEGORY_INCOMMING_SUBMIT = "Văn bản trình ký";
const CATEGORY_INCOMMING_TCT = "Văn bản đến TCT";
const CATEGORY_INCOMMING= "Văn bản đến";
const CATEGORY_INCOMMING_INTERNAL= "Văn bản nội bộ";

// Tạo các tập hợp (Set) để kiểm tra category hiệu quả
const INCOMING_CATEGORIES = new Set([
  CATEGORY_INCOMMING_SUBMIT,
  CATEGORY_INCOMMING_TCT,
  CATEGORY_INCOMMING,
  CATEGORY_INCOMMING_INTERNAL,
]);
const OUTGOING_CATEGORIES = new Set([
  CATEGORY_RELEASE_DV,
  CATEGORY_RELEASE_TCT,
  CATEGORY_OUTGOING,
]);


/**
 * Lớp SyncAuditModel dùng để đồng bộ hóa dữ liệu audit (lịch sử xử lý) từ
 * cơ sở dữ liệu cũ sang cơ sở dữ liệu mới.
 */
class SyncAuditModel extends BaseModel {
  /**
   * Khởi tạo đối tượng SyncAuditModel.
   * @param {string} oldDbTable - Tên bảng trong CSDL cũ chứa dữ liệu audit cần đồng bộ.
   */
  constructor(oldDbTable) {
    super();
    // Cấu hình cho CSDL cũ
    this.oldDbSchema = "dbo";
    this.oldDbTable = oldDbTable;

    // Cấu hình cho CSDL mới
    this.newDbSchema = "dbo";
    this.newDbTable = "audit"; // Bảng đích trong CSDL mới

    // Khởi tạo helper để hỗ trợ các tác vụ chuyển đổi dữ liệu
    this.helper = new MigrationHelper(this.queryNewDbTx.bind(this), this.queryOldDb.bind(this));
  }

  /**
   * Lấy tất cả các bản ghi audit từ CSDL cũ dựa trên ID của văn bản.
   * @param {string|number} oldDocumentId - ID của văn bản trong CSDL cũ.
   */
  async fetchByDocumentId(oldDocumentId) {
    return this._fetchByDocumentIdInternal(
      oldDocumentId
    );
  }

  /**
   * Lấy các bản ghi audit cho văn bản đi dựa trên ID văn bản,
   * lọc theo các danh mục (category) dành riêng cho văn bản đi.
   * @param {string|number} oldDocumentId - ID của văn bản đi trong CSDL cũ.
   */
  async fetchByOutgoingDocumentId(
    oldDocumentId
  ) {
    return this._fetchByDocumentIdInternal(
      oldDocumentId,
      [
        CATEGORY_RELEASE_DV,
        CATEGORY_RELEASE_TCT,
        CATEGORY_OUTGOING,
      ]
    );
  }

  /**
   * Lấy các bản ghi audit dựa trên ID văn bản và một danh sách các danh mục cụ thể.
   * @param {string|number} oldDocumentId - ID của văn bản trong CSDL cũ.
   * @param {string[]} categories - Mảng các danh mục cần lọc.
   */
  async fetchByDocumentIdWithCategories(
    oldDocumentId,
    categories = []
  ) {
    return this._fetchByDocumentIdInternal(
      oldDocumentId,
      categories
    );
  }

  /**
   * Phương thức nội bộ để thực hiện việc truy vấn CSDL cũ.
   * Xây dựng câu lệnh SQL động để lấy dữ liệu audit dựa trên ID văn bản
   * và có thể lọc theo danh mục.
   * @param {string|number} oldDocumentId - ID của văn bản.
   * @param {string[]|null} categories - Mảng các danh mục để lọc (nếu có).
   * @private
   */
  async _fetchByDocumentIdInternal(
    oldDocumentId,
    categories = null
  ) {
    if (!oldDocumentId) return [];

    // Chuẩn hóa ID văn bản (xóa khoảng trắng thừa)
    const normalizedDocumentId =
      String(oldDocumentId).trim();

    const params = {
      oldDocumentId: normalizedDocumentId,
    };

    let categoryFilter = "";
    // Chuẩn hóa danh sách các category
    const normalizedCategories =
      this._normalizeCategories(categories);

    // Nếu có category, thêm điều kiện lọc vào câu truy vấn
    if (normalizedCategories.length) {
      const placeholders = normalizedCategories
        .map((_, idx) => `@category${idx}`)
        .join(", ");

      categoryFilter = `
        AND LTRIM(RTRIM(ISNULL(Category, ''))) IN (${placeholders})
      `;

      // Thêm giá trị của các category vào parameters cho câu truy vấn
      normalizedCategories.forEach(
        (category, idx) => {
          params[`category${idx}`] = category;
        }
      );
    }

// Các cột có thể chứa ID văn bản trong bảng audit cũ
// LTRIM(RTRIM(ISNULL(IDVanBan, ''))) = @oldDocumentId
//           OR LTRIM(RTRIM(ISNULL(VBId, ''))) = @oldDocumentId
//           OR LTRIM(RTRIM(ISNULL(IDVanBanGoc, ''))) = @oldDocumentId
//           OR LTRIM(RTRIM(ISNULL(VBGocId, ''))) = @oldDocumentId

    const query = `
      SELECT *
      FROM ${this.oldDbSchema}.${this.oldDbTable}
      WHERE (
          LTRIM(RTRIM(ISNULL(VBId, ''))) = @oldDocumentId -- Tìm kiếm theo cột VBId
      )
      ${categoryFilter} -- Áp dụng bộ lọc category nếu có
      ORDER BY
        -- Sắp xếp ưu tiên theo ngày tạo (NgayTao), thử nhiều định dạng ngày tháng khác nhau
        COALESCE(
          TRY_CONVERT(datetime, NgayTao, 120),
          TRY_CONVERT(datetime, NgayTao, 121),
          TRY_CONVERT(datetime, NgayTao, 103),
          TRY_CONVERT(datetime, NgayTao, 105),
          TRY_CONVERT(datetime, NgayTao),
          GETDATE()
        ) ASC,
        ID ASC -- Nếu ngày giống nhau thì sắp xếp theo ID
    `;

    // Thực thi câu truy vấn trên CSDL cũ
    return this.queryOldDb(query, params);
  }

  /**
   * Lấy các bản ghi audit cho văn bản đến dựa trên ID văn bản,
   * lọc theo các danh mục (category) dành riêng cho văn bản đến.
   * @param {string|number} oldDocumentId - ID của văn bản đến trong CSDL cũ.
   */
  async fetchByInCommingDocumentId(
    oldDocumentId
  ) {
    return this._fetchByDocumentIdInternal(
      oldDocumentId,
      [
        CATEGORY_INCOMMING_TCT,
        CATEGORY_INCOMMING,
        CATEGORY_INCOMMING_INTERNAL,
        CATEGORY_INCOMMING_SUBMIT
      ]
    );
  }

  /**
   * Xử lý một bản ghi audit thô từ CSDL cũ, chuyển đổi và lưu vào CSDL mới.
   * @param {object} rawRecord - Bản ghi thô từ CSDL cũ.
   * @param {number} documentId - ID của văn bản trong CSDL mới.
   * @param {object} transaction - Đối tượng transaction của CSDL.
   */
  async processSingleRecord(rawRecord, documentId, transaction = null) {
    if (!rawRecord || !documentId) return null;

    let inserted = 0;
    let updated = 0;

    try {
      // 1. Chuyển đổi (map) dữ liệu từ bản ghi cũ sang cấu trúc mới
      const mapped = await this._mapSingleRecord(
        rawRecord,
        documentId,
        transaction
      );

      if (!mapped) {
        return null;
      }
      
      // 2. Một số bản ghi cũ có thể được mở rộng thành nhiều bản ghi audit mới
      const audits = this.helper._expandMappedRecords(mapped);

      if (!Array.isArray(audits) || audits.length === 0) {
        return null;
      }

      // 3. Lặp qua từng bản ghi audit đã được chuyển đổi
      for (const audit of audits) {
        if (!audit) continue;

        try {
          // 4. Kiểm tra xem bản ghi audit này đã tồn tại trong CSDL mới chưa
          const existed = await this._getExistingAudit(audit, transaction);

          if (existed) {
            // 5a. Nếu đã tồn tại, cập nhật lại thông tin
            await this._update(audit, existed.id, transaction);
            updated++;
          } else {
            // 5b. Nếu chưa tồn tại, thêm mới
            await this._insert(audit, transaction);
            inserted++;
          }
        } catch (auditErr) {
          logger.warn(
            `[AuditSyncModel.processSingleRecord] single audit failed table=${this.oldDbTable} ID=${rawRecord?.ID}: ${auditErr.message}`
          );
          // Không throw lỗi ở đây để các bản ghi audit khác trong cùng văn bản vẫn được xử lý
        }
      }

      return { inserted, updated };

    } catch (error) {
      logger.error(
        `[AuditSyncModel.processSingleRecord] table=${this.oldDbTable} ID=${rawRecord?.ID}`,
        error
      );
      throw error;
    }
  }

  /**
   * Kiểm tra xem một bản ghi audit đã tồn tại trong CSDL mới hay chưa.
   * @param {object} audit - Dữ liệu audit đã được map.
   * @param {object} transaction - Đối tượng transaction.
   * @returns {object|null} - Trả về bản ghi đã tồn tại hoặc null.
   * @private
   */
  async _getExistingAudit(audit, transaction) {
    if (!audit) return null;

    // Ưu tiên tìm kiếm theo ID gốc (origin_id) và tên bảng backup
    if (audit.origin_id) {
      const byOriginQuery = `
        SELECT TOP 1 id
        FROM ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable}
        WHERE origin_id = @origin_id
          AND table_backups = @table_backups
      `;

      const byOrigin = await this.queryNewDbTx(
        byOriginQuery,
        {
          origin_id: audit.origin_id,
          table_backups:
            audit.table_backups ||
            this.oldDbTable,
        },
        transaction
      );

      if (byOrigin?.[0]) {
        return byOrigin[0];
      }
    }

    // Nếu không tìm thấy bằng origin_id, thử tìm kiếm bằng tổ hợp document_id, time và user_id
    if (!audit.document_id || !audit.time) return null;

    const query = `
      SELECT TOP 1 id
      FROM ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable}
      WHERE document_id = @document_id
        AND [time] = @time
        AND (
          (@user_id IS NULL AND user_id IS NULL)
          OR user_id = @user_id
        )
    `;

    const result = await this.queryNewDbTx(
      query,
      {
        document_id: audit.document_id,
        time: audit.time,
        user_id: audit.user_id ?? null,
      },
      transaction
    );

    return result?.[0] || null;
  }

  /**
   * Chèn một bản ghi audit mới vào CSDL mới.
   * @param {object} data - Dữ liệu audit đã được map.
   * @param {object} transaction - Đối tượng transaction.
   * @private
   */
  async _insert(data, transaction) {
    // Chuẩn hóa dữ liệu mảng (người nhận, đơn vị nhận) thành chuỗi
    const receiver =
      this._normalizeArrayField(data.receiver, 100);
    const receiverUnit = this._normalizeArrayField(
      data.receiver_unit,
      100
    );

    const query = `
      INSERT INTO ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable} (
        document_id,
        [time],
        user_id,
        display_name,
        action_code,
        details,
        origin_id,
        created_by,
        receiver,
        receiver_unit,
        group_,
        roleProcess,
        [action],
        stage_status,
        created_at,
        updated_at,
        type_document,
        table_backups
      )
      VALUES (
        @document_id,
        @time,
        @user_id,
        @display_name,
        @action_code,
        @details,
        @origin_id,
        @created_by,
        @receiver,
        @receiver_unit,
        @group_,
        @roleProcess,
        @action,
        @stage_status,
        @created_at,
        GETDATE(), -- Tự động lấy ngày giờ hiện tại
        @type_document,
        @table_backups
      )
    `;
    
    // Thực thi câu lệnh INSERT
    await this.queryNewDbTx(
      query,
      {
        document_id: data.document_id,
        time: data.time,
        user_id: data.user_id ?? null,
        display_name: data.display_name ?? null,
        action_code: data.action_code ?? null,
        details: data.details ?? null,
        origin_id: data.origin_id ?? null,
        created_by: data.created_by ?? null,
        receiver,
        receiver_unit: receiverUnit,
        group_: this._normalizeTextField(
          data.group_,
          100
        ),
        roleProcess: data.roleProcess ?? null,
        action: this._normalizeTextField(
          data.action,
          255
        ),
        stage_status: data.stage_status ?? null,
        created_at: data.time ?? new Date(),
        type_document: data.type_document, // Logic đã được xử lý ở _mapSingleRecord
        table_backups:
          data.table_backups ||
          this.oldDbTable,
      },
      transaction
    );
  }

  /**
   * Cập nhật một bản ghi audit đã tồn tại trong CSDL mới.
   * @param {object} data - Dữ liệu audit mới.
   * @param {number} existingId - ID của bản ghi audit cần cập nhật.
   * @param {object} transaction - Đối tượng transaction.
   * @private
   */
  async _update(data, existingId, transaction) {
    if (!existingId) return;

    const receiver =
      this._normalizeArrayField(data.receiver, 100);
    const receiverUnit = this._normalizeArrayField(
      data.receiver_unit,
      100
    );

    const query = `
      UPDATE ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable}
      SET
        display_name = @display_name,
        action_code = @action_code,
        details = @details,
        created_by = @created_by,
        receiver = @receiver,
        receiver_unit = @receiver_unit,
        group_ = @group_,
        roleProcess = @roleProcess,
        [action] = @action,
        stage_status = @stage_status,
        type_document = @type_document,
        updated_at = GETDATE() -- Cập nhật thời gian update
      WHERE id = @id
    `;
    
    // Thực thi câu lệnh UPDATE
    await this.queryNewDbTx(
      query,
      {
        id: existingId,
        display_name: data.display_name ?? null,
        action_code: data.action_code ?? null,
        details: data.details ?? null,
        created_by: data.created_by ?? null,
        receiver,
        receiver_unit: receiverUnit,
        group_: this._normalizeTextField(
          data.group_,
          100
        ),
        roleProcess: data.roleProcess ?? null,
        action: this._normalizeTextField(
          data.action,
          255
        ),
        stage_status: data.stage_status ?? null,
        type_document: data.type_document, // Logic đã được xử lý ở _mapSingleRecord
      },
      transaction
    );
  }

  /**
   * Chuyển đổi (map) một bản ghi thô từ CSDL cũ sang cấu trúc dữ liệu của CSDL mới.
   * Đây là nơi diễn ra logic chuyển đổi chính.
   * @param {object} record - Bản ghi thô từ CSDL cũ.
   * @param {number} documentId - ID của văn bản trong CSDL mới.
   * @param {object} transaction - Đối tượng transaction.
   * @returns {object|null} - Đối tượng dữ liệu đã được map hoặc null.
   * @private
   */
  async _mapSingleRecord(record, documentId, transaction) {
    if (!record?.ID || !documentId)
      return null;
    
    // Chuyển đổi chuỗi ngày tháng từ CSDL cũ sang đối tượng Date
    const parsedTime =
      this.helper.parseDate(record.NgayTao);
    const time =
      parsedTime || new Date();

    // Map tên người dùng từ CSDL cũ sang user_id trong CSDL mới
    const user_id =
      await this.helper.mapUserName(
        record.NguoiXuLy,
        transaction
      );
    
    // Trích xuất tên hiển thị từ chuỗi người xử lý
    const displayName =
      this.helper.extractDisplayName(
        record.NguoiXuLy
      );

    // Phân tích chuỗi hành động (HanhDong) để lấy thông tin chi tiết (mã hành động, người nhận, ...)
    const actionParsed =
      this.helper.parseActionString(
        user_id,
        record.HanhDong
      ) || {};
    
    // Map danh sách người nhận sang ID người dùng mới
    const receiver =
      await this._mapReceiverUsers(
        actionParsed.receiver,
        transaction
      );
    // Map danh sách đơn vị nhận sang ID đơn vị mới
    const receiverUnit =
      await this._mapReceiverUnits(
        actionParsed.receiver_unit,
        transaction
      );
    
    // Chuẩn hóa chuỗi hành động thô và tạo đối tượng JSON cho cột 'details'
    const rawAction = this._normalizeTextField(record.HanhDong);
    const actionStr = JSON.stringify({
      note: rawAction,
      isTransferOption: true
    });

    // --- LOGIC MỚI ĐỂ XÁC ĐỊNH type_document DỰA TRÊN Category ---
    let type_document;
    const category = this._normalizeTextField(record.Category);

    if (INCOMING_CATEGORIES.has(category)) {
      type_document = 'IncomingDocument';
    } else if (OUTGOING_CATEGORIES.has(category)) {
      type_document = 'OutgoingDocument';
    } else {
      // Logic dự phòng nếu category không khớp: sử dụng kết quả phân tích hành động hoặc mặc định
      type_document = actionParsed.type_document ?? "OutgoingDocument";
    }
    // --- KẾT THÚC LOGIC MỚI ---

    // Trả về đối tượng đã được map theo cấu trúc của bảng 'audit' mới
    return {
      document_id: documentId,
      time,
      action_code: actionParsed.action_code ?? null,
      details: actionStr ?? null,
      origin_id: this._normalizeTextField(
        record.ID,
        100
      ),
      created_by: user_id ?? null,
      receiver,
      receiver_unit: receiverUnit,
      group_: this._normalizeTextField(
        record.Category,
        100
      ),
      display_name: displayName ?? null,
      user_id: user_id ?? null,
      roleProcess:
        actionParsed.roleProcess ?? null,
      action: actionParsed.action || this._normalizeTextField(
        rawAction,
        255
      ),
      stage_status:
        actionParsed.stage_status ?? null,
      type_document: type_document, // Sử dụng biến đã được quyết định ở trên
      table_backups: this.oldDbTable,
    };
  }

  /**
   * Map một mảng tên người dùng (receiver) sang một mảng các ID người dùng trong CSDL mới.
   * @param {string[]} receiverValues - Mảng tên người dùng.
   * @param {object} transaction - Đối tượng transaction.
   * @returns {string[]} - Mảng các user ID.
   * @private
   */
  async _mapReceiverUsers(receiverValues, transaction) {
    if (!Array.isArray(receiverValues))
      return [];

    // Lọc ra các giá trị rỗng và trùng lặp
    const normalized = [
      ...new Set(
        receiverValues
          .map((value) =>
            this._normalizeTextField(value)
          )
          .filter(Boolean)
      ),
    ];

    const mapped = [];

    // Lặp qua từng tên người dùng để map sang ID
    for (const userName of normalized) {
      const userId =
        await this.helper.mapUserName(
          userName,
          transaction
        );

      if (userId) {
        mapped.push(String(userId));
      }
    }

    return mapped;
  }

  /**
   * Map một mảng tên đơn vị (receiver unit) sang một mảng các ID đơn vị trong CSDL mới.
   * @param {string[]} receiverUnitValues - Mảng tên đơn vị.
   * @param {object} transaction - Đối tượng transaction.
   * @returns {string[]} - Mảng các unit ID.
   * @private
   */
  async _mapReceiverUnits(receiverUnitValues, transaction) {
    if (!Array.isArray(receiverUnitValues))
      return [];
    
    // Lọc ra các giá trị rỗng và trùng lặp
    const normalized = [
      ...new Set(
        receiverUnitValues
          .map((value) =>
            this._normalizeTextField(value)
          )
          .filter(Boolean)
      ),
    ];

    const mapped = [];

    // Lặp qua từng tên đơn vị để map sang ID
    for (const unitName of normalized) {
      const unitId =
        await this.helper.mapSenderUnitId(
          unitName,
          transaction
        );

      if (unitId) {
        mapped.push(String(unitId));
      }
    }

    return mapped;
  }

  /**
   * Chuẩn hóa giá trị của một trường dạng mảng.
   * Chuyển mảng thành chuỗi phân cách bằng dấu phẩy và giới hạn độ dài.
   * @param {string[]|string} value - Giá trị cần chuẩn hóa.
   * @param {number|null} maxLength - Độ dài tối đa.
   * @returns {string|null} - Chuỗi đã được chuẩn hóa.
   * @private
   */
  _normalizeArrayField(value, maxLength = null) {
    if (!value) return null;

    let normalized = null;

    if (Array.isArray(value)) {
      normalized = value.length
        ? value.join(",")
        : null;
    } else {
      normalized =
        String(value).trim() || null;
    }

    if (
      normalized &&
      maxLength &&
      normalized.length > maxLength
    ) {
      return normalized.substring(0, maxLength);
    }

    return normalized;
  }

  /**
   * Chuẩn hóa giá trị của một trường dạng text.
   * Xóa khoảng trắng, xử lý giá trị 'NULL', và giới hạn độ dài.
   * @param {*} value - Giá trị cần chuẩn hóa.
   * @param {number|null} maxLength - Độ dài tối đa.
   * @returns {string|null} - Chuỗi đã được chuẩn hóa.
   * @private
   */
  _normalizeTextField(value, maxLength = null) {
    if (value === null || value === undefined)
      return null;

    let normalized = String(value).trim();
    if (!normalized) return null;

    // Coi chuỗi "NULL" là giá trị null thực sự
    if (normalized.toUpperCase() === "NULL") {
      return null;
    }

    // Cắt chuỗi nếu vượt quá độ dài tối đa
    if (
      maxLength &&
      normalized.length > maxLength
    ) {
      normalized = normalized.substring(
        0,
        maxLength
      );
    }

    return normalized;
  }

  /**
   * Chuẩn hóa một mảng các category.
   * Xóa các giá trị rỗng và trùng lặp.
   * @param {string[]} categories - Mảng các category.
   * @returns {string[]} - Mảng đã được chuẩn hóa.
   * @private
   */
  _normalizeCategories(categories) {
    if (!Array.isArray(categories)) {
      return [];
    }

    return [
      ...new Set(
        categories
          .map((category) =>
            this._normalizeTextField(category)
          )
          .filter(Boolean)
      ),
    ];
  }
}

module.exports = SyncAuditModel;
