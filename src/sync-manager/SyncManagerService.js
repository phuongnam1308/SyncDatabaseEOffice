/**
 * SyncManagerService.js
 *
 * ════════════════════════════════════════════════════════════════
 * PHÂN CHIA TRÁCH NHIỆM RÕ RÀNG:
 * ────────────────────────────────────────────────────────────────
 *
 *  JSON file  (giữ nguyên 100% như bản gốc):
 *    ✅ state.models   — lastSyncTime, lastSyncId, totalSynced, status, lastRun, activeJobId
 *    ✅ state.jobs     — job object (dùng cho in-memory lookup)
 *    ✅ state.syncLogs — alias của jobs
 *    ✅ saveState()    — vẫn ghi JSON như cũ
 *    ✅ register()     — sync, không đổi chữ ký, có dedup (skip nếu trùng)
 *    ✅ SyncHandlerModel & SyncManagerController — KHÔNG ĐỔI GÌ CẢ
 *
 *  Database  (mới, song song, fire-and-forget):
 *    ✅ sync_jobs       — INSERT khi createJob, UPDATE sau mỗi thay đổi
 *    ✅ sync_job_errors — INSERT mỗi lần pushJobError()
 *    ✅ Lỗi DB chỉ log warning, KHÔNG crash service
 *    ✅ dbClient = null → DB bị bỏ qua, service chạy thuần JSON như cũ
 *
 *  SSE realtime  (mới, thay meta refresh 5s):
 *    ✅ addSSEClient(res) — dashboard subscribe
 *    ✅ _broadcastSSE()   — tự gọi sau mỗi saveState()
 *
 * ════════════════════════════════════════════════════════════════
 * VIỆC CẦN LÀM Ở DỰ ÁN:
 *
 * 1. Sửa path dbClient:
 *      const dbClient = require('../../database/dbClient');
 *    dbClient phải có: await dbClient.query(sql, { param: value })
 *    SQL dùng @tênParam (MSSQL).  Nếu chưa có → để null.
 *
 * 2. Thêm route SSE vào router:
 *      router.get('/events', ctrl.sseEvents);
 *
 * 3. Thêm handler sseEvents vào SyncManagerController:
 *      sseEvents = this.asyncHandler(async (req, res) => {
 *        await this.ensureInitialized();
 *        res.setHeader('Content-Type',      'text/event-stream');
 *        res.setHeader('Cache-Control',     'no-cache');
 *        res.setHeader('Connection',        'keep-alive');
 *        res.setHeader('X-Accel-Buffering', 'no');
 *        const ka = setInterval(() => res.write(': ka\n\n'), 25000);
 *        req.on('close', () => clearInterval(ka));
 *        SyncManagerService.addSSEClient(res);
 *      });
 *
 * 4. Thêm script SSE vào dashboard HTML (xem phần cuối file này).
 * ════════════════════════════════════════════════════════════════
 */

// JSON file persistence removed — state persisted in DB only
const logger = require('../../utils/logger');
// Sử dụng Repository để ghi log vào DB thay vì dbClient trực tiếp
const SyncStateRepository = require('./SyncStateRepository');

// STATE_FILE removed: no JSON file persistence
const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';
const RUNNING_STATUSES = new Set(['RUNNING', 'PAUSE_REQUESTED', 'RESUMING']);
const INTERRUPTED_STATUSES = new Set(['RUNNING', 'PAUSE_REQUESTED', 'RESUMING']);

class SyncManagerService {
  constructor() {
    this.registry = new Map();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '10', 10);
    this.activeJobPromises = new Map();

    // State được khởi tạo rỗng, sau đó hydrate từ DB qua ensureStateLoaded().
    this.state = this.normalizeState(null);
    this._stateLoaded = false;
    this._stateLoadingPromise = null;

    // SSE clients (Set của Express response objects)
    this._sseClients = new Set();

