const StreamDepartmentMigrationModel = require('./StreamDepartmentMigrationModel');
const SyncManagerService = require('../../sync-manager/SyncManagerService');

const UNIT_TEST_MODEL_NAME = 'UNIT_TEST_STREAM_DEPARTMENT_MIGRATION';
const DEFAULT_SYNC_TIME    = '1970-01-01T00:00:00.000Z';

class StreamDepartmentMigrationService {
  constructor() {
    this.model = null;
  }

  /**
   * Khởi tạo model (idempotent).
   */
  async initialize() {
    if (this.model) return;
    this.model = new StreamDepartmentMigrationModel();
    await this.model.initialize();
  }

  /**
   * Chờ đến khi job được persist vào bảng `sync_jobs`.
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
   * Tái sử dụng `syncJobId` nếu được truyền, hoặc tạo job tạm để unit-test.
   * @param {string|null} syncJobId
   * @returns {Promise<string>}
   */
  async _buildOrReuseJob(syncJobId = null) {
    if (syncJobId) return syncJobId;

    await SyncManagerService.ensureStateLoaded();
    const created = SyncManagerService.createJob(UNIT_TEST_MODEL_NAME, {
      reset:     false,
      batchSize: 1
    });
    const jobId = created.jobId;
    await this._ensureJobExists(jobId);
    return jobId;
  }

  /**
   * Unit-test / debug: lấy danh sách phòng ban cần sync.
   * @param {{lastSyncTime?:string, syncJobId?:string}} opts
   */
  async testGetList({ lastSyncTime = DEFAULT_SYNC_TIME, syncJobId = null } = {}) {
    if (!this.model) throw new Error('Service chưa được khởi tạo');

    const jobId      = await this._buildOrReuseJob(syncJobId);
    const listResult = await this.model.getList(lastSyncTime, jobId);
    const jobState   = await this.model.getSyncJobState(jobId);
    const newCount   = await this.model.countNewDepts();

    return {
      syncJobId:       jobId,
      lastSyncTime:    listResult.lastSyncTime,
      oldCount:        listResult.totalCount,
      stagedCount:     Number(listResult.stagedCount || listResult.totalCount || 0),
      newCount,
      totalCount:      Number(jobState?.total_to_sync || listResult.totalCount || 0),
      processingItem:  Number(jobState?.total_processed || 0),
      isCountMatch:
        Number(jobState?.total_to_sync || listResult.totalCount || 0) ===
        Number(listResult.totalCount || 0)
    };
  }

  /**
   * Unit-test / debug: xử lý một mục trong staging.
   * @param {string} syncJobId
   */
  async testProcessOne(syncJobId) {
    if (!this.model)  throw new Error('Service chưa được khởi tạo');
    if (!syncJobId)   throw new Error('syncJobId is required');
    return this.model.processOne(syncJobId);
  }
}

module.exports = StreamDepartmentMigrationService;