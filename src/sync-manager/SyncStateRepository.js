const BaseModel = require('../../models/BaseModel');
const logger = require('../../utils/logger');

class SyncStateRepository extends BaseModel {
  constructor() {
    super();
    this.tblModels = 'sync_models';
    this.tblJobs = 'sync_jobs';
    this.tblErrors = 'sync_job_errors';
  }

  /**
   * Override queryNewDb để đảm bảo pool đã được khởi tạo (Lazy Init)
   */
  async queryNewDb(sql, params) {
    if (!this.newPool) {
      await this.initialize();
    }
    return super.queryNewDb(sql, params);
  }

  /**
   * Đảm bảo Model đã tồn tại trong bảng sync_models
   */
  async ensureModel(modelName) {
    try {
      const query = `
        IF NOT EXISTS (SELECT 1 FROM ${this.tblModels} WHERE model_name = @modelName)
        BEGIN
            INSERT INTO ${this.tblModels} (model_name, status, created_at, updated_at)
            VALUES (@modelName, 'IDLE', SYSDATETIME(), SYSDATETIME())
        END
      `;
      await this.queryNewDb(query, { modelName });
    } catch (error) {
      logger.error(`[SyncStateRepository] Failed to ensure model ${modelName}:`, error);
    }
  }

  /**
   * Lấy dữ liệu tổng hợp cho Dashboard
   * ĐÃ SỬA: trả về đúng cấu trúc { entities, jobs, syncLogs, isRunning, registeredCount }
   */
  async getDashboardData() {
    try {
      // 1. Lấy thông tin Sync Models
      const modelsQuery = `SELECT * FROM ${this.tblModels}`;
      const models = await this.queryNewDb(modelsQuery);

      // 2. Lấy danh sách 100 Job gần nhất
      const jobsQuery = `
        SELECT TOP 100 *
        FROM ${this.tblJobs}
        ORDER BY updated_at DESC
      `;
      const jobs = await this.queryNewDb(jobsQuery);

      // 3. Lấy 50 lỗi mới nhất
      const errorsQuery = `
        SELECT TOP 50 *
        FROM ${this.tblErrors}
        ORDER BY occurred_at DESC
      `;
      const errors = await this.queryNewDb(errorsQuery);

      // 4. Format dữ liệu giống cấu trúc JSON cũ để Dashboard HTML hoạt động không cần sửa
      const entities = {};
      const jobsMap = {};
      const syncLogs = {};  // THÊM: syncLogs giống jobsMap
      let isRunning = false;

      // Map Jobs -> jobsMap và syncLogs
      if (jobs && Array.isArray(jobs)) {
        jobs.forEach(j => {
          const jobData = {
            jobId: j.job_id,
            modelName: j.model_name,
            status: j.status,
            startedAt: j.started_at,
            updatedAt: j.updated_at,
            endedAt: j.ended_at,
            heartbeatAt: j.heartbeat_at,
            pauseRequested: j.pause_requested === 1,
            reset: j.is_reset === 1,
            batchSize: j.batch_size,
            lastSyncTime: j.last_sync_time,
            lastSyncId: j.last_sync_id,
            totalToSync: j.total_to_sync || 0,
            totalProcessed: j.total_processed || 0,
            totalSuccess: j.total_success || 0,
            totalErrors: j.total_errors || 0,
            error: j.error_message,
            fromTime: j.from_time,
            toTime: j.to_time,
            serverPort: j.server_port
          };

          jobsMap[j.job_id] = jobData;
          syncLogs[j.job_id] = { ...jobData }; // Clone vào syncLogs

          // Kiểm tra cờ isRunning toàn cục
          if (['RUNNING', 'RESUMING', 'PAUSE_REQUESTED'].includes(j.status)) {
            isRunning = true;
          }
        });
      }

      // Map Models -> entities
      if (models && Array.isArray(models)) {
        models.forEach(m => {
          // Tìm job active hoặc job gần nhất
          let currentJob = null;
          if (m.active_job_id && jobsMap[m.active_job_id]) {
            currentJob = jobsMap[m.active_job_id];
          } else {
            // Tìm job gần nhất của model này
            currentJob = Object.values(jobsMap)
              .filter(j => j.modelName === m.model_name)
              .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
          }

          const jobSynced = currentJob ? Number(currentJob.totalSuccess || 0) : 0;
          const jobNeeded = currentJob && Number.isFinite(Number(currentJob.totalToSync))
            ? Number(currentJob.totalToSync) : null;
          const progressPercent = jobNeeded && jobNeeded > 0
            ? Math.min(100, Math.round((jobSynced / jobNeeded) * 100)) : 0;

          entities[m.model_name] = {
            status: m.status || 'IDLE',
            lastSyncTime: m.last_sync_time,
            lastSyncId: m.last_sync_id,
            totalSynced: m.total_synced || 0,
            lastRun: m.last_run,
            activeJobId: m.active_job_id,
            error: m.last_error,
            // Các trường tính toán cho dashboard
            currentJobId: currentJob ? currentJob.jobId : null,
            currentJobStatus: currentJob ? currentJob.status : null,
            currentSynced: jobSynced,
            currentTotalToSync: jobNeeded,
            currentProgressPercent: progressPercent
          };
        });
      }

      // TRẢ VỀ ĐÚNG CẤU TRÚC mà dashboard cần
      return {
        entities,
        jobs: jobsMap,
        syncLogs,           // QUAN TRỌNG: thiếu cái này là không hiển thị tiến trình
        isRunning,
        registeredCount: models?.length || 0
      };

    } catch (error) {
      logger.error('[SyncStateRepository] Error getting dashboard data:', error);
      // Trả về cấu trúc rỗng nhưng đầy đủ
      return {
        entities: {},
        jobs: {},
        syncLogs: {},
        isRunning: false,
        registeredCount: 0
      };
    }
  }