    // Setup shutdown hooks
    this.setupShutdownHandlers();
  }

  // ══════════════════════════════════════════════════════════════
  // PHẦN 1 — JSON STATE (giữ nguyên 100%)
  // ══════════════════════════════════════════════════════════════

  ensureStateDir() {
    // no-op: filesystem persistence removed
  }

  toIsoOrNull(value) {
    if (!value) return null;
    const dateValue = new Date(value);
    return Number.isNaN(dateValue.getTime()) ? null : dateValue.toISOString();
  }

  mapDbModelState(row) {
    return {
      lastSyncTime: this.toIsoOrNull(row?.last_sync_time),
      lastSyncId: Number(row?.last_sync_id || 0),
      totalSynced: Number(row?.total_synced || 0),
      status: row?.status || 'IDLE',
      lastRun: this.toIsoOrNull(row?.last_run),
      activeJobId: row?.active_job_id || null,
      error: row?.last_error || null
    };
  }

  mapDbJobState(row) {
    return {
      jobId: row?.job_id,
      modelName: row?.model_name,
      status: row?.status || 'IDLE',
      startedAt: this.toIsoOrNull(row?.started_at),
      updatedAt: this.toIsoOrNull(row?.updated_at),
      endedAt: this.toIsoOrNull(row?.ended_at),
      heartbeatAt: this.toIsoOrNull(row?.heartbeat_at || row?.updated_at),
      pauseRequested: Boolean(row?.pause_requested),
      reset: Boolean(row?.is_reset),
      batchSize: Number(row?.batch_size || this.batchSize),
      lastSyncTime: this.toIsoOrNull(row?.last_sync_time) || DEFAULT_SYNC_TIME,
      lastSyncId: Number(row?.last_sync_id || 0),
      totalToSync: row?.total_to_sync == null ? null : Number(row.total_to_sync),
      totalProcessed: Number(row?.total_processed || 0),
      totalSuccess: Number(row?.total_success || 0),
      totalErrors: Number(row?.total_errors || 0),
      error: row?.error_message || null,
      errorLog: []
    };
  }

  async loadRawState() {
    try {
      const [models, jobs] = await Promise.all([
        SyncStateRepository.queryNewDb(
          `
          SELECT
            model_name, last_sync_time, last_sync_id, total_synced,
            status, last_run, active_job_id, last_error
          FROM ${SyncStateRepository.tblModels}
          `
        ),
        SyncStateRepository.queryNewDb(
          `
          SELECT
            job_id, model_name, status,
            started_at, updated_at, ended_at, heartbeat_at,
            pause_requested, is_reset, batch_size,
            last_sync_time, last_sync_id,
            total_to_sync, total_processed, total_success, total_errors,
            error_message
          FROM ${SyncStateRepository.tblJobs}
          `
        )
      ]);

      const state = { models: {}, jobs: {}, syncLogs: {} };

      for (const modelRow of (models || [])) {
        const modelName = modelRow?.model_name;
        if (!modelName) continue;
        state.models[modelName] = this.mapDbModelState(modelRow);
      }

      for (const jobRow of (jobs || [])) {
        const mappedJob = this.mapDbJobState(jobRow);
        if (!mappedJob.jobId || !mappedJob.modelName) continue;

        state.jobs[mappedJob.jobId] = mappedJob;
        state.syncLogs[mappedJob.jobId] = {
          jobId: mappedJob.jobId,
          modelName: mappedJob.modelName,
          status: mappedJob.status,
          startedAt: mappedJob.startedAt,
          updatedAt: mappedJob.updatedAt,
          endedAt: mappedJob.endedAt,
          heartbeatAt: mappedJob.heartbeatAt,
          lastSyncTime: mappedJob.lastSyncTime,
          lastSyncId: mappedJob.lastSyncId,
          totalToSync: mappedJob.totalToSync,
          totalProcessed: mappedJob.totalProcessed,
          totalSuccess: mappedJob.totalSuccess,
          totalErrors: mappedJob.totalErrors,
          error: mappedJob.error
        };
      }

      return state;
    } catch (error) {
      logger.warn('[SyncManagerService] Load state from DB failed, fallback to empty state:', error.message);
    }
    return null;
  }

  async ensureStateLoaded() {
    if (this._stateLoaded) return;

    if (!this._stateLoadingPromise) {
      this._stateLoadingPromise = (async () => {
        const rawState = await this.loadRawState();
        this.state = this.normalizeState(rawState);
        this._stateLoaded = true;
        this.recoverInterruptedJobs();
      })().finally(() => {
        this._stateLoadingPromise = null;
      });
    }

    await this._stateLoadingPromise;
  }

  normalizeState(raw) {
    const base = { models: {}, jobs: {}, syncLogs: {} };
    if (!raw) return base;
    if (raw.models || raw.jobs || raw.syncLogs) {
      return {
        models: raw.models || {},
        jobs: raw.jobs || {},
        syncLogs: raw.syncLogs || {}
      };
    }
    // Backward compat: shape cũ { [modelName]: modelState }
    return { models: raw, jobs: {}, syncLogs: {} };
  }

  /**
   * saveState() — GIỮ NGUYÊN: ghi JSON.
   * Thêm: broadcast SSE sau khi ghi (không block).
   */
  saveState() {
    // Persist state to DB and broadcast realtime snapshot
    this._broadcastSSE();
    // Persist DB in background (fire-and-forget)
    this._persistStateToDb().catch((err) =>
      logger.warn('[SyncManagerService] Persist state to DB failed:', err && err.message ? err.message : err)
    );
  }

  now() { return new Date().toISOString(); }

  generateJobId(modelName) {
    return `${modelName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  isModelBusy(modelState) {
    return modelState && RUNNING_STATUSES.has(modelState.status);
  }

  get isRunning() {
    return Object.values(this.state.models).some((m) => RUNNING_STATUSES.has(m.status));
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
    process.on('SIGINT', () => { markInterrupted(); process.exit(0); });
    process.on('SIGTERM', () => { markInterrupted(); process.exit(0); });
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
      logger.warn('[SyncManagerService] Recovered interrupted jobs → CRASHED');
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

    // Thêm: cập nhật DB
    this._dbUpdateJob(job);
    if (modelState) this._dbUpdateModel(job.modelName, modelState);
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

  // ══════════════════════════════════════════════════════════════
  // PHẦN 2 — REGISTER (giữ nguyên chữ ký sync, thêm dedup)
  // ══════════════════════════════════════════════════════════════

  /**
   * Đăng ký handler cho model.
   *
   * ✅ Chữ ký GIỮ NGUYÊN — sync, không async, không cần await.
   *
   * DEDUP: Nếu cùng modelName đã được register() rồi → bỏ qua.
   * Điều này xảy ra nếu ensureInitialized() bị gọi nhiều lần
   * hoặc SyncHandlerModel.registerHandlers() được gọi 2 lần.
   *
   * State dedup (lastSyncTime không bị ghi đè):
   *   getModelState() chỉ tạo defaultModelState() nếu chưa có
   *   trong JSON → state từ lần chạy trước được giữ nguyên.
   *
   * @param {string}   name
   * @param {Function} fetchFn
   * @param {Function} processFn
   * @param {{ countFn?: Function }} options
   */
  register(name, fetchFn, processFn, options = {}) {
    // DEDUP: bỏ qua nếu đã đăng ký
    if (this.registry.has(name)) {
      logger.warn(`[SyncManagerService] register("${name}") called again — skipping duplicate`);
      return;
    }

    this.registry.set(name, {
      fetchFn,
      processFn,
      countFn: typeof options.countFn === 'function' ? options.countFn : null
    });

    // Chỉ tạo defaultModelState nếu JSON chưa có model này
    // → Tự động dedup state, không ghi đè lastSyncTime cũ
    this.getModelState(name);

    // Ensure model exists in DB (fire-and-forget) and persist initial state
    this._dbEnsureModel(name);
    this._dbUpdateModel(name, this.getModelState(name));

    this.saveState();
  }

  // ══════════════════════════════════════════════════════════════
  // PHẦN 3 — JOB LIFECYCLE (giữ nguyên logic, thêm ghi DB)
  // ══════════════════════════════════════════════════════════════

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
      totalToSync: null,
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
      totalToSync: job.totalToSync,
      totalProcessed: 0,
      totalSuccess: 0,
      totalErrors: 0,
      error: null
    };

    modelState.status = 'RUNNING';
    modelState.error = null;
    modelState.lastRun = now;
    modelState.activeJobId = jobId;

    this.saveState(); // ghi JSON (giữ nguyên)
    // make sure model exists in sync_models (FK constraint) before inserting job
    this._dbEnsureModel(modelName);
    this._dbInsertJob(job); // ghi DB (thêm mới, fire-and-forget)
    this._dbUpdateModel(modelName, modelState); // ghi DB model state

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
      totalToSync: job.totalToSync,
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
    if (job.errorLog.length > 200) job.errorLog = job.errorLog.slice(-200);

    // Thêm: ghi lỗi vào sync_job_errors
    this._dbInsertJobError(job.jobId, this.extractRecordId(record), error.message);
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

  // ══════════════════════════════════════════════════════════════
  // PHẦN 4 — START / PAUSE / RESUME (giữ nguyên hoàn toàn)
  // ══════════════════════════════════════════════════════════════

  async start(reset = false) {
    for (const modelName of this.registry.keys()) {
      const started = this.startModel(modelName, { reset });
      await this.waitForJobCompletion(started.jobId);
    }
  }

  startModel(modelName, options = {}) {
    if (!this.registry.has(modelName)) throw new Error(`Model ${modelName} is not registered`);

    const modelState = this.getModelState(modelName);
    if (this.isModelBusy(modelState)) throw new Error(`Model ${modelName} is already running`);
    if (modelState.status === 'PAUSED' && modelState.activeJobId) {
      throw new Error(`Model ${modelName} is paused. Resume the paused job first.`);
    }

    const job = this.createJob(modelName, options);
    const runPromise = this.runJob(job.jobId).finally(() => this.activeJobPromises.delete(job.jobId));
    this.activeJobPromises.set(job.jobId, runPromise);

    return { jobId: job.jobId, modelName: job.modelName, status: job.status };
  }

  async waitForJobCompletion(jobId) {
    const running = this.activeJobPromises.get(jobId);
    if (running) await running;
  }

  pauseJob(jobId) {
    const job = this.state.jobs[jobId];
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (!RUNNING_STATUSES.has(job.status)) throw new Error(`Job ${jobId} is not running`);

    job.pauseRequested = true;
    job.status = 'PAUSE_REQUESTED';
    job.updatedAt = this.now();
    job.heartbeatAt = job.updatedAt;

    this.getModelState(job.modelName).status = 'PAUSE_REQUESTED';

    this.updateSyncLogFromJob(job);
    this.saveState();
    this._dbUpdateJob(job); // thêm: cập nhật DB
    this._dbUpdateModel(job.modelName, this.getModelState(job.modelName));

    return job;
  }

  resumeJob(jobId) {
    const job = this.state.jobs[jobId];
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (job.status !== 'PAUSED') throw new Error(`Job ${jobId} is not paused`);

    const modelState = this.getModelState(job.modelName);
    if (this.isModelBusy(modelState)) throw new Error(`Model ${job.modelName} is already running`);

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
    this._dbUpdateJob(job); // thêm: cập nhật DB
    this._dbUpdateModel(job.modelName, modelState);

    const runPromise = this.runJob(job.jobId).finally(() => this.activeJobPromises.delete(job.jobId));
    this.activeJobPromises.set(job.jobId, runPromise);

    return { jobId: job.jobId, modelName: job.modelName, status: job.status };
  }

  async getJob(jobId) {
    const job = await this._dbFindJobById(jobId);

    if (!job) return null;

    const formattedJob = this.keysToCamel(job);

    return formattedJob[0];
  }


  toCamel(str) {
    return str.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
  }

  keysToCamel(obj) {
    if (Array.isArray(obj)) {
      return obj.map(v => this.keysToCamel(v));
    } else if (obj !== null && obj.constructor === Object) {
      return Object.keys(obj).reduce((acc, key) => {
        const camelKey = this.toCamel(key);
        acc[camelKey] = this.keysToCamel(obj[key]);
        return acc;
      }, {});
    }
    return obj;
  }

  findLatestJobByModel(modelName) {
    return Object.values(this.state.jobs)
      .filter((j) => j.modelName === modelName)
      .sort((a, b) => {
        const ta = new Date(a.updatedAt || a.startedAt || 0).getTime();
        const tb = new Date(b.updatedAt || b.startedAt || 0).getTime();
        return tb - ta;
      })[0] || null;
  }

  // ══════════════════════════════════════════════════════════════
  // PHẦN 5 — runJob (giữ nguyên hoàn toàn, thêm _dbUpdateJob)
  // ══════════════════════════════════════════════════════════════

  async runJob(jobId) {
    const job = await this.getJob(jobId);
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
      this._dbUpdateModel(job.modelName, modelState);
    }

    let cursorTime = job.lastSyncTime || modelState.lastSyncTime || DEFAULT_SYNC_TIME;
    let cursorId = Number(job.lastSyncId || modelState.lastSyncId || 0);

    try {
      // Đếm tổng bản ghi cần sync (để tính %)
      if (job.totalToSync == null && typeof handlers.countFn === 'function') {
        try {
          job.totalToSync = await handlers.countFn(cursorTime, cursorId);
          logger.info(`[SyncManagerService][${job.modelName}] Total to sync: ${job.totalToSync}`);
        } catch (countError) {
          logger.error(`[SyncManagerService][${job.modelName}] Count remaining failed:`, countError);
          job.totalToSync = null;
        }
        this.updateSyncLogFromJob(job);
        this.saveState();
        this._dbUpdateJob(job); // ghi totalToSync lên DB
      }

      while (true) {
        if (job.pauseRequested) { this.markJobPaused(job); return; }

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

        if (!records || records.length === 0) { this.completeJob(job); return; }

        let batchSuccess = 0;
        let batchProcessed = 0;

        for (const record of records) {
          if (job.pauseRequested) break;
          batchProcessed += 1;

          try {
            await handlers.processFn(record, { modelName: job.modelName, jobId: job.jobId });

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

        job.totalProcessed += batchProcessed;
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
        this.saveState();            // ghi JSON (giữ nguyên)
        this._dbUpdateJob(job);      // ghi DB (thêm mới)
        this._dbUpdateModel(job.modelName, modelState); // ghi DB model state

        if (job.pauseRequested) { this.markJobPaused(job); return; }
        if (records.length < job.batchSize) { this.completeJob(job); return; }
      }
    } catch (error) {
      this.failJob(job, error, 'FAILED');
    }
  }

  // ══════════════════════════════════════════════════════════════
  // PHẦN 6 — TERMINAL STATES (giữ nguyên, thêm _dbUpdateJob)
  // ══════════════════════════════════════════════════════════════

  markJobPaused(job) {
    const now = this.now(); const modelState = this.getModelState(job.modelName);
    job.status = 'PAUSED'; job.updatedAt = now; job.heartbeatAt = now; job.endedAt = now;
    modelState.status = 'PAUSED'; modelState.error = null; modelState.activeJobId = job.jobId;
    if (job.lastSyncTime) modelState.lastSyncTime = job.lastSyncTime;
    if (job.lastSyncId !== undefined) modelState.lastSyncId = job.lastSyncId;
    this.updateSyncLogFromJob(job); this.saveState(); this._dbUpdateJob(job); this._dbUpdateModel(job.modelName, modelState);
  }

  completeJob(job) {
    const now = this.now(); const modelState = this.getModelState(job.modelName);
    job.status = 'COMPLETED'; job.error = null; job.updatedAt = now; job.heartbeatAt = now; job.endedAt = now;
    modelState.status = 'COMPLETED'; modelState.error = null; modelState.activeJobId = null;
    if (job.lastSyncTime) modelState.lastSyncTime = job.lastSyncTime;
    if (job.lastSyncId !== undefined) modelState.lastSyncId = job.lastSyncId;
    this.updateSyncLogFromJob(job); this.saveState(); this._dbUpdateJob(job); this._dbUpdateModel(job.modelName, modelState);
  }

  failJob(job, error, status = 'FAILED') {
    const now = this.now(); const modelState = this.getModelState(job.modelName);
    job.status = status; job.error = error.message; job.updatedAt = now; job.heartbeatAt = now; job.endedAt = now;
    modelState.status = status; modelState.error = error.message; modelState.activeJobId = null;
    if (job.lastSyncTime) modelState.lastSyncTime = job.lastSyncTime;
    if (job.lastSyncId !== undefined) modelState.lastSyncId = job.lastSyncId;
    this.updateSyncLogFromJob(job); this.saveState(); this._dbUpdateJob(job); this._dbUpdateModel(job.modelName, modelState);
  }

  // ══════════════════════════════════════════════════════════════
  // PHẦN 7 — DASHBOARD DATA (giữ nguyên hoàn toàn)
  // ══════════════════════════════════════════════════════════════

  async getDashboardData() {
    const entities = {};
    for (const [modelName, modelState] of Object.entries(this.state.models)) {
      const currentJob = modelState.activeJobId
        ? this.state.jobs[modelState.activeJobId]
        : this.findLatestJobByModel(modelName);

      const jobSynced = currentJob ? Number(currentJob.totalSuccess || 0) : 0;
      const jobNeeded = currentJob && Number.isFinite(Number(currentJob.totalToSync))
        ? Number(currentJob.totalToSync) : null;
      const progressPercent = jobNeeded && jobNeeded > 0
        ? Math.min(100, Math.round((jobSynced / jobNeeded) * 100)) : null;

      entities[modelName] = {
        ...modelState,
        currentJobId: currentJob ? currentJob.jobId : null,
        currentJobStatus: currentJob ? currentJob.status : null,
        currentSynced: jobSynced,
        currentTotalToSync: jobNeeded,
        currentProgressPercent: progressPercent
      };
    }
    return {
      isRunning: this.isRunning, entities,
      jobs: this.state.jobs, syncLogs: this.state.syncLogs,
      registeredCount: this.registry.size
    };
  }

  // ══════════════════════════════════════════════════════════════
  // PHẦN 8 — SSE (thêm mới, thay meta refresh 5s)
  //
  // Dashboard HTML — thay đoạn <meta http-equiv="refresh" content="5">
  // bằng script này (dán vào trước </body>):
  //
  // <script>
  //   let es = null;
  //   function connectSSE() {
  //     es = new EventSource('/api/sync-manager-src/events');
  //     es.onopen    = () => document.getElementById('sse-dot').textContent = '🟢';
  //     es.onerror   = () => { document.getElementById('sse-dot').textContent = '🔴';
  //                            es.close(); setTimeout(connectSSE, 3000); };
  //     es.onmessage = (e) => {
  //       const data = JSON.parse(e.data);
  //       renderTable(data);  // implement hàm render giống Controller cũ
  //     };
  //   }
  //   connectSSE();
  // </script>
  // ══════════════════════════════════════════════════════════════

  /**
   * Đăng ký một Express response là SSE client.
   * Gọi từ route GET /events trong controller.
   */
  addSSEClient(res) {
    this._sseClients.add(res);
    this._sendSSESnapshot(res); // gửi snapshot ngay lập tức
    res.on('close', () => this._sseClients.delete(res));
  }

  /** @private — gọi tự động sau mỗi saveState() */
  _broadcastSSE() {
    if (this._sseClients.size === 0) return;
    for (const res of this._sseClients) {
      this._sendSSESnapshot(res);
    }
  }

  /** @private */
  _sendSSESnapshot(res) {
    this.getDashboardData().then((data) => {
      try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) { }
    }).catch(() => { });
  }

  /**
   * Persist current in-memory state (models + jobs) into DB.
   * This is fire-and-forget and must not throw.
   * @private
   */
  async _persistStateToDb() {
    try {
      const modelEntries = Object.entries(this.state.models || {});
      const jobEntries = Object.values(this.state.jobs || {});

      const modelPromises = modelEntries.map(async ([modelName, modelState]) => {
        try {
          await SyncStateRepository.ensureModel(modelName);
          await SyncStateRepository.updateModel(modelName, modelState);
        } catch (err) {
          logger.warn(`[SyncManagerService] DB persist model(${modelName}) failed:`, err && err.message ? err.message : err);
        }
      });

      const jobPromises = jobEntries.map(async (job) => {
        try {
          const existing = await SyncStateRepository.findOneJobById(job.jobId);
          if (existing) {
            await SyncStateRepository.updateJob(job);
          } else {
            await SyncStateRepository.createJob(job);
          }
        } catch (err) {
          logger.warn(`[SyncManagerService] DB persist job(${job.jobId}) failed:`, err && err.message ? err.message : err);
        }
      });

      await Promise.all([...modelPromises, ...jobPromises]);
    } catch (err) {
      logger.warn('[SyncManagerService] Unexpected error while persisting state to DB:', err && err.message ? err.message : err);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // PHẦN 9 — DB HELPERS (chỉ ghi job/log, không đụng model state)
  //
  // Tất cả đều fire-and-forget:
  //   - Không throw / không block service
  //   - Lỗi chỉ log warning
  //   - dbClient = null → tự động bỏ qua
  // ══════════════════════════════════════════════════════════════

  /**
   * INSERT job mới vào sync_jobs.
   * @private
   */
  _dbInsertJob(job) {
    SyncStateRepository.createJob(job).catch((err) =>
      logger.warn(`[SyncManagerService] DB insertJob(${job.jobId}) failed:`, err.message)
    );
  }

  /**
   * Ensure the model row exists in sync_models table.
   * This prevents FK violations when inserting a job for a new model.
   * @private
   */
  _dbEnsureModel(modelName) {
    SyncStateRepository.ensureModel(modelName).catch((err) =>
      logger.warn(`[SyncManagerService] DB ensureModel(${modelName}) failed:`, err.message)
    );
  }

  /**
   * UPDATE job trong sync_jobs.
   * @private
   */
  _dbUpdateJob(job) {
    SyncStateRepository.updateJob(job).catch((err) =>
      logger.warn(`[SyncManagerService] DB updateJob(${job.jobId}) failed:`, err.message)
    );
  }

  /**
   * UPDATE model state in sync_models.
   * @private
   */
  _dbUpdateModel(modelName, modelState) {
    SyncStateRepository.updateModel(modelName, modelState).catch((err) =>
      logger.warn(`[SyncManagerService] DB updateModel(${modelName}) failed:`, err.message)
    );
  }

  /**
   * INSERT lỗi record vào sync_job_errors.
   * @private
   */
  _dbInsertJobError(jobId, recordId, errorMessage) {
    SyncStateRepository.logError(jobId, recordId, errorMessage).catch((err) =>
      logger.warn(`[SyncManagerService] DB insertJobError(${jobId}) failed:`, err.message)
    );
  }
  _dbFindJobById(jobId) {
    return SyncStateRepository.findOneJobById(jobId).catch((err) => {
      logger.warn(`[SyncManagerService] DB findOneJobById(${jobId}) failed:`, err.message);
      return null;
    });
  }
}

module.exports = new SyncManagerService();
