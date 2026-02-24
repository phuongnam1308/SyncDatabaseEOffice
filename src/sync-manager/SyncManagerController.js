const BaseController = require('../../controllers/BaseController');
const SyncManagerService = require('./SyncManagerService');
const SyncOutgoingModel = require('../sync-outgoing-document/apply/SyncOutgoingModel');
const SyncAuditModel = require('../sync-audit/apply/SyncAuditModel');
const SyncCommentModel = require('../sync-document-comment/apply/SyncCommentModel');
const SyncHandlerModel = require('./SyncHandlerModel');

const StreamOutgoingMigrationService = require('../sync-outgoing-document/migrate/StreamOutgoingMigrationService');
const StreamAuditMigrationService = require('../sync-audit/migrate/StreamAuditMigrationService');
const StreamCommentMigrationService = require('../sync-document-comment/migration/StreamCommentMigrationService');
const logger = require('../../utils/logger');

class SyncManagerController extends BaseController {
  constructor() {
    super();
    this.initialized = false;
  }

  async registerMigrationHandler(serviceClass, modelName) {
    if (!serviceClass) {
      logger.error(`[SyncManagerController] Service class cho '${modelName}' bị undefined. Kiểm tra lại đường dẫn import.`);
      return;
    }

    const service = new serviceClass();

    // Kiểm tra xem hàm initialize có tồn tại không trước khi gọi
    if (typeof service.initialize === 'function') {
      await service.initialize();
    } else {
      logger.warn(`[SyncManagerController] Service '${modelName}' không có hàm initialize(). Đảm bảo model đã được khởi tạo.`);
    }

    if (!service.model) {
      logger.error(`[SyncManagerController] Service '${modelName}' chưa có property 'model'. Bỏ qua đăng ký.`);
      return;
    }

    const fetchFn = async (lastTime, limit, offset, cursor) => {
      const lastId = cursor?.lastSyncId || 0;
      // SyncManager passes limit as batchSize
      const records = await service.model.fetchBatchFromOldDb({ batch: limit, lastId });
      return records.map((r) => ({
        ...r,
        __sync_id: r.ID,
        __sync_time: null
      }));
    };

    const processFn = async (record) => {
      if (service.model.findByBackupId) {
        const existing = await service.model.findByBackupId(record.ID);
        if (existing) return;
      }
      const newRecord = service.safeMapRecord(record);
      await service.model.insertToNewDb(newRecord);
    };

    const countFn = async () => {
      return 0; // Migration count logic can be added if needed
    };

    SyncManagerService.register(modelName, fetchFn, processFn, { countFn });
  }

