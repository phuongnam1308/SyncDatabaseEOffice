const BaseController = require('../../controllers/BaseController');
const SyncManagerService = require('./SyncManagerService');
const SyncOutgoingModel = require('../sync-outgoing-document/apply/SyncOutgoingModel');
const StreamOutgoingMigrationModel = require('../sync-outgoing-document/migrate/StreamOutgoingMigrationModel');
const SyncAuditModel = require('../sync-audit/apply/SyncAuditModel');
const SyncHandlerModel = require('./SyncHandlerModel');
const SyncStateRepository = require('./SyncStateRepository');
const logger = require('../../utils/logger');
const StreamCommentMigrationModel = require('../sync-document-comment/migration/StreamCommentMigrationModel');
const SyncCommentModel = require('../sync-document-comment/apply/SyncCommentModel');
const StreamOutgoingAuditSyncModel = require('../sync-audit/migrate/StreamAuditMigrationModel');

class SyncManagerController extends BaseController {
  constructor() {
    super();
    this.initialized = false;
  }

  // ── Giữ nguyên hoàn toàn ──────────────────────────────────
  async ensureInitialized() {
    if (this.initialized) return;
    try {
      const outgoingModel = new SyncOutgoingModel();
      await outgoingModel.initialize();
      const outgoingHandler = new SyncHandlerModel(outgoingModel);
      await outgoingHandler.registerHandlers(SyncManagerService, 'Đồng bộ văn bản đi');
      await SyncStateRepository.ensureModel('Đồng bộ văn bản đi'); // Đăng ký vào DB

      const streamOutgoingMigrationModel = new StreamOutgoingMigrationModel();
      await streamOutgoingMigrationModel.initialize();
      const streamOutgoingMigrationHandler = new SyncHandlerModel(streamOutgoingMigrationModel);
      await streamOutgoingMigrationHandler.registerHandlers(SyncManagerService, 'Đồng bộ cơ sở dữ liệu cũ về bảng trung gian: văn bản đi');
      await SyncStateRepository.ensureModel('Đồng bộ cơ sở dữ liệu cũ về bảng trung gian: văn bản đi'); // Đăng ký vào DB

      const auditModel = new SyncAuditModel();
      await auditModel.initialize();
      const auditHandler = new SyncHandlerModel(auditModel);
      await auditHandler.registerHandlers(SyncManagerService, 'Đồng bộ nhật kí thao tác văn bản');
      await SyncStateRepository.ensureModel('Đồng bộ nhật kí thao tác văn bản'); // Đăng ký vào DB

      const streamOutgoingAuditSyncModel = new StreamOutgoingAuditSyncModel();
      await streamOutgoingAuditSyncModel.initialize();
      const streamOutgoingAuditSyncHandler = new SyncHandlerModel(streamOutgoingAuditSyncModel);
      await streamOutgoingAuditSyncHandler.registerHandlers(SyncManagerService, 'Đồng bộ cơ sở dữ liệu cũ về bảng trung gian: nhật kí thao tác văn bản');
      await SyncStateRepository.ensureModel('Đồng bộ cơ sở dữ liệu cũ về bảng trung gian: nhật kí thao tác văn bản'); // Đăng ký vào DB

      const syncCommentModel = new SyncCommentModel();
      await syncCommentModel.initialize();
      const syncCommentHandler = new SyncHandlerModel(syncCommentModel);
      await syncCommentHandler.registerHandlers(SyncManagerService, 'Đồng bộ bình luận văn bản');
      await SyncStateRepository.ensureModel('Đồng bộ bình luận văn bản'); // Đăng ký vào DB

      const streamCommentMigrationModel = new StreamCommentMigrationModel();
      await streamCommentMigrationModel.initialize();
      const streamCommentMigrationHandler = new SyncHandlerModel(streamCommentMigrationModel);
      await streamCommentMigrationHandler.registerHandlers(SyncManagerService, 'Đồng bộ cơ sở dữ liệu cũ về bảng trung gian: bình luận văn bản');
      await SyncStateRepository.ensureModel('Đồng bộ cơ sở dữ liệu cũ về bảng trung gian: bình luận văn bản'); // Đăng ký vào DB

      // Register SYNC_FILE
      const SyncFileModel = require('../sync-file/apply/SyncFileModel');
      const fileModel = new SyncFileModel();
      await fileModel.initialize();
      const fileHandler = new SyncHandlerModel(fileModel);
      await fileHandler.registerHandlers(SyncManagerService, 'Đồng bộ file tài liệu');

      this.initialized = true;
    } catch (error) {
      logger.error('[SyncManagerController] Failed to initialize:', error);
      throw error;
    }
  }