  /**
   * Tạo mới Job trong CSDL
   */
  async createJob(job) {
    const query = `
      INSERT INTO ${this.tblJobs} (
        job_id, model_name, status,
        started_at, updated_at, ended_at, heartbeat_at,
        pause_requested, is_reset, batch_size,
        last_sync_time, last_sync_id,
        total_to_sync, total_processed, total_success, total_errors,
        error_message, from_time, to_time, server_port
      ) VALUES (
        @jobId, @modelName, @status,
        @startedAt, @updatedAt, @endedAt, @heartbeatAt,
        @pauseRequested, @isReset, @batchSize,
        @lastSyncTime, @lastSyncId,
        @totalToSync, @totalProcessed, @totalSuccess, @totalErrors,
        @errorMessage, @fromTime, @toTime, @serverPort
      )
    `;
    const params = this._mapJobToParams(job);
    await this.queryNewDb(query, params);
  }

  /**
   * Cập nhật trạng thái Job
   */
  async updateJob(job) {
    const query = `
      UPDATE ${this.tblJobs} SET
        status          = @status,
        updated_at      = @updatedAt,
        ended_at        = @endedAt,
        heartbeat_at    = @heartbeatAt,
        pause_requested = @pauseRequested,
        last_sync_time  = @lastSyncTime,
        last_sync_id    = @lastSyncId,
        total_to_sync   = @totalToSync,
        total_processed = @totalProcessed,
        total_success   = @totalSuccess,
        total_errors    = @totalErrors,
        error_message   = @errorMessage,
        from_time       = @fromTime,
        to_time         = @toTime,
        server_port     = @serverPort
      WHERE job_id = @jobId
    `;
    const params = this._mapJobToParams(job);
    await this.queryNewDb(query, params);
  }

