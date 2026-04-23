const logger = require('../../../utils/logger');
const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const { roleMapping } = require('./roleMapping');
const { USER_PAREN_DEFAULT, ROLES_DEFAULT } = require('../../config');
const MigrationHelper = require('../../helpers/MigrationHelper');
const { v4: uuidv4 } = require('uuid');
const {
  claimNextStagingRow,
  ensureTrackingColumns,
  markRowFailed,
  markRowSuccess,
  startHeartbeatLoop,
  updateHeartbeat,
} = require('../../helpers/StagingQueueHelper');

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
    this.heartbeatIntervalMs = Number(process.env.HEARTBEAT_INTERVAL_MS || 30000);
    this.migrationHelper = new MigrationHelper(
      (...args) => this.queryNewDbTx(...args),
      (...args) => this.queryOldDb?.(...args) ?? null,
    );
  }

  /**
   * Override initialize: kết nối DB xong tự động tạo bảng trung gian nếu chưa có.
   */
  async initialize() {
    await super.initialize();
    await this.ensureStagingTableExists();

    // Tự động chuyển cột id sang NVARCHAR để chấp nhận ID dạng bình thường (Mã NV)
    try {
      const tableRef = this.newDbName
        ? `${this.newDbName}.${this.newDbSchema}.${this.newDbTable}`
        : `${this.newDbSchema}.${this.newDbTable}`;

      await this.queryNewDb(`
            BEGIN TRY
                -- 1. Tìm và xóa Khóa chính (Primary Key) hiện hữu để có thể sửa cột id
                DECLARE @pkname NVARCHAR(200);
                SELECT @pkname = name FROM sys.key_constraints WHERE type = 'PK' AND parent_object_id = OBJECT_ID('${tableRef}');
                IF @pkname IS NOT NULL
                    EXEC('ALTER TABLE ${tableRef} DROP CONSTRAINT ' + @pkname);

                -- 2. Đổi kiểu cột id sang NVARCHAR
                ALTER TABLE ${tableRef} ALTER COLUMN id NVARCHAR(100) NOT NULL;

                -- 3. Tạo lại Khóa chính trên cột id mới
                IF NOT EXISTS (SELECT 1 FROM sys.key_constraints WHERE type = 'PK' AND parent_object_id = OBJECT_ID('${tableRef}'))
                    EXEC('ALTER TABLE ${tableRef} ADD CONSTRAINT PK_${this.newDbTable}_id PRIMARY KEY (id)');
            END TRY
            BEGIN CATCH
                -- Dự phòng: Nếu là lỗi nhỏ, in cảnh báo, nếu lỗi nặng, ném ra
                IF ERROR_NUMBER() = 50000 -- Lỗi tùy chỉnh
                    THROW;
            END CATCH
        `);
      logger.info(
        `[StreamUserMigrationModel] ID column in ${this.newDbTable} ensured to be NVARCHAR with PK reset.`,
      );
      // Đảm bảo các cột mới có trong bảng (resilience)
      const columnsToAdd = [
        {
          name: 'id_user_del_bak',
          type: 'nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NULL',
        },
        { name: 'tb_bak', type: 'INT DEFAULT 0' },
        { name: 'contentSignImage', type: 'int NULL' },
        { name: 'paraphSignImage', type: 'int NULL' },
        { name: 'paraphSignTransparentImage', type: 'int NULL' },
        { name: 'contentSignTransparentImage', type: 'int NULL' },
        { name: 'stampSignImage', type: 'int NULL' },
        { name: 'table_backups', type: 'nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NULL' },
      ];

      for (const col of columnsToAdd) {
        await this.queryNewDb(`
                IF NOT EXISTS (
                    SELECT * FROM sys.columns
                    WHERE object_id = OBJECT_ID('${tableRef}') AND name = '${col.name}'
                )
                BEGIN
                    ALTER TABLE ${tableRef} ADD ${col.name} ${col.type};
                END
            `);
      }
    } catch (e) {
      logger.warn(
        `[StreamUserMigrationModel] Failed to alter id column or ensure columns: ${e.message}`,
      );
    }
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
    await ensureTrackingColumns(this, {
      tableRef,
      tableName: this.newTableSync,
      schemaName: this.newDbSchema,
      dbName: this.newDbName,
      label: this.modelName,
    });
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

        const matched = lowerPos.includes(lowerKw) || noAccent.includes(noAccKw);

        if (matched) {
          return JSON.stringify(roles);
        }
      }
    }

    return '[]';
  }

  async processAvatar(imageHtml, username) {
    if (!imageHtml) {
      // logger.debug(`[StreamUserMigrationModel][Avatar] processAvatar: imageHtml trống cho user ${username}`);
      return '[]';
    }

    logger.info(
      `[StreamUserMigrationModel][Avatar] [1] Đầu vào chuỗi HTML ảnh của user ${username}: ${imageHtml}`,
    );

    // Match URL inside src
    const match = imageHtml.match(/src=['"]([^'"]+)['"]/i);
    if (!match) {
      logger.info(
        `[StreamUserMigrationModel][Avatar] [1.1] Không tìm thấy 'src=' hợp lệ trong chuỗi HTML của user ${username}`,
      );
      return '[]';
    }

    let imgUrl = match[1];
    logger.info(`[StreamUserMigrationModel][Avatar] [2] Trích xuất cấu trúc gốc URL: ${imgUrl}`);

    if (imgUrl.startsWith('/')) {
      imgUrl = 'https://eoffice.saigonnewport.com.vn' + imgUrl;
      logger.info(
        `[StreamUserMigrationModel][Avatar] [2.1] Đã Normalize URL tải ảnh thành: ${imgUrl}`,
      );
    }

    logger.info(
      `[StreamUserMigrationModel][Avatar] [3] Chuẩn bị gửi request tải ảnh xuống cho user ${username} từ URL: ${imgUrl}`,
    );

    try {
      const { downloadFile } = require('../../sync-file-copy/SharePointAuthService');
      const FileUploadService = require('../../sync-file-copy/Fileuploadservice');
      const path = require('path');

      const fileBuffer = await downloadFile(imgUrl);
      if (!fileBuffer || fileBuffer.length === 0) {
        logger.warn(
          `[StreamUserMigrationModel][Avatar] [3.1] CẢNH BÁO: Không có dữ liệu Buffer trả về khi tải ảnh cho user ${username} (File trống)`,
        );
        return '[]';
      }

      logger.info(
        `[StreamUserMigrationModel][Avatar] [4] Tải thành công Buffer ảnh (Kích thước: ${fileBuffer.length} bytes). Định chuyển nhượng sang FileUploadService...`,
      );

      let originalName = 'avatar.png';
      try {
        const parsedUrl = new URL(imgUrl);
        const segments = parsedUrl.pathname.split('/');
        const lastSegment = segments[segments.length - 1];
        if (lastSegment) {
          originalName = decodeURIComponent(lastSegment.split('?')[0]);
        }
        logger.info(
          `[StreamUserMigrationModel][Avatar] [4.1] Đã bóc tách tên File nhận định ban đầu: ${originalName}`,
        );
      } catch (e) {
        logger.info(
          `[StreamUserMigrationModel][Avatar] [4.1] Lỗi bóc tách URL, lấy tên fallback mặc định: ${originalName}`,
        );
      }

      const uploader = new FileUploadService();
      logger.info(
        `[StreamUserMigrationModel][Avatar] [5] Đang call "uploader.uploadToNewSystem" với params: { originalName: '${originalName}', objectType: '', objectId: '' } cho user ${username}...`,
      );

      const apiResponse = await uploader.uploadToNewSystem({
        fileBuffer,
        originalName,
        objectType: '',
        objectId: '',
      });

      logger.info(
        `[StreamUserMigrationModel][Avatar] [6] KẾT QUẢ thô từ uploader.uploadToNewSystem trả về: ${JSON.stringify(apiResponse)}`,
      );

      if (apiResponse && apiResponse.id) {
        logger.info(
          `[StreamUserMigrationModel][Avatar] [7] Upload Avatar thành công cho user ${username}. File ID trên hệ thống mới: ${apiResponse.id}`,
        );
        return JSON.stringify(apiResponse);
      } else {
        logger.warn(
          `[StreamUserMigrationModel][Avatar] [7.1] THẤT BẠI: Response không trả về field 'id' hợp lệ cho user ${username}. Gửi chuỗi rỗng []`,
        );
      }
    } catch (err) {
      logger.warn(
        `[StreamUserMigrationModel][Avatar] [LỖI] Lỗi ném ra từ catch block khi tải/upload Avatar từ url ${imgUrl} cho user ${username}: ` +
          err.message +
          ` | Stack: ${err.stack}`,
      );
    }
    return '[]';
  }

  async mapRecordForUpsert(oldRecord) {
    let email_user = this.safeString(oldRecord.Email);
    let code_nd = this.safeString(oldRecord.StaffID);

    // If code_nd is not available, derive it from email
    if (!code_nd && email_user) {
      const atIndex = email_user.indexOf('@');
      if (atIndex > -1) {
        code_nd = email_user.substring(0, atIndex);
      } else {
        const backslashIndex = email_user.lastIndexOf('\\');
        if (backslashIndex > -1) {
          code_nd = email_user.substring(backslashIndex + 1);
        }
      }
    }

    let name = (oldRecord.FullName || email_user || 'Unknown').trim();
    const hyphenIndex = name.indexOf('-');
    if (hyphenIndex > -1) {
      name = name.substring(0, hyphenIndex).trim();
    }

    // Nếu code_nd trông không giống mã nhân viên (quá dài hoặc chứa tên đầy đủ),
    // sử dụng hàm buildAbbreviatedCode để tạo mã ndc chuẩn.
    if (!code_nd || code_nd.length > 100 || code_nd.includes(' ')) {
      code_nd = this.migrationHelper.buildAbbreviatedCode(name);
    }

    const position = this.safeString(oldRecord.Position);
    const uploadedAvatar = await this.processAvatar(oldRecord.Image, code_nd);

    return {
      id: uuidv4(),
      password:
        process.env.DEFAULT_PASSWORD ||
        '$2b$10$Ohcqw9J1YStppJHeYdoD5.yWjnCm5Mt7MQxWoIMNc0LBwbFRW1DU2',
      name,
      avatar: uploadedAvatar !== '[]' && uploadedAvatar ? uploadedAvatar : '[]',
      code_nd,
      username: code_nd,
      email_user,
      phone_number_user: this.safeString(oldRecord.Mobile),
      position: position,
      leader: this.safeString(oldRecord.Manager),
      address_user: this.safeString(oldRecord.Address),
      description: null,
      role: null,
      roles_by_process: (() => {
        const mappedRoles = this.mapPositionToRoles(position);
        if (mappedRoles && mappedRoles !== '[]') return mappedRoles;
        let envRoles = process.env.ROLES_DEFAULT;
        if (envRoles && envRoles.trim() !== '') return envRoles;
        return ROLES_DEFAULT && ROLES_DEFAULT.length > 0 ? JSON.stringify(ROLES_DEFAULT) : '[]';
      })(),
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
      table_backups: 'PersonalProfile',
      id_user_del_bak: null,
      contentSignImage: null,
      paraphSignImage: null,
      paraphSignTransparentImage: null,
      contentSignTransparentImage: null,
      stampSignImage: null,
    };
  }

  /**
   * @param {string} lastSyncTime - ISO datetime hoặc giá trị mặc định để lấy từ thời điểm đó về sau
   * @returns {Promise<number>} tổng số bản ghi từ CSDL cũ
   */
  async getCount(lastSyncTime, lastSyncId = 0) {
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
      SELECT COUNT(1) AS total
      FROM source_rows
      WHERE (
        StaffID IS NOT NULL AND LTRIM(RTRIM(StaffID)) <> ''
        AND (
          __sync_time > @lastSyncTime
          OR (
            __sync_time = @lastSyncTime
            AND ISNULL(__sync_id_num, -9223372036854775808) > @lastSyncId
          )
        )
      )
    `;

    const rows = await this.queryOldDb(query, {
      lastSyncTime,
      lastSyncId: Number(lastSyncId || 0),
    });
    return rows?.[0]?.total || 0;
  }

  /**
   * Lấy danh sách user từ CSDL cũ sau `lastSyncTime`.
   * Trả về mảng bản ghi (ID, AccountName, FullName, Modified, NgayTao) đã sắp xếp theo thời gian sửa/tao.
   * @param {string} lastSyncTime - ISO datetime hoặc giá trị mặc định để lấy từ thời điểm đó về sau
   * @param {number} lastSyncId - ID cuối cùng đã đồng bộ
   * @param {number} limit - Số lượng bản ghi cần lấy
   * @param {number} offset - Vị trí bắt đầu lấy
   * @returns {Promise<Array>} danh sách bản ghi từ CSDL cũ
   */
  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0, limit = null, offset = null) {
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
      SELECT * FROM (
        SELECT
          *,
          ISNULL(__sync_id_num, 0) AS __sync_id,
          ROW_NUMBER() OVER (
            ORDER BY
              __sync_time ASC,
              ISNULL(__sync_id_num, -9223372036854775808) ASC,
              ID ASC
          ) AS __page_rn
        FROM source_rows
        WHERE (
          StaffID IS NOT NULL AND LTRIM(RTRIM(StaffID)) <> ''
          AND (
            __sync_time > @lastSyncTime
            OR (
              __sync_time = @lastSyncTime
              AND ISNULL(__sync_id_num, -9223372036854775808) > @lastSyncId
            )
          )
        )
      ) AS t
      WHERE 1=1
      ${offset != null ? `AND __page_rn > @offset` : ''}
      ${limit != null ? `AND __page_rn <= (@offset + @limit)` : ''}
      ORDER BY __page_rn
    `;

    return this.queryOldDb(query, {
      lastSyncTime,
      lastSyncId: Number(lastSyncId || 0),
      limit: limit != null ? Number(limit) : null,
      offset: offset != null ? Number(offset) : 0,
    });
  }

  async syncOldToStaging(rows, { transaction } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { stagedCount: 0 };
    }

    const internalColumns = new Set(['__sync_time', '__sync_id', '__sync_id_num']);
    const columns = Object.keys(rows[0] || {}).filter(
      (column) => !String(column).startsWith('__') && !internalColumns.has(column),
    );
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
          ${
            nonIdColumns.length > 0
              ? `
          UPDATE ${stagingTableRef}
          SET ${updateClause}
          WHERE ID = @ID;`
              : `
          SELECT 1 AS noop;`
          }
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

    const batchSize = Number(process.env.STAGING_FETCH_BATCH_SIZE || 2000);

    // 1. Đếm tổng và cập nhật Dashboard
    const totalCount = await this.getCount(normalizedLastSyncTime, normalizedLastSyncId);
    logger.info(`[StreamUserMigration] Tổng số bản ghi (User) cần hút về Staging: ${totalCount}`);

    await this.queryNewDb(`UPDATE sync_jobs SET total_to_sync = @total WHERE job_id = @jobId`, {
      total: totalCount,
      jobId: syncJobId,
    });

    const numIterations = Math.ceil(totalCount / batchSize);
    let totalProcessed = 0;
    let totalStaged = 0;

    let nextSyncTime = normalizedLastSyncTime;
    let nextSyncId = normalizedLastSyncId;

    // 2. Chạy vòng lặp theo gói batchSize
    for (let i = 0; i < numIterations; i++) {
      const offset = i * batchSize;
      const rows = await this.fetchListFromOldDb(
        normalizedLastSyncTime,
        normalizedLastSyncId,
        batchSize,
        offset,
      );
      if (!rows || rows.length === 0) break;

      const stageResult = await this.syncOldToStaging(rows);
      totalStaged += Number(stageResult?.stagedCount || 0);
      totalProcessed += rows.length;

      // Cập nhật cursor từ batch hiện tại
      for (const row of rows) {
        const rowTime = this.extractRowSyncTime(row);
        const rowId = this.extractRowSyncId(row);
        if (rowTime && this.isCursorAhead(rowTime, rowId, nextSyncTime, nextSyncId)) {
          nextSyncTime = rowTime;
          nextSyncId = rowId;
        }
      }

      logger.info(`🔥 [StreamUserMigration] Đã kéo được ${totalProcessed}/${totalCount} bản ghi về Staging...`);
    }

    return {
      syncJobId,
      rows: [],
      totalCount: totalProcessed,
      stagedCount: totalStaged,
      sourceLastSyncTime: normalizedLastSyncTime,
      sourceLastSyncId: normalizedLastSyncId,
      lastSyncTime: nextSyncTime,
      lastSyncId: nextSyncId,
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
      { syncJobId },
    );

    return rows?.[0] || null;
  }

  async processOne(syncJobId, options = {}) {
    if (!syncJobId) {
      throw new Error('syncJobId is required');
    }

    const jobState = await this.getSyncJobState(syncJobId);
    const itemIndex = Number(
      options.itemIndex != null ? options.itemIndex : jobState?.total_processed || 0,
    );

    const sourceLastSyncTime = this.normalizeSyncTime(
      options.sourceLastSyncTime ||
        options.lastSyncTime ||
        jobState?.last_sync_time ||
        DEFAULT_SYNC_TIME,
    );
    const sourceLastSyncId = Number(
      options.sourceLastSyncId != null ? options.sourceLastSyncId : jobState?.last_sync_id || 0,
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
        done: true,
      };
    }

    const rowId = rowData.ID || null;
    const stopHeartbeat = startHeartbeatLoop(
      () => this.updateHeartbeat(rowId),
      this.heartbeatIntervalMs,
    );

    try {
      const result = await this.processRowData(rowData);
      await markRowSuccess(this, {
        tableRef: this.getStagingTableRef(),
        keyWhere: 'ID = @ID',
        params: { ID: rowId },
        rowToken: `ID=${rowId}`,
        label: this.modelName,
      });
      stopHeartbeat();
      return {
        syncJobId,
        itemIndex,
        processed: true,
        done: false,
        rowId,
        result,
      };
    } catch (error) {
      stopHeartbeat();
      await markRowFailed(this, {
        tableRef: this.getStagingTableRef(),
        keyWhere: 'ID = @ID',
        params: { ID: rowId },
        rowToken: `ID=${rowId}`,
        errorMessage: error.message,
        label: this.modelName,
      });
      throw error;
    }
  }

  async fetchOneFromStaging({ lastSyncTime, lastSyncId = 0, itemIndex, transaction } = {}) {
    const stagingTableRef = this.getStagingTableRef();
    const row = await claimNextStagingRow(this, {
      tableRef: stagingTableRef,
      extraWhere: `
        (
          COALESCE(TRY_CONVERT(datetime2, Modified), TRY_CONVERT(datetime2, NgayTao)) > @lastSyncTime
          OR (
            COALESCE(TRY_CONVERT(datetime2, Modified), TRY_CONVERT(datetime2, NgayTao)) = @lastSyncTime
            AND ISNULL(
              TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), '')),
              -9223372036854775808
            ) > @lastSyncId
          )
        )
      `,
      params: {
        lastSyncTime,
        lastSyncId: Number(lastSyncId || 0),
      },
      owner: `pid_${process.pid}`,
      orderBy: `
        COALESCE(TRY_CONVERT(datetime2, Modified), TRY_CONVERT(datetime2, NgayTao)) ASC,
        ISNULL(TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), '')), -9223372036854775808) ASC,
        ID ASC
      `,
      label: this.modelName,
      transaction,
    });
    if (row) {
      logger.info(`[${this.modelName}] [START] Processing started: ID=${row.ID}`);
    }
    return row;
  }

  async updateHeartbeat(rowId, transaction = null) {
    if (!rowId) return 0;
    return updateHeartbeat(this, {
      tableRef: this.getStagingTableRef(),
      keyWhere: 'ID = @ID',
      params: { ID: rowId },
      transaction,
      rowToken: `ID=${rowId}`,
      label: this.modelName,
    });
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
      affected: Number(res.affected || 0),
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
    const isRowDataInput =
      rowDataOrBackupId &&
      typeof rowDataOrBackupId === 'object' &&
      !Array.isArray(rowDataOrBackupId);
    const rowData = isRowDataInput
      ? rowDataOrBackupId
      : {
          ID: rowDataOrBackupId,
          AccountName: String(rowDataOrBackupId || ''),
          FullName: String(fallbackNameOrTransaction || ''),
        };
    const transaction = isRowDataInput ? fallbackNameOrTransaction : maybeTransaction;

    const mapped = await this.mapRecordForUpsert(rowData);
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
            transaction,
          );
          parentId = orgRows?.length ? orgRows[0].id : null;
        }
        if (!parentId) {
          parentId = USER_PAREN_DEFAULT || '68afb3a1cb36081f0bba5dd6';
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
      DECLARE @existingId nvarchar(100);
      DECLARE @existingUpdatedAt datetime2;

      SELECT TOP 1
        @existingId = id,
        @existingUpdatedAt = updated_at
      FROM ${tableRef}
      WHERE (username = @username AND @username IS NOT NULL AND @username <> '')
         OR (id_user_bak = @id_user_bak AND @id_user_bak IS NOT NULL AND @id_user_bak <> '');

      IF @existingId IS NOT NULL
      BEGIN
        IF @existingUpdatedAt >= @old_modified
        BEGIN
          SELECT 0 AS affected, 'skipped' AS action;
        END
        ELSE
        BEGIN
          UPDATE ${tableRef}
          SET
            name = COALESCE(NULLIF(LTRIM(RTRIM(@name)), ''), name),
            avatar = COALESCE(NULLIF(LTRIM(RTRIM(@avatar)), ''), avatar),
            code_nd = COALESCE(NULLIF(LTRIM(RTRIM(@code_nd)), ''), code_nd),
            email_user = COALESCE(NULLIF(LTRIM(RTRIM(@email_user)), ''), email_user),
            phone_number_user = COALESCE(NULLIF(LTRIM(RTRIM(@phone_number_user)), ''), phone_number_user),
            position = COALESCE(NULLIF(LTRIM(RTRIM(@position)), ''), position),
            leader = COALESCE(NULLIF(LTRIM(RTRIM(@leader)), ''), leader),
            address_user = COALESCE(NULLIF(LTRIM(RTRIM(@address_user)), ''), address_user),
            description = COALESCE(NULLIF(LTRIM(RTRIM(@description)), ''), description),
            role = COALESCE(NULLIF(LTRIM(RTRIM(@role)), ''), role),
            roles_by_process = COALESCE(NULLIF(LTRIM(RTRIM(@roles_by_process)), ''), roles_by_process),
            organization_name = COALESCE(NULLIF(LTRIM(RTRIM(@organization_name)), ''), organization_name),
            organization_code = COALESCE(NULLIF(LTRIM(RTRIM(@organization_code)), ''), organization_code),
            organization_type = COALESCE(NULLIF(LTRIM(RTRIM(@organization_type)), ''), organization_type),
            orders = COALESCE(@orders, orders),
            birthday = COALESCE(@birthday, birthday),
            gender = COALESCE(NULLIF(LTRIM(RTRIM(@gender)), ''), gender),
            identification_card = COALESCE(NULLIF(LTRIM(RTRIM(@identification_card)), ''), identification_card),
            contact_time = COALESCE(@contact_time, contact_time),
            parent = COALESCE(@parent, parent),
            wso2_user_id = COALESCE(NULLIF(LTRIM(RTRIM(@wso2_user_id)), ''), wso2_user_id),
            keycloak_user_id = COALESCE(NULLIF(LTRIM(RTRIM(@keycloak_user_id)), ''), keycloak_user_id),
            status = COALESCE(@status, status),
            author = COALESCE(NULLIF(LTRIM(RTRIM(@author)), ''), author),
            role_group_source_authorized = COALESCE(NULLIF(LTRIM(RTRIM(@role_group_source_authorized)), ''), role_group_source_authorized),
            updated_at = @updated_at,
            name_authorized = COALESCE(NULLIF(LTRIM(RTRIM(@name_authorized)), ''), name_authorized),
            AccountID = COALESCE(NULLIF(LTRIM(RTRIM(@AccountID)), ''), AccountID),
            FullName = COALESCE(NULLIF(LTRIM(RTRIM(@FullName)), ''), FullName),
            Department = COALESCE(NULLIF(LTRIM(RTRIM(@Department)), ''), Department),
            DepartmentId = COALESCE(NULLIF(LTRIM(RTRIM(@DepartmentId)), ''), DepartmentId),
            PhongBanID = COALESCE(NULLIF(LTRIM(RTRIM(@PhongBanID)), ''), PhongBanID),
            SimKySo1 = COALESCE(NULLIF(LTRIM(RTRIM(@SimKySo1)), ''), SimKySo1),
            SimKySo2 = COALESCE(NULLIF(LTRIM(RTRIM(@SimKySo2)), ''), SimKySo2),
            DepartmentManager = COALESCE(NULLIF(LTRIM(RTRIM(@DepartmentManager)), ''), DepartmentManager),
            IsTCT = COALESCE(@IsTCT, IsTCT),
            ImagePath = COALESCE(NULLIF(LTRIM(RTRIM(@ImagePath)), ''), ImagePath),
            SignImage = COALESCE(NULLIF(LTRIM(RTRIM(@SignImage)), ''), SignImage),
            SignImageSmall = COALESCE(NULLIF(LTRIM(RTRIM(@SignImageSmall)), ''), SignImageSmall),
            table_backups = COALESCE(NULLIF(LTRIM(RTRIM(@table_backups)), ''), table_backups),
            id_user_bak = COALESCE(NULLIF(LTRIM(RTRIM(@id_user_bak)), ''), id_user_bak),
            id_user_del_bak = COALESCE(NULLIF(LTRIM(RTRIM(@id_user_del_bak)), ''), id_user_del_bak),
            contentSignImage = COALESCE(@contentSignImage, contentSignImage),
            paraphSignImage = COALESCE(@paraphSignImage, paraphSignImage),
            paraphSignTransparentImage = COALESCE(@paraphSignTransparentImage, paraphSignTransparentImage),
            contentSignTransparentImage = COALESCE(@contentSignTransparentImage, contentSignTransparentImage),
            stampSignImage = COALESCE(@stampSignImage, stampSignImage)
          WHERE id = @existingId;
          SELECT @@ROWCOUNT AS affected, 'updated' AS action;
        END
      END
      ELSE IF LEN(LTRIM(RTRIM(ISNULL(@username, '')))) <= 3
      BEGIN
        SELECT 0 AS affected, 'skipped_invalid_username' AS action;
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
          SignImageSmall, table_backups, id_user_del_bak, contentSignImage, paraphSignImage,
          paraphSignTransparentImage, contentSignTransparentImage, stampSignImage, tb_bak
        )
        VALUES (
          @id, @password, @name, @avatar, @code_nd, @username, @email_user, @phone_number_user,
          @position, @leader, @address_user, @description, @role, @roles_by_process,
          @organization_name, @organization_code, @organization_type, @orders, @birthday, @gender,
          @identification_card, @contact_time, @parent, @wso2_user_id, @keycloak_user_id,
          @status, @author, @role_group_source_authorized, @created_at, @updated_at,
          @name_authorized, @id_user_bak, @AccountID, @FullName, @Department, @DepartmentId,
          @PhongBanID, @SimKySo1, @SimKySo2, @DepartmentManager, @IsTCT, @ImagePath, @SignImage,
          @SignImageSmall, @table_backups, @id_user_del_bak, @contentSignImage, @paraphSignImage,
          @paraphSignTransparentImage, @contentSignTransparentImage, @stampSignImage, 1
        );
        SELECT @@ROWCOUNT AS affected, 'inserted' AS action;
      END
    `;

    const oldModifiedStr = rowData.__sync_time || rowData.Modified || rowData.NgayTao;
    // ensure parsing logic handles empty cases correctly, JS new Date() does not error on empty but gives Invalid Date, so do it right:
    const old_modified =
      oldModifiedStr && !Number.isNaN(new Date(oldModifiedStr).getTime())
        ? new Date(oldModifiedStr)
        : new Date(0);

    const params = { ...mapped, old_modified };
    const result = await this.queryNewDbTx(query, params, transaction);
    const row = Array.isArray(result) && result[0] ? result[0] : result;
    if (row?.action === 'skipped_invalid_username') {
      logger.warn(
        `[upsertUserById] Skip insert user because username "${mapped.username}" has length <= 3`,
      );
    }
    return {
      action: row?.action || (row?.affected ? 'updated' : 'none'),
      affected: Number(row?.affected || 0),
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
      `,
    );
    return Number(rows?.[0]?.total || 0);
  }
}

module.exports = StreamUserMigrationModel;
