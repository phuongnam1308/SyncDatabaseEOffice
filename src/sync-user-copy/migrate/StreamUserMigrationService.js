const StreamUserMigrationModel = require('./StreamUserMigrationModel');
const SyncManagerService = require('../../sync-manager/SyncManagerService');

const UNIT_TEST_MODEL_NAME = 'UNIT_TEST_STREAM_USER_COPY_MIGRATION111';
const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class StreamUserMigrationService {
  constructor() {
    this.model = null;
  }

  /**
   * Khởi tạo service: tạo instance của model và gọi `initialize` trên model.
   * Gọi nhiều lần an toàn (idempotent).
   */
  async initialize() {
    if (this.model) return;
    this.model = new StreamUserMigrationModel();
    await this.model.initialize();
  }

  /**
   * Kiểm tra trong bảng `sync_jobs` xem job với `syncJobId` đã tồn tại chưa.
   * Dùng để đảm bảo job được tạo bởi `SyncManagerService.createJob` đã được persist.
   * Trả về true nếu tồn tại, false nếu sau nhiều lần retry vẫn không thấy.
   * @param {string} syncJobId
   * @returns {Promise<boolean>}
   */
  async _ensureJobExists(syncJobId) {
    let retries = 10;
    while (retries > 0) {
      const rows = await this.model.queryNewDb(
        'SELECT TOP 1 job_id FROM sync_jobs WHERE job_id = @syncJobId',
        { syncJobId }
      );
      if (Array.isArray(rows) && rows.length > 0) return true;
      retries -= 1;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return false;
  }

  /**
   * Nếu `syncJobId` được truyền thì reuse, nếu không sẽ tạo một job tạm (UNIT_TEST_MODEL_NAME)
   * và chờ tới khi job đó xuất hiện trong bảng `sync_jobs` rồi trả về jobId.
   * @param {string|null} syncJobId
   * @returns {Promise<string>} jobId
   */
  async _buildOrReuseJob(syncJobId = null) {
    if (syncJobId) return syncJobId;

    await SyncManagerService.ensureStateLoaded();
    const created = SyncManagerService.createJob(UNIT_TEST_MODEL_NAME, {
      reset: false,
      batchSize: 1
    });
    const jobId = created.jobId;

    await this._ensureJobExists(jobId);
    return jobId;
  }

  /**
   * Dành cho unit-test / debug: lấy danh sách user cần sync theo `lastSyncTime`.
   * - Tạo (hoặc reuse) jobId để model stage dữ liệu raw từ DB cũ sang bảng trung gian.
   * - Trả về mảng dữ liệu tìm được và thông tin cần thiết để bước sau sync sang bảng chính.
   * @param {{lastSyncTime?:string,syncJobId?:string}} opts
   * @returns {Promise<Object>} thông tin kết quả kiểm tra
   */
  async testGetList({ lastSyncTime = DEFAULT_SYNC_TIME, syncJobId = null } = {}) {
    if (!this.model) {
      throw new Error('Service chưa được khởi tạo');
    }

    const jobId = await this._buildOrReuseJob(syncJobId);
    const listResult = await this.model.getList(lastSyncTime, jobId);
    const jobState = await this.model.getSyncJobState(jobId);
    const newCount = await this.model.countNewUsers();
    // const foundRows = Array.isArray(listResult.rows) ? listResult.rows : [];

    return {
      syncJobId: jobId,
      lastSyncTime: listResult.lastSyncTime,
      oldCount: listResult.totalCount,
      stagedCount: Number(listResult.stagedCount || listResult.totalCount || 0),
      newCount,
      totalCount: Number(jobState?.total_to_sync || listResult.totalCount || 0),
      processingItem: Number(jobState?.total_processed || 0),
      isCountMatch: Number(jobState?.total_to_sync || listResult.totalCount || 0) === Number(listResult.totalCount || 0),
      // foundRows
    };
  }

  /**
   * Dành cho unit-test / debug: xử lý một mục raw trong bảng trung gian của `syncJobId`.
   * Trả về kết quả từ `model.processOne`.
   * @param {string} syncJobId
   * @returns {Promise<Object>}
   */
  async testProcessOne(syncJobId) {
    if (!this.model) {
      throw new Error('Service chưa được khởi tạo');
    }
    if (!syncJobId) {
      throw new Error('syncJobId is required');
    }
    return this.model.processOne(syncJobId);
  }
}

module.exports = StreamUserMigrationService;