  /**
   * Cập nhật trạng thái Model trong sync_models
   */
  async updateModel(modelName, state) {
    const query = `
      UPDATE ${this.tblModels} SET
        last_sync_time = @lastSyncTime,
        last_sync_id   = @lastSyncId,
        total_synced   = @totalSynced,
        status         = @status,
        last_run       = @lastRun,
        active_job_id  = @activeJobId,
        last_error     = @lastError,
        updated_at     = SYSDATETIME()
      WHERE model_name = @modelName
    `;
    await this.queryNewDb(query, {
      modelName,
      lastSyncTime: state.lastSyncTime || null,
      lastSyncId: Number(state.lastSyncId || 0),
      totalSynced: Number(state.totalSynced || 0),
      status: state.status || 'IDLE',
      lastRun: state.lastRun || null,
      activeJobId: state.activeJobId || null,
      lastError: state.error || null
    });
  }

  /**
   * Ghi log lỗi chi tiết
   */
  async logError(jobId, recordId, errorMessage) {
    const query = `
      INSERT INTO ${this.tblErrors} (job_id, record_id, error_message)
      VALUES (@jobId, @recordId, @errorMessage)
    `;
    await this.queryNewDb(query, {
      jobId,
      recordId: recordId ?? null,
      errorMessage: String(errorMessage || '')
    });
  }

  /**
   * Đổi tên model trong database (Dùng để sửa lỗi legacy/technical keys)
   * Cập nhật cả bảng models và Jobs để giữ tính nhất quán.
   */
  async renameModel(oldName, newName) {
    if (oldName === newName) return;
    try {
      // 1. Cập nhật bảng models
      const q1 = `UPDATE ${this.tblModels} SET model_name = @newName WHERE model_name = @oldName`;
      await this.queryNewDb(q1, { oldName, newName });
      
      // 2. Cập nhật bảng jobs
      const q2 = `UPDATE ${this.tblJobs} SET model_name = @newName WHERE model_name = @oldName`;
      await this.queryNewDb(q2, { oldName, newName });

      logger.info(`[SyncStateRepository] Đã đổi tên model từ "${oldName}" sang "${newName}"`);
    } catch (error) {
      logger.error(`[SyncStateRepository] Lỗi khi đổi tên model ${oldName}:`, error);
    }
  }

  _mapJobToParams(job) {
    return {
      jobId: job.jobId,
      modelName: job.modelName,
      status: job.status,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      endedAt: job.endedAt || null,
      heartbeatAt: job.heartbeatAt,
      pauseRequested: job.pauseRequested ? 1 : 0,
      isReset: job.reset ? 1 : 0,
      batchSize: job.batchSize,
      lastSyncTime: job.lastSyncTime || null,
      lastSyncId: Number(job.lastSyncId || 0),
      totalToSync: job.totalToSync ?? null,
      totalProcessed: Number(job.totalProcessed || 0),
      totalSuccess: Number(job.totalSuccess || 0),
      totalErrors: Number(job.totalErrors || 0),
      errorMessage: job.error || null,
      fromTime: job.fromTime || null,
      toTime: job.toTime || null,
      serverPort: job.serverPort || null
    };
  }

  /**
   * Cập nhật trạng thái Job
   */
  async findOneJobById(jobId) {
    const query = `
      SELECT * FROM ${this.tblJobs} WHERE job_id = @jobId
    `;
    const params = { jobId };
    return this.queryNewDb(query, params);
  }

  /**
   * Kiểm tra xem dải thời gian mới có chồng lấn với bất kỳ Job nào hiện có không
   */
  async findOverlappingJobs(modelName, fromTime, toTime) {
    const query = `
      SELECT job_id, from_time, to_time, status
      FROM ${this.tblJobs}
      WHERE model_name = @modelName
        AND status IN ('RUNNING', 'RESUMING', 'PAUSE_REQUESTED')
        AND (
          (CAST(@fromTime AS DATETIME2) < ISNULL(to_time, '2099-12-31'))
          AND (ISNULL(CAST(@toTime AS DATETIME2), '2099-12-31') > ISNULL(from_time, '1900-01-01'))
        )
    `;
    const params = { 
      modelName, 
      fromTime: fromTime || '1900-01-01', 
      toTime: toTime || '2099-12-31' 
    };
    return this.queryNewDb(query, params);
  }
}

module.exports = new SyncStateRepository();
