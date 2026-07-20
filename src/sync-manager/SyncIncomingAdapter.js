const logger = require('../../utils/logger');
const dbConnection = require('../../db/connection');
const SyncIncomingModel = require('../sync-incoming-documents/models/SyncIncomingModel');

/**
 * SyncIncomingAdapter
 *
 * Vai trò: Bridge giữa SyncManagerService (qua SyncHandlerModel) và run_batch_workers.js.
 *
 * ══════════════════════════════════════════════════════════════
 * KIẾN TRÚC:
 *
 *  SyncManagerService.runJob()
 *    └─ fetchFn()    → generate virtual items dựa trên totalCount từ getList()
 *    └─ processFn()  → gọi processOne() mỗi virtual item
 *                      processOne() block chờ delta từ worker, flush rồi return { affected: N }
 *
 *  run_batch_workers.js (child process)
 *    └─ stdout: "[SYNC] N records ..."  → N là cumulative, bắn mỗi 10 records
 *    └─ stdout: "THAT BAI ID=..."       → 1 record lỗi
 *    └─ stdout: "LOI ID=..."            → 1 record lỗi
 *    └─ stdout: "Khong co ban ghi nao..." + exit(2) → hết data, job done
 *    └─ exit(0)                         → xong, flush delta cuối rồi done
 *
 * ══════════════════════════════════════════════════════════════
 * CONTRACT VỚI SyncHandlerModel:
 *
 *  Adapter implement đủ interface:
 *    - getName()
 *    - getCount()           → dùng cho countFn
 *    - countListFromOldDb() → dùng cho countFn
 *    - getList()            → extract old DB → staging, trả totalCount
 *    - fetchListFromOldDb() → fallback
 *    - processOne()         → 1 virtual tick, block chờ delta từ worker
 *    - requestPause()       → service gọi khi user bấm Pause
 *    - isBatchSync = true   → SyncHandlerModel dùng cơ chế virtual batch item
 *
 * ══════════════════════════════════════════════════════════════
 * CƠ CHẾ isBatchSync = true (SyncHandlerModel):
 *
 *  SyncHandlerModel generate virtual items với số lượng = ceil(remaining / limit).
 *  Mỗi virtual item đại diện cho 1 "batch tick", không phải 1 record đơn.
 *  processOne() mỗi lần nhận 1 tick → block chờ worker bắn delta → flush delta → return { affected: N }.
 *
 *  Kết quả: service thấy totalSuccess tăng theo từng batch 10 records của worker.
 * ══════════════════════════════════════════════════════════════
 */
class SyncIncomingAdapter {
  /**
   * Flag để SyncHandlerModel biết đây là batch adapter.
   * true → fetchFn generate virtual batch items (không phải 1-by-1).
   */
  isBatchSync = true;

  constructor() {
    this._instanceId = process.env.SYNC_INSTANCE_ID || process.env.INSTANCE_ID || '1';
    this._name       = `StreamIncomingV2_Instance_${this._instanceId}`;
    this._model      = null;
    this._initialized = false;

    this._resetWorkerState();
  }

  // ══════════════════════════════════════════════════════════════
  // STATE MANAGEMENT
  // ══════════════════════════════════════════════════════════════

  /**
   * Reset toàn bộ worker state.
   * Gọi trước mỗi lần spawn worker mới (start / resume).
   * @private
   */
  _resetWorkerState() {
    this._childProcess = null;

    // Cumulative counters đọc từ stdout của worker
    // "[SYNC] N records" → N tăng dần, đây là tổng tích lũy
    this._workerTotalSuccess = 0;
    this._workerTotalFail    = 0;

    // Số đã báo cho service (để tính delta)
    this._lastDispatchedSuccess = 0;
    this._lastDispatchedFail    = 0;

    // Flow control
    this._workerDone     = false;  // worker process đã exit
    this._noDataLeft     = false;  // exit code 2 = không có gì để xử lý
    this._workerExitCode = null;
    this._pauseRequested = false;

    // Danh sách resolve() của processOne() đang block chờ
    this._waitingResolvers = [];

    // Max ID đã extract vào staging (cursor cho resume)
    this._currentBatchMaxId = 0;
  }

