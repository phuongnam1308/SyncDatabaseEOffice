const BaseController        = require('../../controllers/BaseController');
const SyncManagerService    = require('./SyncManagerService');
const SyncStateRepository   = require('./SyncStateRepository');
const SyncModelRegistry     = require('./SyncModelRegistry');
const SyncGroupService      = require('./SyncGroupService');
const logger                = require('../../utils/logger');

class SyncManagerController extends BaseController {
  constructor() {
    super();
    /** @type {SyncModelRegistry} */
    this._registry = new SyncModelRegistry();
    this._initialized = false;
  }

  // ── Initialization ─────────────────────────────────────────────

  /**
   * Idempotent init — gọi nhiều lần cũng an toàn.
   */
  async ensureInitialized() {
    if (this._initialized) return;

    try {
      await this._registry.initializeAll(SyncManagerService, SyncStateRepository);
      this._initialized = true;
    } catch (error) {
      logger.error('[SyncManagerController] Khởi tạo thất bại:', error);
      throw error;
    }
  }

  // ── Routes hiện có (giữ nguyên signature) ─────────────────────

  startSync = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { reset } = req.body;
    SyncManagerService.start(reset === true || reset === 'true');
    return this.success(res, { message: 'Đã kích hoạt tiến trình đồng bộ' });
  });

  startModelSync = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { modelName }                = req.params;
    const { reset = false, batchSize } = req.body || {};

    const result = SyncManagerService.startModel(modelName, {
      reset:     reset === true || reset === 'true',
      batchSize,
    });
    return this.success(res, result, 'Đã kích hoạt đồng bộ đối tượng');
  });

  pauseJobSync = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { jobId } = req.params;
    const result = SyncManagerService.pauseJob(jobId);
    return this.success(res, result, 'Đã yêu cầu dừng tiến trình');
  });

  resumeJobSync = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { jobId } = req.params;
    const result = SyncManagerService.resumeJob(jobId);
    return this.success(res, result, 'Đã tiếp tục tiến trình');
  });

  getJobSyncStatus = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { jobId } = req.params;
    const job = SyncManagerService.getJob(jobId);
    if (!job) return this.notFound(res, `Không tìm thấy job: ${jobId}`);
    return this.success(res, job);
  });

  /**
   * GET /api/sync-manager-src/models
   * Trả về danh sách model đã đăng ký.
   * Single model: { key, label, type: 'single' }
   * Group: { key, label, type: 'group', tableKeys: [...] }
   * Không trả về expanded table entries riêng lẻ (tránh trùng lặp).
   */
  getRegisteredModels = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();

    const singles = this._registry
      .entries()
      .filter((e) => !this._registry.isGroup(e.baseKey) || e.baseKey === e.key)
      .filter((e) => !this._registry.isGroup(e.key)) // loại expanded entries
      .map(({ key, label }) => ({ key, label, type: 'single' }));

    const groups = Object.values(SyncGroupService.getAllGroups()).map((g) => ({
      key:       g.baseKey,
      label:     g.label,
      type:      'group',
      tableKeys: g.tableKeys,
    }));

    return this.success(res, [...singles, ...groups]);
  });

  /**
   * POST /api/sync-manager-src/models/:key/trigger
   * Kích hoạt model đơn hoặc group theo key ngắn.
   * Body: { reset?: boolean, batchSize?: number }
   */
  triggerModelByKey = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { key }              = req.params;
    const { reset = false, batchSize } = req.body || {};

    // Thử group trước
    if (this._registry.isGroup(key)) {
      const result = await SyncGroupService.startGroup(key, SyncManagerService, {
        reset: reset === true || reset === 'true',
      });
      return this.success(res, result, `Đã kích hoạt group: ${key}`);
    }

    // Thử single entry
    const entry = this._registry.get(key);
    if (!entry) {
      const validKeys = [
        ...this._registry.keys().filter((k) => !k.includes(':')),
        ...this._registry.groupKeys(),
      ];
      return this.notFound(
        res,
        `Không tìm thấy model với key="${key}". Các key hợp lệ: ${validKeys.join(', ')}`
      );
    }

    const result = SyncManagerService.startModel(entry.definition.label, {
      reset:     reset === true || reset === 'true',
      batchSize,
    });
    return this.success(res, result, `Đã kích hoạt đồng bộ model: ${key}`);
  });

  // ── NEW: Group endpoints ───────────────────────────────────────

  /**
   * GET /api/sync-manager-src/groups
   * Lấy danh sách và trạng thái tất cả group.
   */
  getGroups = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const groups = SyncGroupService.getAllGroups();
    return this.success(res, groups);
  });

  /**
   * GET /api/sync-manager-src/groups/:baseKey
   * Lấy trạng thái một group cụ thể.
   */
  getGroupStatus = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { baseKey } = req.params;
    const group = SyncGroupService.getGroup(baseKey);
    if (!group) return this.notFound(res, `Không tìm thấy group: ${baseKey}`);
    return this.success(res, group);
  });

  /**
   * POST /api/sync-manager-src/groups/:baseKey/start
   * Bắt đầu chạy group (tuần tự từng bảng).
   * Body: { reset?: boolean, skipCompleted?: boolean }
   */
  startGroup = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { baseKey }                        = req.params;
    const { reset = false, skipCompleted = true } = req.body || {};

    if (!this._registry.isGroup(baseKey)) {
      return this.notFound(res, `"${baseKey}" không phải group. Các group hợp lệ: ${this._registry.groupKeys().join(', ')}`);
    }

    const result = await SyncGroupService.startGroup(baseKey, SyncManagerService, {
      reset:        reset === true || reset === 'true',
      skipCompleted: skipCompleted !== false,
    });
    return this.success(res, result, `Đã kích hoạt group: ${baseKey}`);
  });

  /**
   * POST /api/sync-manager-src/groups/:baseKey/pause
   * Dừng group: pause job hiện tại và xóa queue còn lại.
   */
  pauseGroup = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { baseKey } = req.params;
    const result = SyncGroupService.pauseGroup(baseKey, SyncManagerService);
    if (!result) return this.notFound(res, `Không tìm thấy group: ${baseKey}`);
    return this.success(res, result, `Đã yêu cầu dừng group: ${baseKey}`);
  });

  /**
   * POST /api/sync-manager-src/groups/:baseKey/resume
   * Tiếp tục group sau khi pause (chạy lại từ bảng chưa completed).
   */
  resumeGroup = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { baseKey }              = req.params;
    const { skipCompleted = true } = req.body || {};

    if (!this._registry.isGroup(baseKey)) {
      return this.notFound(res, `"${baseKey}" không phải group`);
    }

    const result = await SyncGroupService.resumeGroup(baseKey, SyncManagerService, {
      skipCompleted: skipCompleted !== false,
    });
    return this.success(res, result, `Đã tiếp tục group: ${baseKey}`);
  });

  /**
   * POST /api/sync-manager-src/groups/:baseKey/tables/:tableKey/trigger
   * Kích hoạt một bảng đơn lẻ trong group (ngoài sequential flow).
   * Dùng để debug / chạy lại một bảng cụ thể.
   * Body: { reset?: boolean }
   */
  triggerGroupTable = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { baseKey, tableKey } = req.params;
    const { reset = false }     = req.body || {};

    // tableKey trong URL được encode, decode lại
    const fullTableKey = `${baseKey}:${tableKey}`;
    try {
      const result = SyncGroupService.triggerTable(fullTableKey, SyncManagerService, {
        reset: reset === true || reset === 'true',
      });
      return this.success(res, result, `Đã kích hoạt bảng: ${fullTableKey}`);
    } catch (err) {
      return this.notFound(res, err.message);
    }
  });

  // ── SSE ────────────────────────────────────────────────────────

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

  // ── Dashboard ──────────────────────────────────────────────────

  getDashboard = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();

    const data             = await SyncStateRepository.getDashboardData();
    const groupMemberLabels = this._registry.getGroupMemberLabels();
    const groupStates       = SyncGroupService.getAllGroups();

    // Tách entities: loại bỏ những entity thuộc group (sẽ render dưới dạng group row)
    const singleEntities = {};
    for (const [name, info] of Object.entries(data.entities || {})) {
      if (!groupMemberLabels.has(name)) {
        singleEntities[name] = info;
      }
    }

    const initialSingleRows = this._renderRows(singleEntities, data.jobs);
    const initialGroupRows  = this._renderGroupRows(groupStates, data.entities, data.jobs);

    const html = this._buildDashboardHtml(data, initialSingleRows, initialGroupRows);
    res.send(html);
  });

  // ── Private: render helpers ────────────────────────────────────

  /**
   * Render server-side group rows cho initial HTML load.
   * Mỗi group → 1 header row + N sub-rows (collapsible).
   */
  _renderGroupRows(groupStates, allEntities, jobs) {
    return Object.values(groupStates).map((group) => {
      const { baseKey, label, tableKeys, status, summary, activeKey } = group;
      const s       = status.toLowerCase();
      const mapVN   = {
        idle: 'Sẵn sàng', running: 'Đang chạy', paused: 'Đã tạm dừng',
        completed: 'Hoàn thành', failed: 'Thất bại', partial: 'Một phần',
      };

      const pct       = summary.percent;
      let   pClass    = status === 'COMPLETED' ? 'bg-success'
        : status === 'FAILED'   ? 'bg-danger'
        : status === 'PAUSED'   ? 'bg-warning text-dark'
        : 'bg-primary';
      const prog      = `<div class="progress" style="height:20px;">
        <div class="progress-bar ${pClass}" style="width:${pct}%" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">${pct}%</div>
      </div>`;

      const canStart  = ['IDLE', 'COMPLETED', 'FAILED', 'PARTIAL'].includes(status);
      const canPause  = status === 'RUNNING';
      const canResume = status === 'PAUSED';

      // Sub-rows cho từng bảng
      const subRows = tableKeys.map((tableKey) => {
        const tableName   = tableKey.split(':').slice(1).join(':');
        const tableLabel  = allEntities
          ? Object.keys(allEntities).find((l) => l.includes(tableName))
          : null;
        const info        = tableLabel ? allEntities[tableLabel] : null;
        const tableResult = group.tableResults[tableKey] || 'pending';
        const isActive    = tableKey === activeKey;

        const statusIcon = tableResult === 'completed' ? '✅'
          : tableResult === 'failed'    ? '❌'
          : isActive                    ? '⏳'
          : '⬜';

        const tPct  = info?.currentProgressPercent;
        const tSync = info?.currentTotalToSync != null
          ? `${(info.currentSynced || 0).toLocaleString()} / ${info.currentTotalToSync.toLocaleString()}`
          : '-';

        return `<tr class="group-sub-row group-sub-${baseKey.replace(/[^a-z0-9]/gi, '_')}" style="display:none; background:#f8f9fa;">
          <td style="padding-left:2rem">${statusIcon} ${tableName}${isActive ? ' <small class="text-primary">(đang chạy)</small>' : ''}</td>
          <td colspan="2">${tPct != null ? `<div class="progress" style="height:14px;"><div class="progress-bar ${pClass}" style="width:${tPct}%">${tPct}%</div></div>` : '-'}</td>
          <td><strong>${tSync}</strong></td>
          <td colspan="4">
            <button class="btn btn-xs btn-sm btn-outline-primary me-1"
              onclick="triggerGroupTable('${baseKey}','${tableName}',false)" title="Chạy bảng này">▶</button>
            <button class="btn btn-xs btn-sm btn-outline-danger"
              onclick="triggerGroupTable('${baseKey}','${tableName}',true)" title="Chạy lại bảng này">↺</button>
          </td>
        </tr>`;
      }).join('');

      const toggleId = `group-sub-${baseKey.replace(/[^a-z0-9]/gi, '_')}`;

      return `
        <tr class="table-secondary group-header" style="cursor:pointer" onclick="toggleGroupRows('${toggleId}')">
          <td><strong>📦 ${label}</strong> <small class="text-muted">(${summary.completed}/${summary.total} bảng)</small></td>
          <td class="status-${s}"><strong>${mapVN[s] || status}</strong></td>
          <td>${prog}</td>
          <td><strong>${summary.completed} / ${summary.total} bảng</strong></td>
          <td>${pct}%</td>
          <td>-</td><td>-</td>
          <td><small>${activeKey || '-'}</small></td>
          <td>
            <button class="btn btn-sm btn-primary me-1"        onclick="event.stopPropagation();startGroup('${baseKey}',false)" ${canStart  ? '' : 'disabled'}>Chạy</button>
            <button class="btn btn-sm btn-outline-danger me-1" onclick="event.stopPropagation();startGroup('${baseKey}',true)"  ${canStart  ? '' : 'disabled'}>Chạy lại</button>
            <button class="btn btn-sm btn-warning me-1"        onclick="event.stopPropagation();pauseGroup('${baseKey}')"       ${canPause  ? '' : 'disabled'}>Dừng</button>
            <button class="btn btn-sm btn-success"             onclick="event.stopPropagation();resumeGroup('${baseKey}')"      ${canResume ? '' : 'disabled'}>Tiếp tục</button>
          </td>
        </tr>
        ${subRows}`;
    }).join('');
  }

  _buildDashboardHtml(data, initialSingleRows, initialGroupRows) {
    return `<!DOCTYPE html>
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
    .status-partial         { color: #fd7e14; font-weight: bold; }
    .progress-bar           { transition: width 0.6s ease-in-out; }
    .group-header:hover     { background: #e2e3e5 !important; }
    .group-sub-row td       { font-size: 0.875rem; }
    .section-title          { background: #343a40; color: #fff; padding: 0.5rem 1rem;
                              font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px; }
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
          <button id="btn-all"   onclick="triggerSync(false)" class="btn btn-success me-2" ${data.isRunning ? 'disabled' : ''}>Chạy tất cả</button>
          <button id="btn-reset" onclick="triggerSync(true)"  class="btn btn-danger"       ${data.isRunning ? 'disabled' : ''}>Chạy lại toàn bộ</button>
        </div>
        <table class="table table-hover table-bordered">
          <thead class="table-dark">
            <tr>
              <th>ĐỐI TƯỢNG</th><th>TRẠNG THÁI</th><th>TIẾN TRÌNH</th>
              <th>SỐ LƯỢNG / TỔNG SỐ</th><th>PHẦN TRĂM</th>
              <th>LẦN GẦN NHẤT</th><th>LẦN CUỐI</th>
              <th>PHIÊN HIỆN TẠI</th><th>HÀNH ĐỘNG</th>
            </tr>
          </thead>
          <tbody id="sync-tbody">
            <!-- Single models -->
            <tr class="section-title"><td colspan="9">🔄 ĐỒNG BỘ THỜI GIAN THỰC</td></tr>
            <tbody id="single-tbody">${initialSingleRows}</tbody>
          </tbody>
        </table>
      </div>
      <div class="card-footer text-muted d-flex justify-content-between">
        <span>Cập nhật realtime qua SSE</span>
        <span id="last-update"></span>
      </div>
    </div>
  </div>
  <script>
    // ── SSE ────────────────────────────────────────────────────
    let _es = null, retryCount = 0;
    function connectSSE() {
      _es = new EventSource('/api/sync-manager-src/events');
      _es.onopen    = () => { document.getElementById('sse-dot').textContent = '🟢'; retryCount = 0; };
      _es.onerror   = () => {
        document.getElementById('sse-dot').textContent = '🔴';
        _es.close();
        if (++retryCount >= 3) {
          document.getElementById('running-badge').textContent = 'Mất kết nối';
          document.getElementById('running-badge').className = 'badge bg-danger text-white';
          return;
        }
        setTimeout(connectSSE, 3000);
      };
      _es.onmessage = (e) => { try { renderDashboard(JSON.parse(e.data)); } catch(_) {} };
    }

    function renderDashboard(data) {
      document.getElementById('running-badge').textContent = data.isRunning ? 'Đang đồng bộ...' : 'Sẵn sàng';
      document.getElementById('btn-all').disabled   = data.isRunning;
      document.getElementById('btn-reset').disabled = data.isRunning;

      // Lấy trạng thái expand hiện tại trước khi re-render
      const expandedGroups = getExpandedGroups();

      // Render single models
      const groupMemberLabels = data.groupMemberLabels || [];
      const singleEntities    = {};
      for (const [name, info] of Object.entries(data.entities || {})) {
        if (!groupMemberLabels.includes(name)) singleEntities[name] = info;
      }
      document.getElementById('single-tbody').innerHTML = buildRows(singleEntities, data.jobs || {});

      // Render groups
      if (data.groups) {
        document.getElementById('group-tbody').innerHTML = buildGroupRows(data.groups, data.entities || {}, data.jobs || {});
        // Khôi phục trạng thái expand
        expandedGroups.forEach((id) => {
          document.querySelectorAll('.' + id).forEach((el) => el.style.display = '');
        });
      }

      document.getElementById('last-update').textContent = 'Cập nhật: ' + new Date().toLocaleTimeString('vi-VN');
    }

    // ── Group expand/collapse ──────────────────────────────────
    function toggleGroupRows(id) {
      document.querySelectorAll('.' + id).forEach((el) => {
        el.style.display = el.style.display === 'none' || el.style.display === '' ? '' : 'none';
      });
    }
    function getExpandedGroups() {
      const expanded = new Set();
      document.querySelectorAll('[class*="group-sub-"]').forEach((el) => {
        if (el.style.display !== 'none' && el.style.display !== '') {
          const match = el.className.match(/group-sub-([\\w]+)/);
          if (match) expanded.add('group-sub-' + match[1]);
        }
      });
      return expanded;
    }

    // ── Build rows (client-side) ───────────────────────────────
    function buildRows(entities, jobs) {
      return Object.entries(entities).map(([n, i]) => buildRow(n, i, jobs)).join('');
    }

    function buildRow(name, info, jobs) {
      const rel = Object.values(jobs).filter(j => j.modelName === name)
        .sort((a,b) => new Date(b.updatedAt||b.startedAt||0) - new Date(a.updatedAt||a.startedAt||0));
      const rp  = rel.find(j => ['RUNNING','PAUSE_REQUESTED','RESUMING','PAUSED'].includes(j.status));
      const cur = (info.activeJobId && jobs[info.activeJobId]) ? jobs[info.activeJobId] : (rp || rel[0] || null);
      let ms = (info.status||'IDLE').toUpperCase();
      if (cur && ['RUNNING','RESUMING','PAUSE_REQUESTED'].includes(cur.status)) {
        if (Date.now() - new Date(cur.updatedAt||cur.startedAt||0).getTime() > 60000) { cur.status = ms = 'CRASHED'; }
      }
      const js = cur ? String(cur.status||'').toUpperCase() : null;
      const canStart  = ['IDLE','COMPLETED','FAILED','CRASHED'].includes(ms);
      const canPause  = js === 'RUNNING' || js === 'RESUMING';
      const canResume = ms === 'PAUSED' || js === 'PAUSED';
      const rid       = canResume ? ((cur&&cur.jobId)||info.activeJobId||'') : '';
      const mapVN = { IDLE:'Sẵn sàng', RUNNING:'Đang chạy', RESUMING:'Đang tiếp tục',
        PAUSE_REQUESTED:'Đang dừng...', PAUSED:'Đã tạm dừng', COMPLETED:'Hoàn thành',
        FAILED:'Thất bại', CRASHED:'Sự cố', ERROR:'Lỗi' };
      const pct  = info.currentProgressPercent;
      let pClass = ms==='COMPLETED' ? 'bg-success' : ['FAILED','CRASHED','ERROR'].includes(ms) ? 'bg-danger' : ms==='PAUSED' ? 'bg-warning text-dark' : 'bg-primary';
      const prog = pct != null ? \`<div class="progress" style="height:20px;"><div class="progress-bar \${pClass}" style="width:\${pct}%" aria-valuenow="\${pct}" aria-valuemin="0" aria-valuemax="100">\${pct}%</div></div>\` : '-';
      const sync = info.currentTotalToSync != null ? \`\${(info.currentSynced||0).toLocaleString()} / \${info.currentTotalToSync.toLocaleString()}\` : '-';
      const s    = (info.status||'idle').toLowerCase();
      return \`<tr>
        <td>\${name}</td>
        <td class="status-\${s}">\${mapVN[ms]||ms}</td>
        <td>\${prog}</td><td><strong>\${sync}</strong></td>
        <td>\${pct!=null?pct+'%':'-'}</td>
        <td>\${info.lastSyncTime ? new Date(info.lastSyncTime).toLocaleString('vi-VN') : '-'}</td>
        <td>\${info.lastRun      ? new Date(info.lastRun).toLocaleString('vi-VN')      : '-'}</td>
        <td>\${cur ? cur.jobId+'<br/><small>'+cur.status+'</small>' : '-'}</td>
        <td>
          <button class="btn btn-sm btn-primary me-1"        onclick="startModel('\${name}',false)" \${canStart?'':'disabled'}>Chạy</button>
          <button class="btn btn-sm btn-outline-danger me-1" onclick="startModel('\${name}',true)"  \${canStart?'':'disabled'}>Chạy lại</button>
          <button class="btn btn-sm btn-warning me-1"        onclick="pauseJob('\${cur?cur.jobId:''}')"  \${canPause?'':'disabled'}>Dừng</button>
          <button class="btn btn-sm btn-success"             onclick="resumeJob('\${rid}')"              \${canResume?'':'disabled'}>Tiếp tục</button>
        </td></tr>\`;
    }

    function buildGroupRows(groups, allEntities, jobs) {
      return Object.values(groups).map((group) => {
        const { baseKey, label, tableKeys, status, summary, activeKey, tableResults } = group;
        const s     = status.toLowerCase();
        const mapVN = { idle:'Sẵn sàng', running:'Đang chạy', paused:'Đã tạm dừng',
          completed:'Hoàn thành', failed:'Thất bại', partial:'Một phần' };
        const pct   = summary.percent;
        const pClass = status==='COMPLETED' ? 'bg-success' : status==='FAILED' ? 'bg-danger'
          : status==='PAUSED' ? 'bg-warning text-dark' : 'bg-primary';
        const prog  = \`<div class="progress" style="height:20px;"><div class="progress-bar \${pClass}" style="width:\${pct}%" aria-valuenow="\${pct}" aria-valuemin="0" aria-valuemax="100">\${pct}%</div></div>\`;
        const canStart  = ['IDLE','COMPLETED','FAILED','PARTIAL'].includes(status);
        const canPause  = status === 'RUNNING';
        const canResume = status === 'PAUSED';
        const safeId    = 'group-sub-' + baseKey.replace(/[^a-z0-9]/gi,'_');

        const subRows = tableKeys.map((tableKey) => {
          const tableName  = tableKey.split(':').slice(1).join(':');
          const tableLabel = Object.keys(allEntities).find(l => l.includes(tableName));
          const info       = tableLabel ? allEntities[tableLabel] : null;
          const result     = tableResults[tableKey] || 'pending';
          const isActive   = tableKey === activeKey;
          const icon       = result==='completed' ? '✅' : result==='failed' ? '❌' : isActive ? '⏳' : '⬜';
          const tPct       = info?.currentProgressPercent;
          const tSync      = info?.currentTotalToSync != null
            ? \`\${(info.currentSynced||0).toLocaleString()} / \${info.currentTotalToSync.toLocaleString()}\` : '-';
          return \`<tr class="\${safeId}" style="display:none; background:#f8f9fa;">
            <td style="padding-left:2rem">\${icon} \${tableName}\${isActive?' <small class="text-primary">(đang chạy)</small>':''}</td>
            <td colspan="2">\${tPct!=null?'<div class="progress" style="height:14px;"><div class="progress-bar '+pClass+'" style="width:'+tPct+'%">'+tPct+'%</div></div>':'-'}</td>
            <td><strong>\${tSync}</strong></td>
            <td colspan="4">
              <button class="btn btn-sm btn-outline-primary me-1" onclick="triggerGroupTable('\${baseKey}','\${tableName}',false)">▶</button>
              <button class="btn btn-sm btn-outline-danger"       onclick="triggerGroupTable('\${baseKey}','\${tableName}',true)">↺</button>
            </td></tr>\`;
        }).join('');

        return \`<tr class="table-secondary group-header" style="cursor:pointer" onclick="toggleGroupRows('\${safeId}')">
          <td><strong>📦 \${label}</strong> <small class="text-muted">(\${summary.completed}/\${summary.total} bảng)</small></td>
          <td class="status-\${s}"><strong>\${mapVN[s]||status}</strong></td>
          <td>\${prog}</td>
          <td><strong>\${summary.completed} / \${summary.total} bảng</strong></td>
          <td>\${pct}%</td>
          <td>-</td><td>-</td>
          <td><small>\${activeKey||'-'}</small></td>
          <td>
            <button class="btn btn-sm btn-primary me-1"        onclick="event.stopPropagation();startGroup('\${baseKey}',false)" \${canStart?'':'disabled'}>Chạy</button>
            <button class="btn btn-sm btn-outline-danger me-1" onclick="event.stopPropagation();startGroup('\${baseKey}',true)"  \${canStart?'':'disabled'}>Chạy lại</button>
            <button class="btn btn-sm btn-warning me-1"        onclick="event.stopPropagation();pauseGroup('\${baseKey}')"       \${canPause?'':'disabled'}>Dừng</button>
            <button class="btn btn-sm btn-success"             onclick="event.stopPropagation();resumeGroup('\${baseKey}')"      \${canResume?'':'disabled'}>Tiếp tục</button>
          </td></tr>\${subRows}\`;
      }).join('');
    }

    // ── API calls ──────────────────────────────────────────────
    async function triggerSync(reset) {
      if (!confirm(reset ? 'Chạy lại từ đầu?' : 'Bắt đầu đồng bộ?')) return;
      try { const r = await fetch('/api/sync-manager-src/start', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({reset}) }); alert((await r.json()).message); } catch(e) { alert('Lỗi: '+e.message); }
    }
    async function startModel(modelName, reset=false) {
      try { const r = await fetch('/api/sync-manager-src/models/'+encodeURIComponent(modelName)+'/start', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({reset}) }); alert((await r.json()).message); } catch(e) { alert('Lỗi: '+e.message); }
    }
    async function pauseJob(jobId)  { if (!jobId) return; try { const r = await fetch('/api/sync-manager-src/jobs/'+encodeURIComponent(jobId)+'/pause',  { method:'POST', headers:{'Content-Type':'application/json'} }); alert((await r.json()).message); } catch(e) { alert(e.message); } }
    async function resumeJob(jobId) { if (!jobId) return; try { const r = await fetch('/api/sync-manager-src/jobs/'+encodeURIComponent(jobId)+'/resume', { method:'POST', headers:{'Content-Type':'application/json'} }); alert((await r.json()).message); } catch(e) { alert(e.message); } }

    // Group actions
    async function startGroup(baseKey, reset=false) {
      if (!confirm(reset ? 'Chạy lại toàn bộ group từ đầu?' : 'Bắt đầu chạy group?')) return;
      try { const r = await fetch('/api/sync-manager-src/groups/'+encodeURIComponent(baseKey)+'/start', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({reset}) }); alert((await r.json()).message || 'Đã kích hoạt'); } catch(e) { alert('Lỗi: '+e.message); }
    }
    async function pauseGroup(baseKey) {
      try { const r = await fetch('/api/sync-manager-src/groups/'+encodeURIComponent(baseKey)+'/pause', { method:'POST', headers:{'Content-Type':'application/json'} }); alert((await r.json()).message || 'Đã dừng'); } catch(e) { alert('Lỗi: '+e.message); }
    }
    async function resumeGroup(baseKey) {
      try { const r = await fetch('/api/sync-manager-src/groups/'+encodeURIComponent(baseKey)+'/resume', { method:'POST', headers:{'Content-Type':'application/json'} }); alert((await r.json()).message || 'Đã tiếp tục'); } catch(e) { alert('Lỗi: '+e.message); }
    }
    async function triggerGroupTable(baseKey, tableKey, reset=false) {
      if (!confirm((reset?'Chạy lại':'Chạy') + ' bảng ' + tableKey + '?')) return;
      try { const r = await fetch('/api/sync-manager-src/groups/'+encodeURIComponent(baseKey)+'/tables/'+encodeURIComponent(tableKey)+'/trigger', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({reset}) }); alert((await r.json()).message || 'Đã kích hoạt'); } catch(e) { alert('Lỗi: '+e.message); }
    }

    connectSSE();
  </script>
</body>
</html>`;
  }

  _renderRows(entities, jobs) {
    return Object.entries(entities).map(([name, info]) => {
      const rel = Object.values(jobs || {})
        .filter((j) => j.modelName === name)
        .sort((a, b) => new Date(b.updatedAt || b.startedAt || 0) - new Date(a.updatedAt || a.startedAt || 0));

      const rp  = rel.find((j) => ['RUNNING', 'PAUSE_REQUESTED', 'RESUMING', 'PAUSED'].includes(j.status));
      const cur = (info.activeJobId && jobs?.[info.activeJobId]) ? jobs[info.activeJobId] : (rp || rel[0] || null);

      let ms = (info.status || 'IDLE').toUpperCase();
      if (cur && ['RUNNING', 'RESUMING', 'PAUSE_REQUESTED'].includes(cur.status)) {
        if (Date.now() - new Date(cur.updatedAt || cur.startedAt || 0).getTime() > 60000) {
          cur.status = ms = 'CRASHED';
        }
      }

      const mapVN    = { IDLE: 'Sẵn sàng', RUNNING: 'Đang chạy', RESUMING: 'Đang tiếp tục', PAUSE_REQUESTED: 'Đang dừng...', PAUSED: 'Đã tạm dừng', COMPLETED: 'Hoàn thành', FAILED: 'Thất bại', CRASHED: 'Sự cố', ERROR: 'Lỗi' };
      const js       = cur ? String(cur.status || '').toUpperCase() : null;
      const canStart = ['IDLE', 'COMPLETED', 'FAILED', 'CRASHED'].includes(ms);
      const canPause = js === 'RUNNING' || js === 'RESUMING';
      const canResume= ms === 'PAUSED' || js === 'PAUSED';
      const rid      = canResume ? ((cur && cur.jobId) || info.activeJobId || '') : '';
      const pct      = info.currentProgressPercent;
      let pClass     = ms === 'COMPLETED' ? 'bg-success' : ['FAILED', 'CRASHED', 'ERROR'].includes(ms) ? 'bg-danger' : ms === 'PAUSED' ? 'bg-warning text-dark' : 'bg-primary';
      const prog     = pct != null ? `<div class="progress" style="height:20px;"><div class="progress-bar ${pClass}" style="width:${pct}%" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">${pct}%</div></div>` : '-';
      const sync     = info.currentTotalToSync != null ? `${(info.currentSynced || 0).toLocaleString()} / ${info.currentTotalToSync.toLocaleString()}` : '-';
      const s        = (info.status || 'idle').toLowerCase();
      const ji       = cur ? `${cur.jobId}<br/><small>${cur.status}</small>` : '-';

      return `<tr>
        <td>${name}</td>
        <td class="status-${s}">${mapVN[ms] || ms}</td>
        <td>${prog}</td><td><strong>${sync}</strong></td>
        <td>${pct != null ? pct + '%' : '-'}</td>
        <td>${info.lastSyncTime ? new Date(info.lastSyncTime).toLocaleString('vi-VN') : '-'}</td>
        <td>${info.lastRun      ? new Date(info.lastRun).toLocaleString('vi-VN')      : '-'}</td>
        <td>${ji}</td>
        <td>
          <button class="btn btn-sm btn-primary me-1"        onclick="startModel('${name}',false)"             ${canStart ? '' : 'disabled'}>Chạy</button>
          <button class="btn btn-sm btn-outline-danger me-1" onclick="startModel('${name}',true)"              ${canStart ? '' : 'disabled'}>Chạy lại</button>
          <button class="btn btn-sm btn-warning me-1"        onclick="pauseJob('${cur ? cur.jobId : ''}')"     ${canPause ? '' : 'disabled'}>Dừng</button>
          <button class="btn btn-sm btn-success"             onclick="resumeJob('${rid}')"                     ${canResume ? '' : 'disabled'}>Tiếp tục</button>
        </td>
      </tr>`;
    }).join('');
  }
}

module.exports = new SyncManagerController();