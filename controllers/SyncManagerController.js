const BaseController = require('./BaseController');
const SyncManagerService = require('../services/SyncManagerService');
const OutgoingDocument2Model = require('../models/OutgoingDocumentModel');
const OutgoingSyncWrapperModel = require('../models/OutgoingSyncWrapperModel');
const FullTestOutgoingService = require('../services/FullTestOutgoingService');
const MigrationIncomingDocumentService = require('../services/MigrationIncomingDocumentService');

class SyncManagerController extends BaseController {
  constructor() {
    super();
    this.initialized = false;
  }

  async ensureInitialized() {
    if (this.initialized) return;

    // Đăng ký OutgoingDocuments2
    const outgoingModel = new OutgoingDocument2Model();
    await outgoingModel.initialize();
    SyncManagerService.registerModel('Đồng bộ văn bản đi về bảng trung gian', outgoingModel);

    // Đăng ký OutgoingSync (Intermediate → Main)
    const outgoingSyncModel = new OutgoingSyncWrapperModel();
    await outgoingSyncModel.initialize();
    SyncManagerService.registerModel('Đồng bộ văn bản đi', outgoingSyncModel);

    // Đăng ký Full Test Outgoing (Đẩy văn bản đi lên phần mềm)
    const fullTestService = new FullTestOutgoingService();
    await fullTestService.initialize();
    
    const fullTestWrapper = {
      getAllFromOldDb: async () => {
        // Trả về 1 record dummy để kích hoạt process 1 lần
        return [{ ID: 'FULL_TEST_RUN', Title: 'Full Test Process' }];
      },
      updateInNewDb: async () => 0, // Luôn trả về 0 để chạy insertToNewDb
      insertToNewDb: async () => {
        await fullTestService.run();
      }
    };
    SyncManagerService.registerModel('Đẩy văn bản đi lên phần mềm', fullTestWrapper);

    // TODO: Đăng ký các models khác ở đây...
    // Đăng ký Đồng bộ văn bản đến (Sử dụng MigrationIncomingDocumentService)
    const incomingService = new MigrationIncomingDocumentService();
    await incomingService.initialize();

    const incomingWrapper = {
      getAllFromOldDb: async () => {
        // Trả về 1 record dummy để kích hoạt process
        return [{ ID: 'INCOMING_MIGRATION', Title: 'Migrate Incoming Documents' }];
      },
      updateInNewDb: async () => 0,
      insertToNewDb: async () => {
        // Gọi hàm migrate của service có sẵn
        await incomingService.migrateIncomingDocuments();
      }
    };
    SyncManagerService.registerModel('Đồng bộ văn bản đến', incomingWrapper);

    this.initialized = true;
  }

  /**
   * API kích hoạt đồng bộ tất cả models
   * POST /api/sync-manager/start
   */
  startSync = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    
    // Chạy background (không await)
    SyncManagerService.syncAll().catch(err => {
      require('../utils/logger').error('Lỗi syncAll:', err);
    });

