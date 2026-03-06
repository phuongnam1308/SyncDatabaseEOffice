const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const { roleMapping } = require('./roleMapping');
const MigrationHelper = require('../../helpers/MigrationHelper');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class StreamUserMigrationModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_USER_COPY_MIGRATION' });
    this.newDbName = process.env.NEW_DB_NAME;
    this.oldDbSchema = 'dbo';
    this.oldDbTable = 'PersonalProfile';
    this.newDbSchema = 'dbo';
    this.newTableSync = 'user_sync'; //Bảng trung gian lưu data raw dùng để sync dần vào bảng chính `user_clone_for_sync`
    this.newDbTable = 'users';
    //_clone_for_sync';
    this.migrationHelper = new MigrationHelper(
      (...args) => this.queryNewDbTx(...args),
      (...args) => this.queryOldDb?.(...args) ?? null
    );
  }

  /**
   * Override initialize: kết nối DB xong tự động tạo bảng trung gian nếu chưa có.
   */
  async initialize() {
    await super.initialize();
    await this.ensureStagingTableExists();
  }

  /**
   * Tự động tạo bảng trung gian `user_sync` trong DB mới nếu chưa tồn tại.
   * Cấu trúc bảng được clone từ `PersonalProfile` (DB cũ) qua SELECT TOP 0 * INTO.
   * Nếu 2 DB khác nhau instance thì câu lệnh này vẫn chạy được miễn cùng SQL Server.
   */
  async ensureStagingTableExists() {
    const tableRef = this.getStagingTableRef();

    const query = `
    IF OBJECT_ID('${tableRef}', 'U') IS NULL
    BEGIN
      CREATE TABLE ${tableRef} (

        ID NVARCHAR(MAX) NULL,
        AccountID NVARCHAR(MAX) NULL,
        AccountName NVARCHAR(MAX) NULL,
        FullName NVARCHAR(MAX) NULL,

        Department NVARCHAR(MAX) NULL,
        DepartmentManager NVARCHAR(MAX) NULL,
        Manager NVARCHAR(MAX) NULL,

        Gender NVARCHAR(MAX) NULL,
        BirthDay NVARCHAR(MAX) NULL,

        Address NVARCHAR(MAX) NULL,
        Image NVARCHAR(MAX) NULL,

        StaffID NVARCHAR(MAX) NULL,
        DateOfHire NVARCHAR(MAX) NULL,

        Mobile NVARCHAR(MAX) NULL,
        Ext NVARCHAR(MAX) NULL,

        Notify NVARCHAR(MAX) NULL,
        Reminder NVARCHAR(MAX) NULL,
        ReceiveMail NVARCHAR(MAX) NULL,

        Email NVARCHAR(MAX) NULL,
        Position NVARCHAR(MAX) NULL,

        After_CompletedDate NVARCHAR(MAX) NULL,

        PhongBan NVARCHAR(MAX) NULL,
        SiteName NVARCHAR(MAX) NULL,

        DienThoaiIP NVARCHAR(MAX) NULL,
        DienThoaiNoiBo NVARCHAR(MAX) NULL,

        Orders NVARCHAR(MAX) NULL,
        Nickname NVARCHAR(MAX) NULL,

        DateOff NVARCHAR(MAX) NULL,
        PublicSiteRedirect NVARCHAR(MAX) NULL,

        DeviceOS NVARCHAR(MAX) NULL,
        DeviceInfo NVARCHAR(MAX) NULL,

        DepartmentId NVARCHAR(MAX) NULL,
        PhongBanID NVARCHAR(MAX) NULL,

        WorkStatus NVARCHAR(MAX) NULL,

        NgayNghiViec NVARCHAR(MAX) NULL,
        LyDoNghiViec NVARCHAR(MAX) NULL,

        NgayTao NVARCHAR(MAX) NULL,
        Modified NVARCHAR(MAX) NULL,

        IsTCT NVARCHAR(MAX) NULL,

        ImagePath NVARCHAR(MAX) NULL,
        SignImage NVARCHAR(MAX) NULL,
        SignImageSmall NVARCHAR(MAX) NULL,

        CMND NVARCHAR(MAX) NULL,

        SimKySo1 NVARCHAR(MAX) NULL,
        SimKySo2 NVARCHAR(MAX) NULL,

        HeSoDich NVARCHAR(MAX) NULL,

        IsForceRelogin NVARCHAR(MAX) NULL,

        CapBac NVARCHAR(MAX) NULL,
        ChucVu NVARCHAR(MAX) NULL,

        LoaiDoiTuong NVARCHAR(MAX) NULL,
        LoaiCBNV NVARCHAR(MAX) NULL,

        OTP NVARCHAR(MAX) NULL,
        OTPTimeOut NVARCHAR(MAX) NULL,

        Password NVARCHAR(MAX) NULL,

        IsKyCAMem NVARCHAR(MAX) NULL,
        IsSortToDoNewOld NVARCHAR(MAX) NULL
      )
    END
    `;

    await this.queryNewDb(query);
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

  safeDate(value) {
    if (value === 'NULL' || value === 'null' || value === null || value === undefined) {
      return null;
    }
    try {
      const dateStr = String(value).trim();
      if (!dateStr) return null;
      const date = new Date(dateStr);
      return Number.isNaN(date.getTime()) ? null : date;
    } catch (error) {
      return null;
    }
  }

  parseGender(value) {
    const genderStr = String(value || '');
    if (genderStr === '1') return 'nam';
    if (genderStr === '0') return 'nu';
    return null;
  }

  parseStatus(value) {
    const statusStr = String(value || '');
    if (statusStr === '-1') return 3;
    return 1;
  }

  parseBit(value) {
    if (value === '1' || value === 1 || value === true) return 1;
    if (value === '0' || value === 0 || value === false) return 0;
    return 0;
  }

  /**
   * Chuẩn hoá chuỗi tiếng Việt: bỏ dấu + lowercase.
   * VD: "Trưởng Phòng" → "truong phong"
   * Giúp match được cả DB lưu có dấu lẫn không dấu.
   */
  normalizeVietnamese(str) {
    if (!str) return '';
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd');
  }

  mapPositionToRoles(position) {
    if (!position) {
      return '[]';
    }

    const lowerPos = position.normalize('NFC').toLowerCase();
    const noAccent = this.normalizeVietnamese(position);

    // // DEBUG: log để xem giá trị thực tế từ DB
    // console.log('[mapPositionToRoles] position raw    :', JSON.stringify(position));
    // console.log('[mapPositionToRoles] position lowerPos:', JSON.stringify(lowerPos));
    // console.log('[mapPositionToRoles] position noAccent:', JSON.stringify(noAccent));
    // console.log('[mapPositionToRoles] codepoints:', [...position].map(c => c.codePointAt(0).toString(16)).join(' '));

    for (const { keywords, roles } of roleMapping) {
      if (!Array.isArray(roles) || !roles.length) continue;

      for (const keyword of keywords) {
        const lowerKw = keyword.normalize('NFC').toLowerCase();
        const noAccKw = this.normalizeVietnamese(keyword);

        const matched =
          lowerPos.includes(lowerKw) ||
          noAccent.includes(noAccKw);

        if (matched) {
          console.log(
            '[mapPositionToRoles] position=' + JSON.stringify(position)
            + ' matched keyword=' + JSON.stringify(keyword)
            + ' → ' + roles.length + ' processKey(s): ' + roles.map(r => r.processKey).join(', ')
          );
          return JSON.stringify(roles);
        }
      }
    }

    console.warn('[mapPositionToRoles] position=' + JSON.stringify(position) + ' → không match keyword nào, trả []');
    return '[]';
  }

  mapRecordForUpsert(oldRecord) {
    const username = oldRecord.AccountName || '';

    let code_nd = username;
    const backslashIndex = username.lastIndexOf('\\');
    if (backslashIndex > -1) {
      code_nd = username.substring(backslashIndex + 1);
    }

    let name = (oldRecord.FullName || username || 'Unknown').trim();
    const hyphenIndex = name.indexOf('-');
    if (hyphenIndex > -1) {
      name = name.substring(0, hyphenIndex).trim();
    }

    let email_user = this.safeString(oldRecord.Email);
    if (!email_user && code_nd) {
      email_user = `${code_nd}@saigonnewport.com.vn`;
    }

    const position = this.safeString(oldRecord.Position);

    return {
      id: oldRecord.ID,
      password: process.env.DEFAULT_PASSWORD ||'$2b$10$Ohcqw9J1YStppJHeYdoD5.yWjnCm5Mt7MQxWoIMNc0LBwbFRW1DU2',
      name,
      avatar: oldRecord.Image || '[]',
      code_nd,
      username: oldRecord.AccountName,
      email_user,
      phone_number_user: this.safeString(oldRecord.Mobile),
      position: position,
      leader: this.safeString(oldRecord.Manager),
      address_user: this.safeString(oldRecord.Address),
      description: null,
      role: null,
      roles_by_process: this.mapPositionToRoles(position) || process.env.ROLES_DEFAULT || '[{"processKey":"VAN_BAN_DI","name":"VAN_BAN_DI","roles":[{"roleCode":"CAN_BO","name":"CAN_BO"},{"roleCode":"CAN_BO","name":"CAN_BO"}]},{"processKey":"vbdi","name":"vbdi","roles":[{"roleCode":"CANBO","name":"CANBO"}]},{"processKey":"XIN_Y_KIEN","name":"XIN_Y_KIEN","roles":[{"roleCode":"CAN_BO","name":"CAN_BO"}]},{"processKey":"QUY_TRINH_CV_PHONG_BAN","name":"QUY_TRINH_CV_PHONG_BAN","roles":[{"roleCode":"NGUOI_GIAO","name":"NGƯỜI GIAO"},{"roleCode":"NGUOI_PHOI_HOP","name":"NGƯỜI PHỐI HỢP"}]},{"processKey":"QUY_TRINH_LICH_HOP","name":"QUY_TRINH_LICH_HOP","roles":[{"roleCode":"UNKNOWN","name":"VAN_THU"}]},{"processKey":"quan_ly_tin_tuc","name":"quan_ly_tin_tuc","roles":[{"roleCode":"NGUOI_TAO_TIN","name":"NGUOI_TAO_TIN"}]},{"processKey":"SOANTHAO_PHATHANH_VBD","name":"SOANTHAO_PHATHANH_VBD","roles":[{"roleCode":"NGUOI_SOAN_THAO","name":"NGUOI_SOAN_THAO"}]},{"processKey":"CVDAN","name":"CVDAN","roles":[{"roleCode":"NGUOI_GIAO","name":"NGƯỜI GIAO"},{"roleCode":"NGUOI_PHOI_HOP","name":"NGƯỜI PHỐI HỢP"}]},{"processKey":"SOANTHAO_PHATHANH_CQD","name":"SOANTHAO_PHATHANH_CQD","roles":[{"roleCode":"NGUOI_SOAN_THAO","name":"NGUOI_SOAN_THAO"}]},{"processKey":"KY_SO_HS_VBD","name":"KY_SO_HS_VBD","roles":[{"roleCode":"NGUOI_SOAN_THAO","name":"NGUOI_SOAN_THAO"}]},{"processKey":"QUY_TRINH_DANG_KY_XE","name":"QUY_TRINH_DANG_KY_XE","roles":[{"roleCode":"ALL","name":"ALL"}]},{"processKey":"thhs","name":"thhs","roles":[{"roleCode":"bld","name":"bld"}]},{"processKey":"QUY_TRINH_PHAN_ANH_KIEN_NGHI","name":"QUY_TRINH_PHAN_ANH_KIEN_NGHI","roles":[{"roleCode":"NGUOI_PHAN_ANH","name":"NGUOI_PHAN_ANH"}]}]',
      organization_name: null,
      organization_code: null,
      organization_type: null,
      orders: this.safeNumber(oldRecord.Orders, 1000),
      birthday: this.safeDate(oldRecord.BirthDay),
      gender: this.parseGender(oldRecord.Gender),
      identification_card: this.safeString(oldRecord.CMND),
      contact_time: null,
      parent: null,
      wso2_user_id: null,
      keycloak_user_id: null,
      status: this.parseStatus(oldRecord.WorkStatus),
      author: '',
      role_group_source_authorized: '',
      created_at: new Date(),
      updated_at: new Date(),
      name_authorized: null,
      id_user_bak: oldRecord.ID,
      AccountID: this.safeString(oldRecord.AccountID),
      FullName: this.safeString(oldRecord.FullName),
      Department: this.safeString(oldRecord.Department),
      DepartmentId: this.safeString(oldRecord.DepartmentId),
      PhongBanID: this.safeString(oldRecord.PhongBanID),
      SimKySo1: this.safeString(oldRecord.SimKySo1),
      SimKySo2: this.safeString(oldRecord.SimKySo2),
      DepartmentManager: this.safeString(oldRecord.DepartmentManager),
      IsTCT: this.parseBit(oldRecord.IsTCT),
      ImagePath: this.safeString(oldRecord.ImagePath),
      SignImage: this.safeString(oldRecord.SignImage),
      SignImageSmall: this.safeString(oldRecord.SignImageSmall),
      table_backups: 'PersonalProfile'
    };
  }

  /**
   * Lấy danh sách user từ CSDL cũ sau `lastSyncTime`.
   * Trả về mảng bản ghi (ID, AccountName, FullName, Modified, NgayTao) đã sắp xếp theo thời gian sửa/tao.
   * @param {string} lastSyncTime - ISO datetime hoặc giá trị mặc định để lấy từ thời điểm đó về sau
   * @returns {Promise<Array>} danh sách bản ghi từ CSDL cũ
   */
  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0) {
    const query = `
      ;WITH source_rows AS (
        SELECT
          *,
          COALESCE(TRY_CONVERT(datetime2, Modified), TRY_CONVERT(datetime2, NgayTao)) AS __sync_time,
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
          COALESCE(TRY_CONVERT(datetime2, Modified), TRY_CONVERT(datetime2, NgayTao)) AS __sync_time,
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
    const res = await this.upsertUserById(rowData, transaction);

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
  async upsertUserById(rowDataOrBackupId, fallbackNameOrTransaction, maybeTransaction) {
    const isRowDataInput = rowDataOrBackupId && typeof rowDataOrBackupId === 'object' && !Array.isArray(rowDataOrBackupId);
    const rowData = isRowDataInput
      ? rowDataOrBackupId
      : {
        ID: rowDataOrBackupId,
        AccountName: String(rowDataOrBackupId || ''),
        FullName: String(fallbackNameOrTransaction || '')
      };
    const transaction = isRowDataInput ? fallbackNameOrTransaction : maybeTransaction;

    const mapped = this.mapRecordForUpsert(rowData);
    if (!mapped.id) throw new Error('backupId is required');

    // Resolve parent: dùng processSenderUnit để chuẩn hoá tên Department
    // rồi tìm id tương ứng trong organization_units
    if (rowData.Department) {
      try {
        const orgRef = this.newDbName
          ? `${this.newDbName}.${this.newDbSchema}.organization_units`
          : `${this.newDbSchema}.organization_units`;

        // ① Chuẩn hoá tên phòng ban qua processSenderUnit
        const normalizedDept = this.migrationHelper.processSenderUnit(rowData.Department);

        // console.log(
        //   `[upsertUserById] user.id=${mapped.id} | Department raw="${rowData.Department}" → processSenderUnit="${normalizedDept}"`
        // );

        let parentId = null;
        if (normalizedDept) {
          // ② Tìm id trong organization_units theo tên đã chuẩn hoá
          const orgRows = await this.queryNewDbTx(
            `SELECT TOP 1 id FROM ${orgRef} WHERE LTRIM(RTRIM(name)) = @name AND status = 1`,
            { name: normalizedDept },
            transaction
          );
          parentId = orgRows?.length ? orgRows[0].id : null;
        }
        if (!parentId) {
          parentId = process.env.USER_PAREN_DEFAULT || '68afb3a1cb36081f0bba5dd6'
        }
        // ③ Gán vào parent
        mapped.parent = parentId;

        // console.log(
        //   `[upsertUserById] user.id=${mapped.id} | Department="${normalizedDept}" → parent=${parentId ?? 'NULL (không tìm thấy)'}`
        // );
      } catch (err) {
        console.warn(`[upsertUserById] Lỗi resolve parent cho user.id=${mapped.id}:`, err.message);
        mapped.parent = null;
      }
    }

    const tableRef = this.newDbName
      ? `${this.newDbName}.${this.newDbSchema}.${this.newDbTable}`
      : `${this.newDbSchema}.${this.newDbTable}`;

    const query = `
      IF EXISTS (SELECT 1 FROM ${tableRef} WHERE id = @id)
      BEGIN
        UPDATE ${tableRef}
        SET password = @password,
            name = @name,
            avatar = @avatar,
            code_nd = @code_nd,
            username = @username,
            email_user = @email_user,
            phone_number_user = @phone_number_user,
            position = @position,
            leader = @leader,
            address_user = @address_user,
            description = @description,
            role = @role,
            roles_by_process = @roles_by_process,
            organization_name = @organization_name,
            organization_code = @organization_code,
            organization_type = @organization_type,
            orders = @orders,
            birthday = @birthday,
            gender = @gender,
            identification_card = @identification_card,
            contact_time = @contact_time,
            parent = @parent,
            wso2_user_id = @wso2_user_id,
            keycloak_user_id = @keycloak_user_id,
            status = @status,
            author = @author,
            role_group_source_authorized = @role_group_source_authorized,
            updated_at = @updated_at,
            name_authorized = @name_authorized,
            id_user_bak = @id_user_bak,
            AccountID = @AccountID,
            FullName = @FullName,
            Department = @Department,
            DepartmentId = @DepartmentId,
            PhongBanID = @PhongBanID,
            SimKySo1 = @SimKySo1,
            SimKySo2 = @SimKySo2,
            DepartmentManager = @DepartmentManager,
            IsTCT = @IsTCT,
            ImagePath = @ImagePath,
            SignImage = @SignImage,
            SignImageSmall = @SignImageSmall,
            table_backups = @table_backups
        WHERE id = @id;
        SELECT @@ROWCOUNT AS affected, 'updated' AS action;
      END
      ELSE
      BEGIN
        INSERT INTO ${tableRef} (
          id, password, name, avatar, code_nd, username, email_user, phone_number_user,
          position, leader, address_user, description, role, roles_by_process,
          organization_name, organization_code, organization_type, orders, birthday, gender,
          identification_card, contact_time, parent, wso2_user_id, keycloak_user_id,
          status, author, role_group_source_authorized, created_at, updated_at,
          name_authorized, id_user_bak, AccountID, FullName, Department, DepartmentId,
          PhongBanID, SimKySo1, SimKySo2, DepartmentManager, IsTCT, ImagePath, SignImage,
          SignImageSmall, table_backups
        )
        VALUES (
          @id, @password, @name, @avatar, @code_nd, @username, @email_user, @phone_number_user,
          @position, @leader, @address_user, @description, @role, @roles_by_process,
          @organization_name, @organization_code, @organization_type, @orders, @birthday, @gender,
          @identification_card, @contact_time, @parent, @wso2_user_id, @keycloak_user_id,
          @status, @author, @role_group_source_authorized, @created_at, @updated_at,
          @name_authorized, @id_user_bak, @AccountID, @FullName, @Department, @DepartmentId,
          @PhongBanID, @SimKySo1, @SimKySo2, @DepartmentManager, @IsTCT, @ImagePath, @SignImage,
          @SignImageSmall, @table_backups
        );
        SELECT @@ROWCOUNT AS affected, 'inserted' AS action;
      END
    `;

    const params = { ...mapped };
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