  async ensureInitialized() {
    if (this.initialized) return;

    try {
      // Register SYNC_OUTGOING_DOCUMENT
      const outgoingModel = new SyncOutgoingModel();
      await outgoingModel.initialize();
      const outgoingHandler = new SyncHandlerModel(outgoingModel);
      await outgoingHandler.registerHandlers(SyncManagerService, 'Đồng bộ văn bản đi');

      // Register SYNC_AUDIT
      const auditModel = new SyncAuditModel();
      await auditModel.initialize();
      const auditHandler = new SyncHandlerModel(auditModel);
      await auditHandler.registerHandlers(SyncManagerService, 'Đồng bộ nhật kí thao tác văn bản');

      // Register SYNC_COMMENT
      const commentModel = new SyncCommentModel();
      await commentModel.initialize();
      const commentHandler = new SyncHandlerModel(commentModel);
      await commentHandler.registerHandlers(SyncManagerService, 'Đồng bộ bình luận văn bản');

      // Register Migration Models
      await this.registerMigrationHandler(StreamOutgoingMigrationService, 'Migration văn bản đi');
      await this.registerMigrationHandler(StreamAuditMigrationService, 'Migration nhật kí thao tác văn bản');
      await this.registerMigrationHandler(StreamCommentMigrationService, 'Migration bình luận văn bản');

      this.initialized = true;
    } catch (error) {
      logger.error('[SyncManagerController] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * POST /api/sync-manager/start
   * Body: { "reset": true/false }
   */
  startSync = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { reset } = req.body;

    SyncManagerService.start(reset === true || reset === 'true');

    return this.success(res, { message: 'Đã kích hoạt tiến trình đồng bộ' });
  });

  startModelSync = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { modelName } = req.params;
    const { reset = false, batchSize, fullFlow = false } = req.body || {};

    if (fullFlow) {
      const migrationName = modelName.replace('Đồng bộ', 'Migration');
      const job = SyncManagerService.startModel(migrationName, {
        reset: reset === true || reset === 'true',
        batchSize
      });

      this.runFullFlowChain(job.jobId, modelName, { reset, batchSize });

      return this.success(res, job, 'Đã kích hoạt Full Flow (Migration -> Sync)');
    }

    const result = SyncManagerService.startModel(modelName, {
      reset: reset === true || reset === 'true',
      batchSize
    });

    return this.success(res, result, 'Đã kích hoạt đồng bộ đối tượng');
  });

  async runFullFlowChain(migrationJobId, syncModelName, options) {
    try {
      await SyncManagerService.waitForJobCompletion(migrationJobId);
      const job = SyncManagerService.getJob(migrationJobId);
      if (job && job.status === 'COMPLETED') {
        SyncManagerService.startModel(syncModelName, options);
      }
    } catch (e) {
      logger.error('Full flow chain error', e);
    }
  }

  pauseJobSync = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { jobId } = req.params;
    const result = SyncManagerService.pauseJob(jobId);
    return this.success(res, result, 'Đồng chí đã yêu cầu dừng lại tiến trình');
  });

  resumeJobSync = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { jobId } = req.params;
    const result = SyncManagerService.resumeJob(jobId);
    return this.success(res, result, 'Đã tiếp tục tiến trình phần mềm');
  });

  getJobSyncStatus = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { jobId } = req.params;
    const job = SyncManagerService.getJob(jobId);
    if (!job) {
      return this.notFound(res, `Không tìm thấy bản ghi với số mã :  ${jobId}`);
    }
    return this.success(res, job);
  });

  /**
   * GET /api/sync-manager/dashboard
   */
  getDashboard = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const data = await SyncManagerService.getDashboardData();

    const html = `
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Migration Dashboard</title>
        <meta http-equiv="refresh" content="5">
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <style>
          .status-running { color: #0d6efd; font-weight: bold; }
          .status-resuming { color: #0d6efd; font-weight: bold; }
          .status-pause_requested { color: #fd7e14; font-weight: bold; }
          .status-paused { color: #fd7e14; font-weight: bold; }
          .status-completed { color: #198754; font-weight: bold; }
          .status-failed { color: #dc3545; font-weight: bold; }
          .status-crashed { color: #dc3545; font-weight: bold; }
          .status-error { color: #dc3545; font-weight: bold; }
          .status-idle { color: #6c757d; }
        </style>
      </head>
      <body class="bg-light">
        <div class="container py-5">
          <div class="card shadow">
            <div class="card-header bg-primary text-white d-flex justify-content-between align-items-center">
              <h3 class="mb-0">BẢNG ĐIỀU KHIỂN ĐỒNG BỘ</h3>
              <span class="badge bg-light text-dark">
                ${data.isRunning ? 'Đang đồng bộ...' : 'Sẵn sàng'}
              </span>
            </div>
            <div class="card-body">
              <div class="mb-4">
                <button onclick="triggerSync(false)" class="btn btn-success me-2" ${data.isRunning ? 'disabled' : ''}>
                  Chạy tất cả các đối tượng
                </button>
                <button onclick="triggerSync(true)" class="btn btn-danger" ${data.isRunning ? 'disabled' : ''}>
                  Chạy lại toàn bộ tất cả đối tượng
                </button>
              </div>

              <table class="table table-hover table-bordered">
                <thead class="table-dark">
                  <tr>
                    <th>ĐỐI TƯỢNG</th>
                    <th>TRẠNG THÁI</th>
                    <th>TIẾN TRÌNH</th>
                    <th>SỐ LƯỢNG / TỔNG SỐ</th>
                    <th>PHẦN TRĂM</th>
                    <th>LẦN ĐỒNG BỘ GẦN NHẤT</th>
                    <th>LẦN ĐỒNG BỘ CUỐI</th>
                    <th>PHIÊN ĐỒNG BỘ HIỆN TẠI</th>
                    <th>HÀNH ĐỘNG</th>
                  </tr>
                </thead>
                <tbody>
                  ${Object.entries(data.entities).map(([name, info]) => `
                    ${(() => {
        const jobs = Object.values(data.jobs || {})
          .filter((job) => job.modelName === name)
          .sort((a, b) => {
            const ta = new Date(a.updatedAt || a.startedAt || 0).getTime();
            const tb = new Date(b.updatedAt || b.startedAt || 0).getTime();
            return tb - ta;
          });

        const runningOrPausedJob = jobs.find((job) =>
          ['RUNNING', 'PAUSE_REQUESTED', 'RESUMING', 'PAUSED'].includes(job.status)
        );

        const currentJob = (info.activeJobId && data.jobs && data.jobs[info.activeJobId])
          ? data.jobs[info.activeJobId]
          : (runningOrPausedJob || jobs[0] || null);

        const modelStatus = (info.status || 'IDLE').toUpperCase();
        const jobStatus = currentJob ? String(currentJob.status || '').toUpperCase() : null;

        const canStart = ['IDLE', 'COMPLETED', 'FAILED', 'CRASHED'].includes(modelStatus);
        const canPause = jobStatus === 'RUNNING' || jobStatus === 'RESUMING';
        const canResume = modelStatus === 'PAUSED' || jobStatus === 'PAUSED';
        const resumeJobId = canResume
          ? ((currentJob && currentJob.jobId) || info.activeJobId || '')
          : '';

        const jobInfo = currentJob
          ? `${currentJob.jobId}<br/><small>${currentJob.status}</small>`
          : '-';

        const progressBar = info.currentProgressPercent != null
          ? `<div class="progress" style="height: 20px;"><div class="progress-bar" role="progressbar" style="width: ${info.currentProgressPercent}%;" aria-valuenow="${info.currentProgressPercent}" aria-valuemin="0" aria-valuemax="100">${info.currentProgressPercent}%</div></div>`
          : '-';

        const syncedTotal = info.currentTotalToSync != null
          ? `${(info.currentSynced || 0).toLocaleString()} / ${info.currentTotalToSync.toLocaleString()}`
          : '-';

        if (['Đồng bộ văn bản đi', 'Đồng bộ bình luận văn bản', 'Đồng bộ nhật kí thao tác văn bản'].includes(name)) {
          return `
                    <tr class="table-light">
                      <td><strong>${name}</strong> <span class="badge bg-secondary">Migration</span></td>
                      <td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
                      <td>
                        <div class="btn-group" role="group">
                          <button class="btn btn-sm btn-primary" onclick="runMigration('${name}', false)">Chạy</button>
                          <button class="btn btn-sm btn-outline-danger" onclick="runMigration('${name}', true)">Chạy lại</button>
                          <button class="btn btn-sm btn-warning" disabled>Dừng</button>
                          <button class="btn btn-sm btn-success" disabled>Tiếp</button>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td><strong>${name}</strong> <span class="badge bg-primary">Sync</span></td>
                      <td class="status-${info.status.toLowerCase()}">${info.status}</td>
                      <td>${progressBar}</td>
                      <td><strong>${syncedTotal}</strong></td>
                      <td>${info.currentProgressPercent != null ? (info.currentProgressPercent + '%') : '-'}</td>
                      <td>${info.lastSyncTime ? new Date(info.lastSyncTime).toLocaleString('vi-VN') : '-'}</td>
                      <td>${info.lastRun ? new Date(info.lastRun).toLocaleString('vi-VN') : '-'}</td>
                      <td>${jobInfo}</td>
                      <td>
                        <div class="btn-group" role="group">
                          <button class="btn btn-sm btn-primary" onclick="startModel('${name}', false)" ${canStart ? '' : 'disabled'}>Chạy</button>
                          <button class="btn btn-sm btn-outline-danger" onclick="startModel('${name}', true)" ${canStart ? '' : 'disabled'}>Chạy lại</button>
                          <button class="btn btn-sm btn-warning" onclick="pauseJob('${currentJob ? currentJob.jobId : ''}')" ${canPause ? '' : 'disabled'}>Dừng</button>
                          <button class="btn btn-sm btn-success" onclick="resumeJob('${resumeJobId}')" ${canResume ? '' : 'disabled'}>Tiếp</button>
                        </div>
                      </td>
                    </tr>
                    <tr class="table-light">
                      <td><strong>${name}</strong> <span class="badge bg-info text-dark">Full Flow</span></td>
                      <td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
                      <td>
                        <div class="btn-group" role="group">
                          <button class="btn btn-sm btn-primary" onclick="runFullFlow('${name}', false)">Chạy</button>
                          <button class="btn btn-sm btn-outline-danger" onclick="runFullFlow('${name}', true)">Chạy lại</button>
                          <button class="btn btn-sm btn-warning" disabled>Dừng</button>
                          <button class="btn btn-sm btn-success" disabled>Tiếp</button>
                        </div>
                      </td>
                    </tr>
                  `;
        }

        return `
                    <tr>
                      <td>${name}</td>
                      <td class="status-${info.status.toLowerCase()}">${info.status}</td>
                      <td>${progressBar}</td>
                      <td><strong>${syncedTotal}</strong></td>
                      <td>${info.currentProgressPercent != null ? (info.currentProgressPercent + '%') : '-'}</td>
                      <td>${info.lastSyncTime ? new Date(info.lastSyncTime).toLocaleString('vi-VN') : '-'}</td>
                      <td>${info.lastRun ? new Date(info.lastRun).toLocaleString('vi-VN') : '-'}</td>
                      <td>${jobInfo}</td>
                      <td>
                        <div class="btn-group" role="group">
                          <button class="btn btn-sm btn-primary" onclick="startModel('${name}', false)" ${canStart ? '' : 'disabled'}>Chạy</button>
                          <button class="btn btn-sm btn-outline-danger" onclick="startModel('${name}', true)" ${canStart ? '' : 'disabled'}>Chạy lại</button>
                          <button class="btn btn-sm btn-warning" onclick="pauseJob('${currentJob ? currentJob.jobId : ''}')" ${canPause ? '' : 'disabled'}>Dừng</button>
                          <button class="btn btn-sm btn-success" onclick="resumeJob('${resumeJobId}')" ${canResume ? '' : 'disabled'}>Tiếp</button>
                        </div>
                      </td>
                    </tr>
                  `;
      })()}
                  `).join('')}
                </tbody>
              </table>

              ${Object.keys(data.entities).length === 0 ? '<p class="text-center text-muted">Chưa có đối tượng nào được đăng kí đồng bộ liên hệ quản trị viên</p>' : ''}
            </div>
            <div class="card-footer text-muted">
              Tự động làm mởi mỗi 5 giây.
            </div>
          </div>
        </div>

        <script>
          async function triggerSync(reset) {
            if(!confirm(reset ? 'Ban chac chan muon chay lai tu dau?' : 'Bắt đầu đồng bộ đối tượng tiếp theo?')) return;

            try {
              const res = await fetch('/api/sync-manager-src/start', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ reset })
              });
              const json = await res.json();
              alert(json.message || 'Đồng chí đã gửi lệnh');
              window.location.reload();
            } catch (e) {
              alert('Loi: ' + e.message);
            }
          }

          async function startModel(modelName, reset = false) {
            try {
              const res = await fetch('/api/sync-manager-src/models/' + encodeURIComponent(modelName) + '/start', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ reset })
              });
              const json = await res.json();
              alert(json.message || 'Đồng chí đã gửi lệnh');
              window.location.reload();
            } catch (e) {
              alert('Loi: ' + e.message);
            }
          }

          async function pauseJob(jobId) {
            if (!jobId) return;
            try {
              const res = await fetch('/api/sync-manager-src/jobs/' + encodeURIComponent(jobId) + '/pause', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'}
              });
              const json = await res.json();
              alert(json.message || 'Đồng chí đã yêu cầu dừng lại');
              window.location.reload();
            } catch (e) {
              alert('Loi: ' + e.message);
            }
          }

          async function resumeJob(jobId) {
            if (!jobId) return;
            try {
              const res = await fetch('/api/sync-manager-src/jobs/' + encodeURIComponent(jobId) + '/resume', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'}
              });
              const json = await res.json();
              alert(json.message || 'Đông chí đã yêu cầu tiếp tục');
              window.location.reload();
            } catch (e) {
              alert('Loi: ' + e.message);
            }
          }

          const flowConfig = {
            'Đồng bộ văn bản đi': {
              migrate: '/api/outgoing/migrate',
              syncModel: 'Đồng bộ văn bản đi'
            },
            'Đồng bộ bình luận văn bản': {
              migrate: '/api/document-comments/migrate',
              syncModel: 'Đồng bộ bình luận văn bản'
            },
            'Đồng bộ nhật kí thao tác văn bản': {
              migrate: '/api/audit/migrate',
              syncModel: 'Đồng bộ nhật kí thao tác văn bản'
            }
          };

          async function runFullFlow(modelName) {
            const config = flowConfig[modelName];
            if (!config) return alert('Chưa cấu hình flow cho model này');
            
            if (!confirm('Bạn có chắc muốn chạy quy trình Full Flow (Migration -> Sync) cho ' + modelName + '?')) return;
            
            const body = JSON.stringify({ limit: 1000, batch: 100 });
            const headers = { 'Content-Type': 'application/json' };

            try {
              // 1. Call Migration
              const res1 = await fetch(config.migrate, { method: 'POST', headers, body });
              const json1 = await res1.json();
              if (!json1.success) throw new Error(json1.message || 'Lỗi Migration');
              console.log('Migration done:', json1);

              // 2. Call Sync
              const syncUrl = '/api/sync-manager-src/models/' + encodeURIComponent(config.syncModel) + '/start';
              const syncBody = JSON.stringify({ reset: false, batchSize: 100 });
              const res2 = await fetch(syncUrl, { method: 'POST', headers, body: syncBody });
              const json2 = await res2.json();
              if (!json2.success) throw new Error(json2.message || 'Lỗi Sync');

              alert('Quy trình hoàn tất! Migration xong và đã kích hoạt Sync.');
              window.location.reload();
            } catch (e) {
              alert('Lỗi quy trình: ' + e.message);
            }
          }

          async function runMigration(modelName) {
            const config = flowConfig[modelName];
            if (!config) return alert('Chưa cấu hình flow cho model này');
            
            if (!confirm('Bạn có chắc muốn chạy Migration cho ' + modelName + '?')) return;
            
            const body = JSON.stringify({ limit: 1000, batch: 100 });
            const headers = { 'Content-Type': 'application/json' };

            try {
              const res = await fetch(config.migrate, { method: 'POST', headers, body });
              const json = await res.json();
              if (!json.success) throw new Error(json.message || 'Lỗi Migration');
              
              alert('Migration hoàn tất! ' + (json.message || ''));
              window.location.reload();
            } catch (e) {
              alert('Lỗi Migration: ' + e.message);
            }
          }
        </script>
      </body>
      </html>
    `;

    res.send(html);
  });
}

module.exports = new SyncManagerController();