    return this.success(res, { message: 'Đã kích hoạt tiến trình đồng bộ tất cả models' });
  });

  /**
   * API kích hoạt đồng bộ model cụ thể
   * POST /api/sync-manager/sync-model/:modelName
   */
  syncModel = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { modelName } = req.params;

    // Chạy background
    SyncManagerService.syncModel(modelName).catch(err => {
      require('../utils/logger').error(`Lỗi syncModel ${modelName}:`, err);
    });

    return this.success(res, { message: `Đã kích hoạt tiến trình đồng bộ ${modelName}` });
  });

  /**
   * API dừng/hủy đồng bộ
   * POST /api/sync-manager/stop
   */
  stopSync = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    require('../utils/logger').warn('[SyncManagerController] ========== NHẬN YÊU CẦU STOP ==========');
    require('../utils/logger').warn('[SyncManagerController] Gọi SyncManagerService.cancelSync()');
    SyncManagerService.cancelSync();
    require('../utils/logger').warn('[SyncManagerController] Đã gọi cancelSync()');
    return this.success(res, { message: 'Đã gửi yêu cầu hủy đồng bộ' });
  });

  /**
   * API lấy chi tiết model
   * GET /api/sync-manager/model-details/:modelName
   */
  modelDetails = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { modelName } = req.params;

    const details = SyncManagerService.getModelDetails(modelName);
    return this.success(res, details);
  });

  /**
   * API lấy danh sách lỗi của model
   * GET /api/sync-manager/errors/:modelName
   */
  getErrors = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { modelName } = req.params;
    const { limit = 100, offset = 0 } = req.query;

    const errorLog = SyncManagerService.getErrorLog(modelName);
    const total = errorLog.length;
    const page = Math.floor(offset / limit) + 1;
    const pageErrors = errorLog.slice(offset, offset + parseInt(limit));

    return this.success(res, {
      modelName,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
      page,
      totalPages: Math.ceil(total / limit),
      errors: pageErrors
    });
  });

  /**
   * API export lỗi ra CSV
   * GET /api/sync-manager/errors/:modelName/export
   */
  exportErrors = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { modelName } = req.params;
    const { format = 'csv' } = req.query;

    const errorLog = SyncManagerService.getErrorLog(modelName);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="sync_errors_${modelName}.json"`);
      return res.send(JSON.stringify(errorLog, null, 2));
    }

    // CSV format
    let csv = 'Record ID,Error Message,Timestamp\n';
    errorLog.forEach(err => {
      const recordId = String(err.recordId).replace(/"/g, '""');
      const error = String(err.error).replace(/"/g, '""');
      csv += `"${recordId}","${error}","${err.timestamp}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="sync_errors_${modelName}.csv"`);
    return res.send(csv);
  });

  /**
   * API trả về HTML Dashboard
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
        <title>Migration Sync Dashboard</title>
        <meta http-equiv="refresh" content="1">
        <style>
          /* === CSS NỘI BỘ (Thay thế Bootstrap CDN) === */
          body { font-family: system-ui, -apple-system, sans-serif; background: #f8f9fa; margin: 0; padding: 20px; }
          .card { background: white; border: 1px solid #dee2e6; border-radius: 0.375rem; box-shadow: 0 0.5rem 1rem rgba(0,0,0,0.15); overflow: hidden; margin-bottom: 20px; }
          .card-header { background: #0d6efd; color: white; padding: 1rem; display: flex; justify-content: space-between; align-items: center; }
          .card-body { padding: 1rem; }
          .card-footer { padding: 0.5rem 1rem; background: #f8f9fa; border-top: 1px solid #dee2e6; color: #6c757d; font-size: 0.875em; }
          
          /* Tables */
          .table-responsive { overflow-x: auto; }
          .table { width: 100%; margin-bottom: 1rem; border-collapse: collapse; }
          .table th, .table td { padding: 0.5rem; border-bottom: 1px solid #dee2e6; vertical-align: middle; }
          .table-dark th { background: #212529; color: white; text-align: left; }
          .table-striped tbody tr:nth-of-type(odd) { background-color: rgba(0,0,0,.05); }
          .table-hover tbody tr:hover { background-color: rgba(0,0,0,.075); }
          
          /* Buttons */
          .btn { display: inline-block; padding: 0.375rem 0.75rem; border: 1px solid transparent; border-radius: 0.25rem; cursor: pointer; text-decoration: none; font-size: 1rem; line-height: 1.5; transition: opacity 0.2s; }
          .btn:hover { opacity: 0.9; }
          .btn:disabled { opacity: 0.65; cursor: not-allowed; }
          .btn-primary { background: #0d6efd; color: white; }
          .btn-success { background: #198754; color: white; }
          .btn-danger { background: #dc3545; color: white; }
          .btn-info { background: #0dcaf0; color: black; }
          .btn-warning { background: #ffc107; color: black; }
          .btn-outline-secondary { border-color: #6c757d; color: #6c757d; background: transparent; }
          .btn-sm { padding: 0.25rem 0.5rem; font-size: 0.875rem; }
          .btn-close { background: transparent; border: 0; font-size: 1.5rem; cursor: pointer; float: right; line-height: 1; color: #000; opacity: 0.5; }
          .btn-group { display: inline-flex; }
          .btn-group .btn { margin-right: 2px; }

          /* Badges & Progress */
          .badge { display: inline-block; padding: 0.35em 0.65em; font-size: 0.75em; font-weight: 700; line-height: 1; color: white; text-align: center; white-space: nowrap; vertical-align: baseline; border-radius: 0.25rem; }
          .bg-primary { background-color: #0d6efd; }
          .bg-success { background-color: #198754; }
          .bg-info { background-color: #0dcaf0; color: black; }
          .bg-warning { background-color: #ffc107; color: black; }
          .bg-danger { background-color: #dc3545; }
          .bg-light { background-color: #f8f9fa; color: #212529; }
          .progress { display: flex; height: 1rem; overflow: hidden; font-size: 0.75rem; background-color: #e9ecef; border-radius: 0.25rem; margin-bottom: 0.5rem; }
          .progress-bar { display: flex; flex-direction: column; justify-content: center; color: #fff; text-align: center; white-space: nowrap; background-color: #0d6efd; transition: width .6s ease; }
          
          /* Modal (Custom implementation) */
          .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1050; overflow-x: hidden; overflow-y: auto; }
          .modal.show { display: block; }
          .modal-dialog { position: relative; width: auto; margin: 1.75rem auto; max-width: 800px; pointer-events: none; }
          .modal-content { position: relative; display: flex; flex-direction: column; width: 100%; pointer-events: auto; background-color: #fff; border: 1px solid rgba(0,0,0,.2); border-radius: 0.3rem; outline: 0; box-shadow: 0 0.5rem 1rem rgba(0,0,0,0.5); }
          .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 1rem; border-bottom: 1px solid #dee2e6; }
          .modal-title { margin: 0; font-size: 1.25rem; }
          .modal-body { position: relative; flex: 1 1 auto; padding: 1rem; }
          
          /* Utilities */
          .d-flex { display: flex; }
          .justify-content-between { justify-content: space-between; }
          .align-items-center { align-items: center; }
          .text-center { text-align: center; }
          .text-muted { color: #6c757d; }
          .mb-0 { margin-bottom: 0; }
          .mb-4 { margin-bottom: 1.5rem; }
          .me-2 { margin-right: 0.5rem; }
          .mt-2 { margin-top: 0.5rem; }
          .alert { padding: 1rem; margin-bottom: 1rem; border: 1px solid transparent; border-radius: 0.25rem; }
          .alert-warning { color: #664d03; background-color: #fff3cd; border-color: #ffecb5; }
          .alert-info { color: #055160; background-color: #cff4fc; border-color: #b6effb; }
          .spinner-border { display: inline-block; width: 1rem; height: 1rem; vertical-align: text-bottom; border: .2em solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spinner-border .75s linear infinite; }
          @keyframes spinner-border { 100% { transform: rotate(360deg); } }

          .status-idle { color: #6c757d; }
          .status-running { color: #0d6efd; font-weight: bold; animation: pulse 1s infinite; }
          .status-completed { color: #198754; font-weight: bold; }
          .status-error { color: #dc3545; font-weight: bold; }
          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
          .progress { height: 25px; }
          .card-body { font-size: 0.95rem; }
          .stats-badge { font-size: 1.1rem; padding: 0.5rem 1rem; }
        </style>
      </head>
      <body class="bg-light">
        <div class="container-fluid py-4">
          <div class="card shadow-lg">
            <div class="card-header bg-primary text-white d-flex justify-content-between align-items-center">
              <div>
                <h2 class="mb-0">Trung Tâm Điều Khiển Đồng Bộ Dữ Liệu</h2>
                <small>Batch Size: ${data.batchSize} | Cập nhật lần cuối: ${new Date(data.timestamp).toLocaleString('vi-VN')}</small>
              </div>
              <span class="badge bg-light text-dark fs-5">
                ${data.isRunning ? '⚙️ ĐANG CHẠY...' : '✓ SẴN SÀNG'}
              </span>
            </div>

            <div class="card-body">
              <div class="mb-4">
                <button type="button" onclick="triggerSyncAll()" class="btn btn-success btn-lg me-2" ${data.isRunning ? 'disabled' : ''}>
                  ▶ Đồng bộ tất cả Models
                </button>
                <button type="button" onclick="triggerStopSync()" class="btn btn-danger btn-lg" ${data.isRunning ? '' : 'disabled'}>
                  ⏹ Dừng Đồng Bộ
                </button>
              </div>

              <div class="table-responsive">
                <table class="table table-hover table-striped align-middle">
                  <thead class="table-dark sticky-top">
                    <tr>
                      <th style="width: 20%;">Model</th>
                      <th style="width: 10%;">Tổng số</th>
                      <th style="width: 10%;">Đã xử lý</th>
                      <th style="width: 20%;">Trạng thái</th>
                      <th style="width: 15%;">Thống kê</th>
                      <th style="width: 10%;">Trạng thái</th>
                      <th style="width: 15%;">Hành động</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${Object.entries(data.entities).map(([name, info]) => {
                      let total = (info.synced || 0) + (info.skipped || 0) + (info.errors || 0) + (info.remaining || 0);
                      if (name === 'Đồng bộ văn bản đi') total = 35909;
                      if (name === 'Đồng bộ văn bản đến') total = 290001;
                      if (name === 'Đồng bộ văn bản đi về bảng trung gian') total = 32048;

                      const processed = (info.synced || 0) + (info.skipped || 0) + (info.errors || 0);
                      let pct = info.progressPercent || 0;
                      if (name === 'Đồng bộ văn bản đi' || name === 'Đồng bộ văn bản đến' || name === 'Đồng bộ văn bản đi về bảng trung gian') {
                        pct = total > 0 ? Math.floor((processed / total) * 100) : 0;
                      }

                      const statusClass = info.status === 'running' ? 'status-running' : 
                                         info.status === 'completed' ? 'status-completed' :
                                         info.status === 'error' ? 'status-error' : 'status-idle';
                      return `
                        <tr>
                          <td><strong>${name}</strong></td>
                          <td><strong>${total.toLocaleString('vi-VN')}</strong></td>
                          <td><strong>${processed.toLocaleString('vi-VN')}</strong></td>
                          <td>
                            <div class="progress">
                              <div class="progress-bar ${pct >= 75 ? 'bg-success' : pct >= 50 ? 'bg-info' : pct >= 25 ? 'bg-warning' : 'bg-secondary'}" 
                                   role="progressbar" 
                                   style="width: ${pct}%;" 
                                   aria-valuenow="${pct}" 
                                   aria-valuemin="0" 
                                   aria-valuemax="100">
                                ${pct}%
                              </div>
                            </div>
                          </td>
                          <td>
                            <small>
                              <span class="badge bg-primary">Synced: ${info.synced}</span>
                              <span class="badge bg-warning">Skip: ${info.skipped}</span>
                              <span class="badge bg-danger">Error: ${info.errors}</span>
                              <br/>
                              <span class="text-muted">Remaining: ${info.remaining}</span>
                            </small>
                          </td>
                          <td>
                            <span class="${statusClass}">${info.status.toUpperCase()}</span>
                            <br/>
                            <small class="text-muted">${info.lastRun ? new Date(info.lastRun).toLocaleTimeString('vi-VN') : '-'}</small>
                          </td>
                          <td>
                            <div class="btn-group btn-group-sm" role="group">
                              <button type="button" onclick="triggerSyncModel('${name}')" class="btn btn-primary" ${data.isRunning ? 'disabled' : ''}>
                                Sync
                              </button>
                              <button type="button" onclick="showDetails('${name}')" class="btn btn-info">
                                Chi tiết
                              </button>
                              <button type="button" onclick="showErrors('${name}')" class="btn btn-warning" id="error-btn-${name}" ${info.errors > 0 ? '' : 'disabled'}>
                                Lỗi (${info.errors})
                              </button>
                            </div>
                            <div class="mt-2">
                              ${info.errors > 0 ? `
                                <a href="/api/sync-manager/errors/${name}/export?format=csv" class="btn btn-sm btn-outline-secondary" target="_blank">⬇ CSV</a>
                                <a href="/api/sync-manager/errors/${name}/export?format=json" class="btn btn-sm btn-outline-secondary" target="_blank">⬇ JSON</a>
                              ` : ''}
                            </div>
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>

              ${Object.keys(data.entities).length === 0 ? '<p class="text-center text-muted">Chưa có model nào được đăng ký.</p>' : ''}
            </div>

            <div class="card-footer text-muted">
              <small>Tự động làm mới mỗi 3 giây | Total Models: ${Object.keys(data.entities).length}</small>
            </div>
          </div>
        </div>

        <!-- Modal Chi tiết Model -->
        <div class="modal fade" id="detailsModal" tabindex="-1">
          <div class="modal-dialog modal-lg">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">Chi tiết Model: <span id="detailModelName"></span></h5>
                <button type="button" class="btn-close" onclick="closeModal('detailsModal')">×</button>
              </div>
              <div class="modal-body" id="detailsBody">
                <p class="text-center"><span class="spinner-border spinner-border-sm"></span></p>
              </div>
            </div>
          </div>
        </div>

        <!-- Modal Danh sách Lỗi -->
        <div class="modal fade" id="errorsModal" tabindex="-1">
          <div class="modal-dialog modal-xl">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">Danh sách Lỗi</h5>
                <button type="button" class="btn-close" onclick="closeModal('errorsModal')">×</button>
              </div>
              <div class="modal-body" id="errorsBody">
                <p class="text-center"><span class="spinner-border spinner-border-sm"></span></p>
              </div>
            </div>
          </div>
        </div>

        <script>
          // === JS NỘI BỘ (Thay thế Bootstrap JS) ===
          function openModal(id) {
            const el = document.getElementById(id);
            el.style.display = 'block';
            setTimeout(() => el.classList.add('show'), 10); // Add class for potential transition
          }

          function closeModal(id) {
            const el = document.getElementById(id);
            el.classList.remove('show');
            el.style.display = 'none';
          }

          // Close modal when clicking outside
          window.onclick = function(event) {
            if (event.target.classList.contains('modal')) {
              event.target.style.display = 'none';
              event.target.classList.remove('show');
            }
          }

          async function triggerSyncAll() {
            if (!confirm('Đồng bộ tất cả models? Quá trình này có thể mất một lúc.')) return;
            try {
              const res = await fetch('/api/sync-manager/start', { method: 'POST', headers: {'Content-Type': 'application/json'} });
              const json = await res.json();
              alert(json.message || 'Đã gửi lệnh');
            } catch (e) {
              alert('Lỗi: ' + e.message);
            }
          }

          async function triggerStopSync() {
            if (!confirm('Bạn chắc chắn muốn dừng đồng bộ?')) return;
            try {
              const res = await fetch('/api/sync-manager/stop', { method: 'POST', headers: {'Content-Type': 'application/json'} });
              const json = await res.json();
              alert(json.message || 'Đã gửi lệnh dừng');
            } catch (e) {
              alert('Lỗi: ' + e.message);
            }
          }

          async function triggerSyncModel(modelName) {
            if (!confirm(\`Đồng bộ \${modelName}?\`)) return;
            try {
              const res = await fetch(\`/api/sync-manager/sync-model/\${modelName}\`, { method: 'POST', headers: {'Content-Type': 'application/json'} });
              const json = await res.json();
              alert(json.message || 'Đã gửi lệnh');
            } catch (e) {
              alert('Lỗi: ' + e.message);
            }
          }

          async function showDetails(modelName) {
            openModal('detailsModal');
            document.getElementById('detailModelName').textContent = modelName;
            
            try {
              const res = await fetch('/api/sync-manager/model-details/' + modelName);
              const json = await res.json();
              const data = json.data;

              let html = '<table class="table table-sm">';
              html += '<tr><td><strong>Status:</strong></td><td><span class="badge bg-info">' + data.status.toUpperCase() + '</span></td></tr>';
              html += '<tr><td><strong>Total:</strong></td><td>' + data.total + '</td></tr>';
              html += '<tr><td><strong>Synced:</strong></td><td>' + data.synced + '</td></tr>';
              html += '<tr><td><strong>Skipped:</strong></td><td>' + data.skipped + '</td></tr>';
              html += '<tr><td><strong>Errors:</strong></td><td>' + data.errors + '</td></tr>';
              html += '<tr><td><strong>Remaining:</strong></td><td>' + data.remaining + '</td></tr>';
              html += '<tr><td><strong>Progress:</strong></td><td>' + data.progressPercent + '%</td></tr>';
              html += '<tr><td><strong>Last Run:</strong></td><td>' + (data.lastRun ? new Date(data.lastRun).toLocaleString('vi-VN') : '-') + '</td></tr>';
              html += '<tr><td><strong>Last Sync Time:</strong></td><td>' + (data.lastSyncTime || 'N/A') + '</td></tr>';
              html += '</table>';

              if (data.errorLog && data.errorLog.length > 0) {
                html += '<h6 class="mt-3">Error Log:</h6><div style="max-height: 200px; overflow-y: auto;"><ul class="small">';
                data.errorLog.forEach(err => {
                  html += '<li>ID ' + err.recordId + ': ' + err.error + ' (' + err.timestamp + ')</li>';
                });
                html += '</ul></div>';
              }

              document.getElementById('detailsBody').innerHTML = html;
            } catch (e) {
              document.getElementById('detailsBody').innerHTML = '<p class="text-danger">Lỗi tải chi tiết: ' + e.message + '</p>';
            }
          }

          async function showErrors(modelName) {
            openModal('errorsModal');
            const modalTitle = document.querySelector('#errorsModal .modal-title');
            const errorsBody = document.getElementById('errorsBody');
            
            modalTitle.textContent = 'Danh sách Lỗi: ' + modelName;
            errorsBody.innerHTML = '<p class="text-center"><span class="spinner-border spinner-border-sm"></span></p>';
            
            try {
              const res = await fetch('/api/sync-manager/errors/' + modelName + '?limit=1000');
              const json = await res.json();
              
              if (!json.success || json.data.errors.length === 0) {
                errorsBody.innerHTML = '<p class="alert alert-info">Không có lỗi</p>';
                return;
              }

              let html = '<div class="alert alert-warning"><strong>Tổng lỗi: ' + json.data.total + '</strong>';
              html += '<a href="/api/sync-manager/errors/' + modelName + '/export?format=csv" class="btn btn-sm btn-outline-secondary ms-2" target="_blank">⬇ CSV</a>';
              html += '<a href="/api/sync-manager/errors/' + modelName + '/export?format=json" class="btn btn-sm btn-outline-secondary" target="_blank">⬇ JSON</a>';
              html += '</div><div style="max-height: 500px; overflow-y: auto;"><table class="table table-sm table-striped">';
              html += '<thead class="table-dark sticky-top"><tr><th style="width: 20%;">Record ID</th><th style="width: 60%;">Lỗi</th><th style="width: 20%;">Thời gian</th></tr></thead><tbody>';

              json.data.errors.forEach(err => {
                const time = new Date(err.timestamp).toLocaleString('vi-VN');
                html += '<tr><td>' + err.recordId + '</td><td><code>' + err.error + '</code></td><td>' + time + '</td></tr>';
              });

              html += '</tbody></table></div>';
              errorsBody.innerHTML = html;
            } catch (e) {
              errorsBody.innerHTML = '<p class="text-danger">Lỗi tải danh sách lỗi: ' + e.message + '</p>';
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