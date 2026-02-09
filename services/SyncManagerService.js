const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const STATE_FILE = path.join(__dirname, '../logs/sync_state.json');

class SyncManagerService {
  constructor() {
    this.models = {}; // { modelName: { model, compareFunc } }
    this.isRunning = false;
    this.cancelRequested = false; // Cờ để dừng sync
    this.progress = {}; // { modelName: { total, synced, skipped, errors, status, ... } }
    this.batchSize = parseInt(process.env.BATCH_SIZE || '100', 10);
    this.loadState();
    this.setupShutdownHandlers();
  }

  loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        this.progress = saved;

        // Tự động phát hiện và reset trạng thái bị treo do crash
        let hasChanges = false;
        for (const modelName in this.progress) {
          if (this.progress[modelName].status === 'running') {
            this.progress[modelName].status = 'interrupted';
            this.progress[modelName].errorLog.push({
              recordId: 'SYSTEM',
              error: 'Tiến trình bị dừng đột ngột (Crash/Restart) khi đang chạy.',
              timestamp: new Date().toISOString()
            });
            hasChanges = true;
            logger.warn(`[SyncManager] Phát hiện model ${modelName} bị crash lần trước. Đã reset trạng thái.`);
          }
        }
        if (hasChanges) {
          this.saveState();
        }
      }
    } catch (e) {
      logger.error('Không thể đọc file state:', e);
    }
  }

  saveState() {
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.progress, null, 2));
    } catch (e) {
      logger.error('Không thể lưu file state:', e);
    }
  }

  /**
   * Bắt các sự kiện tắt ứng dụng để lưu trạng thái
   */
  setupShutdownHandlers() {
    const cleanup = () => {
      try {
        let modified = false;
        for (const name in this.progress) {
          if (this.progress[name].status === 'running') {
            this.progress[name].status = 'interrupted';
            modified = true;
          }
        }
        if (modified || this.isRunning) {
          this.isRunning = false;
          this.saveState();
          // Sử dụng console.log vì logger có thể đã đóng hoặc không ghi kịp
          console.log('[SyncManager] Đã lưu trạng thái interrupted trước khi tắt ứng dụng.');
        }
      } catch (e) {
        console.error('Lỗi lưu state khi tắt ứng dụng:', e);
      }
    };

    // Bắt các tín hiệu tắt
    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(); }); // Ctrl+C
    process.on('SIGTERM', () => { cleanup(); process.exit(); }); // Kill command
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught Exception (Crash):', err);
      cleanup();
      process.exit(1);
    });
  }

  /**
   * Lưu errorLog vào file riêng
   */
  saveErrorLog(modelName, errorLog) {
    try {
      const logDir = path.join(__dirname, '../logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const errorFile = path.join(logDir, `sync_errors_${modelName}.json`);
      const fullLog = {
        modelName,
        totalErrors: errorLog.length,
        exportTime: new Date().toISOString(),
        errors: errorLog
      };
      fs.writeFileSync(errorFile, JSON.stringify(fullLog, null, 2));
      logger.info(`[${modelName}] Đã lưu error log vào ${errorFile}`);
    } catch (e) {
      logger.error(`Không thể lưu error log cho ${modelName}:`, e);
    }
  }

  /**
   * Lấy tất cả error logs
   */
  getErrorLog(modelName) {
    const state = this.progress[modelName];
    return state ? state.errorLog : [];
  }

  /**
   * Đăng ký model để đồng bộ
   * @param {string} name
   * @param {Object} model - Instance có các method: getAllFromOldDb(), insertToNewDb(), updateInNewDb()
   */
  registerModel(name, model) {
    this.models[name] = { model };

    if (!this.progress[name]) {
      this.progress[name] = {
        total: 0,
        synced: 0,
        skipped: 0,
        errors: 0,
        status: 'idle',
        lastRun: null,
        lastSyncTime: null,
        errorLog: []
      };
    }

    logger.info(`[SyncManager] Đã đăng ký model: ${name}`);
  }

  /**
   * Đồng bộ một model cụ thể
   */
  async syncModel(modelName) {
    if (!this.models[modelName]) {
      throw new Error(`Model ${modelName} chưa được đăng ký`);
    }

    const state = this.progress[modelName];
    // Lấy mốc thời gian của lần đồng bộ thành công trước đó
    const lastSyncDate = state.lastSyncTime ? new Date(state.lastSyncTime) : null;

    state.status = 'running';
    state.lastRun = new Date().toISOString();
    state.synced = 0;
    state.skipped = 0;
    state.errors = 0;
    state.errorLog = [];
    this.saveState();

    const { model } = this.models[modelName];

    try {
      logger.info(`[${modelName}] Bắt đầu đồng bộ...`);

      const sourceRecords = await model.getAllFromOldDb();
      state.total = sourceRecords.length;

      logger.info(`[${modelName}] Tìm thấy ${state.total} records trong source`);

      let shouldStop = false;
      for (let i = 0; i < sourceRecords.length && !shouldStop; i += this.batchSize) {
        // Kiểm tra xem có yêu cầu hủy không
        if (this.cancelRequested) {
          logger.warn(`[${modelName}] Quá trình đồng bộ đã bị hủy bởi người dùng`);
          state.status = 'cancelled';
          shouldStop = true;
          this.saveState();
          break;
        }

        const batch = sourceRecords.slice(i, Math.min(i + this.batchSize, sourceRecords.length));

        for (const srcRecord of batch) {
          // Check cancel trước mỗi record
          if (this.cancelRequested) {
            logger.warn(`[${modelName}] Dừng tại record ${srcRecord.ID}`);
            state.status = 'cancelled';
            shouldStop = true;
            this.saveState();
            break;
          }

          // Kiểm tra Modified: Nếu bản ghi chưa thay đổi so với lần sync trước thì bỏ qua
          if (lastSyncDate && srcRecord.Modified) {
            const recordModified = new Date(srcRecord.Modified);
            if (!isNaN(recordModified.getTime()) && recordModified <= lastSyncDate) {
              state.skipped++;
              continue;
            }
          }

          try {
            // Update-first approach: cố gắng update trước
            let rowsAffected = 0;
            try {
              rowsAffected = await model.updateInNewDb(srcRecord);
            } catch (updateErr) {
              // Nếu UPDATE lỗi (ví dụ: missing id_outgoing_bak hoặc database error), cố gắng INSERT thay thế
              logger.debug(`[${modelName}] UPDATE failed for ID ${srcRecord.ID}, attempting INSERT: ${updateErr.message}`);
              rowsAffected = 0; // Gán 0 để trigger INSERT logic
            }

            if (rowsAffected > 0) {
              // Record đã tồn tại và được update
              state.synced++;
              logger.info(`[${modelName}] UPDATE ID ${srcRecord.ID}: record đã cập nhật`);
            } else {
              // Record không tồn tại hoặc UPDATE lỗi → insert mới
              await model.insertToNewDb(srcRecord);
              state.synced++;
              logger.info(`[${modelName}] INSERT ID ${srcRecord.ID}: record mới đã thêm`);
            }
          } catch (err) {
            state.errors++;
            state.errorLog.push({
              recordId: srcRecord.ID,
              error: err.message,
              timestamp: new Date().toISOString()
            });
            logger.error(`[${modelName}] Lỗi sync record ${srcRecord.ID}: ${err.message}`);
          }
        }

        if (shouldStop) {
          logger.info(`[${modelName}] Đã dừng đồng bộ tại batch ${Math.floor(i / this.batchSize) + 1}`);
          break;
        }

        const processed = Math.min(i + this.batchSize, sourceRecords.length);
        logger.info(
          `[${modelName}] Progress: ${processed}/${state.total} | Synced: ${state.synced}, Errors: ${state.errors}`
        );
        this.saveState();
      }

      // Lưu error log vào file
      if (state.errorLog.length > 0) {
        this.saveErrorLog(modelName, state.errorLog);
      }

      state.status = 'completed';
      state.lastSyncTime = new Date().toISOString();
      logger.info(
        `[${modelName}] Hoàn thành | Synced: ${state.synced}, Errors: ${state.errors}`
      );
    } catch (err) {
      state.status = 'error';
      logger.error(`[${modelName}] Lỗi đồng bộ: ${err.message}`);
      throw err;
    } finally {
      this.saveState();
    }
  }

  /**
   * Hủy quá trình đồng bộ
   */
  cancelSync() {
    logger.warn('[SyncManager] ========== YÊU CẦU HỦY ĐỒNG BỘ ==========');
    logger.warn('[SyncManager] cancelRequested được set thành TRUE');
    this.cancelRequested = true;
    logger.warn('[SyncManager] isRunning = ' + this.isRunning);
    logger.warn('[SyncManager] cancelRequested = ' + this.cancelRequested);
  }

  /**
   * Reset trạng thái hủy
   */
  resetCancel() {
    this.cancelRequested = false;
  }

  /**
   * Đồng bộ tất cả models
   */
  async syncAll() {
    if (this.isRunning) {
      logger.warn('[SyncManager] Đang có tiến trình chạy, bỏ qua request mới');
      return;
    }

    this.isRunning = true;
    this.resetCancel();

    try {
      const modelNames = Object.keys(this.models);
      logger.info(`[SyncManager] Bắt đầu đồng bộ ${modelNames.length} models...`);

      for (const modelName of modelNames) {
        if (this.cancelRequested) {
          logger.warn('[SyncManager] Đã nhận yêu cầu hủy, dừng đồng bộ');
          break;
        }
        try {
          await this.syncModel(modelName);
        } catch (err) {
          logger.error(`[SyncManager] Lỗi đồng bộ ${modelName}, tiếp tục với model tiếp theo`);
        }
      }

      logger.info('[SyncManager] Hoàn thành tất cả đồng bộ');
    } finally {
      this.isRunning = false;
      this.resetCancel();
    }
  }

  /**
   * Lấy thông tin dashboard
   */
  getDashboardData() {
    const entities = {};

    for (const [name, state] of Object.entries(this.progress)) {
      entities[name] = {
        ...state,
        remaining: state.total - state.synced,
        progressPercent: state.total > 0 ? Math.round((state.synced / state.total) * 100) : 0
      };
    }

    return {
      isRunning: this.isRunning,
      batchSize: this.batchSize,
      entities,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Lấy chi tiết một model
   */
  getModelDetails(modelName) {
    if (!this.progress[modelName]) {
      throw new Error(`Model ${modelName} không tồn tại`);
    }

    const state = this.progress[modelName];
    return {
      name: modelName,
      ...state,
      remaining: state.total - state.synced,
      progressPercent: state.total > 0 ? Math.round((state.synced / state.total) * 100) : 0
    };
  }
}

module.exports = new SyncManagerService();