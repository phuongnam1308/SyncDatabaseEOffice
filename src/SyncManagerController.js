const BaseController = require('../controllers/BaseController');
const SyncManagerService = require('./SyncManagerService');
const SyncOutgoingModel = require('./sync-outgoing-document/apply/SyncOutgoingModel');
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
      async (lastTime, limit, offset) => {
        const query = `
          SELECT *
          FROM (
            SELECT
              *,
              COALESCE(updated_at, created_at, [Modified], [Created]) AS __sync_time
            FROM camunda.${outgoingModel.syncSchema}.${outgoingModel.syncTable}
          ) src
          WHERE src.__sync_time > @lastTime
          ORDER BY src.__sync_time ASC, src.id ASC
          OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `;

        const records = await outgoingModel.queryNewDbTx(query, {
          lastTime,
          offset,
          limit
        });

        return records.map((record) => ({
          ...record,
          updated_at: record.updated_at || record.__sync_time
        }));
      },
      async (record) => {
        await outgoingModel.insertBatchToMain([record]);
      }
    );

    logger.info('[SyncManagerController] Registered SYNC_OUTGOING_DOCUMENT');
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
                  Tiep tuc dong bo (Incremental)
                </button>
                <button onclick="triggerSync(true)" class="btn btn-danger" ${data.isRunning ? 'disabled' : ''}>
                  Dong bo lai tu dau (Reset)
                </button>
              </div>

              <table class="table table-hover table-bordered">
                <thead class="table-dark">
                  <tr>
                    <th>Doi tuong</th>
                    <th>Trang thai</th>
                    <th>Tong da sync</th>
                    <th>Moc thoi gian</th>
                    <th>Lan chay cuoi</th>
                  </tr>
                </thead>
                <tbody>
                  ${Object.entries(data.entities).map(([name, info]) => `
                    <tr>
                      <td>${name}</td>
                      <td class="status-${info.status.toLowerCase()}">${info.status}</td>
                      <td>${info.totalSynced.toLocaleString()}</td>
                      <td>${info.lastSyncTime || 'Chua co'}</td>
                      <td>${info.lastRun ? new Date(info.lastRun).toLocaleString('vi-VN') : '-'}</td>
                    </tr>
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
              const res = await fetch('/api/sync-manager/start', {
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
        </script>
      </body>
      </html>
    `;

    res.send(html);
  });
}

module.exports = new SyncManagerController();
