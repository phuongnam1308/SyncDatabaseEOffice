const path = require('path');
const fs = require('fs');
const BaseController = require('../../controllers/BaseController');
const SyncManagerService = require('./SyncManagerService');
const SyncStateRepository = require('./SyncStateRepository');
const logger = require('../../utils/logger');
const SyncModelRegistry = require('./SyncModelRegistry');
const { refreshAuth } = require('../sync-file-copy/SharePointAuthService');

class SyncManagerController extends BaseController {
  /**
   * Creates controller instance and in-memory model registry.
   */
  constructor() {
    super();
    this.initialized = false;
    this._initPromise = null; // In-flight guard cho instance này
    this.modelRegistry = new SyncModelRegistry();
  }

  _getSharePointLoginState() {
    return global.sharePointLoginState || {
      required: false,
      inProgress: false,
      message: '',
      skipped: global.sharePointLoginSkipped || false
    };
  }

  /**
   * Ensures all sync models are initialized and registered once.
   * Sử dụng in-flight Promise để nhiều request HTTP đồng thời
   * không mỗi request spawn 1 lần init riêng biệt.
   */
  async ensureInitialized() {
    if (this.initialized) return;

    // Nếu đang có init chạy, được cùng Promise đó thay vì spawn mới
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      try {
        await SyncManagerService.ensureStateLoaded();
        await this.modelRegistry.initializeAll(
          SyncManagerService,
          SyncStateRepository
        );
        this.initialized = true;
      } catch (error) {
        logger.error('[SyncManagerController] Failed to initialize models:', error);
        this._initPromise = null; // Reset để cho phép retry
        throw error;
      }
    })();

    return this._initPromise;
  }

  // ── Routes ─────────────────────

  /**
   * @openapi
   * /sync-manager-src/start:
   *   post:
   *     tags: [Sync Manager]
   *     summary: Bắt đầu đồng bộ cho tất cả các đối tượng đã đăng ký.
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               reset:
   *                 type: boolean
   *                 description: Nếu là true, sẽ xóa trạng thái cũ và chạy lại từ đầu.
   *     responses:
   *       200:
   *         description: Đã kích hoạt tiến trình đồng bộ thành công.
   */
  startSync = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { reset } = req.body;
    SyncManagerService.start(reset === true || reset === 'true');
    return this.success(res, { message: 'Đã kích hoạt tiến trình đồng bộ' });
  });

  /**
   * @openapi
   * /sync-manager-src/models/{modelName}/start:
   *   post:
   *     tags: [Sync Manager]
   *     summary: Khởi động đồng bộ cho một đối tượng cụ thể.
   *     parameters:
   *       - in: path
   *         name: modelName
   *         required: true
   *         schema:
   *           type: string
   *         description: Tên của đối tượng (model) cần đồng bộ.
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               reset:
   *                 type: boolean
   *                 description: Chạy lại từ bản ghi đầu tiên.
   *               batchSize:
   *                 type: number
   *                 description: Số lượng bản ghi xử lý mỗi đợt.
   *     responses:
   *       200:
   *         description: Đã kích hoạt đồng bộ đối tượng thành công.
   */
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

  /**
   * @openapi
   * /sync-manager-src/jobs/{jobId}/pause:
   *   post:
   *     tags: [Sync Manager]
   *     summary: Yêu cầu tạm dừng một tiến trình đang chạy.
   *     parameters:
   *       - in: path
   *         name: jobId
   *         required: true
   *         schema:
   *           type: string
   *         description: ID của phiên đồng bộ (job).
   *     responses:
   *       200:
   *         description: Yêu cầu dừng đã được tiếp nhận.
   */
  pauseJobSync = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { jobId } = req.params;
    const result = SyncManagerService.pauseJob(jobId);
    return this.success(res, result, 'Đồng chí đã yêu cầu dừng lại tiến trình');
  });

  /**
   * @openapi
   * /sync-manager-src/jobs/{jobId}/resume:
   *   post:
   *     tags: [Sync Manager]
   *     summary: Tiếp tục một tiến trình đang bị tạm dừng.
   *     parameters:
   *       - in: path
   *         name: jobId
   *         required: true
   *         schema:
   *           type: string
   *         description: ID của phiên đồng bộ (job).
   *     responses:
   *       200:
   *         description: Tiến trình đã được tiếp tục.
   */
  resumeJobSync = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { jobId } = req.params;
    try {
      const result = SyncManagerService.resumeJob(jobId);
      return this.success(res, result, 'Đã tiếp tục tiến trình phần mềm');
    } catch (error) {
      logger.warn(`[resumeJobSync] Resume job ${jobId} failed: ${error.message}`);
      return this.error(res, error.message, 400, error);
    }
  });

  /**
   * @openapi
   * /sync-manager-src/jobs/{jobId}:
   *   get:
   *     tags: [Sync Manager]
   *     summary: Lấy chi tiết trạng thái của một job cụ thể.
   *     parameters:
   *       - in: path
   *         name: jobId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Trạng thái chi tiết của job.
   *       404:
   *         description: Không tìm thấy job.
   */
  getJobSyncStatus = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { jobId } = req.params;
    const job = await SyncManagerService.getJob(jobId);
    if (!job) return this.notFound(res, `Không tìm thấy bản ghi với số mã : ${jobId}`);
    return this.success(res, job);
  });

  /**
   * Kiểm tra phiên làm việc SharePoint
   */
  checkSession = this.asyncHandler(async (req, res) => {
    return this.success(res, {
      alive: !global.sharePointLoginState?.required,
      message: global.sharePointLoginState?.message || 'Session is alive'
    });
  });

  /**
   * Yêu cầu dừng toàn bộ hệ thống (Đóng Chrome và Terminal).
   */
  shutdown = this.asyncHandler(async (req, res) => {
    logger.warn('[SyncManagerController] Người dùng yêu cầu dừng hệ thống');

    // 1. Đóng trình duyệt Chrome (nếu đang mở qua Playwright)
    if (global.appBrowser) {
      await global.appBrowser.close().catch(() => {});
    }

    // 2. Dừng Scheduler
    const CronSyncScheduler = require('./CronSyncScheduler');
    CronSyncScheduler.stop();

    // 3. Thoát process sau 1s để kịp gửi response
    setTimeout(() => {
      logger.info('[SyncManagerController] Đang thoát tiến trình...');
      process.exit(0);
    }, 1000);

    return this.success(res, { message: 'Hệ thống đang thực hiện dừng lệnh... Tạm biệt đồng chí!' });
  });

  /**
   * Xử lý đăng nhập (Mở cửa sổ Playwright giống npm run login).
   */
  login = this.asyncHandler(async (req, res) => {
    logger.info('[SyncManagerController] Kích hoạt đăng nhập từ Bảng điều khiển');

    global.sharePointLoginState = {
      required: false,
      inProgress: true,
      message: ''
    };
    SyncManagerService._broadcastSSE();

    try {
      await refreshAuth();

      global.sharePointLoginState = {
        required: false,
        inProgress: false,
        message: ''
      };

      if (typeof global.startBackgroundServicesOnce === 'function') {
        global.startBackgroundServicesOnce();
      }

      SyncManagerService._broadcastSSE();
      return this.success(res, {
        loginRequired: false,
        message: 'Đăng nhập SharePoint thành công.'
      }, 'Đăng nhập SharePoint thành công.');
    } catch (err) {
      logger.error('[SyncManagerController] Lỗi quy trình đăng nhập:', err);

      global.sharePointLoginState = {
        required: true,
        inProgress: false,
        message: err?.message || 'Đăng nhập SharePoint thất bại.'
      };
      SyncManagerService._broadcastSSE();

      return this.error(
        res,
        `Đăng nhập SharePoint thất bại: ${err?.message || 'Không rõ nguyên nhân'}`,
        500,
        err
      );
    }
  });

  /**
   * Bỏ qua đăng nhập SharePoint.
   */
  skipLogin = this.asyncHandler(async (req, res) => {
    logger.warn('[SyncManagerController] Người dùng yêu cầu bỏ qua đăng nhập SharePoint');
    global.sharePointLoginSkipped = true;
    global.sharePointLoginState = {
      required: false,
      inProgress: false,
      message: ''
    };
    SyncManagerService._broadcastSSE();
    return this.success(res, { message: 'Đã bỏ qua đăng nhập SharePoint. Cảnh báo dữ liệu có thể không chính xác.' });
  });

  // ── MỚI: SSE endpoint và Settings endpoint ─────────────────────────────────────

  /**
   * Cập nhật cấu hình hệ thống
   */
  updateSettings = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { key, value } = req.body;
    if (!key) return this.clientError(res, 'Thiếu key cấu hình');

    // Nếu key là SKIP_PULL_FROM_OLD, value là boolean
    const success = await SyncManagerService.updateSetting(key, value);
    if (!success) {
      return this.serverError(res, 'Không thể cập nhật cấu hình');
    }
    return this.success(res, { message: 'Cập nhật cấu hình thành công' });
  });

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

  /**
   * Upload file Excel hộ chiếu để chuẩn bị import
   */
  uploadPassportFile = this.asyncHandler(async (req, res) => {
    try {
      // Vì hệ thống hiện tại chưa dùng multer rộng rãi, tôi sẽ handle đơn giản
      // Giả định file được gửi qua body (nếu client dùng FormData thì cần middleware)
      // Để nhanh nhất, tôi sẽ hướng dẫn người dùng sử dụng file cố định hoặc viết logic nhận file đơn giản

      // Tạm thời, tôi sẽ fix lỗi ReferenceError bằng cách định nghĩa handleFileSelected ở dashboard.
      // Và giữ nguyên việc import file cố định 'ReportDSHoChieu.xlsx' trên server cho ổn định.
      // Nếu bạn muốn upload file bất kỳ, hãy cài thêm 'multer'.

      return this.success(res, { success: true });
    } catch (err) {
      return this.error(res, err.message);
    }
  });

  /**
   * Thực hiện import hộ chiếu từ file Excel bằng script JS
   */
  importPassport = this.asyncHandler(async (req, res) => {
    const { exec } = require('child_process');
    const nodePath = 'node';
    const scriptPath = path.join(process.cwd(), 'import_passport.js');

    logger.info(`[SyncManagerController] Đang khởi chạy script import hộ chiếu: ${scriptPath}`);

    // Sử dụng Promise để chờ script chạy xong và trả về kết quả cho UI
    try {
      const result = await new Promise((resolve, reject) => {
        exec(`"${nodePath}" "${scriptPath}"`, { maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
          if (error) {
            logger.error(`[SyncManagerController] Lỗi thực thi script JS: ${error.message}`);
            return resolve({ success: false, message: error.message });
          }

          if (stderr) {
            logger.warn(`[SyncManagerController] Script JS stderr: ${stderr}`);
          }

          // Tìm dòng kết quả JSON
          const lines = stdout.split('\n');
          const resultLine = lines.find(l => l.trim().startsWith('JSON_RESULT:'));

          if (resultLine) {
            try {
              const jsonStr = resultLine.trim().replace('JSON_RESULT:', '');
              const data = JSON.parse(jsonStr);
              return resolve(data);
            } catch (e) {
              logger.error(`[SyncManagerController] Lỗi parse JSON kết quả: ${e.message}`);
              return resolve({ success: false, message: 'Lỗi định dạng kết quả từ script' });
            }
          }

          resolve({ success: false, message: 'Không tìm thấy kết quả từ script' });
        });
      });

      if (result.success) {
        return this.success(res, result, 'Import thành công');
      } else {
        return this.error(res, result.message || 'Import thất bại', 500, result);
      }
    } catch (err) {
      return this.error(res, `Lỗi hệ thống: ${err.message}`);
    }
  });

  /**
   * Downloads the passport import Excel template.
   */
  downloadPassportTemplate = this.asyncHandler(async (req, res) => {
    const templatePath = path.resolve(process.cwd(), 'ReportDSHoChieu.xlsx');
    if (!fs.existsSync(templatePath)) {
      return this.error(res, 'Không tìm thấy file mẫu trên server.', 404);
    }
    res.download(templatePath, 'Mau_Import_Ho_Chieu.xlsx');
  });

  // ── Dashboard — giống bản gốc, bỏ meta refresh, thêm SSE JS

  /**
   * Renders dashboard HTML and injects realtime SSE client script.
   */
  getDashboard = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();

    const instanceId = process.env.SYNC_INSTANCE_ID || process.env.INSTANCE_ID || 'default';
    const data = await SyncStateRepository.getDashboardData(instanceId);
    const sharePointLoginState = this._getSharePointLoginState();
    data.sharePointLoginRequired = sharePointLoginState.required;
    data.sharePointLoginInProgress = sharePointLoginState.inProgress;
    data.sharePointLoginMessage = sharePointLoginState.message;
    data.sharePointLoginSkipped = global.sharePointLoginSkipped || false;
    const registeredLabels = this.modelRegistry.getRegisteredLabels();
    // Đảm bảo tất cả models trong registry đều xuất hiện, kể cả khi chưa có trong DB
    const allEntities = { ...(data.entities || {}) };
    for (const label of registeredLabels) {
      if (!allEntities[label]) {
        allEntities[label] = {
          modelName: label,
          status: 'IDLE',
          error: 'Chưa khởi tạo hoặc DB không phản hồi'
        };
      }
    }
    const filteredEntities = allEntities;

    const initialRows = this._renderRows(filteredEntities, data.jobs);
    const noEntities = Object.keys(filteredEntities).length === 0;
    const tableContent = noEntities
      ? '<div class="empty-state"><i class="bi bi-inbox"></i>Chưa có đối tượng nào được đăng kí đồng bộ — liên hệ quản trị viên</div>'
      : `<table class="dash-table">
          <thead>
            <tr>
              <th style="width: 50px">ID</th>
              <th style="width: 250px"><i class="bi bi-box-seam me-1"></i>Đối tượng</th>
              <th style="width: 130px"><i class="bi bi-activity me-1"></i>Trạng thái</th>
              <th><i class="bi bi-bar-chart-line me-1"></i>Tiến trình</th>
              <th><i class="bi bi-123 me-1"></i>Số lượng / Tổng số</th>
              <th style="width: 80px"><i class="bi bi-percent me-1"></i>%</th>
              <th><i class="bi bi-clock-history me-1"></i>Lần đồng bộ gần nhất</th>
              <th><i class="bi bi-calendar-check me-1"></i>Lần đồng bộ cuối</th>
              <th><i class="bi bi-hash me-1"></i>Phiên hiện tại</th>
              <th style="max-width: 150px">Lỗi gần nhất</th>
              <th>Host</th>
              <th><i class="bi bi-sliders me-1"></i>Hành động</th>
            </tr>
          </thead>
          <tbody id="sync-tbody">${initialRows}</tbody>
        </table>`;

    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>TÂN CẢNG ĐỒNG BỘ - Dashboard</title>
  <link href="/assets/inter/vietnamese.css" rel="stylesheet">
  <link href="/assets/bootstrap-icons/font/bootstrap-icons.css" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg-body:       #f0f4f8;
      --bg-card:       #ffffff;
      --bg-card-inner: #f8fafc;
      --bg-header:     linear-gradient(135deg, #1e3a5f 0%, #0d2137 60%, #162032 100%);
      --bg-table-head: #f1f5f9;
      --bg-row-hover:  rgba(59,130,246,0.04);
      --border-color:  rgba(0,0,0,0.08);
      --accent-blue:   #2563eb;
      --accent-green:  #16a34a;
      --accent-orange: #d97706;
      --accent-red:    #dc2626;
      --text-primary:  #1e293b;
      --text-muted:    #94a3b8;
      --text-sub:      #64748b;
      --radius-lg:     14px;
      --radius-md:     10px;
      --radius-sm:     7px;
      --shadow-card:   0 4px 24px rgba(0,0,0,0.08);
      --shadow-btn:    0 2px 8px rgba(0,0,0,0.15);
    }

    html, body {
      height: 100vh;
      overflow: hidden;
      background: var(--bg-body);
      font-family: 'Inter', sans-serif;
      color: var(--text-primary);
    }

    /* ── Page wrapper ── */
    .page-wrapper {
      width: 100%;
      height: 100vh;
      padding: 20px 20px 20px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── Main card ── */
    .dash-card {
      background: var(--bg-card);
      border-radius: var(--radius-lg);
      border: 1px solid var(--border-color);
      box-shadow: var(--shadow-card);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      flex: 1 1 0;
      min-height: 0;
    }

    /* ── Header ── */
    .dash-header {
      background: var(--bg-header);
      padding: 22px 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .dash-header-left {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .dash-logo {
      width: 42px; height: 42px;
      background: rgba(59,130,246,0.2);
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px;
    }
    .dash-title {
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: #fff;
    }
    .dash-subtitle {
      font-size: 0.74rem;
      color: rgba(255,255,255,0.5);
      margin-top: 2px;
      letter-spacing: 0.3px;
    }
    .dash-header-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    #running-badge {
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 0.78rem;
      font-weight: 600;
      letter-spacing: 0.4px;
      border: 1.5px solid rgba(255,255,255,0.15);
    }
    #running-badge.ready  { background: rgba(34,197,94,0.15);  color: #4ade80; border-color: rgba(34,197,94,0.3); }
    #running-badge.syncing{ background: rgba(59,130,246,0.15); color: #60a5fa; border-color: rgba(59,130,246,0.3); }
    #running-badge.error  { background: rgba(239,68,68,0.15);  color: #f87171; border-color: rgba(239,68,68,0.3); }
    .sse-indicator {
      display: flex; align-items: center; gap: 6px;
      font-size: 0.74rem; color: var(--text-sub);
    }
    #sse-dot { font-size: 14px; }

    /* ── Action buttons bar ── */
    .action-bar {
      padding: 20px 28px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }
    .btn-dash {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 9px 18px;
      border-radius: var(--radius-sm);
      font-size: 0.83rem;
      font-weight: 600;
      border: none;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: var(--shadow-btn);
      letter-spacing: 0.2px;
    }
    .btn-dash:disabled {
      opacity: 0.38;
      cursor: not-allowed;
      box-shadow: none;
    }
    .btn-dash-primary {
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      color: #fff;
    }
    .btn-dash-primary:not(:disabled):hover {
      background: linear-gradient(135deg, #3b82f6, #2563eb);
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(37,99,235,0.4);
    }
    .btn-dash-danger {
      background: linear-gradient(135deg, #dc2626, #b91c1c);
      color: #fff;
    }
    .btn-dash-danger:not(:disabled):hover {
      background: linear-gradient(135deg, #ef4444, #dc2626);
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(220,38,38,0.4);
    }

    /* ── Table ── */
    .table-wrapper {
      padding: 0 20px 16px;
      overflow: auto;
      flex: 1 1 0;
      min-height: 0;
    }
    table.dash-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.82rem;
      margin-top: 20px;
    }
    table.dash-table thead tr {
      background: var(--bg-table-head);
      border-bottom: 2px solid var(--border-color);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    table.dash-table thead th {
      padding: 12px 14px;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      color: var(--text-sub);
      white-space: nowrap;
      border: none;
    }
    table.dash-table tbody tr {
      border-bottom: 1px solid var(--border-color);
      transition: background 0.15s ease;
    }
    table.dash-table tbody tr:hover { background: var(--bg-row-hover); }
    table.dash-table tbody td {
      padding: 13px 14px;
      vertical-align: middle;
      color: var(--text-primary);
      border: none;
    }

    /* ── Model name chip ── */
    .model-chip {
      display: inline-flex; align-items: center; gap: 6px;
      background: rgba(37,99,235,0.08);
      border: 1px solid rgba(37,99,235,0.2);
      color: #1d4ed8;
      padding: 4px 10px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 0.78rem;
      white-space: nowrap;
    }

    /* ── Status badges ── */
    .status-badge {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 0.74rem;
      font-weight: 600;
      white-space: nowrap;
    }
    .status-badge .dot {
      width: 7px; height: 7px; border-radius: 50%;
    }
    .status-running, .status-resuming {
      background: rgba(37,99,235,0.1); color: #1d4ed8;
    }
    .status-running .dot, .status-resuming .dot {
      background: #2563eb;
      animation: pulse-dot 1.2s infinite;
    }
    .status-pause_requested {
      background: rgba(217,119,6,0.12); color: #b45309;
    }
    .status-pause_requested .dot { background: #d97706; }
    .status-paused {
      background: rgba(217,119,6,0.1); color: #92400e;
    }
    .status-paused .dot { background: #d97706; }
    .status-completed {
      background: rgba(22,163,74,0.1); color: #15803d;
    }
    .status-completed .dot { background: #16a34a; }
    .status-failed, .status-crashed, .status-error {
      background: rgba(220,38,38,0.1); color: #b91c1c;
    }
    .status-failed .dot, .status-crashed .dot, .status-error .dot { background: #dc2626; }
    .status-idle {
      background: rgba(100,116,139,0.1); color: #475569;
    }
    .status-idle .dot { background: #64748b; }
    @keyframes pulse-dot {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%       { opacity: 0.4; transform: scale(0.7); }
    }

    /* ── Progress bar ── */
    .prog-wrap {
      background: rgba(255,255,255,0.06);
      border-radius: 20px;
      height: 8px;
      overflow: hidden;
      min-width: 110px;
    }
    .prog-fill {
      height: 100%;
      border-radius: 20px;
      transition: width 0.6s ease, background 0.3s ease;
    }
    .prog-fill.blue   { background: linear-gradient(90deg, #3b82f6, #60a5fa); }
    .prog-fill.green  { background: linear-gradient(90deg, #16a34a, #22c55e); }
    .prog-fill.red    { background: linear-gradient(90deg, #b91c1c, #ef4444); }
    .prog-fill.yellow { background: linear-gradient(90deg, #b45309, #f59e0b); }
    .prog-label {
      font-size: 0.72rem;
      color: var(--text-sub);
      margin-top: 4px;
      text-align: right;
    }

    /* ── Sync count ── */
    .sync-count { font-weight: 700; font-size: 0.85rem; color: var(--text-primary); }
    .sync-total { color: var(--text-muted); font-size: 0.78rem; }

    /* ── Job info ── */
    .job-id {
      font-family: 'Courier New', monospace;
      font-size: 0.68rem;
      color: #475569;
      background: rgba(0,0,0,0.04);
      padding: 2px 6px;
      border-radius: 4px;
      word-break: break-all;
    }
    .job-status-pill {
      display: inline-block;
      margin-top: 3px;
      font-size: 0.65rem;
      padding: 1px 7px;
      border-radius: 10px;
      background: rgba(0,0,0,0.06);
      color: var(--text-sub);
    }

    /* ── Action buttons in table ── */
    .act-btn {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 5px 10px;
      border-radius: var(--radius-sm);
      font-size: 0.74rem;
      font-weight: 600;
      border: 1.5px solid transparent;
      cursor: pointer;
      transition: all 0.18s ease;
      margin: 2px 2px;
      white-space: nowrap;
    }
    .act-btn:disabled { opacity: 0.28; cursor: not-allowed; }
    .act-btn-run {
      background: #2563eb;
      border-color: #1d4ed8;
      color: #fff;
    }
    .act-btn-run:not(:disabled):hover {
      background: #1d4ed8;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(37,99,235,0.35);
    }
    .act-btn-reset {
      background: #dc2626;
      border-color: #b91c1c;
      color: #fff;
    }
    .act-btn-reset:not(:disabled):hover {
      background: #b91c1c;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(220,38,38,0.35);
    }
    .act-btn-pause {
      background: #d97706;
      border-color: #b45309;
      color: #fff;
    }
    .act-btn-pause:not(:disabled):hover {
      background: #b45309;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(217,119,6,0.35);
    }
    .act-btn-resume {
      background: #16a34a;
      border-color: #15803d;
      color: #fff;
    }
    .act-btn-resume:not(:disabled):hover {
      background: #15803d;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(22,163,74,0.35);
    }
    .act-group { display: flex; flex-wrap: wrap; gap: 4px; }

    /* ── Footer ── */
    .dash-footer {
      padding: 14px 28px;
      border-top: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.74rem;
      color: var(--text-muted);
    }

    /* ── Empty state ── */
    .empty-state {
      text-align: center;
      padding: 48px 20px;
      color: #94a3b8;
    }
    .empty-state i { font-size: 2.5rem; display: block; margin-bottom: 12px; color: #cbd5e1; }

    /* ── Toggle Switch ── */
    .toggle-wrapper {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-left: auto;
      background: rgba(0,0,0,0.03);
      padding: 6px 14px;
      border-radius: 20px;
      border: 1px solid var(--border-color);
    }
    .toggle-label {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text-primary);
      cursor: pointer;
    }
    .switch {
      position: relative;
      display: inline-block;
      width: 38px;
      height: 20px;
    }
    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .slider {
      position: absolute;
      cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background-color: #cbd5e1;
      transition: .3s;
      border-radius: 34px;
    }
    .slider:before {
      position: absolute;
      content: "";
      height: 14px;
      width: 14px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .3s;
      border-radius: 50%;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    input:checked + .slider {
      background-color: var(--accent-green);
    }
    input:checked + .slider:before {
      transform: translateX(18px);
    }

    /* ── SharePoint Notification Banner ── */
    .alert-banner {
      margin: 10px 20px 0;
      padding: 12px 20px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 15px;
      animation: slideDown 0.3s ease-out;
    }
    .alert-banner-warning {
      background: rgba(217,119,6,0.1);
      border: 1px solid rgba(217,119,6,0.2);
      color: #b45309;
    }
    .alert-banner-error {
      background: rgba(220,38,38,0.1);
      border: 1px solid rgba(220,38,38,0.2);
      color: #b91c1c;
    }
    .alert-banner-content {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.85rem;
      font-weight: 500;
    }
    .alert-banner-actions {
      display: flex;
      gap: 8px;
    }
    .btn-banner {
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 700;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.2s;
    }
    .btn-banner-primary {
      background: #2563eb;
      color: #fff;
    }
    .btn-banner-primary:hover { background: #1d4ed8; }
    .btn-banner-secondary {
      background: rgba(0,0,0,0.05);
      color: inherit;
      border-color: currentColor;
    }
    .btn-banner-secondary:hover { background: rgba(0,0,0,0.1); }

    /* ── SharePoint Modal Overlay ── */
    .modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.75);
      backdrop-filter: blur(4px);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .modal-content {
      background: var(--bg-card);
      border-radius: var(--radius-md);
      width: 100%;
      max-width: 450px;
      padding: 30px;
      text-align: center;
      box-shadow: 0 20px 50px rgba(0,0,0,0.5);
      border: 1px solid var(--border-color);
      animation: modalFadeIn 0.3s ease-out;
    }
    .spinner-box {
      margin-bottom: 20px;
    }
    .spinner {
      width: 50px;
      height: 50px;
      border: 5px solid rgba(37,99,235,0.2);
      border-top-color: #2563eb;
      border-radius: 50%;
      display: inline-block;
      animation: spin 1s linear infinite;
    }
    .modal-title {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 12px;
    }
    .modal-desc {
      font-size: 0.9rem;
      color: var(--text-sub);
      margin-bottom: 25px;
      line-height: 1.5;
    }
    .modal-actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .btn-modal {
      padding: 12px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 0.95rem;
      cursor: pointer;
      transition: all 0.2s;
      border: none;
    }
    .btn-modal-primary {
      background: #2563eb;
      color: #fff;
    }
    .btn-modal-primary:hover { background: #1d4ed8; transform: translateY(-1px); }
    .btn-modal-secondary {
      background: rgba(255,255,255,0.05);
      color: var(--text-primary);
      border: 1px solid var(--border-color);
    }
    .btn-modal-secondary:hover { background: rgba(255,255,255,0.1); }

    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes modalFadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }

    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Blur background when modal is active */
    body.has-modal .page-wrapper {
      filter: blur(5px);
      pointer-events: none;
      user-select: none;
    }
  </style>
</head>
<body class="${data.sharePointLoginRequired && !data.sharePointLoginSkipped ? 'has-modal' : ''}">
  <div class="page-wrapper">
    <div class="dash-card">

      <!-- Header -->
      <div class="dash-header">
        <div class="dash-header-left">
          <div class="dash-logo"><i class="bi bi-arrow-repeat" style="color:#60a5fa;"></i></div>
          <div>
            <div class="dash-title">SNP - HỆ THỐNG ĐỒNG BỘ</div>
            <div class="dash-subtitle">Điều khiển và giám sát quy trình đồng bộ EOffice</div>
          </div>
        </div>
        <div class="dash-header-right">
          <span id="running-badge" class="${data.isRunning ? 'syncing' : 'ready'}">
            ${data.isRunning ? '⟳ Đang đồng bộ...' : '✓ Sẵn sàng'}
          </span>
          <button class="btn-close-app" onclick="triggerShutdown()" title="Tắt hệ thống" style="background: rgba(239,68,68,0.1); color: #f87171; border: 1px solid rgba(239,68,68,0.2); width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; font-size: 20px;">
            <i class="bi bi-x"></i>
          </button>
          <div class="sse-indicator">
            <span id="sse-dot">⌛</span>
            <span>Trực tuyến</span>
          </div>
        </div>
      </div>

      <!-- Action bar -->
      <div class="action-bar">
        <button id="btn-all"   onclick="triggerSync(false)" class="btn-dash btn-dash-primary">
          <i class="bi bi-play-fill"></i> Chạy tất cả các đối tượng
        </button>
        <button id="btn-reset" onclick="triggerSync(true)"  class="btn-dash btn-dash-danger">
          <i class="bi bi-arrow-counterclockwise"></i> Chạy lại toàn bộ tất cả đối tượng
        </button>

        <button id="btn-import-passport" onclick="document.getElementById('passport-file-input').click()" class="btn-dash" style="background: #8b5cf6; color: #fff;" ${data.isRunning ? 'disabled' : ''}>
          <i class="bi bi-file-earmark-excel"></i> Chọn file & Import Hộ Chiếu
        </button>
        <button onclick="window.open('/api/sync-manager-src/download-passport-template', '_blank')" class="btn-dash" style="background: #10b981; color: #fff;">
          <i class="bi bi-download"></i> Tải file mẫu
        </button>
        <input type="file" id="passport-file-input" style="display:none" accept=".xlsx, .xls" onchange="handleFileSelected(this)">

        <div class="toggle-wrapper">
          <label class="toggle-label" for="skipPullToggle">
            <i class="bi bi-fast-forward-btn me-1"></i> Bỏ qua chuẩn bị dữ liệu từ các bảng (Người dùng, Văn bản đến/đi, Công việc...)
          </label>
          <label class="switch">
            <input type="checkbox" id="skipPullToggle" onchange="toggleSkipPull(this)" ${data.settings && data.settings.SKIP_PULL_FROM_OLD ? 'checked' : ''} ${data.isRunning ? 'disabled' : ''}>
            <span class="slider"></span>
          </label>
        </div>

      </div>

      <!-- Notification Area -->
      <div id="notification-area">
        ${!data.sharePointLoginRequired && data.sharePointLoginSkipped ? `
          <div class="alert-banner alert-banner-warning">
            <div class="alert-banner-content">
              <i class="bi bi-info-circle-fill"></i>
              <span><b>Cảnh báo dữ liệu:</b> Bạn đang bỏ qua đăng nhập SharePoint. Dữ liệu liên quan đến Tệp tin & Tin tức sẽ bị sai lệch hoặc thiếu.</span>
            </div>
            <div class="alert-banner-actions">
              <button class="btn-banner btn-banner-secondary" onclick="triggerLogin()">Thử đăng nhập lại</button>
            </div>
          </div>
        ` : ''}
      </div>

      <!-- Table -->
      <div class="table-wrapper">
        ${tableContent}
      </div>

      <!-- Footer -->
      <div class="dash-footer">
        <span><i class="bi bi-broadcast me-1"></i>Cập nhật realtime qua SSE</span>
        <span id="last-update"></span>
      </div>
    </div>
  </div>

  <!-- Modal Area (Nằm ngoài để không bị mờ) -->
  <div id="modal-area">
    ${data.sharePointLoginRequired && !data.sharePointLoginSkipped ? `
      <div class="modal-overlay">
        <div class="modal-content">
          <div class="spinner-box">
            <div class="spinner"></div>
          </div>
          <div class="modal-title">Yêu cầu đăng nhập SharePoint</div>
          <div class="modal-desc">
            ${data.sharePointLoginMessage || 'Hệ thống cần kết nối với SharePoint để đồng bộ Tin tức & Tệp tin. Vui lòng thực hiện đăng nhập.'}
          </div>
          <div class="modal-actions">
            <button class="btn-modal btn-modal-primary" onclick="triggerLogin()">Đăng nhập ngay</button>
            <button class="btn-modal btn-modal-secondary" onclick="triggerSkipLoginUI()">Bỏ qua không đăng nhập</button>
          </div>
        </div>
      </div>
    ` : ''}
  </div>

  <script>
    // ── SSE: nhận update realtime từ server ──────────────────
    let _es = null;
    let retryCount = 0;
    const maxRetries = 2; // Giới hạn số lần thử lại trước khi báo sự cố
    let sharePointLoginActive = false;
    let sharePointLoginRequestActive = false;
    window.__sharePointSkipConfirmActive = false;
    window.__sharePointLoginRequired = ${data.sharePointLoginRequired ? 'true' : 'false'};
    window.__sharePointLoginInProgress = ${data.sharePointLoginInProgress ? 'true' : 'false'};
    window.__sharePointLoginMessage = ${JSON.stringify(data.sharePointLoginMessage || '')};

    function handleSharePointLoginRequirement(data = {}) {
      window.__sharePointLoginRequired = Boolean(data.sharePointLoginRequired);
      window.__sharePointLoginInProgress = Boolean(data.sharePointLoginInProgress);
      window.__sharePointLoginMessage = data.sharePointLoginMessage || '';
      window.__sharePointLoginSkipped = Boolean(data.sharePointLoginSkipped);

      const area = document.getElementById('notification-area');
      const modalArea = document.getElementById('modal-area');

      const newModalState = JSON.stringify({
        req: window.__sharePointLoginRequired,
        prog: window.__sharePointLoginInProgress,
        msg: window.__sharePointLoginMessage,
        skip: window.__sharePointLoginSkipped,
        conf: window.__sharePointSkipConfirmActive,
        succ: window.__sharePointLoginSuccessActive
      });

      if (window.__lastModalState === newModalState) return;
      window.__lastModalState = newModalState;
      // TRƯỜNG HỢP 1: ĐANG TRONG QUÁ TRÌNH ĐĂNG NHẬP (Hiện màn hình tối + Spinner + LOG + Nút Bỏ qua thẳng)
      if (window.__sharePointLoginInProgress) {
        document.body.classList.add('has-modal');
        modalArea.innerHTML = \`
          <div class="modal-overlay">
            <div class="modal-content">
              <div class="spinner-box">
                <div class="spinner"></div>
              </div>
              <div class="modal-title">Đang kết nối SharePoint</div>
              <div class="modal-desc">Vui lòng đợi trong giây lát...</div>

              <!-- Hiển thị log đăng nhập -->
              <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; margin-bottom: 20px; font-family: monospace; font-size: 0.8rem; color: #60a5fa; text-align: left; border: 1px solid rgba(255,255,255,0.1);">
                <i class="bi bi-terminal me-2"></i> Trạng thái: \${window.__sharePointLoginMessage || 'Khởi tạo kết nối...'}
              </div>

              <div class="modal-actions">
                <button class="btn-modal btn-modal-secondary" onclick="confirmSkipLogin()">Bỏ qua và vào Dashboard</button>
              </div>
            </div>
          </div>
        \`;
        area.innerHTML = '';
        return;
      }
      // TRƯỜNG HỢP 4: THÀNH CÔNG (Hiện thông báo xanh trong 2 giây)
      else if (window.__sharePointLoginSuccessActive) {
        document.body.classList.add('has-modal');
        modalArea.innerHTML = \`
          <div class="modal-overlay">
            <div class="modal-content" style="border-color: #10b981;">
              <div class="spinner-box">
                <i class="bi bi-check-circle-fill" style="font-size: 3.5rem; color: #10b981; animation: modalFadeIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);"></i>
              </div>
              <div class="modal-title" style="color: #10b981;">Đăng nhập thành công</div>
              <div class="modal-desc">Kết nối SharePoint đã được thiết lập. Hệ thống đang sẵn sàng đồng bộ.</div>
            </div>
          </div>
        \`;
      }
      // TRƯỜNG HỢP 2: YÊU CẦU ĐĂNG NHẬP (Hiện màn hình tối + Các nút lựa chọn)
      else if (window.__sharePointLoginRequired) {
        document.body.classList.add('has-modal');
        if (window.__sharePointSkipConfirmActive) {
          // Giai đoạn 2: Xác nhận bỏ qua (vẫn trong màn hình tối)
          modalArea.innerHTML = \`
            <div class="modal-overlay">
              <div class="modal-content" style="border-color: #b45309;">
                <div class="spinner-box">
                  <i class="bi bi-exclamation-triangle" style="font-size: 3rem; color: #d97706;"></i>
                </div>
                <div class="modal-title" style="color: #d97706;">Xác nhận bỏ qua</div>
                <div class="modal-desc">
                  <b>Cảnh báo:</b> Nếu bỏ qua, dữ liệu Tin tức và Tệp tin sẽ <b>không được đồng bộ chính xác</b> hoặc bị thiếu sót. Bạn có chắc chắn muốn tiếp tục?
                </div>
                <div class="modal-actions">
                  <button class="btn-modal btn-modal-primary" style="background:#d97706" onclick="confirmSkipLogin()">Tôi đã hiểu, tiếp tục bỏ qua</button>
                  <button class="btn-modal btn-modal-secondary" onclick="cancelSkipLogin()">Quay lại đăng nhập</button>
                </div>
              </div>
            </div>
          \`;
        } else {
          // Giai đoạn 1: Yêu cầu đăng nhập (xoay xoay)
          modalArea.innerHTML = \`
            <div class="modal-overlay">
              <div class="modal-content">
                <div class="spinner-box">
                  <div class="spinner"></div>
                </div>
                <div class="modal-title">Yêu cầu đăng nhập SharePoint</div>
                <div class="modal-desc">
                  \${window.__sharePointLoginMessage || 'Hệ thống cần kết nối với SharePoint để đồng bộ Tin tức & Tệp tin. Vui lòng thực hiện đăng nhập.'}
                </div>
                <div class="modal-actions">
                  <button class="btn-modal btn-modal-primary" onclick="triggerLogin()">Đăng nhập ngay</button>
                  <button class="btn-modal btn-modal-secondary" onclick="triggerSkipLoginUI()">Bỏ qua không đăng nhập</button>
                </div>
              </div>
            </div>
          \`;
        }
        area.innerHTML = ''; // Ẩn banner nếu đang hiện modal
      } else {
        document.body.classList.remove('has-modal');
        modalArea.innerHTML = '';

        // Xử lý Banner Cảnh báo (Bỏ qua)
        if (window.__sharePointLoginSkipped) {
          area.innerHTML = \`
            <div class="alert-banner alert-banner-warning">
              <div class="alert-banner-content">
                <i class="bi bi-info-circle-fill"></i>
                <span><b>Cảnh báo dữ liệu:</b> Bạn đang bỏ qua đăng nhập SharePoint. Dữ liệu liên quan đến Tệp tin & Tin tức sẽ bị sai lệch hoặc thiếu.</span>
              </div>
              <div class="alert-banner-actions">
                <button class="btn-banner btn-banner-secondary" onclick="triggerLogin()">Thử đăng nhập lại</button>
              </div>
            </div>
          \`;
        } else {
          area.innerHTML = '';
        }
      }
    }

    function triggerSkipLoginUI() {
      window.__sharePointSkipConfirmActive = true;
      handleSharePointLoginRequirement({
        sharePointLoginRequired: window.__sharePointLoginRequired,
        sharePointLoginInProgress: window.__sharePointLoginInProgress,
        sharePointLoginMessage: window.__sharePointLoginMessage,
        sharePointLoginSkipped: window.__sharePointLoginSkipped
      });
    }

    function cancelSkipLogin() {
      window.__sharePointSkipConfirmActive = false;
      handleSharePointLoginRequirement({
        sharePointLoginRequired: window.__sharePointLoginRequired,
        sharePointLoginInProgress: window.__sharePointLoginInProgress,
        sharePointLoginMessage: window.__sharePointLoginMessage,
        sharePointLoginSkipped: window.__sharePointLoginSkipped
      });
    }

    async function confirmSkipLogin() {
      window.__sharePointSkipConfirmActive = false;
      try {
        await fetch('/api/sync-manager-src/skip-login', { method: 'POST' });
      } catch (e) {
        alert('Lỗi: ' + e.message);
      }
    }

    async function retrySharePointLoginFromDashboard() {
      if (sharePointLoginRequestActive) return false;
      sharePointLoginRequestActive = true;
      try {
        const r = await fetch('/api/sync-manager-src/login', { method: 'POST' });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.success !== false) {
          window.__sharePointLoginRequired = false;
          window.__sharePointLoginInProgress = false;
          window.__sharePointLoginMessage = '';
          window.__sharePointLoginSkipped = false;
          return true;
        }

        window.__sharePointLoginRequired = true;
        window.__sharePointLoginInProgress = false;
        window.__sharePointLoginMessage = j.message || j.error || 'Đăng nhập SharePoint thất bại.';
        return false;
      } catch (e) {
        window.__sharePointLoginRequired = true;
        window.__sharePointLoginInProgress = false;
        window.__sharePointLoginMessage = e.message || 'Đăng nhập SharePoint thất bại.';
        return false;
      } finally {
        sharePointLoginRequestActive = false;
      }
    }



    function connectSSE() {
      _es = new EventSource('/api/sync-manager-src/events');
      _es.onopen    = () => {
        document.getElementById('sse-dot').textContent = '🟢';
        retryCount = 0;
      };
      _es.onerror   = () => {
        document.getElementById('sse-dot').textContent = '🔴';
        _es.close();

        retryCount++;
        if (retryCount >= maxRetries) {
          // Nếu lỗi quá số lần quy định -> Chuyển trạng thái CRASHED và DỪNG
          const badge = document.getElementById('running-badge');
          badge.textContent = 'Gặp sự cố (Mất kết nối)';
          badge.className = 'error';
          return; // Không gọi setTimeout nữa
          // Nếu lỗi 2 lần liên tiếp -> Dừng và báo SỰ CỐ
          badge.textContent = 'SỰ CỐ (MẤT KẾT NỐI)';
          badge.className = 'error';
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
      handleSharePointLoginRequirement(data);
      const badge = document.getElementById('running-badge');
      badge.textContent = data.isRunning ? '⟳ Đang đồng bộ...' : '✓ Sẵn sàng';
      badge.className   = data.isRunning ? 'syncing' : 'ready';
      document.getElementById('btn-all').disabled   = false;
      document.getElementById('btn-reset').disabled = false;
      const btnImport = document.getElementById('btn-import-passport');
      if (btnImport) btnImport.disabled = data.isRunning;

      const skipToggle = document.getElementById('skipPullToggle');
      if (skipToggle) {
        skipToggle.disabled = data.isRunning;
        if (data.settings && !window.__skipPullLock) {
          skipToggle.checked = !!data.settings.SKIP_PULL_FROM_OLD;
        }
      }

      // Kiểm tra job vừa khởi chạy xem có kết thúc ngay với tổng=0 không
      if (window.__pendingJobIds && window.__pendingJobIds.size > 0) {
        for (const [jobId, job] of Object.entries(data.jobs || {})) {
          if (
            window.__pendingJobIds.has(jobId) &&
            job.status === 'COMPLETED' &&
            Number(job.totalToSync || 0) === 0 &&
            Number(job.totalProcessed || 0) === 0
          ) {
            window.__pendingJobIds.delete(jobId);
            showToast('<b>✅ Đã đồng bộ hết rồi!</b><br>Không có bản ghi mới cần xử lý.', '#2563eb', 6000);
          }
        }
      }

      // Lọc dữ liệu hiển thị (giống logic server-side)
      const registeredLabels = [${this.modelRegistry.getRegisteredLabels().map(l => `'${l}'`).join(',')}];
      const filteredEntities = {};
      for (const label of registeredLabels) {
        if (data.entities && data.entities[label]) {
          filteredEntities[label] = data.entities[label];
        }
      }

      document.getElementById('sync-tbody').innerHTML =
        buildRows(filteredEntities, data.jobs || {});
      document.getElementById('last-update').textContent =
        'Lần cuối: ' + new Date().toLocaleTimeString('vi-VN');
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

      // Khong tu suy dien CRASHED theo timeout heartbeat o giao dien.
      // Với job du lieu lon, mot batch co the xu ly lau > 60s nhung van RUNNING.
      let ms = (info.status||'IDLE').toUpperCase();
      const js = cur ? String(cur.status||'').toUpperCase() : null;

      const canStart  = true; // Luôn luôn hiện sáng theo yêu cầu người dùng
      const canPause  = js === 'RUNNING' || js === 'RESUMING';
      const canResume = !['RUNNING', 'RESUMING', 'PAUSE_REQUESTED'].includes(js || ''); // Chỉ hiện khi không đang chạy
      const rid       = (cur && cur.jobId) || info.activeJobId || '';

      const mapVN = {
        'IDLE': 'Sẵn sàng', 'RUNNING': 'Đang chạy', 'RESUMING': 'Đang tiếp tục',
        'PAUSE_REQUESTED': 'Đang dừng...', 'PAUSED': 'Đã tạm dừng',
        'COMPLETED': 'Hoàn thành', 'FAILED': 'Thất bại', 'CRASHED': 'Sự cố', 'ERROR': 'Lỗi'
      };
      const txt = mapVN[ms] || ms;

      let pFill = 'blue';
      if (ms === 'COMPLETED') pFill = 'green';
      else if (['FAILED','CRASHED','ERROR'].includes(ms)) pFill = 'red';
      else if (ms === 'PAUSED') pFill = 'yellow';

      const pct = info.currentProgressPercent;
      const prog = pct != null
        ? \`<div class="prog-wrap"><div class="prog-fill \${pFill}" style="width:\${pct}%"></div></div>
           <div class="prog-label">\${pct}%</div>\`
        : '<span style="color:var(--text-muted)">—</span>';

      const [synced, total] = info.currentTotalToSync != null
        ? [\`\${(info.currentSynced||0).toLocaleString()}\`, \`\${info.currentTotalToSync.toLocaleString()}\`]
        : [null, null];
      const syncCell = synced
        ? \`<span class="sync-count">\${synced}</span><span class="sync-total"> / \${total}</span>\`
        : '<span style="color:var(--text-muted)">—</span>';

      const ji = cur
        ? \`<div class="job-id">\${cur.jobId}</div><span class="job-status-pill">\${cur.status}</span>\`
        : '<span style="color:var(--text-muted)">—</span>';

      const s = (info.status||'idle').toLowerCase();

      return \`<tr>
        <td><span class="model-chip"><i class="bi bi-database-fill-gear"></i>\${name}</span></td>
        <td><span class="status-badge status-\${s}"><span class="dot"></span>\${txt}</span></td>
        <td>\${prog}</td>
        <td>\${syncCell}</td>
        <td style="font-weight:600;color:var(--text-primary)">\${pct != null ? pct+'%' : '<span style=color:var(--text-muted)>—</span>'}</td>
        <td style="color:var(--text-sub);font-size:.78rem">\${info.lastSyncTime ? new Date(info.lastSyncTime).toLocaleString('vi-VN') : '—'}</td>
        <td style="color:var(--text-sub);font-size:.78rem">\${info.lastRun      ? new Date(info.lastRun).toLocaleString('vi-VN')      : '—'}</td>
        <td>\${ji}</td>
        <td>
          <div class="act-group">
            <button class="act-btn act-btn-run"    onclick="startModel('\${name}',false,this,'\${ms}')" \${canPause?'style="opacity:0.45;cursor:not-allowed;" disabled':''} \${canStart?'':'disabled'}><i class="bi bi-play-fill"></i>Chạy</button>
            <button class="act-btn act-btn-reset"  onclick="startModel('\${name}',true,this,'\${ms}')"  \${canStart?'':'disabled'}><i class="bi bi-arrow-counterclockwise"></i>Lại</button>
            <button class="act-btn act-btn-pause"  onclick="pauseJob('\${cur?cur.jobId:''}', this)"  \${canPause?'':'disabled'}><i class="bi bi-pause-fill"></i>Dừng</button>
            <button class="act-btn act-btn-resume" onclick="resumeJob('\${rid}', this)"              \${canResume?'':'disabled'}><i class="bi bi-skip-forward-fill"></i>Tiếp</button>
          </div>
        </td>
      </tr>\`;
    }

    // ── Actions — giống bản gốc, bỏ window.location.reload() ─
    // Helper for robust API calls
    async function safeFetchJson(url, options = {}) {
      try {
        const r = await fetch(url, options);
        const contentType = r.headers.get('Content-Type') || '';

        if (!r.ok) {
          let errorMsg = \`HTTP \${r.status}\`;
          if (contentType.includes('application/json')) {
            const j = await r.json();
            errorMsg = j.message || j.error || errorMsg;
          } else {
            const text = await r.text();
            errorMsg = text.substring(0, 200) || errorMsg;
          }
          throw new Error(errorMsg);
        }

        if (!contentType.includes('application/json')) {
          const text = await r.text();
          console.error('[safeFetchJson] Non-JSON response:', text);
          throw new Error('Hệ thống trả về định dạng không phải JSON. Vui lòng kiểm tra log server.');
        }

        return await r.json();
      } catch (e) {
        console.error('[safeFetchJson] Error:', e);
        throw e;
      }
    }

    async function triggerSync(reset) {
      if (!confirm(reset ? 'Bạn chắc chắn muốn chạy lại từ đầu?' : 'Bắt đầu đồng bộ đối tượng tiếp theo?')) return;
      try {
        const data = await safeFetchJson('/api/sync-manager-src/start', {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({reset})
        });
        alert(data.message || 'Đồng chí đã gửi lệnh');
      } catch(e) { alert('Lỗi: ' + e.message); }
    }

    // Hiện modal xác nhận trước khi chạy (khi đang ở trạng thái cần cảnh báo)
    function showSyncConfirm(onConfirm) {
      const overlay = document.createElement('div');
      overlay.id = '__sync-confirm-overlay';
      overlay.style.cssText = [
        'position:fixed;inset:0;z-index:9999',
        'background:rgba(15,23,42,0.6)',
        'backdrop-filter:blur(4px)',
        'display:flex;align-items:center;justify-content:center',
        'animation:modalFadeIn 0.2s ease'
      ].join(';');
      overlay.innerHTML =
        '<div style="background:#1e2a3b;border:1.5px solid rgba(245,158,11,0.6);border-radius:16px;' +
        'padding:36px 40px;max-width:440px;width:90%;box-shadow:0 24px 64px rgba(0,0,0,0.5);' +
        'text-align:center;animation:modalFadeIn 0.25s cubic-bezier(.175,.885,.32,1.275);">' +
          '<div style="font-size:3rem;margin-bottom:12px;">\u26a0\ufe0f</div>' +
          '<div style="font-size:1.1rem;font-weight:700;color:#f59e0b;margin-bottom:14px;line-height:1.4">' +
            '\u0110\u1ed3ng ch\u00ed \u01a1i !' +
          '</div>' +
          '<div style="font-size:0.88rem;color:#cbd5e1;line-height:1.7;margin-bottom:28px;">' +
            'T\u00f4i s\u1ebd th\u1ef1c hi\u1ec7n \u0111\u1ed3ng b\u1ed9 l\u1ea1i c\u00e1c b\u1ea3n ghi ' +
            'Tôi sẽ thực hiện đồng bộ lại các bản ghi ' +
            '<strong style="color:#fbbf24">chưa đồng bộ</strong> và ' +
            '<strong style="color:#f87171">bị lỗi</strong>.<br>' +
            'Đồng chí có chắc chắn sẽ tiếp tục chứ?' +
          '</div>' +
          '<div style="display:flex;gap:12px;justify-content:center;">' +
            '<button id="__sync-confirm-yes" style="' +
              'background:linear-gradient(135deg,#2563eb,#1d4ed8);' +
              'color:#fff;border:none;border-radius:8px;' +
              'padding:10px 28px;font-size:0.85rem;font-weight:600;' +
              'cursor:pointer;transition:all 0.18s;">' +
              '✅ Tiếp tục' +
            '</button>' +
            '<button id="__sync-confirm-no" style="' +
              'background:rgba(255,255,255,0.08);' +
              'color:#94a3b8;border:1px solid rgba(255,255,255,0.12);' +
              'border-radius:8px;padding:10px 28px;' +
              'font-size:0.85rem;font-weight:600;' +
              'cursor:pointer;transition:all 0.18s;">' +
              '\u274c \u1ede l\u1ea1i' +
            '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      const close = function() { overlay.remove(); };
      overlay.querySelector('#__sync-confirm-yes').onclick = function() { close(); onConfirm(); };
      overlay.querySelector('#__sync-confirm-no').onclick = close;
      overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
    }

    // Hiện toast thông báo nhanh
    function showToast(msg, color, duration) {
      var t = document.createElement('div');
      t.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);' +
        'z-index:99999;padding:14px 28px;border-radius:10px;' +
        'font-size:0.88rem;font-weight:600;color:#fff;' +
        'box-shadow:0 8px 32px rgba(0,0,0,0.4);' +
        'background:' + (color || '#1e40af') + ';max-width:90%;text-align:center;' +
        'pointer-events:none;';
      t.innerHTML = msg;
      document.body.appendChild(t);
      setTimeout(function() {
        t.style.transition = 'opacity 0.4s';
        t.style.opacity = '0';
        setTimeout(function() { t.remove(); }, 400);
      }, duration || 3200);
    }

    async function startModel(modelName, reset, btn, currentStatus) {
      reset = reset === true || reset === 'true';
      var statusUp = String(currentStatus || '').toUpperCase();

      // Đang chạy → không cho chạy thêm, hiện toast cảnh báo
      if (!reset && (statusUp === 'RUNNING' || statusUp === 'RESUMING')) {
        return; // Nút đã mờ, không làm gì thêm
      }

      // Tạm dừng / Lỗi → hiện dialog xác nhận trước khi chạy lại
      var needsConfirm = ['PAUSED','PAUSE_REQUESTED','FAILED','CRASHED','ERROR'];
      if (!reset && needsConfirm.indexOf(statusUp) >= 0) {
        showSyncConfirm(function() { _doStartModel(modelName, reset, btn); });
        return;
      }

      // IDLE / COMPLETED / unknown → chạy ngay
      _doStartModel(modelName, reset, btn);
    }

    async function _doStartModel(modelName, reset, btn) {
      if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.innerHTML = '<i class="bi bi-hourglass-split"></i>...';
      }
      try {
        const data = await safeFetchJson('/api/sync-manager-src/models/'+encodeURIComponent(modelName)+'/start', {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({reset})
        });
        // Lưu jobId để renderDashboard theo dõi nếu job kết thúc với tổng = 0
        const jobId = data && data.data && data.data.jobId;
        if (jobId) {
          window.__pendingJobIds = window.__pendingJobIds || new Set();
          window.__pendingJobIds.add(jobId);
        }
        showToast('<b>✅ Đồng bộ đã được khởi chạy!</b>', '#15803d');
      } catch(e) {
        showToast('<b>❌ Lỗi:</b> ' + e.message, '#b91c1c');
        if (btn) {
          btn.disabled = false;
          btn.style.opacity = '1';
          btn.innerHTML = reset ? '<i class="bi bi-arrow-counterclockwise"></i>Lại' : '<i class="bi bi-play-fill"></i>Chạy';
        }
      }
    }

    async function pauseJob(jobId, btn) {
      if (!jobId) return;
      if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.innerHTML = '<i class="bi bi-hourglass-split"></i>...';
      }
      try {
        const data = await safeFetchJson('/api/sync-manager-src/jobs/'+encodeURIComponent(jobId)+'/pause', {
          method:'POST', headers:{'Content-Type':'application/json'}
        });
        alert(data.message || 'Đồng chí đã yêu cầu dừng lại');
      } catch(e) { 
        alert('Lỗi: ' + e.message);
        if (btn) {
          btn.disabled = false;
          btn.style.opacity = '1';
          btn.innerHTML = '<i class="bi bi-pause-fill"></i>Dừng';
        }
      }
    }

    async function resumeJob(jobId, btn) {
      if (!jobId) return;
      if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.innerHTML = '<i class="bi bi-hourglass-split"></i>...';
      }
      try {
        const data = await safeFetchJson('/api/sync-manager-src/jobs/'+encodeURIComponent(jobId)+'/resume', {
          method:'POST', headers:{'Content-Type':'application/json'}
        });
        alert(data.message || 'Đồng chí đã yêu cầu tiếp tục');
      } catch(e) { 
        alert('Lỗi: ' + e.message); 
        if (btn) {
          btn.disabled = false;
          btn.style.opacity = '1';
          btn.innerHTML = '<i class="bi bi-skip-forward-fill"></i>Tiếp';
        }
        location.reload(); 
      }
    }

    async function triggerShutdown() {
      if (!confirm('Bạn có chắc chắn muốn TẮT toàn bộ hệ thống? Cả trình duyệt và Command Line sẽ đóng.')) return;
      try {
        const data = await safeFetchJson('/api/sync-manager-src/shutdown', { method: 'POST' });
        alert(data.message || 'Hệ thống đang đóng...');
        window.close();
      } catch (e) { alert('Hệ thống đang đóng...'); window.close(); }
    }

    async function handleFileSelected(input) {
      const file = input.files[0];
      if (!file) return;

      if (!confirm('Bạn có chắc chắn muốn thực hiện import hộ chiếu từ file ' + file.name + '?')) {
        input.value = '';
        return;
      }

      const btn = document.getElementById('btn-import-passport');
      const originalHtml = btn.innerHTML;

      // Hiệu ứng đang chạy
      btn.disabled = true;
      btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Đang tải lên & import...';
      btn.style.opacity = '0.7';

      try {
        const formData = new FormData();
        formData.append('file', file);

        // Bước 1: Upload file lên server
        const upData = await safeFetchJson('/api/sync-manager-src/upload-passport-file', {
          method: 'POST',
          body: formData
        });

        if (!upData.success) {
          throw new Error(upData.message || 'Lỗi tải file lên server');
        }

        // Bước 2: Kích hoạt import từ file vừa upload
        const j = await safeFetchJson('/api/sync-manager-src/import-passport', { method: 'POST' });

        console.log('[Import Result]', j);

        if (j.success) {
          const data = j.data;
          let msg = '✅ KẾT QUẢ IMPORT HỘ CHIẾU\\n';
          msg += '----------------------------------\\n';
          msg += '• Tổng số bản ghi: ' + (data.inserted + data.updated + data.errors) + '\\n';
          msg += '• Thêm mới: ' + data.inserted + '\\n';
          msg += '• Cập nhật: ' + data.updated + '\\n';
          msg += '• Lỗi: ' + data.errors + '\\n';

          if (data.report_file) {
            msg += '\\nChi tiết lỗi xem tại: ' + data.report_file;
          }

          alert(msg);
        } else {
          const errMsg = j.message || 'Lỗi không xác định';
          if (errMsg.includes('không đúng mẫu chuẩn') || errMsg.includes('định dạng')) {
            if (confirm('❌ THẤT BẠI: ' + errMsg + '\\n\\nBạn có muốn tải file mẫu chuẩn ngay bây giờ không?')) {
              window.open('/api/sync-manager-src/download-passport-template', '_blank');
            }
          } else {
            alert('❌ THẤT BẠI: ' + errMsg);
          }
        }
      } catch(e) {
        const errMsg = e.message;
        if (errMsg.includes('không đúng mẫu chuẩn') || errMsg.includes('định dạng')) {
          if (confirm('❌ LỖI: ' + errMsg + '\\n\\nBạn có muốn tải file mẫu chuẩn không?')) {
            window.open('/api/sync-manager-src/download-passport-template', '_blank');
          }
        } else {
          alert('❌ LỖI: ' + errMsg);
        }
      } finally {
        input.value = '';
        btn.disabled = false;
        btn.innerHTML = originalHtml;
        btn.style.opacity = '1';
      }
    }

    async function triggerImportPassport() {
      document.getElementById('passport-file-input').click();
    }

    async function triggerLogin() {
      const ok = await retrySharePointLoginFromDashboard();
      if (ok) {
        window.__sharePointLoginSuccessActive = true;
        handleSharePointLoginRequirement({
          sharePointLoginRequired: false,
          sharePointLoginInProgress: false
        });

        // Tự động đóng sau 2 giây
        setTimeout(() => {
          window.__sharePointLoginSuccessActive = false;
          handleSharePointLoginRequirement({
            sharePointLoginRequired: false,
            sharePointLoginInProgress: false,
            sharePointLoginSkipped: window.__sharePointLoginSkipped
          });
        }, 2000);
      }
    }

    async function toggleSkipPull(checkbox) {
      const isChecked = checkbox.checked;
      window.__skipPullLock = true; // Khóa không cho SSE ghi đè khi đang gạt
      checkbox.disabled = true;
      document.body.style.cursor = 'wait';
      try {
        const r = await fetch('/api/sync-manager-src/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'SKIP_PULL_FROM_OLD', value: isChecked })
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.message || 'Lỗi cập nhật cấu hình');
      } catch (e) {
        alert('Lỗi: ' + e.message);
        checkbox.checked = !isChecked;
      } finally {
        window.__skipPullLock = false;
        checkbox.disabled = false;
        document.body.style.cursor = 'default';
      }
    }

    connectSSE(); // khởi động SSE khi trang load
    handleSharePointLoginRequirement({
      sharePointLoginRequired: window.__sharePointLoginRequired,
      sharePointLoginInProgress: window.__sharePointLoginInProgress,
      sharePointLoginMessage: window.__sharePointLoginMessage,
      sharePointLoginSkipped: ${data.sharePointLoginSkipped ? 'true' : 'false'}
    });
  </script>
</body>
</html>`;

    res.send(html);
  });

  // ── Helper server-side render (load lần đầu) ──────────────
  /**
   * Builds initial table rows on server side for first dashboard render.
   * @param {object} entities
   * @param {object} jobs
   * @returns {string}
   */
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

      // Khong tu suy dien CRASHED theo timeout heartbeat khi render dashboard.
      let ms = (info.status || 'IDLE').toUpperCase();
      const js = cur ? String(cur.status || '').toUpperCase() : null;

      const canStart = true; // Luôn luôn hiện sáng theo yêu cầu người dùng
      const canPause = js === 'RUNNING' || js === 'RESUMING';
      const canResume = !['RUNNING', 'RESUMING', 'PAUSE_REQUESTED'].includes(js || ''); // Chỉ hiện khi không đang chạy
      const rid = (cur && cur.jobId) || info.activeJobId || '';

      const mapVN = {
        'IDLE': 'Sẵn sàng', 'RUNNING': 'Đang chạy', 'RESUMING': 'Đang tiếp tục',
        'PAUSE_REQUESTED': 'Đang dừng...', 'PAUSED': 'Đã tạm dừng',
        'COMPLETED': 'Hoàn thành', 'FAILED': 'Thất bại', 'CRASHED': 'Sự cố', 'ERROR': 'Lỗi'
      };
      const txt = mapVN[ms] || ms;

      let pFill = 'blue';
      if (ms === 'COMPLETED') pFill = 'green';
      else if (['FAILED', 'CRASHED', 'ERROR'].includes(ms)) pFill = 'red';
      else if (ms === 'PAUSED') pFill = 'yellow';

      const pct = info.currentProgressPercent;
      const prog = pct != null
        ? `<div class="prog-wrap"><div class="prog-fill ${pFill}" style="width:${pct}%"></div></div>
       <div class="prog-label">${pct}%</div>`
        : '<span style="color:var(--text-muted)">—</span>';

      const [synced, total] = info.currentTotalToSync != null
        ? [`${(info.currentSynced || 0).toLocaleString()}`, `${info.currentTotalToSync.toLocaleString()}`]
        : [null, null];
      const syncCell = synced
        ? `<span class="sync-count">${synced}</span><span class="sync-total"> / ${total}</span>`
        : '<span style="color:var(--text-muted)">—</span>';

      const ji = cur
        ? `<div class="job-id">${cur.jobId}</div><span class="job-status-pill">${cur.status}</span>`
        : '<span style="color:var(--text-muted)">—</span>';

      const s = (info.status || 'idle').toLowerCase();

      return `<tr>
        <td style="color:var(--text-sub);font-family:monospace;font-size:0.75rem">${info.id || '—'}</td>
        <td><span class="model-chip"><i class="bi bi-database-fill-gear"></i>${name}</span></td>
        <td><span class="status-badge status-${s}"><span class="dot"></span>${txt}</span></td>
        <td>${prog}</td>
        <td>${syncCell}</td>
        <td style="font-weight:600;color:var(--text-primary)">${pct != null ? pct + '%' : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td style="color:var(--text-sub);font-size:.78rem">${info.lastSyncTime ? new Date(info.lastSyncTime).toLocaleString('vi-VN') : '—'}</td>
        <td style="color:var(--text-sub);font-size:.78rem">${info.lastRun ? new Date(info.lastRun).toLocaleString('vi-VN') : '—'}</td>
        <td>${ji}</td>
        <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.7rem; color: var(--accent-red)" title="${info.error || ''}">${info.error || '—'}</td>
        <td><span class="badge" style="background:rgba(0,0,0,0.05);color:var(--text-sub);font-size:0.65rem">${info.instanceId || '—'}</span></td>
        <td>
          <div class="act-group">
            <button class="act-btn act-btn-run"    onclick="startModel('${name}',false,this,'${ms}')" ${canPause ? 'style="opacity:0.45;cursor:not-allowed;" disabled' : ''} ${canStart ? '' : 'disabled'}><i class="bi bi-play-fill"></i>Chạy</button>
            <button class="act-btn act-btn-reset"  onclick="startModel('${name}',true,this,'${ms}')"  ${canStart ? '' : 'disabled'}><i class="bi bi-arrow-counterclockwise"></i>Lại</button>
            <button class="act-btn act-btn-pause"  onclick="pauseJob('${cur ? cur.jobId : ''}')"  ${canPause ? '' : 'disabled'}><i class="bi bi-pause-fill"></i>Dừng</button>
            <button class="act-btn act-btn-resume" onclick="resumeJob('${rid}')"                  ${canResume ? '' : 'disabled'}><i class="bi bi-skip-forward-fill"></i>Tiếp</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }
}

module.exports = new SyncManagerController();
