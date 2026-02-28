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
   * Lấy dữ liệu tổng hợp cho Dashboard (thay thế cho JSON)
   */
  async getDashboardData() {
    try {
      // 1. Lấy thông tin Sync Models
      const modelsQuery = `SELECT * FROM ${this.tblModels}`;
      const models = await this.queryNewDb(modelsQuery);

      // 2. Lấy danh sách 10 Job gần nhất
      const jobsQuery = `
        SELECT TOP 10 *
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
      let isRunning = false;

      // Map Jobs
      const jobsMap = {};
      if (jobs && Array.isArray(jobs)) {
        jobs.forEach(j => {
          jobsMap[j.job_id] = {
            jobId: j.job_id,
            modelName: j.model_name,
            status: j.status,
            startedAt: j.started_at,
            updatedAt: j.updated_at,
            endedAt: j.ended_at,
            totalToSync: j.total_to_sync || 0,
            totalProcessed: j.total_processed || 0,
            totalSuccess: j.total_success || 0,
            totalErrors: j.total_errors || 0,
            errorMessage: j.error_message
          };

          // Kiểm tra cờ isRunning toàn cục
          if (['RUNNING', 'RESUMING', 'PAUSE_REQUESTED'].includes(j.status)) {
            isRunning = true;
          }
        });
      }

      // Map Models
      if (models && Array.isArray(models)) {
        models.forEach(m => {
          entities[m.model_name] = {
            status: m.status || 'IDLE',
            lastSyncTime: m.last_sync_time,
            lastRun: m.last_run,
            activeJobId: m.active_job_id,
            // Các chỉ số này sẽ được tính toán lại từ Job đang chạy nếu có
            currentProgressPercent: 0,
            currentSynced: m.total_synced || 0,
            currentTotalToSync: 0
          };

          // Nếu đây là Job đang kích hoạt của Model, cập nhật thông tin tiến độ cho Model
          if (m.active_job_id && jobsMap[m.active_job_id]) {
            const j = jobsMap[m.active_job_id];
            const total = j.totalToSync || 0;
            const processed = j.totalProcessed || 0;
            const pct = total > 0 ? Math.floor((processed / total) * 100) : 0;

            entities[m.model_name].currentProgressPercent = pct;
            entities[m.model_name].currentSynced = j.totalSuccess;
            entities[m.model_name].currentTotalToSync = total;
          }
        });
      }

      return { entities, jobs: jobsMap, isRunning };

    } catch (error) {
      logger.error('[SyncStateRepository] Error getting dashboard data:', error);
      return { entities: {}, jobs: {}, isRunning: false };
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
        error_message
      ) VALUES (
        @jobId, @modelName, @status,
        @startedAt, @updatedAt, @endedAt, @heartbeatAt,
        @pauseRequested, @isReset, @batchSize,
        @lastSyncTime, @lastSyncId,
        @totalToSync, @totalProcessed, @totalSuccess, @totalErrors,
        @errorMessage
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
        error_message   = @errorMessage
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
      errorMessage: job.error || null
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
}

module.exports = new SyncStateRepository();