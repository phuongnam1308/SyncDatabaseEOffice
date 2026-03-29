const StreamTgdScheduleMigrationModel = require('./StreamTgdScheduleMigrationModel');
const SyncManagerService = require('../../sync-manager/SyncManagerService');

const UNIT_TEST_MODEL_NAME = 'UNIT_TEST_STREAM_TGD_SCHEDULE_MIGRATION';
const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class StreamTgdScheduleMigrationService {
    constructor() {
        this.model = null;
    }

    async initialize() {
        if (this.model) return;
        this.model = new StreamTgdScheduleMigrationModel();
        await this.model.initialize();
    }

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

    async _buildOrReuseJob(syncJobId = null) {
        if (syncJobId) return syncJobId;
        await SyncManagerService.ensureStateLoaded();
        const created = SyncManagerService.createJob(UNIT_TEST_MODEL_NAME, { reset: false, batchSize: 1 });
        const jobId = created.jobId;
        await this._ensureJobExists(jobId);
        return jobId;
    }

    async testGetList({ lastSyncTime = DEFAULT_SYNC_TIME, syncJobId = null } = {}) {
        if (!this.model) throw new Error('Service chưa được khởi tạo');
        const jobId = await this._buildOrReuseJob(syncJobId);
        const listResult = await this.model.getList(lastSyncTime, jobId);
        const jobState = await this.model.getSyncJobState(jobId);
        return {
            syncJobId: jobId,
            lastSyncTime: listResult.lastSyncTime,
            oldCount: listResult.totalCount,
            stagedCount: Number(listResult.stagedCount || listResult.totalCount || 0),
            totalCount: Number(jobState?.total_to_sync || listResult.totalCount || 0),
            processingItem: Number(jobState?.total_processed || 0)
        };
    }

    async testProcessOne(syncJobId) {
        if (!this.model) throw new Error('Service chưa được khởi tạo');
        if (!syncJobId) throw new Error('syncJobId is required');
        return this.model.processOne(syncJobId);
    }
}

module.exports = StreamTgdScheduleMigrationService;
