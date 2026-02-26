const sql = require('mssql');
const BaseModel = require('../../models/BaseModel');
const logger = require('../../utils/logger');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class BaseIncrementalSyncInterface extends BaseModel {
  constructor(options = {}) {
    super();
    this.modelName = options.modelName || this.constructor.name;
    this.jobBufferTable = 'sync_job_buffers';
    this.jobBufferItemTable = 'sync_job_buffer_items';
  }

  /**
   * (Abstract) Lấy danh sách bản ghi từ CSDL cũ sau `lastSyncTime`.
   * Các lớp con phải override hàm này để fetch dữ liệu từ CSDL cũ.
   * @param {string} _lastSyncTime - ISO datetime để lấy bản ghi sau thời điểm này
   * @returns {Promise<Array>} danh sách bản ghi từ CSDL cũ
   */
  // eslint-disable-next-line no-unused-vars
  async fetchListFromOldDb(_lastSyncTime) {
    throw new Error(`[${this.modelName}] fetchListFromOldDb(lastSyncTime) must be implemented`);
  }

  /**
   * (Abstract) Xử lý một bản ghi đơn từ CSDL cũ → đồng bộ vào CSDL mới.
   * Các lớp con phải override hàm này để thực hiện map/transform/insert logic.
   * @param {Object} _rowData - bản ghi đầu vào từ CSDL cũ
   * @param {{syncJobId?:string,itemIndex?:number,transaction?:Object}} [_context] - ngữ cảnh xử lý
   * @returns {Promise<Object>} kết quả xử lý
   */
  // eslint-disable-next-line no-unused-vars
  async processRowData(_rowData, _context = {}) {
    throw new Error(`[${this.modelName}] processRowData(rowData, context) must be implemented`);
  }

  /**
   * (Abstract) Đồng bộ một batch bản ghi từ CSDL cũ vào bảng `staging`.
   * Chỉ được override nếu sử dụng kiến trúc 2-stage (old → staging → new).
   * @param {Array} _rows - danh sách bản ghi từ CSDL cũ
   * @param {{syncJobId?:string,lastSyncTime?:string,transaction?:Object}} [_context]
   * @returns {Promise<{stagedCount?:number}>}
   */
  // eslint-disable-next-line no-unused-vars
  async syncOldToStaging(_rows, _context = {}) {
    throw new Error(`[${this.modelName}] syncOldToStaging(rows, context) must be implemented`);
  }

  /**
   * (Abstract) Lấy một bản ghi từ bảng `staging` để xử lý.
   * Chỉ được override nếu sử dụng kiến trúc 2-stage.
   * @param {{syncJobId?:string,lastSyncTime?:string,itemIndex?:number,transaction?:Object}} [_context]
   * @returns {Promise<Object|null>} bản ghi từ staging hoặc null nếu không còn
   */
  // eslint-disable-next-line no-unused-vars
  async fetchOneFromStaging(_context = {}) {
    throw new Error(`[${this.modelName}] fetchOneFromStaging(context) must be implemented`);
  }

  /**
   * Chuẩn hóa `lastSyncTime` sang ISO string, dùng DEFAULT_SYNC_TIME nếu rỗng.
   * @param {string|Date|null} lastSyncTime
   * @returns {string} ISO datetime string
   * @throws {Error} nếu giá trị không phải là datetime hợp lệ
   */
  normalizeLastSyncTime(lastSyncTime) {
    const parsed = new Date(lastSyncTime || DEFAULT_SYNC_TIME);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid lastSyncTime: ${lastSyncTime}`);
    }
    return parsed.toISOString();
  }

  /**
   * (Hook) Tạo bảng buffer nếu cần. Override trong lớp con nếu sử dụng staging.
   * @returns {Promise<null>}
   */
  async ensureBufferTables() {
    return null;
  }

  /**
   * Lấy trạng thái buffer của một job: total_count, processed count, status.
   * Dùng để theo dõi tiến độ đồng bộ.
   * @param {string} syncJobId
   * @returns {Promise<{sync_job_id:string,model_name:string,last_sync_time:*,total_count:number,processing_item:number,status:string}|null>}
   */
  async getBufferState(syncJobId) {
    const rows = await this.queryNewDb(
      `
      SELECT TOP 1 *
      FROM sync_jobs
      WHERE job_id = @syncJobId
      `,
      { syncJobId }
    );

    const row = rows?.[0];
    if (!row) return null;

    return {
      sync_job_id: row.job_id,
      model_name: row.model_name,
      last_sync_time: row.last_sync_time,
      total_count: Number(row.total_to_sync || 0),
      processing_item: Number(row.total_processed || 0),
      status: row.status
    };
  }

  /**
   * Trích xuất `sync_time` từ bản ghi (thử nhiều tên cột: Modified, updated_at, NgayTao, etc.).
   * Trả về fallback time nếu không tìm được hoặc giá trị không hợp lệ.
   * @param {Object} rowData - bản ghi
   * @param {string|Date} [fallbackSyncTime=DEFAULT_SYNC_TIME]
   * @returns {string} ISO datetime string
   */
  extractRowSyncTime(rowData, fallbackSyncTime = DEFAULT_SYNC_TIME) {
    const candidate =
      rowData?.Modified ||
      rowData?.modified ||
      rowData?.updated_at ||
      rowData?.UpdatedAt ||
      rowData?.NgayTao ||
      rowData?.Created ||
      rowData?.created_at ||
      rowData?.__sync_time ||
      fallbackSyncTime;

    const parsed = new Date(candidate);
    if (Number.isNaN(parsed.getTime())) {
      return fallbackSyncTime;
    }
    return parsed.toISOString();
  }

  /**
   * Kiểm tra xem mô hình này có sử dụng bảng staging (`newTableSync`) không.
   * @returns {boolean}
   */
  hasStagingTable() {
    return Boolean(this.newTableSync);
  }

  /**
   * Lấy tên đầy đủ của bảng staging (schema.table) hoặc null nếu không có staging.
   * @returns {string|null} ví dụ: `dbo.users_staging`
   */
  getStagingTableRef() {
    if (!this.hasStagingTable()) return null;
    const schema = this.newDbSchema || 'dbo';
    return `${schema}.${this.newTableSync}`;
  }

  /**
   * Kiểm tra xem job có tồn tại trong `sync_jobs` không. Throw error nếu không tìm thấy.
   * Dùng để xác thực trước khi xử lý.
   * @param {string} syncJobId
   * @param {Object} [transaction] - transaction của kết nối mới (nếu có)
   * @throws {Error} nếu job không tồn tại
   */
  async ensureSyncJobExists(syncJobId, transaction = null) {
    const rows = await this.queryNewDbTx(
      `
      SELECT TOP 1 job_id
      FROM sync_jobs
      WHERE job_id = @syncJobId
      `,
      { syncJobId },
      transaction
    );

    if (!rows?.length) {
      throw new Error(`syncJobId not found in sync_jobs: ${syncJobId}`);
    }
  }

  /**
   * Lấy danh sách bản ghi via staging table (2-stage: old → staging → new).
   * - Fetch từ CSDL cũ.
   * - Đồng bộ vào staging table qua `syncOldToStaging`.
   * - Update job status và tổng số lượng.
   * @param {string} lastSyncTime - thời gian đồng bộ lần cuối
   * @param {string} syncJobId
   * @returns {Promise<{syncJobId:string,lastSyncTime:string,totalCount:number,stagedCount:number,processingItem:number,status:string,rows:Array}>}
   */
  async getListViaStaging(lastSyncTime, syncJobId) {
    const normalizedLastSyncTime = this.normalizeLastSyncTime(lastSyncTime);
    const rows = await this.fetchListFromOldDb(normalizedLastSyncTime) || [];
    const totalCount = rows.length;
    const nowStatus = totalCount === 0 ? 'COMPLETED' : 'RUNNING';
    const transaction = new sql.Transaction(this.newPool);

    try {
      await transaction.begin();
      await this.ensureSyncJobExists(syncJobId, transaction);

      const stagingResult = await this.syncOldToStaging(rows, {
        syncJobId,
        lastSyncTime: normalizedLastSyncTime,
        transaction
      });

      await this.queryNewDbTx(
        `
        UPDATE sync_jobs
        SET
          [status] = @status,
          last_sync_time = @lastSyncTime,
          total_to_sync = @totalCount,
          total_processed = 0,
          total_success = 0,
          total_errors = 0,
          error_message = NULL,
          updated_at = SYSDATETIME(),
          heartbeat_at = SYSDATETIME(),
          ended_at = CASE WHEN @status = 'COMPLETED' THEN SYSDATETIME() ELSE NULL END
        WHERE job_id = @syncJobId
        `,
        {
          syncJobId,
          status: nowStatus,
          lastSyncTime: normalizedLastSyncTime,
          totalCount
        },
        transaction
      );

      await transaction.commit();

      return {
        syncJobId,
        lastSyncTime: normalizedLastSyncTime,
        totalCount,
        stagedCount: Number(stagingResult?.stagedCount ?? totalCount),
        processingItem: 0,
        status: nowStatus,
        rows
      };
    } catch (error) {
      try {
        await transaction.rollback();
      } catch (_) {}

      await this.queryNewDb(
        `
        UPDATE sync_jobs
        SET
          [status] = 'FAILED',
          total_errors = ISNULL(total_errors, 0) + 1,
          error_message = @errorMessage,
          updated_at = SYSDATETIME(),
          heartbeat_at = SYSDATETIME(),
          ended_at = SYSDATETIME()
        WHERE job_id = @syncJobId
        `,
        {
          syncJobId,
          errorMessage: error.message
        }
      ).catch(() => {});

      logger.error(`[${this.modelName}] getListViaStaging failed:`, error);
      throw error;
    }
  }

  /**
   * Lấy danh sách và xử lý trực tiếp (1-stage: old → new).
   * - Fetch từ CSDL cũ.
   * - Xử lý từng bản ghi tuần tự qua `processRowData`.
   * - Cập nhật job status chi tiết: processed, success, error counts.
   * @param {string} lastSyncTime
   * @param {string} syncJobId
   * @returns {Promise<{syncJobId:string,lastSyncTime:string,totalCount:number,totalProcessed:number,totalSuccess:number,totalErrors:number,status:string}>}
   */
  async getListDirect(lastSyncTime, syncJobId) {
    const normalizedLastSyncTime = this.normalizeLastSyncTime(lastSyncTime);
    const rows = await this.fetchListFromOldDb(normalizedLastSyncTime) || [];
    const totalCount = rows.length;
    const processingStatus = totalCount === 0 ? 'COMPLETED' : 'RUNNING';

    let totalProcessed = 0;
    let totalSuccess = 0;
    let totalErrors = 0;
    let latestSyncTime = normalizedLastSyncTime;
    let errorMessage = null;

    try {
      await this.ensureSyncJobExists(syncJobId);

      await this.queryNewDb(
        `
        UPDATE sync_jobs
        SET
          [status] = @status,
          last_sync_time = @lastSyncTime,
          total_to_sync = @totalCount,
          total_processed = 0,
          total_success = 0,
          total_errors = 0,
          error_message = NULL,
          updated_at = SYSDATETIME(),
          heartbeat_at = SYSDATETIME(),
          ended_at = CASE WHEN @status = 'COMPLETED' THEN SYSDATETIME() ELSE NULL END
        WHERE job_id = @syncJobId
        `,
        {
          syncJobId,
          status: processingStatus,
          lastSyncTime: normalizedLastSyncTime,
          totalCount
        }
      );

      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        latestSyncTime = this.extractRowSyncTime(row, latestSyncTime);

        const transaction = new sql.Transaction(this.newPool);
        try {
          await transaction.begin();
          await this.processRowData(row, {
            syncJobId,
            itemIndex: i,
            transaction
          });
          await transaction.commit();
          totalSuccess += 1;
        } catch (rowError) {
          totalErrors += 1;
          if (!errorMessage) errorMessage = rowError.message;

          try {
            await transaction.rollback();
          } catch (_) {}

          logger.error(
            `[${this.modelName}] process row failed syncJobId=${syncJobId}, itemIndex=${i}:`,
            rowError
          );
        }

        totalProcessed += 1;
      }

      const finalStatus = totalErrors > 0 ? 'FAILED' : 'COMPLETED';
      await this.queryNewDb(
        `
        UPDATE sync_jobs
        SET
          [status] = @status,
          last_sync_time = @lastSyncTime,
          total_to_sync = @totalCount,
          total_processed = @totalProcessed,
          total_success = @totalSuccess,
          total_errors = @totalErrors,
          error_message = @errorMessage,
          updated_at = SYSDATETIME(),
          heartbeat_at = SYSDATETIME(),
          ended_at = SYSDATETIME()
        WHERE job_id = @syncJobId
        `,
        {
          syncJobId,
          status: finalStatus,
          lastSyncTime: latestSyncTime,
          totalCount,
          totalProcessed,
          totalSuccess,
          totalErrors,
          errorMessage
        }
      );

      return {
        syncJobId,
        lastSyncTime: latestSyncTime,
        totalCount,
        totalProcessed,
        totalSuccess,
        totalErrors,
        status: finalStatus
      };
    } catch (error) {
      await this.queryNewDb(
        `
        UPDATE sync_jobs
        SET
          [status] = 'FAILED',
          total_errors = ISNULL(total_errors, 0) + 1,
          error_message = @errorMessage,
          updated_at = SYSDATETIME(),
          heartbeat_at = SYSDATETIME(),
          ended_at = SYSDATETIME()
        WHERE job_id = @syncJobId
        `,
        {
          syncJobId,
          errorMessage: error.message
        }
      ).catch(() => {});

      logger.error(`[${this.modelName}] getListDirect failed:`, error);
      throw error;
    }
  }

  /**
   * Lấy danh sách bản ghi dựa trên `lastSyncTime` và thực hiện đồng bộ.
   * Tự động chọn giữa 2-stage (`getListViaStaging`) hoặc 1-stage (`getListDirect`).
   * @param {string} lastSyncTime
   * @param {string} syncJobId
   * @returns {Promise<Object>} kết quả từ getListViaStaging hoặc getListDirect
   */
  async getList(lastSyncTime, syncJobId) {
    if (!syncJobId) {
      throw new Error('syncJobId is required');
    }

    if (this.hasStagingTable()) {
      return this.getListViaStaging(lastSyncTime, syncJobId);
    }

    return this.getListDirect(lastSyncTime, syncJobId);
  }

  /**
   * Xử lý một item từ staging table (2-stage architecture).
   * - Lock row trong `sync_jobs` để tranh thủ cập nhật.
   * - Fetch mục tiếp theo từ staging qua `fetchOneFromStaging`.
   * - Gọi `processRowData` để xử lý bản ghi.
   * - Update job: total_processed, total_success, status.
   * @param {string} syncJobId
   * @returns {Promise<{syncJobId:string,totalCount:number,processingItemBefore:number,processingItemAfter:number,processed:boolean,done:boolean,processResult?:Object}>}
   */
  async processOneViaStaging(syncJobId) {
    const transaction = new sql.Transaction(this.newPool);

    try {
      await transaction.begin();

      const jobRows = await this.queryNewDbTx(
        `
        SELECT TOP 1 *
        FROM sync_jobs WITH (UPDLOCK, ROWLOCK)
        WHERE job_id = @syncJobId
        `,
        { syncJobId },
        transaction
      );

      if (!jobRows?.length) {
        throw new Error(`syncJobId not found in sync_jobs: ${syncJobId}`);
      }

      const job = jobRows[0];
      const totalCount = Number(job.total_to_sync || 0);
      const processingItemBefore = Number(job.total_processed || 0);

      if (processingItemBefore >= totalCount) {
        await this.queryNewDbTx(
          `
          UPDATE sync_jobs
          SET
            [status] = 'COMPLETED',
            updated_at = SYSDATETIME(),
            heartbeat_at = SYSDATETIME(),
            ended_at = SYSDATETIME()
          WHERE job_id = @syncJobId
          `,
          { syncJobId },
          transaction
        );

        await transaction.commit();
        return {
          syncJobId,
          totalCount,
          processingItemBefore,
          processingItemAfter: processingItemBefore,
          processed: false,
          done: true
        };
      }

      const baselineLastSyncTime = this.normalizeLastSyncTime(job.last_sync_time || DEFAULT_SYNC_TIME);
      const item = await this.fetchOneFromStaging({
        syncJobId,
        lastSyncTime: baselineLastSyncTime,
        itemIndex: processingItemBefore,
        transaction
      });

      if (!item) {
        await this.queryNewDbTx(
          `
          UPDATE sync_jobs
          SET
            [status] = 'COMPLETED',
            updated_at = SYSDATETIME(),
            heartbeat_at = SYSDATETIME(),
            ended_at = SYSDATETIME()
          WHERE job_id = @syncJobId
          `,
          { syncJobId },
          transaction
        );

        await transaction.commit();
        return {
          syncJobId,
          totalCount,
          processingItemBefore,
          processingItemAfter: processingItemBefore,
          processed: false,
          done: true
        };
      }

      const rowData = item.rowData || item;

      const processResult = await this.processRowData(rowData, {
        syncJobId,
        itemIndex: processingItemBefore,
        transaction
      });

      const processingItemAfter = processingItemBefore + 1;
      const done = processingItemAfter >= totalCount;
      const jobStatus = done ? 'COMPLETED' : 'RUNNING';
      const latestSyncTime = done
        ? this.extractRowSyncTime(rowData, baselineLastSyncTime)
        : baselineLastSyncTime;

      await this.queryNewDbTx(
        `
        UPDATE sync_jobs
        SET
          [status] = @jobStatus,
          last_sync_time = @lastSyncTime,
          total_processed = @processingItemAfter,
          total_success = ISNULL(total_success, 0) + 1,
          updated_at = SYSDATETIME(),
          heartbeat_at = SYSDATETIME(),
          ended_at = CASE WHEN @jobStatus = 'COMPLETED' THEN SYSDATETIME() ELSE NULL END
        WHERE job_id = @syncJobId
        `,
        {
          syncJobId,
          jobStatus,
          lastSyncTime: latestSyncTime,
          processingItemAfter
        },
        transaction
      );

      await transaction.commit();

      return {
        syncJobId,
        totalCount,
        processingItemBefore,
        processingItemAfter,
        processed: true,
        done,
        processResult
      };
    } catch (error) {
      try {
        await transaction.rollback();
      } catch (_) {}

      await this.queryNewDb(
        `
        UPDATE sync_jobs
        SET
          [status] = 'FAILED',
          total_errors = ISNULL(total_errors, 0) + 1,
          error_message = @errorMessage,
          updated_at = SYSDATETIME(),
          heartbeat_at = SYSDATETIME()
        WHERE job_id = @syncJobId
        `,
        {
          syncJobId,
          errorMessage: error.message
        }
      ).catch(() => {});

      logger.error(`[${this.modelName}] processOneViaStaging failed for syncJobId=${syncJobId}:`, error);
      throw error;
    }
  }

  /**
   * Xử lý một bản ghi đơn trong job.
   * - Nếu có staging: xử lý qua `processOneViaStaging`.
   * - Nếu không: gọi lại `getList` để fetch và xử lý tiếp (1-stage).
   * @param {string} syncJobId
   * @returns {Promise<Object>} kết quả từ processOneViaStaging hoặc getList
   */
  async processOne(syncJobId) {
    if (!syncJobId) {
      throw new Error('syncJobId is required');
    }

    if (this.hasStagingTable()) {
      return this.processOneViaStaging(syncJobId);
    }

    const rows = await this.queryNewDb(
      `
      SELECT TOP 1 last_sync_time
      FROM sync_jobs
      WHERE job_id = @syncJobId
      `,
      { syncJobId }
    );

    if (!rows?.length) {
      throw new Error(`syncJobId not found in sync_jobs: ${syncJobId}`);
    }

    const lastSyncTime = rows[0].last_sync_time || DEFAULT_SYNC_TIME;
    return this.getList(lastSyncTime, syncJobId);
  }
}

module.exports = BaseIncrementalSyncInterface;
