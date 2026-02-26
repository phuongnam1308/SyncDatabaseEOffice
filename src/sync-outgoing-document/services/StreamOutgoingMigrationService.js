const StreamOutgoingIncrementalModel = require('./StreamOutgoingIncrementalModel');
const SyncManagerService = require('../../sync-manager/SyncManagerService');

const UNIT_TEST_MODEL_NAME = 'UNIT_TEST_STREAM_OUTGOING_INCREMENTAL';

class StreamOutgoingMigrationService {
  constructor() {
    this.model = null;
  }

  async initialize() {
    if (this.model) return;
    this.model = new StreamOutgoingIncrementalModel();
    await this.model.initialize();
  }

  async _buildOrReuseJob(syncJobId = null) {
    if (syncJobId) return syncJobId;

    const created = SyncManagerService.createJob(UNIT_TEST_MODEL_NAME, {
      reset: false,
      batchSize: 1
    });

    return created.jobId;
  }

  async testGetList({ lastSyncTime, syncJobId }) {
    if (!this.model) throw new Error('Service chưa initialize');

    const jobId = await this._buildOrReuseJob(syncJobId);

    const listResult = await this.model.getList(lastSyncTime, jobId);
    const bufferState = await this.model.getBufferState(jobId);

    return {
      syncJobId: jobId,
      totalCount: listResult.totalCount,
      stagedCount: listResult.stagedCount,
      processingItem: bufferState?.processing_item || 0,
      status: bufferState?.status
    };
  }

  async testProcessOne(syncJobId) {
    if (!this.model) throw new Error('Service chưa initialize');
    if (!syncJobId) throw new Error('syncJobId is required');

    return this.model.processOne(syncJobId);
  }
}

module.exports = StreamOutgoingMigrationService;