  // ── Routes cũ — giữ nguyên hoàn toàn ─────────────────────

  startSync = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { reset } = req.body;
    SyncManagerService.start(reset === true || reset === 'true');
    return this.success(res, { message: 'Đã kích hoạt tiến trình đồng bộ' });
  });

  startModelSync = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { modelName } = req.params;
    const { reset = false, batchSize } = req.body || {};

    const result = SyncManagerService.startModel(modelName, {
      reset: reset === true || reset === 'true',
      batchSize
    });
    return this.success(res, result, 'Đã kích hoạt đồng bộ đối tượng');
  });

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
    if (!job) return this.notFound(res, `Không tìm thấy bản ghi với số mã : ${jobId}`);
    return this.success(res, job);
  });

  // ── MỚI: SSE endpoint ─────────────────────────────────────

  /**
   * GET /api/sync-manager-src/events
   * Thêm vào router: router.get('/events', ctrl.sseEvents);
   */
  sseEvents = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    const ka = setInterval(() => {
      try { res.write(': ka\n\n'); } catch (_) { clearInterval(ka); }
    }, 25_000);
    req.on('close', () => clearInterval(ka));
    SyncManagerService.addSSEClient(res);
  });

  // ── Dashboard — giống bản gốc, bỏ meta refresh, thêm SSE JS

  getDashboard = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();

    // THAY ĐỔI: Lấy dữ liệu từ DB (Repository) thay vì JSON (Service)
    // const data = await SyncManagerService.getDashboardData(); 
    const data = await SyncStateRepository.getDashboardData();
    const initialRows = this._renderRows(data.entities, data.jobs);

    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Migration Dashboard</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <style>
    .status-running         { color: #0d6efd; font-weight: bold; }
    .status-resuming        { color: #0d6efd; font-weight: bold; }
    .status-pause_requested { color: #fd7e14; font-weight: bold; }
    .status-paused          { color: #fd7e14; font-weight: bold; }
    .status-completed       { color: #198754; font-weight: bold; }
    .status-failed          { color: #dc3545; font-weight: bold; }
    .status-crashed         { color: #dc3545; font-weight: bold; }
    .status-error           { color: #dc3545; font-weight: bold; }
    .status-idle            { color: #6c757d; }
    .progress-bar           { transition: width 0.6s ease-in-out, background-color 0.3s ease; }
  </style>
</head>
<body class="bg-light">
  <div class="container py-5">
    <div class="card shadow">
      <div class="card-header bg-primary text-white d-flex justify-content-between align-items-center">
        <h3 class="mb-0">BẢNG ĐIỀU KHIỂN ĐỒNG BỘ</h3>
        <div class="d-flex align-items-center gap-2">
          <span id="running-badge" class="badge bg-light text-dark">
            ${data.isRunning ? 'Đang đồng bộ...' : 'Sẵn sàng'}
          </span>
          <span id="sse-dot" title="Trạng thái kết nối realtime">⏳</span>
        </div>
      </div>
      <div class="card-body">
        <div class="mb-4">
          <button id="btn-all"   onclick="triggerSync(false)" class="btn btn-success me-2" ${data.isRunning ? 'disabled' : ''}>Chạy tất cả các đối tượng</button>
          <button id="btn-reset" onclick="triggerSync(true)"  class="btn btn-danger"       ${data.isRunning ? 'disabled' : ''}>Chạy lại toàn bộ tất cả đối tượng</button>
        </div>
        <table class="table table-hover table-bordered">
          <thead class="table-dark">
            <tr>
              <th>ĐỐI TƯỢNG</th><th>TRẠNG THÁI</th><th>TIẾN TRÌNH</th>
              <th>SỐ LƯỢNG / TỔNG SỐ</th><th>PHẦN TRĂM</th>
              <th>LẦN ĐỒNG BỘ GẦN NHẤT</th><th>LẦN ĐỒNG BỘ CUỐI</th>
              <th>PHIÊN ĐỒNG BỘ HIỆN TẠI</th><th>HÀNH ĐỘNG</th>
            </tr>
          </thead>
          <tbody id="sync-tbody">${initialRows}</tbody>
        </table>
        ${Object.keys(data.entities).length === 0
        ? '<p class="text-center text-muted">Chưa có đối tượng nào được đăng kí đồng bộ liên hệ quản trị viên</p>'
        : ''}
      </div>
      <div class="card-footer text-muted d-flex justify-content-between">
        <span>Cập nhật realtime qua SSE (không còn refresh 5s)</span>
        <span id="last-update"></span>
      </div>
    </div>
  </div>

  <script>
    // ── SSE: nhận update realtime từ server ──────────────────
    let _es = null;
    let retryCount = 0;
    const maxRetries = 2; // Giới hạn số lần thử lại trước khi báo sự cố

    function connectSSE() {
      _es = new EventSource('/api/sync-manager-src/events');
      _es.onopen    = () => { 
        document.getElementById('sse-dot').textContent = '🟢'; 
        retryCount = 0; // Reset bộ đếm khi kết nối thành công
      };
      _es.onopen    = () => { document.getElementById('sse-dot').textContent = '🟢'; };
      _es.onerror   = () => {
        document.getElementById('sse-dot').textContent = '🔴';
        _es.close();
        
        retryCount++;
        if (retryCount >= maxRetries) {
          // Nếu lỗi quá số lần quy định -> Chuyển trạng thái CRASHED và DỪNG
          document.getElementById('running-badge').textContent = 'Gặp sự cố  (Mất kết nối)';
          document.getElementById('running-badge').className = 'badge bg-danger text-white';
          return; // Không gọi setTimeout nữa
          // Nếu lỗi 2 lần liên tiếp -> Dừng và báo SỰ CỐ
          const badge = document.getElementById('running-badge');
          badge.textContent = 'SỰ CỐ (MẤT KẾT NỐI)';
          badge.className = 'badge bg-danger text-white';
          return; // Dừng, không gọi setTimeout nữa
        };

        setTimeout(connectSSE, 2000); // Thử lại sau 2s
        setTimeout(connectSSE, 3000); // reconnect sau 3s
      };
      _es.onmessage = (e) => {
        try { renderDashboard(JSON.parse(e.data)); } catch(_) {}
      };
    }

    function renderDashboard(data) {
      document.getElementById('running-badge').textContent =
        data.isRunning ? 'Đang đồng bộ...' : 'Sẵn sàng';
      document.getElementById('btn-all').disabled   = data.isRunning;
      document.getElementById('btn-reset').disabled = data.isRunning;
      document.getElementById('sync-tbody').innerHTML =
        buildRows(data.entities || {}, data.jobs || {});
      document.getElementById('last-update').textContent =
        'Cập nhật: ' + new Date().toLocaleTimeString('vi-VN');
    }

    function buildRows(entities, jobs) {
      return Object.entries(entities).map(([n, i]) => buildRow(n, i, jobs)).join('');
    }

    function buildRow(name, info, jobs) {
      const rel = Object.values(jobs)
        .filter(j => j.modelName === name)
        .sort((a,b) => new Date(b.updatedAt||b.startedAt||0) - new Date(a.updatedAt||a.startedAt||0));

      const rp  = rel.find(j => ['RUNNING','PAUSE_REQUESTED','RESUMING','PAUSED'].includes(j.status));
      const cur = (info.activeJobId && jobs[info.activeJobId]) ? jobs[info.activeJobId] : (rp || rel[0] || null);

      let ms = (info.status||'IDLE').toUpperCase();
if (cur && ['RUNNING','RESUMING','PAUSE_REQUESTED'].includes(cur.status)) {
  const last = new Date(cur.updatedAt || cur.startedAt || 0).getTime();

  if (new Date().getTime() - last > 60000) {
    cur.status = 'CRASHED';
    ms = 'CRASHED';
  }
}
      if (cur && ['RUNNING','RESUMING','PAUSE_REQUESTED'].includes(cur.status)) {
        const last = new Date(cur.updatedAt || cur.startedAt || 0).getTime();
        if (new Date().getTime() - last > 60000) {
          cur.status = 'CRASHED';
          ms = 'CRASHED';
        }
      }
      const js = cur ? String(cur.status||'').toUpperCase() : null;

      const canStart  = ['IDLE','COMPLETED','FAILED','CRASHED'].includes(ms);
      const canPause  = js === 'RUNNING' || js === 'RESUMING';
      const canResume = ms === 'PAUSED' || js === 'PAUSED';
      const rid       = canResume ? ((cur && cur.jobId) || info.activeJobId || '') : '';

      const mapVN = {
        'IDLE': 'Sẵn sàng', 'RUNNING': 'Đang chạy', 'RESUMING': 'Đang tiếp tục',
        'PAUSE_REQUESTED': 'Đang dừng...', 'PAUSED': 'Đã tạm dừng',
        'COMPLETED': 'Hoàn thành', 'FAILED': 'Thất bại', 'CRASHED': 'Sự cố', 'ERROR': 'Lỗi'
      };
      const txt = mapVN[ms] || ms;

      let pClass = 'bg-primary';
      if (ms === 'COMPLETED') pClass = 'bg-success';
      else if (['FAILED','CRASHED','ERROR'].includes(ms)) pClass = 'bg-danger';
      else if (ms === 'PAUSED') pClass = 'bg-warning text-dark';

      const pct = info.currentProgressPercent;
      const prog = pct != null
        ? \`<div class="progress" style="height:20px;">
             <div class="progress-bar \${pClass}" role="progressbar"
                  style="width:\${pct}%"
                  aria-valuenow="\${pct}"
                  aria-valuemin="0"
                  aria-valuemax="100">
               \${pct}%
             </div>
           </div>\`
        : '-';

      const sync = info.currentTotalToSync != null
        ? \`\${(info.currentSynced||0).toLocaleString()} / \${info.currentTotalToSync.toLocaleString()}\`
        : '-';
      const ji   = cur ? \`\${cur.jobId}<br/><small>\${cur.status}</small>\` : '-';
      const s    = (info.status||'idle').toLowerCase();

      return \`<tr>
        <td>\${name}</td>
        <td class="status-\${s}">\${txt}</td>
        <td>\${prog}</td>
        <td><strong>\${sync}</strong></td>
        <td>\${pct != null ? pct+'%' : '-'}</td>
        <td>\${info.lastSyncTime ? new Date(info.lastSyncTime).toLocaleString('vi-VN') : '-'}</td>
        <td>\${info.lastRun      ? new Date(info.lastRun).toLocaleString('vi-VN')      : '-'}</td>
        <td>\${ji}</td>
        <td>
          <button class="btn btn-sm btn-primary me-1"        onclick="startModel('\${name}',false)" \${canStart?'':'disabled'}>Chạy đồng bộ</button>
          <button class="btn btn-sm btn-outline-danger me-1" onclick="startModel('\${name}',true)"  \${canStart?'':'disabled'}>Chạy lại</button>
          <button class="btn btn-sm btn-warning me-1"        onclick="pauseJob('\${cur?cur.jobId:''}')"  \${canPause?'':'disabled'}>Dừng lại</button>
          <button class="btn btn-sm btn-success"             onclick="resumeJob('\${rid}')"              \${canResume?'':'disabled'}>Tiếp tục</button>
        </td>
      </tr>\`;
    }

    // ── Actions — giống bản gốc, bỏ window.location.reload() ─
    async function triggerSync(reset) {
      if (!confirm(reset ? 'Bạn chắc chắn muốn chạy lại từ đầu?' : 'Bắt đầu đồng bộ đối tượng tiếp theo?')) return;
      try {
        const r = await fetch('/api/sync-manager-src/start', {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({reset})
        });
        alert((await r.json()).message || 'Đồng chí đã gửi lệnh');
      } catch(e) { alert('Lỗi: '+e.message); }
    }

    async function startModel(modelName, reset=false) {
      try {
        const r = await fetch('/api/sync-manager-src/models/'+encodeURIComponent(modelName)+'/start', {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({reset})
        });
        alert((await r.json()).message || 'Đồng chí đã gửi lệnh');
      } catch(e) { alert('Lỗi: '+e.message); }
    }

    async function pauseJob(jobId) {
      if (!jobId) return;
      try {
        const r = await fetch('/api/sync-manager-src/jobs/'+encodeURIComponent(jobId)+'/pause', {
          method:'POST', headers:{'Content-Type':'application/json'}
        });
        alert((await r.json()).message || 'Đồng chí đã yêu cầu dừng lại');
      } catch(e) { alert('Lỗi: '+e.message); }
    }

    async function resumeJob(jobId) {
      if (!jobId) return;
      try {
        const r = await fetch('/api/sync-manager-src/jobs/'+encodeURIComponent(jobId)+'/resume', {
          method:'POST', headers:{'Content-Type':'application/json'}
        });
        alert((await r.json()).message || 'Đồng chí đã yêu cầu tiếp tục');
      } catch(e) { alert('Lỗi: '+e.message); }
    }

    connectSSE(); // khởi động SSE khi trang load
  </script>
</body>
</html>`;

    res.send(html);
  });

  // ── Helper server-side render (load lần đầu) ──────────────
  _renderRows(entities, jobs) {
    return Object.entries(entities).map(([name, info]) => {
      const rel = Object.values(jobs || {})
        .filter((j) => j.modelName === name)
        .sort((a, b) => {
          const ta = new Date(a.updatedAt || a.startedAt || 0).getTime();
          const tb = new Date(b.updatedAt || b.startedAt || 0).getTime();
          return tb - ta;
        });

      const rp = rel.find((j) => ['RUNNING', 'PAUSE_REQUESTED', 'RESUMING', 'PAUSED'].includes(j.status));
      const cur = (info.activeJobId && jobs && jobs[info.activeJobId])
        ? jobs[info.activeJobId] : (rp || rel[0] || null);

      let ms = (info.status || 'IDLE').toUpperCase();
      if (cur && ['RUNNING', 'RESUMING', 'PAUSE_REQUESTED'].includes(cur.status)) {
        const last = new Date(cur.updatedAt || cur.startedAt || 0).getTime();
        if (Date.now() - last > 60000) {
          cur.status = 'CRASHED';
          ms = 'CRASHED';
        }
      }
      const js = cur ? String(cur.status || '').toUpperCase() : null;

      const canStart = ['IDLE', 'COMPLETED', 'FAILED', 'CRASHED'].includes(ms);
      const canPause = js === 'RUNNING' || js === 'RESUMING';
      const canResume = ms === 'PAUSED' || js === 'PAUSED';
      const rid = canResume ? ((cur && cur.jobId) || info.activeJobId || '') : '';

      const mapVN = {
        'IDLE': 'Sẵn sàng', 'RUNNING': 'Đang chạy', 'RESUMING': 'Đang tiếp tục',
        'PAUSE_REQUESTED': 'Đang dừng...', 'PAUSED': 'Đã tạm dừng',
        'COMPLETED': 'Hoàn thành', 'FAILED': 'Thất bại', 'CRASHED': 'Sự cố', 'ERROR': 'Lỗi'
      };
      const txt = mapVN[ms] || ms;

      let pClass = 'bg-primary';
      if (ms === 'COMPLETED') pClass = 'bg-success';
      else if (['FAILED', 'CRASHED', 'ERROR'].includes(ms)) pClass = 'bg-danger';
      else if (ms === 'PAUSED') pClass = 'bg-warning text-dark';

      const pct = info.currentProgressPercent;
      const prog = pct != null
        ? `<div class="progress" style="height:20px;">
       <div class="progress-bar ${pClass}" role="progressbar"
            style="width:${pct}%"
            aria-valuenow="${pct}"
            aria-valuemin="0"
            aria-valuemax="100">
         ${pct}%
       </div>
     </div>`
        : '-';
      const sync = info.currentTotalToSync != null
        ? `${(info.currentSynced || 0).toLocaleString()} / ${info.currentTotalToSync.toLocaleString()}`
        : '-';
      const ji = cur ? `${cur.jobId}<br/><small>${cur.status}</small>` : '-';

      return `<tr>
        <td>${name}</td>
        <td class="status-${info.status.toLowerCase()}">${txt}</td>
        <td>${prog}</td>
        <td><strong>${sync}</strong></td>
        <td>${pct != null ? pct + '%' : '-'}</td>
        <td>${info.lastSyncTime ? new Date(info.lastSyncTime).toLocaleString('vi-VN') : '-'}</td>
        <td>${info.lastRun ? new Date(info.lastRun).toLocaleString('vi-VN') : '-'}</td>
        <td>${ji}</td>
        <td>
          <button class="btn btn-sm btn-primary me-1"        onclick="startModel('${name}',false)" ${canStart ? '' : 'disabled'}>Chạy đồng bộ</button>
          <button class="btn btn-sm btn-outline-danger me-1" onclick="startModel('${name}',true)"  ${canStart ? '' : 'disabled'}>Chạy lại</button>
          <button class="btn btn-sm btn-warning me-1"        onclick="pauseJob('${cur ? cur.jobId : ''}')"  ${canPause ? '' : 'disabled'}>Dừng lại</button>
          <button class="btn btn-sm btn-success"             onclick="resumeJob('${rid}')"                  ${canResume ? '' : 'disabled'}>Tiếp tục</button>
        </td>
      </tr>`;
    }).join('');
  }
}

module.exports = new SyncManagerController();