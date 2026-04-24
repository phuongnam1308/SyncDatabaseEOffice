const BaseModel = require('../../models/BaseModel');
const logger = require('../../utils/logger');

class SyncStateRepository extends BaseModel {
  constructor() {
    super();
    this.tblModels = 'sync_models';
    this.tblJobs = 'sync_jobs';
    this.tblErrors = 'sync_job_errors';
    this.tblSettings = 'sync_settings';
  }

  /**
   * Override queryNewDb để đảm bảo pool đã được khởi tạo (Lazy Init)
   */
  async queryNewDb(sql, params) {
    if (!this.newPool) {
      await this.initialize();
      // Tự động cập nhật Schema khi khởi tạo
      await this.alterTables();
    }
    return super.queryNewDb(sql, params);
  }

  /**
   * Tự động thêm cột instance_id nếu chưa có để hỗ trợ chạy đa instance/host
   */
  async alterTables() {
    try {
      const tables = [this.tblModels, this.tblJobs];
      for (const table of tables) {
        const checkQuery = `
          IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
                         WHERE TABLE_NAME = '${table}' AND COLUMN_NAME = 'instance_id')
          BEGIN
            ALTER TABLE ${table} ADD instance_id NVARCHAR(50) DEFAULT 'default';
          END
        `;
        await super.queryNewDb(checkQuery);
      }

      // Initialize sync_settings table
      const checkSettingsQuery = `
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${this.tblSettings}')
        BEGIN
          CREATE TABLE ${this.tblSettings} (
            setting_key NVARCHAR(100) NOT NULL,
            instance_id NVARCHAR(50) NOT NULL DEFAULT 'default',
            setting_value NVARCHAR(500),
            updated_at DATETIME2 DEFAULT SYSDATETIME(),
            CONSTRAINT PK_sync_settings PRIMARY KEY (setting_key, instance_id)
          );
          
          -- Bật mặc định: Không skip
          INSERT INTO ${this.tblSettings} (setting_key, instance_id, setting_value) 
          VALUES ('SKIP_PULL_FROM_OLD', 'default', 'false');
        END
      `;
      await super.queryNewDb(checkSettingsQuery);
    } catch (err) {
      logger.warn(`[SyncStateRepository] Alter tables failed (non-critical): ${err.message}`);
    }
  }

  /**
   * Đảm bảo Model đã tồn tại trong bảng sync_models
   */
  async ensureModel(modelName, instanceId = 'default') {
    const query = `
      BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM ${this.tblModels} WITH (UPDLOCK, HOLDLOCK)
                       WHERE model_name = @modelName AND instance_id = @instanceId)
        BEGIN
            INSERT INTO ${this.tblModels} (model_name, instance_id, status, created_at, updated_at)
            VALUES (@modelName, @instanceId, 'IDLE', SYSDATETIME(), SYSDATETIME())
        END
      END TRY
      BEGIN CATCH
        -- Ignore duplicate key error (2627: Unique constraint, 2601: Duplicate key index)
        IF ERROR_NUMBER() NOT IN (2627, 2601)
        BEGIN
            THROW;
        END
      END CATCH
    `;

    try {
      await this.queryNewDb(query, { modelName, instanceId });
    } catch (error) {
      // Ignore duplicate key error (2627: Unique constraint, 2601: Duplicate key index)
      if (error.number === 2627 || error.number === 2601) {
        logger.debug(`[SyncStateRepository] Model ${modelName} already exists (instance=${instanceId}), skipping`);
        return;
      }
      // Handle string truncation - model name too long
      if (error.number === 2628) {
        logger.warn(`[SyncStateRepository] Model name truncated for ${modelName}, skipping insert`);
        return;
      }
      logger.error(`[SyncStateRepository] Failed to ensure model ${modelName} (host=${instanceId}):`, error.message);
    }
  }

