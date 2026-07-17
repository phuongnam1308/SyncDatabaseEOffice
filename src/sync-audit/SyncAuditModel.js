// Import các module cần thiết
const BaseModel = require("../../models/BaseModel");
const logger = require("../../utils/logger");
const MigrationHelper = require("../helpers/MigrationHelper");
const ReceiverParserService = require("./ReceiverParserService");
const { getStatusCodeByAction } = require('../config/action-mapping');
const sql = require("mssql");
const { isRetryableSqlError } = require("../../utils/dbUtils");

// Định nghĩa các hằng số cho danh mục (Category) của văn bản đi
const CATEGORY_RELEASE_DV = "Phát hành văn bản ĐV";
const CATEGORY_RELEASE_TCT = "Phát hành văn bản TCT";
const CATEGORY_OUTGOING = "Văn bản đi";

// Định nghĩa các hằng số cho danh mục (Category) của văn bản đến
const CATEGORY_INCOMING_SUBMIT = "Văn bản trình ký";
const CATEGORY_INCOMING_TCT = "Văn bản đến TCT";
const CATEGORY_INCOMING = "Văn bản đến";
const CATEGORY_INCOMING_INTERNAL = "Văn bản nội bộ";

// Tạo các tập hợp (Set) để kiểm tra category hiệu quả
const INCOMING_CATEGORIES = new Set([
  CATEGORY_INCOMING_SUBMIT,
  CATEGORY_INCOMING_TCT,
  CATEGORY_INCOMING,
  CATEGORY_INCOMING_INTERNAL,
]);
const OUTGOING_CATEGORIES = new Set([
  CATEGORY_RELEASE_DV,
  CATEGORY_RELEASE_TCT,
  CATEGORY_OUTGOING,
]);


// Import cấu hình quy trình từ file JSON
const config = require("../config");
class SyncAuditModel extends BaseModel {
  // Static flag to ensure schema initialization runs only once across all instances
  static _schemaInitPromise = null;

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

