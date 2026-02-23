const BaseController = require('../controllers/BaseController');
const SyncManagerService = require('./SyncManagerService');
const SyncOutgoingModel = require('./sync-outgoing-document/apply/SyncOutgoingModel');

const SyncAuditModel = require('./sync-audit/apply/SyncAuditModel');
const logger = require('../utils/logger');

class SyncManagerController extends BaseController {
  constructor() {
    super();
    this.initialized = false;
  }

  async ensureInitialized() {
    if (this.initialized) return;

    const outgoingModel = new SyncOutgoingModel();
    await outgoingModel.initialize();

    SyncManagerService.register(
      'SYNC_OUTGOING_DOCUMENT',
      async (lastTime, limit, _offset, cursor = {}) => {
        const lastSyncId = Number(cursor.lastSyncId || 0);
        const query = `
          SELECT TOP (@limit) *
          FROM (
            SELECT
              *,
              COALESCE(updated_at, created_at, [Modified], [Created]) AS __sync_time,
              ISNULL(CAST(id AS BIGINT), 0) AS __sync_id
            FROM camunda.${outgoingModel.syncSchema}.${outgoingModel.syncTable}
          ) src
          WHERE (
            src.__sync_time > @lastTime
            OR (src.__sync_time = @lastTime AND src.__sync_id > @lastSyncId)
          )
          ORDER BY src.__sync_time ASC, src.__sync_id ASC
        `;

        const records = await outgoingModel.queryNewDbTx(query, {
          lastTime,
          lastSyncId,
          limit
        });

        return records.map((record) => ({
          ...record,
          updated_at: record.updated_at || record.__sync_time,
          __sync_id: record.__sync_id
        }));
      },
      async (record) => {
        await outgoingModel.insertBatchToMain([record]);
      }
    );

    logger.info('[SyncManagerController] Registered SYNC_OUTGOING_DOCUMENT');

    const auditModel = new SyncAuditModel();
    await auditModel.initialize();

    SyncManagerService.register(
      'SYNC_AUDIT',
      async (lastTime, limit, _offset, cursor = {}) => {
        const lastSyncId = Number(cursor.lastSyncId || 0);
        const query = `
          SELECT TOP (@limit) *
          FROM (
            SELECT
              *,
              COALESCE(updated_at, created_at, [Modified], [Created]) AS __sync_time,
              ISNULL(CAST(id AS BIGINT), 0) AS __sync_id
            FROM camunda.${auditModel.syncSchema}.${auditModel.syncTable}
          ) src
          WHERE (
            src.__sync_time > @lastTime
            OR (src.__sync_time = @lastTime AND src.__sync_id > @lastSyncId)
          )
          ORDER BY src.__sync_time ASC, src.__sync_id ASC
        `;

        const records = await auditModel.queryNewDbTx(query, {
          lastTime,
          lastSyncId,
          limit
        });

        return records.map((record) => ({
          ...record,
          updated_at: record.updated_at || record.__sync_time,
          __sync_id: record.__sync_id
        }));
      },
      async (record) => {
        await auditModel.insertBatchToMain([record]);
      }
    );

    logger.info('[SyncManagerController] Registered SYNC_AUDIT');
    this.initialized = true;
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
    const data = SyncManagerService.getDashboardData();

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
          .status-completed { color: #198754; font-weight: bold; }
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
                ${data.isRunning ? 'DANG CHAY...' : 'DANG CHO'}
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
                    <th>TOTAL SYNCHRONIZED</th>
                    <th>LAST SYNC TIME</th>
                    <th>LAST RUN TIME</th>
                    <th>CURRENT JOB</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${Object.entries(data.entities).map(([name, info]) => `
                    ${(() => {
                      const currentJob = info.activeJobId ? data.jobs[info.activeJobId] : null;
                      const canPause = currentJob && ['RUNNING', 'PAUSE_REQUESTED', 'RESUMING'].includes(currentJob.status);
                      const canResume = currentJob && currentJob.status === 'PAUSED';
                      const canStart = !['RUNNING', 'PAUSE_REQUESTED', 'RESUMING'].includes(info.status);
                      const actionHtml = `
                        <button class="btn btn-sm btn-primary me-1" onclick="startModel('${name}', false)" ${canStart ? '' : 'disabled'}>Start</button>
                        <button class="btn btn-sm btn-outline-danger me-1" onclick="startModel('${name}', true)" ${canStart ? '' : 'disabled'}>Reset</button>
                        <button class="btn btn-sm btn-warning me-1" onclick="pauseJob('${currentJob ? currentJob.jobId : ''}')" ${canPause ? '' : 'disabled'}>Pause</button>
                        <button class="btn btn-sm btn-success" onclick="resumeJob('${currentJob ? currentJob.jobId : ''}')" ${canResume ? '' : 'disabled'}>Resume</button>
                      `;
                      const jobInfo = currentJob
                        ? `${currentJob.jobId}<br/><small>${currentJob.status}</small>`
                        : '-';
                      return `
                    <tr>
                      <td>${name}</td>
                      <td class="status-${info.status.toLowerCase()}">${info.status}</td>
                      <td>${info.totalSynced.toLocaleString()}</td>
                      <td>${info.lastSyncTime || 'Chua co'}</td>
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