  /**
   * Lấy dữ liệu tổng hợp cho Dashboard
   * ĐÃ SỬA: trả về đúng cấu trúc { entities, jobs, syncLogs, isRunning, registeredCount }
   */
  async getDashboardData(instanceId = 'default') {
    try {
      // 1. Lấy thông tin Sync Models của host hiện tại
      const modelsQuery = `SELECT * FROM ${this.tblModels} WHERE instance_id = @instanceId`;
      const models = await this.queryNewDb(modelsQuery, { instanceId });

      // 2. Lấy danh sách 10 Job gần nhất của host hiện tại
      const jobsQuery = `
        SELECT TOP 10 *
        FROM ${this.tblJobs}
        WHERE instance_id = @instanceId
        ORDER BY updated_at DESC
      `;
      const jobs = await this.queryNewDb(jobsQuery, { instanceId });

      // 3. Lấy 50 lỗi mới nhất
      const errorsQuery = `
        SELECT TOP 50 e.*
        FROM ${this.tblErrors} e
        INNER JOIN ${this.tblJobs} j ON e.job_id = j.job_id
        WHERE j.instance_id = @instanceId
        ORDER BY e.occurred_at DESC
      `;
      const errors = await this.queryNewDb(errorsQuery, { instanceId });

      // 4. Lấy cấu hình Global
      const settingsQuery = `
        SELECT setting_key, setting_value 
        FROM ${this.tblSettings} 
        WHERE instance_id = @instanceId OR instance_id = 'default'
      `;
      const settingsRows = await this.queryNewDb(settingsQuery, { instanceId });
      const settings = {};
      if (settingsRows && Array.isArray(settingsRows)) {
        settingsRows.forEach(row => {
          settings[row.setting_key] = row.setting_value === 'true';
        });
      }

      // 5. Format dữ liệu giống cấu trúc JSON cũ để Dashboard HTML hoạt động không cần sửa
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
            error: j.error_message
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
            instanceId: m.instance_id,
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
        registeredCount: models?.length || 0,
        settings            // Cấu hình Global
      };

    } catch (error) {
      logger.error('[SyncStateRepository] Error getting dashboard data:', error);
      // Trả về cấu trúc rỗng nhưng đầy đủ
      return {
        entities: {},
        jobs: {},
        syncLogs: {},
        isRunning: false,
        registeredCount: 0,
        settings: {}
      };
    }
  }

  /**
   * Tạo mới Job trong CSDL
   */
  async createJob(job) {
    const query = `
      INSERT INTO ${this.tblJobs} (
        job_id, model_name, instance_id, status,
        started_at, updated_at, ended_at, heartbeat_at,
        pause_requested, is_reset, batch_size,
        last_sync_time, last_sync_id,
        total_to_sync, total_processed, total_success, total_errors,
        error_message
      ) VALUES (
        @jobId, @modelName, @instanceId, @status,
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
      WHERE model_name = @modelName AND instance_id = @instanceId
    `;
    await this.queryNewDb(query, {
      modelName,
      lastSyncTime: state.lastSyncTime || null,
      lastSyncId: Number(state.lastSyncId || 0),
      totalSynced: Number(state.totalSynced || 0),
      status: state.status || 'IDLE',
      lastRun: state.lastRun || null,
      activeJobId: state.activeJobId || null,
      lastError: state.error || null,
      instanceId: state.instanceId || 'default'
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
  async renameModel(oldName, newName, instanceId = 'default') {
    if (oldName === newName) return;
    try {
      // 1. Cập nhật bảng models
      const q1 = `UPDATE ${this.tblModels} SET model_name = @newName WHERE model_name = @oldName AND instance_id = @instanceId`;
      await this.queryNewDb(q1, { oldName, newName, instanceId });
      
      // 2. Cập nhật bảng jobs
      const q2 = `UPDATE ${this.tblJobs} SET model_name = @newName WHERE model_name = @oldName AND instance_id = @instanceId`;
      await this.queryNewDb(q2, { oldName, newName, instanceId });

      logger.info(`[SyncStateRepository] Đã đổi tên model từ "${oldName}" sang "${newName}"`);
    } catch (error) {
      logger.error(`[SyncStateRepository] Lỗi khi đổi tên model ${oldName}:`, error);
    }
  }

  /**
   * Lấy tất cả cài đặt toàn cục
   */
  async getSettings(instanceId = 'default') {
    try {
      const query = `
        SELECT setting_key, setting_value 
        FROM ${this.tblSettings} 
        WHERE instance_id = @instanceId OR instance_id = 'default'
      `;
      const rows = await this.queryNewDb(query, { instanceId });
      const settings = {};
      if (rows && Array.isArray(rows)) {
        rows.forEach(row => {
          settings[row.setting_key] = row.setting_value === 'true' ? true : (row.setting_value === 'false' ? false : row.setting_value);
        });
      }
      return settings;
    } catch (error) {
      logger.error(`[SyncStateRepository] Lỗi khi lấy settings:`, error);
      return {};
    }
  }

  /**
   * Cập nhật một cài đặt toàn cục
   */
  async updateSetting(key, value, instanceId = 'default') {
    try {
      const stringValue = String(value);
      const query = `
        MERGE ${this.tblSettings} AS target
        USING (SELECT @key AS setting_key, @instanceId AS instance_id) AS source
        ON (target.setting_key = source.setting_key AND target.instance_id = source.instance_id)
        WHEN MATCHED THEN 
            UPDATE SET setting_value = @value, updated_at = SYSDATETIME()
        WHEN NOT MATCHED THEN   
            INSERT (setting_key, instance_id, setting_value, updated_at)
            VALUES (@key, @instanceId, @value, SYSDATETIME());
      `;
      await this.queryNewDb(query, { key, value: stringValue, instanceId });
      logger.info(`[SyncStateRepository] Đã cập nhật setting ${key} = ${stringValue}`);
    } catch (error) {
      logger.error(`[SyncStateRepository] Lỗi khi cập nhật setting ${key}:`, error);
      throw error;
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
      instanceId: job.instanceId || 'default'
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
