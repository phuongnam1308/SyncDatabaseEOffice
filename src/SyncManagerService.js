const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const STATE_FILE = path.join(__dirname, '../logs/sync_state_src.json');
const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';
const RUNNING_STATUSES = new Set(['RUNNING', 'PAUSE_REQUESTED', 'RESUMING']);
const INTERRUPTED_STATUSES = new Set(['RUNNING', 'PAUSE_REQUESTED', 'RESUMING']);

class SyncManagerService {
  constructor() {
    this.registry = new Map();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '100', 10);
    this.activeJobPromises = new Map();
    this.state = this.normalizeState(this.loadRawState());
    this.recoverInterruptedJobs();
    this.setupShutdownHandlers();
  }

  ensureStateDir() {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  loadRawState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      }
    } catch (error) {
      logger.error('[SyncManagerService] Cannot read state file:', error);
    }
    return null;
  }

  normalizeState(raw) {
    const base = {
      models: {},
      jobs: {},
      syncLogs: {}
    };

    if (!raw) return base;
    if (raw.models || raw.jobs || raw.syncLogs) {
      return {
        models: raw.models || {},
        jobs: raw.jobs || {},
        syncLogs: raw.syncLogs || {}
      };
    }

    // Backward compatibility with old shape: { [modelName]: modelState }
    return {
      models: raw,
      jobs: {},
      syncLogs: {}
    };
  }

  saveState() {
    try {
      this.ensureStateDir();
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
    } catch (error) {
      logger.error('[SyncManagerService] Cannot save state file:', error);
    }
  }

  now() {
    return new Date().toISOString();
  }

  generateJobId(modelName) {
    const nonce = Math.random().toString(36).slice(2, 8);
    return `${modelName}-${Date.now()}-${nonce}`;
  }

  isModelBusy(modelState) {
    return modelState && RUNNING_STATUSES.has(modelState.status);
  }

  get isRunning() {
    return Object.values(this.state.models).some((model) => RUNNING_STATUSES.has(model.status));
  }

  setupShutdownHandlers() {
    const markInterrupted = () => {
      try {
        let changed = false;
        const now = this.now();
        for (const job of Object.values(this.state.jobs)) {
          if (INTERRUPTED_STATUSES.has(job.status)) {
            this.markJobAsCrashed(job, 'Application is shutting down while job is running', now);
            changed = true;
          }
        }
        if (changed) this.saveState();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[SyncManagerService] Failed to persist crash state:', error);
      }
    };

    process.on('SIGINT', () => {
      markInterrupted();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      markInterrupted();
      process.exit(0);
    });
  }

  recoverInterruptedJobs() {
    const now = this.now();
    let changed = false;

    for (const job of Object.values(this.state.jobs)) {
      if (INTERRUPTED_STATUSES.has(job.status)) {
        this.markJobAsCrashed(job, 'Application restarted while job was running', now);
        changed = true;
      }
    }

    if (changed) {
      this.saveState();
      logger.warn('[SyncManagerService] Recovered interrupted jobs and marked them as CRASHED');
    }
  }

  markJobAsCrashed(job, reason, at = this.now()) {
    job.status = 'CRASHED';
    job.error = reason;
    job.updatedAt = at;
    job.endedAt = at;
    job.heartbeatAt = at;

    const modelState = this.state.models[job.modelName];
    if (modelState) {
      modelState.status = 'CRASHED';
      modelState.error = reason;
      modelState.activeJobId = null;
      if (job.lastSyncTime) modelState.lastSyncTime = job.lastSyncTime;
      if (job.lastSyncId !== undefined) modelState.lastSyncId = job.lastSyncId;
    }

    this.updateSyncLogFromJob(job);
  }

  defaultModelState() {
    return {
      lastSyncTime: null,
      lastSyncId: 0,
      totalSynced: 0,
      status: 'IDLE',
      lastRun: null,
      activeJobId: null,
      error: null
    };
  }

  getModelState(modelName) {
    if (!this.state.models[modelName]) {
      this.state.models[modelName] = this.defaultModelState();
    }
    return this.state.models[modelName];
  }

  /**
   * @param {string} name
   * @param {(lastUpdatedAt: string, limit: number, offset: number, cursor?: Object) => Promise<Array>} fetchFn
   * @param {(record: any, context?: Object) => Promise<void>} processFn
   */
  register(name, fetchFn, processFn) {
    this.registry.set(name, { fetchFn, processFn });
    this.getModelState(name);
    this.saveState();
  }

  createJob(modelName, options = {}) {
    const modelState = this.getModelState(modelName);
    const now = this.now();
    const reset = Boolean(options.reset);

    if (reset) {
      modelState.lastSyncTime = null;
      modelState.lastSyncId = 0;
      modelState.totalSynced = 0;
    }

    const jobId = this.generateJobId(modelName);
    const job = {
      jobId,
      modelName,
      status: 'RUNNING',
      startedAt: now,
      updatedAt: now,
      endedAt: null,
      heartbeatAt: now,
      pauseRequested: false,
      reset,
      batchSize: parseInt(options.batchSize || this.batchSize, 10),
      lastSyncTime: modelState.lastSyncTime || DEFAULT_SYNC_TIME,
      lastSyncId: modelState.lastSyncId || 0,
      totalProcessed: 0,
      totalSuccess: 0,
      totalErrors: 0,
      error: null,
      errorLog: []
    };

    this.state.jobs[jobId] = job;
    this.state.syncLogs[jobId] = {
      jobId,
      modelName,
      status: job.status,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      endedAt: job.endedAt,
      lastSyncTime: job.lastSyncTime,
      lastSyncId: job.lastSyncId,
      totalProcessed: 0,
      totalSuccess: 0,
      totalErrors: 0,
      error: null
    };

    modelState.status = 'RUNNING';
    modelState.error = null;
    modelState.lastRun = now;
    modelState.activeJobId = jobId;

    this.saveState();
    return job;
  }

  updateSyncLogFromJob(job) {
    this.state.syncLogs[job.jobId] = {
      jobId: job.jobId,
      modelName: job.modelName,
      status: job.status,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      endedAt: job.endedAt,
      heartbeatAt: job.heartbeatAt,
      lastSyncTime: job.lastSyncTime,
      lastSyncId: job.lastSyncId,
      totalProcessed: job.totalProcessed,
      totalSuccess: job.totalSuccess,
      totalErrors: job.totalErrors,
      error: job.error
    };
  }

  pushJobError(job, record, error) {
    job.totalErrors += 1;
    job.error = error.message;
    job.errorLog.push({
      at: this.now(),
      recordId: this.extractRecordId(record),
      message: error.message
    });

    if (job.errorLog.length > 200) {
      job.errorLog = job.errorLog.slice(-200);
    }
  }

  extractRecordTime(record) {
    return record.updated_at || record.UpdatedAt || record.ModifiedDate || record.__sync_time || null;
  }

  extractRecordId(record) {
    const raw = record.__sync_id || record.id || record.ID || record.document_id || 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  compareCursor(aTime, aId, bTime, bId) {
    const ta = new Date(aTime || DEFAULT_SYNC_TIME).getTime();
    const tb = new Date(bTime || DEFAULT_SYNC_TIME).getTime();

    if (ta > tb) return 1;
    if (ta < tb) return -1;
    if ((aId || 0) > (bId || 0)) return 1;
    if ((aId || 0) < (bId || 0)) return -1;
    return 0;
  }

  async start(reset = false) {
    for (const modelName of this.registry.keys()) {
      const started = this.startModel(modelName, { reset });
      await this.waitForJobCompletion(started.jobId);
    }
  }

  startModel(modelName, options = {}) {
    if (!this.registry.has(modelName)) {
      throw new Error(`Model ${modelName} is not registered`);
    }

    const modelState = this.getModelState(modelName);
    if (this.isModelBusy(modelState)) {
      throw new Error(`Model ${modelName} is already running`);
    }
    if (modelState.status === 'PAUSED' && modelState.activeJobId) {
      throw new Error(`Model ${modelName} is paused. Resume the paused job first.`);
    }

    const job = this.createJob(modelName, options);
    const runPromise = this.runJob(job.jobId).finally(() => {
      this.activeJobPromises.delete(job.jobId);
    });
    this.activeJobPromises.set(job.jobId, runPromise);

    return {
      jobId: job.jobId,
      modelName: job.modelName,
      status: job.status
    };
  }

  async waitForJobCompletion(jobId) {
    const running = this.activeJobPromises.get(jobId);
    if (running) await running;
  }

  pauseJob(jobId) {
    const job = this.state.jobs[jobId];
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (!RUNNING_STATUSES.has(job.status)) {
      throw new Error(`Job ${jobId} is not running`);
    }

    job.pauseRequested = true;
    job.status = 'PAUSE_REQUESTED';
    job.updatedAt = this.now();
    job.heartbeatAt = job.updatedAt;

    const modelState = this.getModelState(job.modelName);
    modelState.status = 'PAUSE_REQUESTED';

    this.updateSyncLogFromJob(job);
    this.saveState();
    return job;
  }

  resumeJob(jobId) {
    const job = this.state.jobs[jobId];
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (job.status !== 'PAUSED') {
      throw new Error(`Job ${jobId} is not paused`);
    }

    const modelState = this.getModelState(job.modelName);
    if (this.isModelBusy(modelState)) {
      throw new Error(`Model ${job.modelName} is already running`);
    }

    job.pauseRequested = false;
    job.status = 'RESUMING';
    job.updatedAt = this.now();
    job.heartbeatAt = job.updatedAt;
    job.endedAt = null;

    modelState.status = 'RESUMING';
    modelState.error = null;
    modelState.activeJobId = job.jobId;

    this.updateSyncLogFromJob(job);
    this.saveState();

    const runPromise = this.runJob(job.jobId).finally(() => {
      this.activeJobPromises.delete(job.jobId);
    });
    this.activeJobPromises.set(job.jobId, runPromise);

    return {
      jobId: job.jobId,
      modelName: job.modelName,
      status: job.status
    };
  }

  getJob(jobId) {
    return this.state.jobs[jobId] || null;
  }

  async runJob(jobId) {
    const job = this.state.jobs[jobId];
    if (!job) return;

    const handlers = this.registry.get(job.modelName);
    if (!handlers) {
      this.failJob(job, new Error(`Model ${job.modelName} has no registered handlers`), 'FAILED');
      return;
    }

    const modelState = this.getModelState(job.modelName);

    if (job.status === 'RESUMING') {
      job.status = 'RUNNING';
      modelState.status = 'RUNNING';
    }

    let cursorTime = job.lastSyncTime || modelState.lastSyncTime || DEFAULT_SYNC_TIME;
    let cursorId = Number(job.lastSyncId || modelState.lastSyncId || 0);

    try {
      while (true) {
        if (job.pauseRequested) {
          this.markJobPaused(job);
          return;
        }

        const now = this.now();
        job.updatedAt = now;
        job.heartbeatAt = now;
        this.updateSyncLogFromJob(job);
        this.saveState();

        const records = await handlers.fetchFn(cursorTime, job.batchSize, 0, {
          modelName: job.modelName,
          jobId: job.jobId,
          lastSyncTime: cursorTime,
          lastSyncId: cursorId
        });

        if (!records || records.length === 0) {
          this.completeJob(job);
          return;
        }

        let batchSuccess = 0;

        for (const record of records) {
          try {
            await handlers.processFn(record, {
              modelName: job.modelName,
              jobId: job.jobId
            });

            const recordTime = this.extractRecordTime(record);
            const recordId = this.extractRecordId(record);
            if (recordTime && this.compareCursor(recordTime, recordId, cursorTime, cursorId) > 0) {
              cursorTime = recordTime;
              cursorId = recordId;
            }

            batchSuccess += 1;
          } catch (recordError) {
            this.pushJobError(job, record, recordError);
          }
        }

        job.totalProcessed += records.length;
        job.totalSuccess += batchSuccess;
        job.lastSyncTime = cursorTime;
        job.lastSyncId = cursorId;

        modelState.lastSyncTime = cursorTime;
        modelState.lastSyncId = cursorId;
        modelState.totalSynced += batchSuccess;
        modelState.error = job.error;

        const batchNow = this.now();
        job.updatedAt = batchNow;
        job.heartbeatAt = batchNow;
        this.updateSyncLogFromJob(job);
        this.saveState();

        if (job.pauseRequested) {
          this.markJobPaused(job);
          return;
        }

        if (records.length < job.batchSize) {
          this.completeJob(job);
          return;
        }
      }
    } catch (error) {
      this.failJob(job, error, 'FAILED');
    }
  }

  markJobPaused(job) {
    const now = this.now();
    const modelState = this.getModelState(job.modelName);

    job.status = 'PAUSED';
    job.updatedAt = now;
    job.heartbeatAt = now;
    job.endedAt = now;

    modelState.status = 'PAUSED';
    modelState.error = null;
    modelState.activeJobId = job.jobId;
    if (job.lastSyncTime) modelState.lastSyncTime = job.lastSyncTime;
    if (job.lastSyncId !== undefined) modelState.lastSyncId = job.lastSyncId;

    this.updateSyncLogFromJob(job);
    this.saveState();
  }

  completeJob(job) {
    const now = this.now();
    const modelState = this.getModelState(job.modelName);

    job.status = 'COMPLETED';
    job.error = null;
    job.updatedAt = now;
    job.heartbeatAt = now;
    job.endedAt = now;

    modelState.status = 'COMPLETED';
    modelState.error = null;
    modelState.activeJobId = null;
    if (job.lastSyncTime) modelState.lastSyncTime = job.lastSyncTime;
    if (job.lastSyncId !== undefined) modelState.lastSyncId = job.lastSyncId;

    this.updateSyncLogFromJob(job);
    this.saveState();
  }

  failJob(job, error, status = 'FAILED') {
    const now = this.now();
    const modelState = this.getModelState(job.modelName);

    job.status = status;
    job.error = error.message;
    job.updatedAt = now;
    job.heartbeatAt = now;
    job.endedAt = now;

    modelState.status = status;
    modelState.error = error.message;
    modelState.activeJobId = null;
    if (job.lastSyncTime) modelState.lastSyncTime = job.lastSyncTime;
    if (job.lastSyncId !== undefined) modelState.lastSyncId = job.lastSyncId;

    this.updateSyncLogFromJob(job);
    this.saveState();
  }

  getDashboardData() {
    return {
      isRunning: this.isRunning,
      entities: this.state.models,
      jobs: this.state.jobs,
      syncLogs: this.state.syncLogs,
      registeredCount: this.registry.size
    };
  }
}

module.exports = new SyncManagerService();
