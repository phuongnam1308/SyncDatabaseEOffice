const StreamDepartmentMigrationModel = require('./StreamDepartmentMigrationModel');
const SyncManagerService = require('../../sync-manager/SyncManagerService');

const UNIT_TEST_MODEL_NAME = 'UNIT_TEST_STREAM_DEPARTMENT_MIGRATION111';
const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

/**
 * Service for department migration.
 */
class StreamDepartmentMigrationService {
  constructor() {
    this.model = null;
  }

  /**
   * Initialize service: create model instance and call initialize.
   */
  async initialize() {
    if (this.model) return;
    this.model = new StreamDepartmentMigrationModel();
    await this.model.initialize();
  }

  /**
   * Ensure sync job exists in sync_jobs table (retry up to 10 times).
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
   * Reuse or create a temporary job.
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
   * Test getList: fetch and stage departments.
   */
  async testGetList({ lastSyncTime = DEFAULT_SYNC_TIME, syncJobId = null } = {}) {
    if (!this.model) {
      throw new Error('Service not initialized');
    }

    const jobId = await this._buildOrReuseJob(syncJobId);
    const listResult = await this.model.getList(lastSyncTime, jobId);
    const jobState = await this.model.getSyncJobState(jobId);
    const newCount = 0; // TODO: implement count from organization_units

    return {
      syncJobId: jobId,
      lastSyncTime: listResult.lastSyncTime,
      oldCount: listResult.totalCount,
      stagedCount: Number(listResult.stagedCount || listResult.totalCount || 0),
      newCount,
      totalCount: Number(jobState?.total_to_sync || listResult.totalCount || 0),
      processingItem: Number(jobState?.total_processed || 0),
      isCountMatch: Number(jobState?.total_to_sync || listResult.totalCount || 0) === Number(listResult.totalCount || 0)
    };
  }

  /**
   * Test processOne: process one department record.
   */
  async testProcessOne(syncJobId) {
    if (!this.model) {
      throw new Error('Service not initialized');
    }
    if (!syncJobId) {
      throw new Error('syncJobId is required');
    }
    return this.model.processOne(syncJobId);
  }
}

module.exports = StreamDepartmentMigrationService;