  // ══════════════════════════════════════════════════════════════
  // WAITER MECHANISM
  // ══════════════════════════════════════════════════════════════

  /** @private */
  _wakeUpWaiters() {
    const resolvers = this._waitingResolvers;
    this._waitingResolvers = [];
    for (const resolve of resolvers) resolve();
  }

  /** @private — event-driven block, không spin */
  _waitForUpdate() {
    return new Promise(resolve => this._waitingResolvers.push(resolve));
  }

  // ══════════════════════════════════════════════════════════════
  // SAFE CURSOR
  // ══════════════════════════════════════════════════════════════

  /**
   * Tính lastSyncId an toàn tại thời điểm pause.
   * Workers chạy song song theo partition → dùng min(pending) - 1.
   * @returns {Promise<number>}
   * @private
   */
  async _getSafeLastSyncId() {
    try {
      const pool = dbConnection.getNewPool();
      if (!pool) {
        logger.warn('[SyncIncomingAdapter] _getSafeLastSyncId: pool unavailable, fallback to currentBatchMaxId');
        return this._currentBatchMaxId || 0;
      }

      const result = await pool.request().query(`
        SELECT MIN(ID) AS min_pending
        FROM incomming_documents_sync
        WHERE ISNULL(MigrateFlg, 0)    = 0
          AND ISNULL(MigrateErrFlg, 0) = 0
      `);

      const minPending = result.recordset?.[0]?.min_pending;

      if (minPending == null) {
        logger.info(
          `[SyncIncomingAdapter] _getSafeLastSyncId: staging fully done. ` +
          `returning currentBatchMaxId=${this._currentBatchMaxId}`
        );
        return this._currentBatchMaxId || 0;
      }

      const safeId = Math.max(0, Number(minPending) - 1);
      logger.info(
        `[SyncIncomingAdapter] _getSafeLastSyncId: min_pending=${minPending} → safeId=${safeId}`
      );
      return safeId;

    } catch (err) {
      logger.error(`[SyncIncomingAdapter] _getSafeLastSyncId error: ${err.message}`);
      return 0;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // WORKER PROCESS MANAGEMENT
  // ══════════════════════════════════════════════════════════════

  /**
   * Spawn run_batch_workers.js, parse stdout cập nhật cumulative counters.
   * @param {number} startId
   * @private
   */
  _startBatchWorker(startId) {
    if (this._childProcess) return;

    const { spawn } = require('child_process');
    const path      = require('path');

    const scriptPath  = path.join(process.cwd(), 'src', 'sync-incoming-documents', 'run_batch_workers.js');
    const workerCount = process.env.BATCH_WORKER_COUNT || '6';
    const rangeSize   = process.env.BATCH_RANGE_SIZE   || '20000';

    logger.info(
      `[SyncIncomingAdapter] Spawning batch worker: ` +
      `workers=${workerCount}, range=${rangeSize}, start=${startId}`
    );

    const child = spawn(
      'node',
      [scriptPath, `--workers=${workerCount}`, `--range=${rangeSize}`, `--start=${startId}`],
      { cwd: process.cwd() }
    );

    this._childProcess = child;
    let fullOutput = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      fullOutput += text;

      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) logger.info(`[BatchWorker] ${trimmed}`);
      }

      this._parseWorkerOutput(text);
    });

    child.stderr.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n')) {
        const trimmed = line.trim();
        if (trimmed) logger.error(`[BatchWorker][ERR] ${trimmed}`);
      }
    });

    child.on('close', (code) => {
      this._parseFinalSummary(fullOutput);

      this._workerExitCode = code;
      this._workerDone     = true;
      // exit(2) = "Khong co ban ghi nao duoc xu ly. Co the da dong bo het data!"
      this._noDataLeft     = (code === 2);
      this._childProcess   = null;

      const reason = this._pauseRequested ? 'KILLED(pause)' : `exit(${code})`;
      logger.info(
        `[SyncIncomingAdapter] Worker closed [${reason}] ` +
        `totalSuccess=${this._workerTotalSuccess}, totalFail=${this._workerTotalFail}, ` +
        `noDataLeft=${this._noDataLeft}`
      );

      this._wakeUpWaiters();
    });
  }

  /**
   * Parse stdout chunk, cập nhật cumulative counters, wake up waiters.
   *
   * "[SYNC] N records" → N là CUMULATIVE. Chỉ update nếu N > current.
   * "THAT BAI / LOI ID=..." → mỗi dòng = 1 fail, incremental.
   *
   * @param {string} text
   * @private
   */
  _parseWorkerOutput(text) {
    let updated = false;

    const syncMatches = [...text.matchAll(/\[SYNC\]\s+(\d+)\s+records/g)];
    if (syncMatches.length > 0) {
      const maxInChunk = Math.max(...syncMatches.map(m => parseInt(m[1], 10)));
      if (maxInChunk > this._workerTotalSuccess) {
        this._workerTotalSuccess = maxInChunk;
        updated = true;
      }
    }

    const failCount = (text.match(/(?:THAT BAI|LOI)\s+ID=/g) || []).length;
    if (failCount > 0) {
      this._workerTotalFail += failCount;
      updated = true;
    }

    if (updated) this._wakeUpWaiters();
  }

  /**
   * Reconcile counter từ summary block cuối worker.
   * @param {string} fullOutput
   * @private
   */
  _parseFinalSummary(fullOutput) {
    const successMatch = fullOutput.match(/- Thanh cong:\s*(\d+)/);
    if (successMatch) {
      const finalSuccess = parseInt(successMatch[1], 10);
      if (finalSuccess > this._workerTotalSuccess) {
        this._workerTotalSuccess = finalSuccess;
        logger.info(`[SyncIncomingAdapter] Final summary reconcile: totalSuccess=${this._workerTotalSuccess}`);
      }
    }

    const failMatch = fullOutput.match(/- That bai:\s*(\d+)/);
    if (failMatch) {
      const finalFail = parseInt(failMatch[1], 10);
      if (finalFail > this._workerTotalFail) {
        this._workerTotalFail = finalFail;
      }
    }
  }

  /**
   * Kill child process (Windows: taskkill /F /T để kill cả tree).
   * @private
   */
  _killBatchWorker() {
    const child = this._childProcess;
    if (!child) return;

    logger.warn(`[SyncIncomingAdapter] Killing batch worker pid=${child.pid}`);
    try {
      if (process.platform === 'win32') {
        const { execSync } = require('child_process');
        execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore' });
      } else {
        child.kill('SIGTERM');
      }
    } catch (err) {
      logger.warn(`[SyncIncomingAdapter] Kill worker error: ${err.message}`);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // PUBLIC INTERFACE
  // ══════════════════════════════════════════════════════════════

  async initialize() {
    if (this._initialized) return;
    this._model = new SyncIncomingModel();
    await this._model.initialize(this._instanceId);
    this._initialized = true;
    logger.info(`[SyncIncomingAdapter] Initialized as ${this._name}`);
  }

  getName()       { return this._name || 'StreamIncomingV2_Unknown'; }
  get modelName() { return this._name; }

  /** Service gọi khi user bấm Pause. */
  requestPause() {
    logger.info('[SyncIncomingAdapter] Pause requested by service.');
    this._pauseRequested = true;
    this._wakeUpWaiters();
  }

  async getCount(lastTime, lastSyncId = 0) {
    try {
      const pool = dbConnection.getNewPool();
      if (!pool) { logger.error('[SyncIncomingAdapter] getCount: pool not connected'); return 0; }
      const result = await pool.request().query(`
        SELECT COUNT(1) AS cnt
        FROM incomming_documents_sync
        WHERE ISNULL(MigrateFlg, 0)    = 0
          AND ISNULL(MigrateErrFlg, 0) = 0
      `);
      const count = Number(result.recordset?.[0]?.cnt || 0);
      logger.debug(`[SyncIncomingAdapter] getCount: ${count}`);
      return count;
    } catch (err) {
      logger.error(`[SyncIncomingAdapter] getCount error: ${err.message}`);
      return 0;
    }
  }

  async countListFromOldDb(lastSyncTime, lastSyncId = 0) {
    if (!this._model?.extractor) return 0;
    return this._model.extractor.countListFromOldDb(lastSyncTime, lastSyncId);
  }

  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    const batchSize       = Number(process.env.STAGING_FETCH_BATCH_SIZE  || 1000);
    const parallelBatches = Number(process.env.STAGING_PARALLEL_BATCHES  || 3);
    let extractedCount    = 0;
    let hasMore           = true;

    const lastCursor = await this._model.extractor.getLastSyncCursor(this._instanceId);
    let cursorTime   = lastCursor.time;
    let cursorId     = lastCursor.id || 0;

    if (!cursorTime) {
      const d           = new Date(lastSyncTime);
      const isValidTime = lastSyncTime &&
                          lastSyncTime !== '1970-01-01T00:00:00.000Z' &&
                          lastSyncTime !== '2100-01-01T00:00:00.000Z' &&
                          !isNaN(d.getTime()) &&
                          d.getFullYear() > 1753 &&
                          d.getFullYear() < 2100;

      cursorTime = isValidTime ? lastSyncTime : this._model.extractor.getInitialSyncTime();
      cursorId   = isValidTime ? Number(lastSyncId || 0) : 0;
    }

    logger.info(`[SyncIncomingAdapter] getList start: cursorTime=${cursorTime}, cursorId=${cursorId}`);

    while (hasMore) {
      const batchPromises = [];
      for (let p = 0; p < parallelBatches; p++) {
        batchPromises.push(
          this._model.extractor.fetchBatchFromOldDb(cursorTime, cursorId, batchSize, p * batchSize)
        );
      }

      const batchResults = await Promise.all(batchPromises);
      let anyRows = false;

      for (const batch of batchResults) {
        if (!batch?.length) continue;
        anyRows = true;

        await this._model.extractor.syncBatchToStaging(batch, this._instanceId);
        extractedCount += batch.length;

        const lastRow = batch[batch.length - 1];
        cursorTime    = lastRow.__sync_time;
        cursorId      = lastRow.__sync_id || lastRow.ID;

        if (batch.length < batchSize) hasMore = false;
      }

      if (!anyRows) hasMore = false;
    }

    this._currentBatchMaxId = cursorId;
    const stagedCount       = await this.getCount(cursorTime, cursorId);

    logger.info(
      `[SyncIncomingAdapter] getList done: extracted=${extractedCount}, staged=${stagedCount}, ` +
      `currentBatchMaxId=${this._currentBatchMaxId}`
    );

    return { lastSyncTime: cursorTime, lastSyncId: cursorId, stagedCount, totalCount: stagedCount };
  }

  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0, limit = null, offset = 0) {
    const batchSize       = Number(limit) || Number(process.env.STAGING_FETCH_BATCH_SIZE || 1000);
    const effectiveOffset = Number(offset) || 0;
    const d               = new Date(lastSyncTime);
    const isValidTime     = lastSyncTime &&
                            lastSyncTime !== '1970-01-01T00:00:00.000Z' &&
                            !isNaN(d.getTime()) && d.getFullYear() > 1753;
    const effectiveTime   = isValidTime ? lastSyncTime : this._model.extractor.getInitialSyncTime();
    const rows = await this._model.extractor.fetchBatchFromOldDb(effectiveTime, lastSyncId, batchSize, effectiveOffset);
    return rows || [];
  }

  // ══════════════════════════════════════════════════════════════
  // processOne() — TRÁI TIM CỦA ADAPTER
  //
  // SyncHandlerModel gọi processOne() mỗi lần có 1 virtual item.
  //
  // Đây không phải xử lý 1 record thật — đây là 1 "tick":
  //   - Spawn worker nếu chưa có
  //   - Block chờ worker bắn stdout có delta mới
  //   - Flush delta → return { affected: N }
  //   - Khi worker exit(2) hoặc hết data → return { done: true }
  //
  // Service sẽ cộng affected vào totalSuccess → hiển thị dashboard.
  // done:true → service gọi completeJob() hoặc markJobPaused().
  // ══════════════════════════════════════════════════════════════

  /**
   * @param {string} syncJobId
   * @param {object} options - { lastSyncId, sourceLastSyncId, totalProcessed, itemIndex, ... }
   * @returns {Promise<{done: boolean, affected: number, lastSyncId: number}>}
   */
  async processOne(syncJobId, options = {}) {
    try {
      // Spawn worker lần đầu (hoặc sau _resetWorkerState từ lần run trước)
      if (!this._childProcess && !this._workerDone) {
        const startId = Number(options.lastSyncId || options.sourceLastSyncId || 0);
        this._startBatchWorker(startId);
      }

      while (true) {

        // ── 1. Pause requested ──────────────────────────────────
        if (this._pauseRequested) {
          this._killBatchWorker();

          // Chờ child process thực sự exit trước khi query DB
          // (tránh race: worker vẫn đang ghi MigrateFlg khi ta query min_pending)
          if (this._childProcess) {
            await new Promise(resolve => {
              const interval = setInterval(() => {
                if (!this._childProcess) { clearInterval(interval); resolve(); }
              }, 100);
            });
          }

          const safeLastSyncId = await this._getSafeLastSyncId();
          logger.info(
            `[SyncIncomingAdapter] Paused. safeLastSyncId=${safeLastSyncId}, ` +
            `workerTotalSuccess=${this._workerTotalSuccess}, dispatched=${this._lastDispatchedSuccess}`
          );

          this._pauseRequested = false;
          return { done: true, affected: 0, lastSyncId: safeLastSyncId };
        }

        // ── 2. Có delta mới từ worker ───────────────────────────
        const deltaSuccess = this._workerTotalSuccess - this._lastDispatchedSuccess;
        const deltaFail    = this._workerTotalFail    - this._lastDispatchedFail;

        if (deltaSuccess > 0 || deltaFail > 0) {
          // Flush toàn bộ delta trong 1 lần → service nhận affected = batch size thực tế
          this._lastDispatchedSuccess = this._workerTotalSuccess;
          this._lastDispatchedFail    = this._workerTotalFail;

          logger.debug(
            `[SyncIncomingAdapter] processOne flush: deltaSuccess=${deltaSuccess}, ` +
            `deltaFail=${deltaFail}, cumulativeSuccess=${this._workerTotalSuccess}`
          );

          return { done: false, affected: deltaSuccess, lastSyncId: this._currentBatchMaxId };
        }

        // ── 3. Worker đã exit ───────────────────────────────────
        if (this._workerDone) {
          // Flush delta cuối (phòng _parseFinalSummary cập nhật thêm sau 'close' event)
          const finalDelta = this._workerTotalSuccess - this._lastDispatchedSuccess;
          const finalFail  = this._workerTotalFail    - this._lastDispatchedFail;

          if (finalDelta > 0 || finalFail > 0) {
            this._lastDispatchedSuccess = this._workerTotalSuccess;
            this._lastDispatchedFail    = this._workerTotalFail;

            logger.debug(
              `[SyncIncomingAdapter] processOne final flush: finalDelta=${finalDelta}, finalFail=${finalFail}`
            );

            return { done: false, affected: finalDelta, lastSyncId: this._currentBatchMaxId };
          }

          // Tất cả delta đã flush → thực sự kết thúc
          logger.info(
            `[SyncIncomingAdapter] Worker fully consumed. ` +
            `exitCode=${this._workerExitCode}, noDataLeft=${this._noDataLeft}, ` +
            `totalSuccess=${this._workerTotalSuccess}, totalFail=${this._workerTotalFail}`
          );

          const lastSyncId = this._currentBatchMaxId;
          this._resetWorkerState(); // sạch state để lần start/resume tiếp theo
          return { done: true, affected: 0, lastSyncId };
        }

        // ── 4. Chưa có gì → block event-driven, không spin ─────
        await this._waitForUpdate();
      }

    } catch (err) {
      logger.error(`[SyncIncomingAdapter] processOne error: ${err.message}`, err);
      return { done: false, affected: 0, error: err.message };
    }
  }
}

module.exports = SyncIncomingAdapter;