// sync-outgoing.model.js
const BaseModel = require("../../../models/BaseModel");
const logger = require("../../../utils/logger");
const sql = require('mssql');
const BaseIncrementalSyncInterface = require("../../sync-manager/BaseIncrementalSyncInterface");
const MigrationHelper = require("../../helpers/MigrationHelper");

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class SyncIncomingDocumentModel extends BaseIncrementalSyncInterface {
    constructor() {
        super({ modelName: '3_incoming' });
        this.newDbName = process.env.NEW_DB_NAME;
        this.oldDbSchema = 'dbo';
        this.oldDbTable = 'VanBanDen';
        this.newDbSchema = 'dbo';
        this.newTableSync = 'incomming_documents_sync'; //Bảng trung gian lưu data raw dùng để sync dần vào bảng chính `user_clone_for_sync`
        this.newDbTable = 'incomming_documents2';
        this.helper = new MigrationHelper(this.queryNewDbTx.bind(this));

    }
    getStagingTableRef() {
        if (this.newDbName) {
            return `${this.newDbName}.${this.newDbSchema}.${this.newTableSync}`;
        }
        return `${this.newDbSchema}.${this.newTableSync}`;
    }
    /**
     * Override queryNewDbTx để hỗ trợ explicit type cho NVARCHAR(MAX) fields.
     * Giải quyết vấn đề mssql driver tự động infer NVARCHAR(4000) thay vì MAX.
     */
    async queryNewDbTx(query, params = {}, transaction = null) {
        try {
            // Ensure pool is initialized
            if (!transaction && !this.newPool) {
                throw new Error('Database pool not initialized. Call initialize() first.');
            }

            const request = transaction
                ? new sql.Request(transaction)
                : this.newPool.request();

            // Danh sách các fields cần explicit declare là NVARCHAR(MAX)
            const maxFields = ['CoQuanGui2', 'CoQuanGuiText', 'DonVi', 'abstract_note', 
                               'to_book_code', 'urgency_level', 'private_level', 'document_type',
                               'SoVanBan', 'TrichYeu', 'VanBanTraLoi', 'YKienLanhDao', 'YKienLanhDaoTCT',
                               'YKienLanhDaoVPDN', 'YKienCuaLDVPChoVanThu', 'ForwardType', 'MigrateErrMess'];

            Object.keys(params || {}).forEach(key => {
                const value = params[key];
                
                // Explicit declare NVARCHAR(MAX) cho các fields dài
                if (maxFields.includes(key)) {
                    request.input(key, sql.NVarChar(sql.MAX), value);
                }
                // Các field khác để driver tự infer
                else {
                    request.input(key, value);
                }
            });

            const result = await request.query(query);
            return result.recordset;
        } catch (error) {
            logger.error(`Lỗi query database mới: ${error.message}`);
            throw error;
        }
    }
    sanitizeColumnName(column) {
        if (!/^[A-Za-z0-9_]+$/.test(column)) {
            throw new Error(`Invalid column name from source: ${column}`);
        }
        return `[${column}]`;
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
    normalizeSyncTime(value) {
        if (!value) return DEFAULT_SYNC_TIME;
        const dateValue = new Date(value);
        if (Number.isNaN(dateValue.getTime())) return DEFAULT_SYNC_TIME;
        return dateValue.toISOString();
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
    safeNumber(value, defaultValue = 0) {
        if (value === 'NULL' || value === 'null' || value === null || value === undefined) {
            return defaultValue;
        }
        const num = Number(value);
        return Number.isNaN(num) ? defaultValue : num;
    }
    safeString(value) {
        if (value === 'NULL' || value === 'null' || value === null || value === undefined) {
            return null;
        }
        const strValue = String(value).trim();
        if (strValue === '' || strValue === 'NULL' || strValue === 'null') {
            return null;
        }
        return strValue;
    }
    /**
     * Strip HTML tags from string
     * @param {*} value - value to clean
     * @returns {string|null}
     */
    stripHtml(value) {
        const str = this.safeString(value);
        if (!str) return null;
        return str.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    /**
     * Safe string cho các field chứa số (có thể là số hoặc chuỗi)
     */
    safeStringOrNumber(value) {
        const str = this.safeString(value);
        if (!str) return null;
        // Nếu là số thuần túy, giữ nguyên
        if (/^\d+$/.test(str)) return str;
        // Nếu là format số văn bản, giữ nguyên
        return str;
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
    /**
   * Đếm số user hiện có trong bảng `user_clone_for_sync` (schema mặc định của service).
   * @returns {Promise<number>} tổng số bản ghi
   */
    async countNewIncommingDocument() {
        const rows = await this.queryNewDb(
            `
      SELECT COUNT(1) AS total
      FROM ${this.newDbSchema}.${this.newDbTable}
      `
        );
        return Number(rows?.[0]?.total || 0);
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
    /**
   * Returns SQL expression that normalizes source sync time across supported columns.
   * @returns {string}
   */
    getSyncTimeExpression() {
        return `
      COALESCE(
        TRY_CONVERT(datetime2, Modified),
        TRY_CONVERT(datetime2, Created)
      )
    `;
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

        const transaction = new sql.Transaction(this.newPool);
        await transaction.begin();

        try {
            const rowData = await this.fetchOneFromStaging({
                lastSyncTime: sourceLastSyncTime,
                lastSyncId: sourceLastSyncId,
                itemIndex,
                transaction
            });

            if (!rowData) {
                await transaction.commit();
                return {
                    syncJobId,
                    itemIndex,
                    processed: false,
                    done: true
                };
            }

            const result = await this.processRowData(rowData, { transaction });
            await transaction.commit();

            return {
                syncJobId,
                itemIndex,
                processed: true,
                done: false,
                rowId: rowData.ID || null,
                result
            };
        } catch (error) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                logger.error('[OutGoingDocumentModel.processOne] rollback failed:', rollbackError);
            }
            throw error;
        }
    }


    async fetchOneFromStaging({ lastSyncTime, lastSyncId = 0, itemIndex, transaction } = {}) {
        const rowNumber = Number(itemIndex || 0) + 1;
        const stagingTableRef = this.getStagingTableRef();
        const syncTimeExpr = this.getSyncTimeExpression();
        const query = `
      ;WITH source_rows AS (
        SELECT
          *,
          ${syncTimeExpr} AS __sync_time,
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
        if (!rowData) {
            throw new Error('rowData is required');
        }

        const backupId = String(rowData.ID || '').trim();
        if (!backupId) {
            throw new Error('Invalid document ID from staging');
        }

        const res = await this.upsertUserById(rowData, { transaction });
        const affected = Number(res?.affected || 0);

        if (affected === 0) {
            throw new Error(`Document was not inserted or updated for ID=${backupId}`);
        }

        return {
            action: res?.action || 'upsert',
            backupId,
            affected
        };
    }
    /**
  * Chèn hoặc cập nhật văn bản đến theo `document_id` trong `{newDbName}.{schema}.incomming_documents2`.
  * - Nếu tồn tại: cập nhật các trường từ VanBanDen.
  * - Nếu chưa có: chèn hàng mới.
  * @param {Object} rowData - bản ghi từ VanBanDen
  * @param {Object} [transaction] - transaction của kết nối mới (nếu có)
  * @returns {Promise<{action:string,affected:number}>}
  */
    async upsertUserById(rowDataOrBackupId, fallbackNameOrTransaction, maybeTransaction) {
        const isRowDataInput = rowDataOrBackupId && typeof rowDataOrBackupId === 'object' && !Array.isArray(rowDataOrBackupId);
        const rowData = isRowDataInput
            ? rowDataOrBackupId
            : {
                ID: rowDataOrBackupId,
                TrichYeu: String(fallbackNameOrTransaction || '')
            };
        const transaction = isRowDataInput ? fallbackNameOrTransaction : maybeTransaction;

        const mapped = this.mapRecordForUpsert(rowData);
        if (!mapped.document_id) throw new Error('document_id is required');

        const tableRef = this.newDbName
            ? `${this.newDbName}.${this.newDbSchema}.${this.newDbTable}`
            : `${this.newDbSchema}.${this.newDbTable}`;

        const query = `
      IF EXISTS (SELECT 1 FROM ${tableRef} WHERE id_incoming_bak = @id_incoming_bak)
      BEGIN
        UPDATE ${tableRef}
        SET to_book_code = @to_book_code,
            to_book = @to_book,
            to_book_date = @to_book_date,
            abstract_note = @abstract_note,
            receive_date = @receive_date,
            urgency_level = @urgency_level,
            private_level = @private_level,
            deadline_reply = @deadline_reply,
            document_type = @document_type,
            status = @status,
            status_code = @status_code,
            book_document_id = @book_document_id,
            CoQuanGui2 = @CoQuanGui2,
            CoQuanGuiText = @CoQuanGuiText,
            DonVi = @DonVi,
            IsLibrary = @IsLibrary,
            SoBan = @SoBan,
            SoTrang = @SoTrang,
            TrangThai = @TrangThai,
            SoVanBan = @SoVanBan,
            TrichYeu = @TrichYeu,
            ItemVBDTCT = @ItemVBDTCT,
            ItemVBPH = @ItemVBPH,
            ItemVBPHOld = @ItemVBPHOld,
            BanLanhDao = @BanLanhDao,
            LanhDaoTCT = @LanhDaoTCT,
            LanhDaoTCTDaXuLy = @LanhDaoTCTDaXuLy,
            LanhDaoTCTDeBiet = @LanhDaoTCTDeBiet,
            LanhDaoVPDN = @LanhDaoVPDN,
            LinhVuc = @LinhVuc,
            VanBanTraLoi = @VanBanTraLoi,
            ChenSo = @ChenSo,
            YKienLanhDao = @YKienLanhDao,
            YKienLanhDaoTCT = @YKienLanhDaoTCT,
            YKienLanhDaoVPDN = @YKienLanhDaoVPDN,
            YKienCuaLDVPChoVanThu = @YKienCuaLDVPChoVanThu,
            ForwardType = @ForwardType,
            ModuleId = @ModuleId,
            SiteName = @SiteName,
            ListName = @ListName,
            ItemId = @ItemId,
            MigrateFlg = @MigrateFlg,
            YearMonth = @YearMonth,
            MigrateErrFlg = @MigrateErrFlg,
            MigrateErrMess = @MigrateErrMess,
            ModifiedBy = @ModifiedBy,
            CreatedBy = @CreatedBy,
            DGPId = @DGPId,
            updated_at = @updated_at
        WHERE id_incoming_bak = @id_incoming_bak;
        SELECT @@ROWCOUNT AS affected, 'updated' AS action;
      END
      ELSE
      BEGIN
        INSERT INTO ${tableRef} (
          document_id, id_incoming_bak, to_book_code, to_book, to_book_date,
          abstract_note, receive_date, urgency_level, private_level, deadline_reply,
          document_type, status, status_code, book_document_id,
          CoQuanGui2, CoQuanGuiText, DonVi, IsLibrary, SoBan, SoTrang, TrangThai,
          SoVanBan, TrichYeu, ItemVBDTCT, ItemVBPH, ItemVBPHOld, BanLanhDao,
          LanhDaoTCT, LanhDaoTCTDaXuLy, LanhDaoTCTDeBiet, LanhDaoVPDN, LinhVuc,
          VanBanTraLoi, ChenSo, YKienLanhDao, YKienLanhDaoTCT, YKienLanhDaoVPDN,
          YKienCuaLDVPChoVanThu, ForwardType, ModuleId, SiteName, ListName, ItemId,
          MigrateFlg, YearMonth, MigrateErrFlg, MigrateErrMess, ModifiedBy, CreatedBy,
          DGPId, created_at, updated_at
        )
        VALUES (
          @document_id, @id_incoming_bak, @to_book_code, @to_book, @to_book_date,
          @abstract_note, @receive_date, @urgency_level, @private_level, @deadline_reply,
          @document_type, @status, @status_code, @book_document_id,
          @CoQuanGui2, @CoQuanGuiText, @DonVi, @IsLibrary, @SoBan, @SoTrang, @TrangThai,
          @SoVanBan, @TrichYeu, @ItemVBDTCT, @ItemVBPH, @ItemVBPHOld, @BanLanhDao,
          @LanhDaoTCT, @LanhDaoTCTDaXuLy, @LanhDaoTCTDeBiet, @LanhDaoVPDN, @LinhVuc,
          @VanBanTraLoi, @ChenSo, @YKienLanhDao, @YKienLanhDaoTCT, @YKienLanhDaoVPDN,
          @YKienCuaLDVPChoVanThu, @ForwardType, @ModuleId, @SiteName, @ListName, @ItemId,
          @MigrateFlg, @YearMonth, @MigrateErrFlg, @MigrateErrMess, @ModifiedBy, @CreatedBy,
          @DGPId, @created_at, @updated_at
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

    async mapRecordForUpsert(oldRecord) {
        const uuid = require('uuid');

        let abstractNote = this.safeString(oldRecord.TrichYeu);;
        let toBook = this.safeString(oldRecord.SoVanBan);
        let senderUnit = await this.helper.mapSenderUnitId(oldRecord.DonVi);
        let urgencyLevel = await this.helper.processUrgencyLevel(oldRecord.DoKhan);
        let privateLevel = await this.helper.processPrivateLevel(oldRecord.DoMat);
        let drafter = await this.helper.mapUserName(
            oldRecord.CreatedBy || oldRecord.NguoiSoanThaoText
        ); // không có trong db mình
        let bookDocumentId = await this.helper.mapBookDocument(
            oldRecord.SoVanBan || oldRecord.SoVanBanText,
            { drafter, senderUnit, privateLevel}
        );
        const documentType = await this.helper.processDocumentType(
            oldRecord.LoaiVanBan || oldRecord.LoaiBanHanh
        );
        
        if (!abstractNote) {
            throw new Error('abstract_note (TrichYeu) is required');
        }

        return {
            document_id: uuid.v4().toUpperCase(),
            id_incoming_bak: this.safeStringOrNumber(oldRecord.ID),
            to_book_code: this.safeString(oldRecord.TrangThai), // TrangThai chứa số đến thực tế
            to_book: toBook,
            to_book_date: this.safeDate(oldRecord.NgayTrenVB),
            abstract_note: abstractNote,
            receive_date: this.safeDate(oldRecord.NgayDen),
            urgency_level: this.stripHtml(oldRecord.DoKhan), // Loại bỏ HTML
            private_level: this.stripHtml(oldRecord.DoMat), // Loại bỏ HTML
            deadline_reply: this.safeDate(oldRecord.ThoiHanGQ),
            document_type: this.safeString(oldRecord.LoaiVanBan),
            status: 1,
            status_code: '100',
            book_document_id: null, // Sẽ được update sau
            CoQuanGui2: this.safeString(oldRecord.CoQuanGui2),
            CoQuanGuiText: this.safeString(oldRecord.CoQuanGuiText),
            DonVi: this.safeString(oldRecord.DonVi),
            IsLibrary: this.parseBit(oldRecord.IsLibrary),
            SoBan: this.safeNumber(oldRecord.SoBan, 0),
            SoTrang: this.safeNumber(oldRecord.SoTrang, 0),
            TrangThai: this.safeString(oldRecord.LanhDaoVPDN), // Status text từ LanhDaoVPDN
            // Các field bổ sung từ DB cũ
            SoVanBan: this.safeString(oldRecord.SoVanBan),
            TrichYeu: this.safeString(oldRecord.TrichYeu),
            ItemVBDTCT: this.safeString(oldRecord.ItemVBDTCT),
            ItemVBPH: this.safeString(oldRecord.ItemVBPH),
            ItemVBPHOld: this.safeString(oldRecord.ItemVBPHOld),
            BanLanhDao: this.safeString(oldRecord.BanLanhDao),
            LanhDaoTCT: this.safeString(oldRecord.LanhDaoTCT),
            LanhDaoTCTDaXuLy: this.safeString(oldRecord.LanhDaoTCTDaXuLy),
            LanhDaoTCTDeBiet: this.safeString(oldRecord.LanhDaoTCTDeBiet),
            LanhDaoVPDN: this.safeString(oldRecord.LanhDaoVPDN),
            LinhVuc: this.safeString(oldRecord.LinhVuc),
            VanBanTraLoi: this.safeString(oldRecord.VanBanTraLoi),
            ChenSo: this.safeString(oldRecord.ChenSo),
            YKienLanhDao: this.safeString(oldRecord.YKienLanhDao),
            YKienLanhDaoTCT: this.safeString(oldRecord.YKienLanhDaoTCT),
            YKienLanhDaoVPDN: this.safeString(oldRecord.YKienLanhDaoVPDN),
            YKienCuaLDVPChoVanThu: this.safeString(oldRecord.YKienCuaLDVPChoVanThu),
            ForwardType: this.safeString(oldRecord.ForwardType),
            ModuleId: this.safeNumber(oldRecord.ModuleId, null),
            SiteName: this.safeString(oldRecord.SiteName),
            ListName: this.safeString(oldRecord.ListName),
            ItemId: this.safeNumber(oldRecord.ItemId, null),
            MigrateFlg: this.safeNumber(oldRecord.MigrateFlg, null),
            YearMonth: this.safeString(oldRecord.YearMonth),
            MigrateErrFlg: this.safeNumber(oldRecord.MigrateErrFlg, null),
            MigrateErrMess: this.safeString(oldRecord.MigrateErrMess),
            ModifiedBy: this.safeString(oldRecord.ModifiedBy),
            CreatedBy: this.safeString(oldRecord.CreatedBy),
            DGPId: this.safeNumber(oldRecord.DGPId, null),
            created_at: this.safeDate(oldRecord.Created) || new Date(),
            updated_at: this.safeDate(oldRecord.Modified) || new Date()
        };
    }

    parseGender(value) {
        const genderStr = String(value || '').trim();
        if (genderStr === '1') return 'nam';
        if (genderStr === '0') return 'nu';
        return null;
    }
}
module.exports = SyncIncomingDocumentModel;