    // Khởi tạo ReceiverParser để bóc tách receiver theo quy tắc nghiệp vụ
    // Truyền thêm helper để dùng mapUserName tra cứu ID chính xác
    this.receiverParser = new ReceiverParserService(
      this.queryNewDbTx.bind(this),
      this.queryOldDb.bind(this),
      this.helper
    );
  }

  /**
   * Khởi tạo kết nối và các cấu trúc dữ liệu nếu cần.
   * Sử dụng static promise để đảm bảo check bảng/cột chỉ chạy 1 lần duy nhất
   * (tránh overhead khi call 47 lần mỗi vòng lặp).
   */
  async initialize() {
    if (typeof super.initialize === 'function') {
      await super.initialize();
    }

    // Nếu đã/đang init rồi thì trả về promise đó luôn
    if (SyncAuditModel._schemaInitPromise) {
      return SyncAuditModel._schemaInitPromise;
    }

    // Khởi tạo block check schema duy nhất
    SyncAuditModel._schemaInitPromise = (async () => {
      // Yêu cầu của người dùng: tắt auto schema creation (tránh lỗi permission denied)
      logger.info('[SyncAuditModel] Skipping global schema initialization (disabled as per user request).');
      return;
      try {
        const dbName = process.env.NEW_DB_NAME;
        const schema = this.newDbSchema;

        // Danh sách các bảng và cột cần check robustly
        const schemaCheckList = [
          {
            table: 'audit',
            cols: [
              { name: 'table_backups', type: 'NVARCHAR(255)' },
              { name: 'type_document', type: 'VARCHAR(100)' },
              { name: 'processed_by', type: 'VARCHAR(100)' },
              { name: 'acting_as', type: 'VARCHAR(100)' },
              { name: 'status_code', type: 'VARCHAR(50)' },
              { name: 'bpmn_version', type: 'VARCHAR(100)' },
              { name: 'type_of_process', type: 'VARCHAR(100)' },
              { name: 'curStatusCode', type: 'INT' },
              { name: 'role', type: 'VARCHAR(100)' }
            ]
          },
          {
            table: 'incomming_assignment',
            cols: [
              { name: 'table_backups', type: 'NVARCHAR(255)' },
              { name: 'last_audit_id', type: 'INT' }
            ]
          },
          {
            table: 'incomming_current_state',
            cols: [
              { name: 'table_backups', type: 'NVARCHAR(255)' },
              { name: 'is_completed_doc', type: 'BIT' },
              { name: 'has_open_workitem', type: 'BIT' },
              { name: 'is_transfer_to_room', type: 'BIT' },
              { name: 'last_audit_id', type: 'INT' },
              { name: 'last_audit_time', type: 'DATETIME2' }
            ]
          },
          {
            table: 'outgoing_assignment',
            cols: [
              { name: 'table_backups', type: 'NVARCHAR(255)' },
              { name: 'receiver_unit', type: 'NVARCHAR(100)' },
              { name: 'is_creator', type: 'BIT' },
              { name: 'last_audit_id', type: 'INT' }
            ]
          },
          {
            table: 'outgoing_current_state',
            cols: [
              { name: 'table_backups', type: 'NVARCHAR(255)' },
              { name: 'has_ban_hanh', type: 'BIT' },
              { name: 'has_da_xu_ly', type: 'BIT' },
              { name: 'has_ht_vbtt', type: 'BIT' },
              { name: 'is_completed_doc', type: 'BIT' },
              { name: 'last_da_xu_ly_audit_id', type: 'INT' },
              { name: 'has_tra_lai_after_da_xu_ly', type: 'BIT' },
              { name: 'has_open_workitem', type: 'BIT' },
              { name: 'is_transfer_to_room', type: 'BIT' },
              { name: 'last_audit_id', type: 'INT' },
              { name: 'last_audit_time', type: 'DATETIME2' }
            ]
          }
        ];

        let sqlScript = '';
        for (const target of schemaCheckList) {
          const fullTableName = `${dbName}.${schema}.${target.table}`;
          for (const col of target.cols) {
            sqlScript += `
              IF NOT EXISTS (
                SELECT 1 FROM ${dbName}.INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = '${target.table}' AND COLUMN_NAME = '${col.name}'
              )
              BEGIN
                ALTER TABLE ${fullTableName} ADD [${col.name}] ${col.type} NULL;
              END
            `;
          }
        }

        if (sqlScript) {
          await this.queryNewDb(sqlScript);
          // logger.info('[SyncAuditModel] Global audit schema check/migration completed once (optimized).');
        }

        // Bổ sung: Tự động tạo non-clustered index trên cột [document_id] nếu chưa có
        // để loại bỏ table scans khi thực hiện DELETE/UPDATE theo document_id dưới tải cao (tránh deadlocks)
        const indexTables = [
          'audit',
          'incomming_assignment',
          'incomming_current_state',
          'outgoing_assignment',
          'outgoing_current_state'
        ];
        
        let indexScript = '';
        for (const tbl of indexTables) {
          const idxName = `IX_${tbl}_document_id`;
          indexScript += `
            IF EXISTS (
              SELECT 1 FROM sys.objects 
              WHERE object_id = OBJECT_ID('${dbName}.${schema}.${tbl}') AND type = 'U'
            )
            AND NOT EXISTS (
              SELECT 1 FROM sys.indexes 
              WHERE name = '${idxName}' AND object_id = OBJECT_ID('${dbName}.${schema}.${tbl}')
            )
            BEGIN
              EXEC('CREATE NONCLUSTERED INDEX [${idxName}] ON ${dbName}.${schema}.${tbl} (document_id)');
            END
          `;
        }
        
        if (indexScript) {
          await this.queryNewDb(indexScript);
        }

      } catch (err) {
        logger.error('[SyncAuditModel] Global schema initialization failed:', err.message);
        // Reset promise so it can retry later if needed
        SyncAuditModel._schemaInitPromise = null;
        throw err;
      }
    })();

    return SyncAuditModel._schemaInitPromise;
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
        AND Category IN (${placeholders})
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
          VBId = @oldDocumentId -- Tìm kiếm theo cột VBId
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
   * Lấy tất cả các bản ghi audit từ nhiều bảng khác nhau cho một văn bản.
   * Kết quả được gộp lại và sắp xếp theo thời gian (NgayTao).
   * @param {string|number} oldDocumentId - ID của văn bản trong CSDL cũ.
   * @param {string[]} tableNames - Danh sách các bảng audit cần truy vấn.
   * @param {string[]} categories - Mảng các danh mục để lọc (nếu có).
   * @param {{minDate?: string|Date}} options - Tuỳ chọn tối ưu truy vấn.
   */
  async fetchAllAuditsAcrossTables(
    oldDocumentId,
    tableNames = [],
    categories = null,
    options = {}
  ) {
    if (!oldDocumentId || !Array.isArray(tableNames) || tableNames.length === 0) {
      return [];
    }

    const normalizedDocumentId = String(oldDocumentId).trim();
    const safeTableNames = this._sanitizeTableNames(tableNames);
    const normalizedCategories = this._normalizeCategories(categories);

    if (!safeTableNames.length) {
      return [];
    }

    try {
      return await this._fetchAllAuditsAcrossTablesUnion(
        normalizedDocumentId,
        safeTableNames,
        normalizedCategories,
        options
      );
    } catch (unionErr) {
      logger.warn(
        `[SyncAuditModel.fetchAllAuditsAcrossTables] UNION optimization failed, fallback to parallel queries. reason=${unionErr.message}`
      );
      return this._fetchAllAuditsAcrossTablesLegacy(
        normalizedDocumentId,
        safeTableNames,
        normalizedCategories,
        options
      );
    }
  }

  /**
   * Optimized path: single UNION ALL query for all audit tables.
   * @private
   */
  async _fetchAllAuditsAcrossTablesUnion(
    normalizedDocumentId,
    safeTableNames,
    normalizedCategories,
    options = {}
  ) {
    const params = { oldDocumentId: normalizedDocumentId };
    const categoryFilter = this._buildCategoryFilterClause(normalizedCategories, params, "src");
    const minDateFilter = this._buildMinDateFilterClause(options, params, "src");
    const sortTimeExpr = this._getAuditSortTimeExpr("src");

    const unionParts = safeTableNames.map((tableName) => `
      SELECT
        src.*,
        N'${tableName}' AS __source_table,
        ${sortTimeExpr} AS __sync_sort_time,
        TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), src.ID))), '')) AS __sync_sort_id
      FROM ${this.oldDbSchema}.[${tableName}] src
      WHERE src.VBId = @oldDocumentId
      ${categoryFilter}
      ${minDateFilter}
    `);

    const query = `
      SELECT *
      FROM (
        ${unionParts.join("\nUNION ALL\n")}
      ) AS audits
      ORDER BY
        audits.__sync_sort_time ASC,
        ISNULL(audits.__sync_sort_id, 0) ASC,
        TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), audits.ID))), '')) ASC
    `;

    const rows = await this.queryOldDb(query, params);
    if (!Array.isArray(rows) || rows.length === 0) {
      return [];
    }

    // Xóa cột kỹ thuật dùng cho ORDER BY trước khi trả về.
    for (const row of rows) {
      if (row && typeof row === "object") {
        delete row.__sync_sort_time;
        delete row.__sync_sort_id;
      }
    }

    return rows;
  }

  /**
   * Backward-compatible path: parallel query per table.
   * @private
   */
  async _fetchAllAuditsAcrossTablesLegacy(
    normalizedDocumentId,
    safeTableNames,
    normalizedCategories,
    options = {}
  ) {
    const allRecords = [];

    const fetchPromises = safeTableNames.map(async (tableName) => {
      try {
        const params = { oldDocumentId: normalizedDocumentId };
        const categoryFilter = this._buildCategoryFilterClause(normalizedCategories, params);
        const minDateFilter = this._buildMinDateFilterClause(options, params);
        const query = `
          SELECT *, N'${tableName}' as __source_table
          FROM ${this.oldDbSchema}.[${tableName}]
          WHERE VBId = @oldDocumentId
          ${categoryFilter}
          ${minDateFilter}
        `;

        return await this.queryOldDb(query, params);
      } catch (err) {
        logger.warn(`[SyncAuditModel.fetchAllAuditsAcrossTables] Failed to fetch from ${tableName}: ${err.message}`);
        return [];
      }
    });

    const results = await Promise.all(fetchPromises);
    for (const batch of results) {
      if (Array.isArray(batch)) {
        allRecords.push(...batch);
      }
    }

    allRecords.sort((a, b) => {
      const timeA = this.helper.parseDate(a.NgayTao) || new Date(0);
      const timeB = this.helper.parseDate(b.NgayTao) || new Date(0);
      if (timeA.getTime() !== timeB.getTime()) {
        return timeA.getTime() - timeB.getTime();
      }
      return (Number(a.ID) || 0) - (Number(b.ID) || 0);
    });

    return allRecords;
  }

  /**
   * SQL expression chuẩn hoá thời gian audit để sort/filter.
   * @private
   */
  _getAuditSortTimeExpr(alias = "") {
    const p = alias ? `${alias}.` : "";
    return `
      COALESCE(
        TRY_CONVERT(datetime2, ${p}NgayTao, 120),
        TRY_CONVERT(datetime2, ${p}NgayTao, 121),
        TRY_CONVERT(datetime2, ${p}NgayTao, 103),
        TRY_CONVERT(datetime2, ${p}NgayTao, 105),
        TRY_CONVERT(datetime2, ${p}NgayTao),
        CONVERT(datetime2, '1900-01-01T00:00:00')
      )
    `;
  }

  /**
   * Build clause lọc Category với params an toàn.
   * @private
   */
  _buildCategoryFilterClause(normalizedCategories, params, alias = "") {
    if (!Array.isArray(normalizedCategories) || normalizedCategories.length === 0) {
      return "";
    }

    const placeholders = normalizedCategories
      .map((_, idx) => `@category${idx}`)
      .join(", ");
    normalizedCategories.forEach((category, idx) => {
      params[`category${idx}`] = category;
    });

    const p = alias ? `${alias}.` : "";
    return `AND ${p}Category IN (${placeholders})`;
  }

  /**
   * Build clause lọc tối thiểu theo thời gian audit (opt-in qua options.minDate).
   * @private
   */
  _buildMinDateFilterClause(options, params, alias = "") {
    const minDateRaw = options && options.minDate ? this._normalizeTextField(options.minDate) : null;
    if (!minDateRaw) {
      return "";
    }

    const minDate = new Date(minDateRaw);
    if (Number.isNaN(minDate.getTime())) {
      logger.warn(`[SyncAuditModel] Invalid minDate=${minDateRaw}. Ignore minDate filter.`);
      return "";
    }

    params.auditMinDate = minDate;
    const sortTimeExpr = this._getAuditSortTimeExpr(alias);
    return `AND ${sortTimeExpr} >= @auditMinDate`;
  }

  /**
   * Chỉ giữ tên bảng hợp lệ để tránh SQL injection trong dynamic UNION.
   * @private
   */
  _sanitizeTableNames(tableNames = []) {
    const safe = [];
    const seen = new Set();

    for (const tableNameRaw of tableNames) {
      const tableName = String(tableNameRaw || "").trim();
      if (!tableName) continue;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
        logger.warn(`[SyncAuditModel] Skip invalid table name: ${tableName}`);
        continue;
      }

      const key = tableName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      safe.push(tableName);
    }

    return safe;
  }

  /**
   * Lấy các bản ghi audit cho văn bản đến dựa trên ID văn bản,
   * lọc theo các danh mục (category) dành riêng cho văn bản đến.
   * @param {string|number} oldDocumentId - ID của văn bản đến trong CSDL cũ.
   */
  async fetchByIncomingDocumentId(
    oldDocumentId
  ) {
    return this._fetchByDocumentIdInternal(
      oldDocumentId,
      [
        CATEGORY_INCOMING_TCT,
        CATEGORY_INCOMING,
        CATEGORY_INCOMING_INTERNAL,
        CATEGORY_INCOMING_SUBMIT
      ]
    );
  }

  /**
   * Xử lý một bản ghi audit thô từ CSDL cũ, chuyển đổi và lưu vào CSDL mới.
   * @param {object} rawRecord - Bản ghi thô từ CSDL cũ.
   * @param {number} documentId - ID của văn bản trong CSDL mới.
   * @param {object} transaction - Đối tượng transaction của CSDL.
   */
  async processSingleRecord(rawRecord, documentId, transaction = null, drafter = null, typeDocument = 'OutgoingDocument') {
    if (!rawRecord || !documentId) return null;

    let inserted = 0;
    let updated = 0;
    const results = [];

    try {
      // 1. Chuyển đổi (map) dữ liệu từ bản ghi cũ sang cấu trúc mới
      const mapped = await this._mapSingleRecord(
        rawRecord,
        documentId,
        transaction,
        drafter,
        typeDocument
      );

      if (!mapped) {
        return null;
      }

      // 2. Một số bản ghi cũ có thể được mở rộng thành nhiều bản ghi audit mới
      const audits = this.helper._expandMappedRecords(mapped);

      if (!Array.isArray(audits) || audits.length === 0) {
        return null;
      }

      // ── ĐẢM BẢO THỨ TỰ DETERMINISTIC ──
      // Sắp xếp theo receiver và receiver_unit để đảm bảo thứ tự luôn giống nhau
      audits.sort((a, b) => {
        const keyA = String(a.receiver || "") + String(a.receiver_unit || "");
        const keyB = String(b.receiver || "") + String(b.receiver_unit || "");
        return keyA.localeCompare(keyB);
      });

      // ── TỐI ƯU HÓA TÌM KIẾM THEO BATCH ──
      // Lấy toàn bộ audit đã có của document_id này trong 1 query duy nhất
      // để tránh N+1 query problem khi lặp qua _getExistingAudit.
      const existingAuditsRows = await this.queryNewDbTx(
        `SELECT id, [time], receiver, receiver_unit
         FROM ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable} WITH (NOLOCK)
         WHERE document_id = @document_id`,
        { document_id: documentId },
        transaction
      );
      
      const existingAuditsList = Array.isArray(existingAuditsRows) ? existingAuditsRows : [];
      
      // Phân loại bản ghi thành nhóm cần INSERT và nhóm cần UPDATE
      const toInsert = [];
      const toUpdate = [];

      for (const audit of audits) {
        if (!audit) continue;

        let matchedId = null;
        if (audit.document_id && audit.time) {
            const timeA = new Date(audit.time).getTime();
            
            // Priority 1: Tìm theo receiver
            if (audit.receiver !== undefined) {
                const match = existingAuditsList.find(r => {
                    const rTime = new Date(r.time).getTime();
                    return rTime === timeA && ((audit.receiver === null && r.receiver === null) || r.receiver === audit.receiver);
                });
                if (match) matchedId = match.id;
            }
            
            // Priority 2: Tìm theo receiver_unit (fallback)
            if (!matchedId && audit.receiver_unit !== undefined) {
                const match = existingAuditsList.find(r => {
                    const rTime = new Date(r.time).getTime();
                    return rTime === timeA && ((audit.receiver_unit === null && r.receiver_unit === null) || r.receiver_unit === audit.receiver_unit);
                });
                if (match) matchedId = match.id;
            }
        }

        if (matchedId) {
            toUpdate.push({ audit, id: matchedId });
        } else {
            toInsert.push(audit);
        }
      }

      // 3. Xử lý Update hàng loạt
      if (toUpdate.length > 0) {
        try {
            const updateResults = await this._updateMany(toUpdate, transaction);
            updated += updateResults.length;
            results.push(...updateResults);
        } catch (auditErr) {
            if (isRetryableSqlError(auditErr)) throw auditErr;
            logger.warn(`[AuditSyncModel] UPDATE MANY failed table=${this.oldDbTable} ID=${rawRecord?.ID}: ${auditErr.message}`);
        }
      }

      // 4. Xử lý Insert hàng loạt
      if (toInsert.length > 0) {
        try {
            const insertResults = await this._insertMany(toInsert, transaction);
            inserted += insertResults.length;
            results.push(...insertResults);
        } catch (auditErr) {
            if (isRetryableSqlError(auditErr)) throw auditErr;
            logger.warn(`[AuditSyncModel] INSERT MANY failed table=${this.oldDbTable} ID=${rawRecord?.ID}: ${auditErr.message}`);
        }
      }

      return { inserted, updated, results };

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
    if (!audit.document_id || !audit.time) return null;

    const baseCondition = `
      document_id = @document_id
      AND [time] = @time
    `;

    const baseParams = {
      document_id: audit.document_id,
      time: audit.time,
    };

    // Priority 1: Tìm theo receiver
    if (audit.receiver !== undefined) {
      const result = await this.queryNewDbTx(
        `SELECT TOP 1 id
        FROM ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable}
        WHERE ${baseCondition}
          AND ((@receiver IS NULL AND receiver IS NULL) OR receiver = @receiver)
        ORDER BY id ASC`,
        { ...baseParams, receiver: audit.receiver ?? null },
        transaction
      );
      if (result?.[0]) return result[0];
    }

    // Priority 2: Fallback theo receiver_unit
    if (audit.receiver_unit !== undefined) {
      const result = await this.queryNewDbTx(
        `SELECT TOP 1 id
        FROM ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable}
        WHERE ${baseCondition}
          AND ((@receiver_unit IS NULL AND receiver_unit IS NULL) OR receiver_unit = @receiver_unit)
        ORDER BY id ASC`,
        { ...baseParams, receiver_unit: audit.receiver_unit ?? null },
        transaction
      );
      if (result?.[0]) return result[0];
    }

    return null; // ← fix: không có result nào ở đây, trả null thẳng
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
      INSERT INTO ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable}  WITH (ROWLOCK)  (
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
        table_backups,
        status_code,
        bpmn_version,
        type_of_process,
        curStatusCode,
        [role]
      )
      OUTPUT INSERTED.id
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
        @updated_at, -- Sử dụng thời điểm sự kiện thay vì GETDATE()
        @type_document,
        @table_backups,
        @status_code,
        @bpmn_version,
        @type_of_process,
        @curStatusCode,
        @role
      )
    `;

    // Thực thi câu lệnh INSERT
    const result = await this.queryNewDbTx(
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
        updated_at: data.time ?? new Date(),
        type_document: data.type_document, // Logic đã được xử lý ở _mapSingleRecord
        table_backups:
          data.table_backups ||
          this.oldDbTable,
        status_code: data.status_code ?? null,
        bpmn_version: data.bpmn_version ?? null,
        type_of_process: data.type_of_process ?? null,
        curStatusCode: data.curStatusCode ?? null,
        role: data.role ?? null,
      },
      transaction
    );

    const auditId = result?.[0]?.id || null;
    if (auditId) {
      logger.info(`[SyncAuditModel] Inserted audit row successfully: doc=${data.document_id} originId=${data.origin_id} table=${this.oldDbTable}`);
    }

    return auditId;
  }

  /**
   * Cập nhật một bản ghi audit đã tồn tại trong CSDL mới.
   * @param {object} data - Dữ liệu audit mới.
   * @param {number} existingId - ID của bản ghi audit cần cập nhật.
   * @param {object} transaction - Đối tượng transaction.
   * @private
   */
  async _update(data, existingId, transaction) {
    if (!existingId) return null;

    const receiver =
      this._normalizeArrayField(data.receiver, 100);
    const receiverUnit = this._normalizeArrayField(
      data.receiver_unit,
      100
    );

    const query = `
      UPDATE ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable}  WITH (ROWLOCK) 
      SET
        document_id = @document_id,
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
        status_code = @status_code,
        bpmn_version = @bpmn_version,
        type_of_process = @type_of_process,
        curStatusCode = @curStatusCode,
        [role] = @role,
        type_document = @type_document,
        updated_at = GETDATE() -- Cập nhật thời gian update
      WHERE id = @id
    `;

    // Thực thi câu lệnh UPDATE
    await this.queryNewDbTx(
      query,
      {
        id: existingId,
        document_id: data.document_id,
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
        status_code: data.status_code ?? null,
        bpmn_version: data.bpmn_version ?? null,
        type_of_process: data.type_of_process ?? null,
        curStatusCode: data.curStatusCode ?? null,
        role: data.role ?? null,
        type_document: data.type_document, // Logic đã được xử lý ở _mapSingleRecord
      },
      transaction
    );

    // logger.info(`[SyncAuditModel] Updated audit row successfully: doc=${data.document_id} originId=${data.origin_id} table=${this.oldDbTable}`);

    return existingId;
  }

  /**
   * Chèn hàng loạt bản ghi audit mới vào CSDL mới (Bulk Insert).
   * @param {Array} items - Mảng dữ liệu audit cần chèn.
   * @param {object} transaction - Đối tượng transaction.
   * @private
   */
  async _insertMany(items, transaction) {
    if (!items || items.length === 0) return [];
    
    // Giới hạn chunk size để tránh lỗi quá 2100 parameters của SQL Server (23 params/record -> tối đa ~90 record/chunk)
    const chunkSize = 80;
    const results = [];
    
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      
      let query = `INSERT INTO ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable} WITH (ROWLOCK) (
        document_id, [time], user_id, display_name, action_code, details, origin_id, created_by, receiver, receiver_unit, group_, roleProcess, [action], stage_status, created_at, updated_at, type_document, table_backups, status_code, bpmn_version, type_of_process, curStatusCode, [role]
      ) OUTPUT INSERTED.id VALUES `;
      
      const params = {};
      const valuesClauses = [];
      
      chunk.forEach((data, index) => {
        const receiver = this._normalizeArrayField(data.receiver, 100);
        const receiverUnit = this._normalizeArrayField(data.receiver_unit, 100);
        
        valuesClauses.push(`(
          @document_id_${index}, @time_${index}, @user_id_${index}, @display_name_${index}, @action_code_${index}, @details_${index}, @origin_id_${index}, @created_by_${index}, @receiver_${index}, @receiver_unit_${index}, @group__${index}, @roleProcess_${index}, @action_${index}, @stage_status_${index}, @created_at_${index}, @updated_at_${index}, @type_document_${index}, @table_backups_${index}, @status_code_${index}, @bpmn_version_${index}, @type_of_process_${index}, @curStatusCode_${index}, @role_${index}
        )`);
        
        params[`document_id_${index}`] = data.document_id;
        params[`time_${index}`] = data.time;
        params[`user_id_${index}`] = data.user_id ?? null;
        params[`display_name_${index}`] = data.display_name ?? null;
        params[`action_code_${index}`] = data.action_code ?? null;
        params[`details_${index}`] = data.details ?? null;
        params[`origin_id_${index}`] = data.origin_id ?? null;
        params[`created_by_${index}`] = data.created_by ?? null;
        params[`receiver_${index}`] = receiver;
        params[`receiver_unit_${index}`] = receiverUnit;
        params[`group__${index}`] = this._normalizeTextField(data.group_, 100);
        params[`roleProcess_${index}`] = data.roleProcess ?? null;
        params[`action_${index}`] = this._normalizeTextField(data.action, 255);
        params[`stage_status_${index}`] = data.stage_status ?? null;
        params[`created_at_${index}`] = data.time ?? new Date();
        params[`updated_at_${index}`] = data.time ?? new Date();
        params[`type_document_${index}`] = data.type_document;
        params[`table_backups_${index}`] = data.table_backups || this.oldDbTable;
        params[`status_code_${index}`] = data.status_code ?? null;
        params[`bpmn_version_${index}`] = data.bpmn_version ?? null;
        params[`type_of_process_${index}`] = data.type_of_process ?? null;
        params[`curStatusCode_${index}`] = data.curStatusCode ?? null;
        params[`role_${index}`] = data.role ?? null;
      });
      
      query += valuesClauses.join(', ');
      
      const rows = await this.queryNewDbTx(query, params, transaction);
      
      // Map generated IDs back to the original audits.
      // SQL Server OUTPUT typically returns in the same order as VALUES.
      // Normalize receiver/receiver_unit về string giống DB để downstream (assignment sync) dùng đúng.
      if (Array.isArray(rows) && rows.length === chunk.length) {
        chunk.forEach((data, index) => {
          results.push({
            audit: {
              ...data,
              receiver:      this._normalizeArrayField(data.receiver, 100),
              receiver_unit: this._normalizeArrayField(data.receiver_unit, 100),
            },
            id: rows[index].id,
          });
        });
      }
    }
    
    // if (results.length > 0) {
    //   logger.info(`[SyncAuditModel] Bulk inserted ${results.length} audit rows successfully for table=${this.oldDbTable}`);
    // }
    
    return results;
  }

  /**
   * Cập nhật hàng loạt bản ghi audit đã tồn tại trong CSDL mới (Bulk Update).
   * @param {Array} items - Mảng chứa { audit, id }.
   * @param {object} transaction - Đối tượng transaction.
   * @private
   */
  async _updateMany(items, transaction) {
    if (!items || items.length === 0) return [];
    
    // Giới hạn chunk size để tránh lỗi vượt quá 2100 parameters
    const chunkSize = 80;
    const results = [];
    
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      
      let query = '';
      const params = {};
      
      chunk.forEach((item, index) => {
        const data = item.audit;
        const id = item.id;
        const receiver = this._normalizeArrayField(data.receiver, 100);
        const receiverUnit = this._normalizeArrayField(data.receiver_unit, 100);
        
        query += `
          UPDATE ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable} WITH (ROWLOCK)
          SET
            document_id = @document_id_${index},
            display_name = @display_name_${index},
            action_code = @action_code_${index},
            details = @details_${index},
            created_by = @created_by_${index},
            receiver = @receiver_${index},
            receiver_unit = @receiver_unit_${index},
            group_ = @group__${index},
            roleProcess = @roleProcess_${index},
            [action] = @action_${index},
            stage_status = @stage_status_${index},
            status_code = @status_code_${index},
            bpmn_version = @bpmn_version_${index},
            type_of_process = @type_of_process_${index},
            curStatusCode = @curStatusCode_${index},
            [role] = @role_${index},
            type_document = @type_document_${index},
            updated_at = @updated_at_${index}
          WHERE id = @id_${index};
        `;
        
        params[`id_${index}`] = id;
        params[`updated_at_${index}`] = data.time || new Date();
        params[`document_id_${index}`] = data.document_id;
        params[`display_name_${index}`] = data.display_name ?? null;
        params[`action_code_${index}`] = data.action_code ?? null;
        params[`details_${index}`] = data.details ?? null;
        params[`created_by_${index}`] = data.created_by ?? null;
        params[`receiver_${index}`] = receiver;
        params[`receiver_unit_${index}`] = receiverUnit;
        params[`group__${index}`] = this._normalizeTextField(data.group_, 100);
        params[`roleProcess_${index}`] = data.roleProcess ?? null;
        params[`action_${index}`] = this._normalizeTextField(data.action, 255);
        params[`stage_status_${index}`] = data.stage_status ?? null;
        params[`status_code_${index}`] = data.status_code ?? null;
        params[`bpmn_version_${index}`] = data.bpmn_version ?? null;
        params[`type_of_process_${index}`] = data.type_of_process ?? null;
        params[`curStatusCode_${index}`] = data.curStatusCode ?? null;
        params[`role_${index}`] = data.role ?? null;
        params[`type_document_${index}`] = data.type_document;
      });
      
      await this.queryNewDbTx(query, params, transaction);
      
      // Normalize receiver/receiver_unit về string giống DB để downstream (assignment sync) dùng đúng.
      chunk.forEach(item => {
        results.push({
          audit: {
            ...item.audit,
            receiver:      this._normalizeArrayField(item.audit.receiver, 100),
            receiver_unit: this._normalizeArrayField(item.audit.receiver_unit, 100),
          },
          id: item.id,
        });
      });
    }
    
    if (results.length > 0) {
      logger.info(`[SyncAuditModel] Bulk updated ${results.length} audit rows successfully for table=${this.oldDbTable}`);
    }
    
    return results;
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
  async _mapSingleRecord(record, documentId, transaction, drafter = null, typeDocument= 'OutgoingDocument') {
    if (!record?.ID || !documentId)
      return null;

    // Chuyển đổi chuỗi ngày tháng từ CSDL cũ sang đối tượng Date
    const parsedTime =
      this.helper.parseDate(record.NgayTao);
    const time =
      parsedTime || new Date();

    // Map tên người dùng từ CSDL cũ sang user_id trong CSDL mới
    const user_id =
      (await this.helper.mapUserName(
        record.NguoiXuLy,
        transaction
      )) || process.env.VANTHU_USER_ID;

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

    // ── SỬ DỤNG ReceiverParserService ĐỂ BÓC TÁCH RECEIVER THEO QUY TẮC NGHIỆP VỤ ──
    const parsed = await this.receiverParser.determineReceivers(record, transaction);
    let receiver = parsed.receiverIds || [];
    const receiverUnit = parsed.receiverUnitIds || [];
    const parsedRoleProcess = actionParsed.roleProcess || parsed.roleProcess || 'VANTHU';
    const parsedRole = parsed.parsedRole || null; // Role của người nhận bóc từ text

    // ── FALLBACK 1: Nếu receiver rỗng → tự động lấy ID người xử lý (user_id) đắp vào ──
    if ((!receiver || receiver.length === 0) && user_id) {
      receiver = [user_id];
    }

    // ── FALLBACK 2: Nếu vẫn rỗng (user_id cũng null) → dùng drafter từ outgoing_documents ──
    // drafter được truyền vào từ bên ngoài sau khi đã map xong document,
    // đảm bảo cột receiver trong audit không bao giờ NULL.
    if ((!receiver || receiver.length === 0) && drafter) {
      receiver = [String(drafter).trim()].filter(Boolean);
    }

    // Chuẩn hóa chuỗi hành động thô và tạo đối tượng JSON cho cột 'details'
    const rawAction = this._normalizeTextField(record.HanhDong);
    const actionStr = JSON.stringify({
      note: rawAction,
      isTransferOption: true
    });

    // --- XÁC ĐỊNH type_document dựa vào actionParsed và Category ---
    let type_document = typeDocument ?? actionParsed?.type_document ?? null;

    const categoryRaw = record?.Category ?? null;
    const category = this._normalizeTextField(categoryRaw);

    // chỉ assign nếu thực sự chưa có (null hoặc undefined, KHÔNG override '')
    if (type_document === null || type_document === undefined) {
      if (category && INCOMING_CATEGORIES.has(category)) {
        type_document = 'IncomingDocument';
      } else if (category && OUTGOING_CATEGORIES.has(category)) {
        type_document = 'OutgoingDocument';
      }
    }

    // ── XỬ LÝ MAPPING ROLE VÀ SCREEN DỰA TRÊN CẤU HÌNH DYNAMIC ──
    const userProfile = await this.helper.findUserByBakId(user_id, transaction);
    const userPosition = userProfile?.position || '';
    const currentTrangThai = this._normalizeTextField(record.TrangThai);

    // Sử dụng action_code từ parseActionString làm action_code mục tiêu
    const parsedActionCode = actionParsed.action_code || null;

    const workflowMapping = this._determineUserRoleAndScreen(
      userPosition,
      currentTrangThai,
      rawAction,
      type_document,
      parsedRole,
      parsedActionCode,
      record.NguoiXuLy // Truyền raw name để check role fallback
    );

    // Trả về đối tượng đã được map theo cấu trúc của bảng 'audit' mới
    return {
      document_id: documentId,
      time,
      action_code: actionParsed.action_code || workflowMapping.action_code || null,
      details: actionStr ?? null,
      origin_id: this._normalizeTextField(
        record.ID,
        100
      ),
      // Ưu tiên: user_id → VANTHU_USER_ID → drafter (đảm bảo created_by không NULL)
      created_by: user_id || (drafter ? String(drafter).trim() : null) || process.env.VANTHU_USER_ID,
      receiver,
      receiver_unit: receiverUnit,
      group_: this._normalizeTextField(
        record.Category,
        100
      ),
      display_name: displayName ?? null,
      user_id: user_id ?? null,
      roleProcess:
        actionParsed.roleProcess || workflowMapping.role || parsedRoleProcess || null,
      action: actionParsed.action || this._normalizeTextField(
        rawAction,
        255
      ),
      stage_status:
        actionParsed.stage_status || workflowMapping.stage_status || null,
      status_code: getStatusCodeByAction(
        type_document,
        actionParsed.action_code || workflowMapping.action_code || 'CREATE',
        parsedRole || 'CAN_BO'
      ),
      bpmn_version: workflowMapping.bpmn_version || null,
      type_of_process: workflowMapping.type_of_process || null,
      curStatusCode: workflowMapping.curStatusCode || null,
      role: workflowMapping.role || null,
      type_document: type_document, // Sử dụng biến đã được quyết định ở trên
      table_backups: this.oldDbTable,
    };
  }

  /**
   * Xác định vai trò và màn hình dựa trên chức danh và trạng thái/hành động.
   * @param {string} userPosition - Chức danh/vị trí của người dùng.
   * @param {string} currentTrangThai - Trạng thái hiện tại từ bản ghi cũ.
   * @param {string} actionText - Nội dung hành động (HanhDong).
   * @param {string} type_document - Loại văn bản.
   * @param {string} parsedRole - Role bóc được từ text người nhận (Target Role).
   * @param {string} parsedActionCode - Mã hành động bóc được.
   * @param {string} rawNguoiXuLy - Tên/Chức danh nguyên bản của người thực hiện (Source Role).
   * @returns {object} - Cấu hình mapping tìm được hoặc mặc định.
   * @private
   */
  _determineUserRoleAndScreen(userPosition, currentTrangThai, actionText, type_document = 'OutgoingDocument', parsedRole = null, parsedActionCode = null, rawNguoiXuLy = null) {
    const pos = (userPosition || '').toLowerCase();
    const status = (currentTrangThai || '').toLowerCase();
    const action = (actionText || '').toLowerCase();

    // Lấy cấu hình workflow chuẩn dựa trên loại văn bản (Hỗ trợ cả Incomming và Incoming)
    const isIncoming = ['IncomingDocument', 'IncommingDocument'].includes(type_document);
    const docTypeKey = isIncoming ? 'incoming' : 'outgoing';
    const workflowConfig = config.getWorkflowConfig(docTypeKey);
    const PROCESS_CONFIG = workflowConfig.WORKFLOW_PROCESS_CONFIG || [];
    const DEFAULT_CONFIG = workflowConfig.DEFAULT_WORKFLOW_PROCESS || {};

    // 1. Tìm vai trò (role)
    let matchedRole = null;

    // Ưu tiên 1: Sử dụng parsedRole bóc được từ text người nhận (Target Role)
    if (parsedRole) {
      matchedRole = PROCESS_CONFIG.find(r =>
        (r.role && r.role.toLowerCase() === parsedRole.toLowerCase()) ||
        (r.name && r.name.toLowerCase() === parsedRole.toLowerCase())
      );
    }

    // Ưu tiên 2: Nếu không có target role -> Tìm vai trò dựa trên chức danh/tên người thực hiện (Source Role Fallback)
    // Dùng rawNguoiXuLy (VD: "Phạm Thị Sáu - VP" hoặc "Văn Thư") để check keywords
    if (!matchedRole && rawNguoiXuLy) {
      const sourceInfo = rawNguoiXuLy.toLowerCase();
      for (const roleConf of PROCESS_CONFIG) {
        if (roleConf.keywords && roleConf.keywords.some(kw => sourceInfo.includes(kw.toLowerCase()))) {
          matchedRole = roleConf;
          break;
        }
      }
    }

    // Ưu tiên 3: Tìm vai trò dựa trên chức danh user trong DB (Phụ trợ)
    if (!matchedRole && pos) {
      for (const roleConf of PROCESS_CONFIG) {
        if (roleConf.keywords && roleConf.keywords.some(kw => pos.includes(kw.toLowerCase()))) {
          matchedRole = roleConf;
          break;
        }
      }
    }

    if (!matchedRole) {
      return DEFAULT_CONFIG;
    }

    // 2. Tìm màn hình (screen)
    let matchedScreen = null;
    if (matchedRole.screens && matchedRole.screens.length > 0) {
      // Ưu tiên 1: Khớp theo action_code đã bóc tách
      if (parsedActionCode) {
        matchedScreen = matchedRole.screens.find(s => s.action_code === parsedActionCode);
      }

      // Ưu tiên 2: Khớp theo trangthais (keywords)
      if (!matchedScreen) {
        for (const screen of matchedRole.screens) {
          if (screen.trangthais && screen.trangthais.some(st =>
            status.includes(st.toLowerCase()) || action.includes(st.toLowerCase())
          )) {
            matchedScreen = screen;
            break;
          }
        }
      }
    }

    if (matchedScreen) {
      return {
        ...matchedScreen,
        role: matchedScreen.role || matchedRole.role || matchedRole.name // Fallback to role name
      };
    }

    // --- FALLBACK: Nếu có role nhưng không khớp màn hình nào, lấy màn hình đầu tiên của role đó ---
    if (matchedRole && matchedRole.screens && matchedRole.screens.length > 0) {
      const firstScreen = matchedRole.screens[0];
      return {
        ...firstScreen,
        role: firstScreen.role || matchedRole.role || matchedRole.name
      };
    }

    // Nếu không khớp role hoặc không có màn hình, trả về mặc định hệ thống
    return DEFAULT_CONFIG;
  }

  /**
   * Cập nhật status_code cho bảng văn bản tương ứng.
   * @param {number} documentId - ID của văn bản trong CSDL mới.
   * @param {string} typeDocument - Loại văn bản (IncomingDocument/OutgoingDocument).
   * @param {string} statusCode - Mã trạng thái mới.
   * @param {object} transaction - Transaction.
   * @private
   */
  async _updateDocumentStatusCode(documentId, typeDocument, statusCode, transaction) {
    if (!documentId || !statusCode) return;

    const isIncoming = ['IncomingDocument', 'IncommingDocument'].includes(typeDocument);
    const tableName = isIncoming ? 'incomming_documents' : 'outgoing_documents';
    const idColumn = 'document_id';
    const query = `
      UPDATE ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${tableName} WITH (ROWLOCK, UPDLOCK) 
      SET status_code = @status_code
      WHERE ${idColumn} = @id
        AND (
          status_code IS NULL
          OR status_code < @status_code
        )
    `;

    try {
      await this.queryNewDbTx(query, {
        status_code: statusCode,
        id: documentId
      }, transaction);
    } catch (err) {
      logger.warn(`[SyncAuditModel] Không thể cập nhật status_code cho ${tableName} ID=${documentId}: ${err.message}`);
      // Ném lại lỗi để withDeadlockRetry ở lớp ngoài có thể thực hiện retry toàn bộ transaction
      throw err;
    }
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
module.exports.CATEGORY_RELEASE_DV = CATEGORY_RELEASE_DV;
module.exports.CATEGORY_RELEASE_TCT = CATEGORY_RELEASE_TCT;
module.exports.CATEGORY_OUTGOING = CATEGORY_OUTGOING;
module.exports.CATEGORY_INCOMING_SUBMIT = CATEGORY_INCOMING_SUBMIT;
module.exports.CATEGORY_INCOMING_TCT = CATEGORY_INCOMING_TCT;
module.exports.CATEGORY_INCOMING = CATEGORY_INCOMING;
module.exports.CATEGORY_INCOMING_INTERNAL = CATEGORY_INCOMING_INTERNAL;
module.exports.INCOMING_CATEGORIES = INCOMING_CATEGORIES;
module.exports.OUTGOING_CATEGORIES = OUTGOING_CATEGORIES;