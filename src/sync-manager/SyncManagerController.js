const BaseController = require('../../controllers/BaseController');
const SyncManagerService = require('./SyncManagerService');
const SyncOutgoingModel = require('../sync-outgoing-document/apply/SyncOutgoingModel');
const SyncAuditModel = require('../sync-audit/apply/SyncAuditModel');
const SyncHandlerModel = require('./SyncHandlerModel');
const logger = require('../../utils/logger');

class SyncManagerController extends BaseController {
  constructor() {
    super();
    this.initialized = false;
  }

  async ensureInitialized() {
    if (this.initialized) return;

    try {
      // Register SYNC_OUTGOING_DOCUMENT
      const outgoingModel = new SyncOutgoingModel();
      await outgoingModel.initialize();
      const outgoingHandler = new SyncHandlerModel(outgoingModel);
      await outgoingHandler.registerHandlers(SyncManagerService, 'SYNC_OUTGOING_DOCUMENT');

      // Register SYNC_AUDIT
      const auditModel = new SyncAuditModel();
      await auditModel.initialize();
      const auditHandler = new SyncHandlerModel(auditModel);
      await auditHandler.registerHandlers(SyncManagerService, 'SYNC_AUDIT');

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

    return this.success(res, { message: 'Da kich hoat tien trinh dong bo background' });
  });

  startModelSync = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { modelName } = req.params;
    const { reset = false, batchSize } = req.body || {};

    const result = SyncManagerService.startModel(modelName, {
      reset: reset === true || reset === 'true',
      batchSize
    });

    return this.success(res, result, 'Da kich hoat dong bo model');
  });

  pauseJobSync = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { jobId } = req.params;
    const result = SyncManagerService.pauseJob(jobId);
    return this.success(res, result, 'Da gui yeu cau pause');
  });

  resumeJobSync = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { jobId } = req.params;
    const result = SyncManagerService.resumeJob(jobId);
    return this.success(res, result, 'Da tiep tuc tien trinh pause');
  });

  getJobSyncStatus = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { jobId } = req.params;
    const job = SyncManagerService.getJob(jobId);
    if (!job) {
      return this.notFound(res, `Khong tim thay job ${jobId}`);
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
              <h3 class="mb-0">Sync Manager Dashboard</h3>
              <span class="badge bg-light text-dark">
                ${data.isRunning ? 'SYNCING...' : 'WAITING...'}
              </span>
            </div>
            <div class="card-body">
              <div class="mb-4">
                <button onclick="triggerSync(false)" class="btn btn-success me-2" ${data.isRunning ? 'disabled' : ''}>
                  Chay tat ca model (Incremental)
                </button>
                <button onclick="triggerSync(true)" class="btn btn-danger" ${data.isRunning ? 'disabled' : ''}>
                  Chay tat ca model (Reset)
                </button>
              </div>

              <table class="table table-hover table-bordered">
                <thead class="table-dark">
                  <tr>
                    <th>MODEL</th>
                    <th>STATUS</th>
                    <th>PROGRESS</th>
                    <th>SYNCED / TOTAL</th>
                    <th>PERCENT</th>
                    <th>LAST SYNC TIME</th>
                    <th>LAST RUN TIME</th>
                    <th>CURRENT JOB</th>
                    <th>Action</th>
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

        const actionHtml = `
                        <button class="btn btn-sm btn-primary me-1" onclick="startModel('${name}', false)" ${canStart ? '' : 'disabled'}>Start</button>
                        <button class="btn btn-sm btn-outline-danger me-1" onclick="startModel('${name}', true)" ${canStart ? '' : 'disabled'}>Reset</button>
                        <button class="btn btn-sm btn-warning me-1" onclick="pauseJob('${currentJob ? currentJob.jobId : ''}')" ${canPause ? '' : 'disabled'}>Pause</button>
                        <button class="btn btn-sm btn-success" onclick="resumeJob('${resumeJobId}')" ${canResume ? '' : 'disabled'}>Resume</button>
                      `;
        const jobInfo = currentJob
          ? `${currentJob.jobId}<br/><small>${currentJob.status}</small>`
          : '-';

        const progressBar = info.currentProgressPercent != null
          ? `<div class="progress" style="height: 20px;"><div class="progress-bar" role="progressbar" style="width: ${info.currentProgressPercent}%;" aria-valuenow="${info.currentProgressPercent}" aria-valuemin="0" aria-valuemax="100">${info.currentProgressPercent}%</div></div>`
          : '-';

        const syncedTotal = info.currentTotalToSync != null
          ? `${(info.currentSynced || 0).toLocaleString()} / ${info.currentTotalToSync.toLocaleString()}`
          : '-';

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
                      <td>${actionHtml}</td>
                    </tr>
                  `;
      })()}
                  `).join('')}
                </tbody>
              </table>

              ${Object.keys(data.entities).length === 0 ? '<p class="text-center text-muted">Chua co doi tuong nao duoc dang ky.</p>' : ''}
            </div>
            <div class="card-footer text-muted">
              Tu dong refresh moi 5 giay.
            </div>
          </div>
        </div>

        <script>
          async function triggerSync(reset) {
            if(!confirm(reset ? 'Ban chac chan muon chay lai tu dau?' : 'Bat dau dong bo tiep theo?')) return;

            try {
              const res = await fetch('/api/sync-manager-src/start', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ reset })
              });
              const json = await res.json();
              alert(json.message || 'Da gui lenh');
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
              alert(json.message || 'Da gui lenh');
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
              alert(json.message || 'Da gui lenh pause');
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
              alert(json.message || 'Da gui lenh resume');
              window.location.reload();
            } catch (e) {
              alert('Loi: ' + e.message);
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
