const BaseController = require('../../controllers/BaseController');
const SyncManagerService = require('./SyncManagerService');
const SyncStateRepository = require('./SyncStateRepository');
const logger = require('../../utils/logger');
const SyncModelRegistry = require('./SyncModelRegistry');
const DashboardTemplate = require('./DashboardTemplate');

class SyncManagerController extends BaseController {
  constructor() {
    super();
    this.initialized = false;
    this.modelRegistry = new SyncModelRegistry();
  }

  async ensureInitialized() {
    if (this.initialized) return;
    try {
      await SyncManagerService.ensureStateLoaded();
      await this.modelRegistry.initializeAll(SyncManagerService, SyncStateRepository);
      this.initialized = true;
    } catch (error) {
      logger.error('[SyncManagerController] Failed to initialize models:', error);
      throw error;
    }
  }

  // ── Routes ──

  startSync = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { reset } = req.body;
    SyncManagerService.start(reset === true || reset === 'true');
    return this.success(res, { message: 'Đã kích hoạt tiến trình đồng bộ' });
  });

  startModelSync = this.asyncHandler(async (req, res) => {
    try {
      await this.ensureInitialized();
      const { modelName } = req.params;
      const { reset = false, batchSize, fromTime, toTime } = req.body || {};
      const result = await SyncManagerService.startModel(modelName, {
        reset: reset === true || reset === 'true',
        batchSize,
        fromTime,
        toTime
      });
      return this.success(res, result, 'Đã kích hoạt đồng bộ đối tượng');
    } catch (error) {
      return this.error(res, error.message, 400, error);
    }
  });

  pauseJobSync = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const result = SyncManagerService.pauseJob(req.params.jobId);
    return this.success(res, result, 'Đồng chí đã yêu cầu dừng lại tiến trình');
  });

  resumeJobSync = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const { reset = false } = req.body || {};
    const result = SyncManagerService.resumeJob(req.params.jobId, { reset: reset === true });
    return this.success(res, result, 'Đã tiếp tục tiến trình phần mềm');
  });

  getJobSyncStatus = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const job = await SyncManagerService.getJob(req.params.jobId);
    if (!job) return this.notFound(res, `Không tìm thấy job: \${req.params.jobId}`);
    return this.success(res, job);
  });

  shutdown = this.asyncHandler(async (req, res) => {
    if (global.appBrowser) await global.appBrowser.close().catch(() => {});
    const CronSyncScheduler = require('./CronSyncScheduler');
    CronSyncScheduler.stop();
    setTimeout(() => process.exit(0), 1000);
    return this.success(res, { message: 'Hệ thống đang thực hiện dừng lệnh...' });
  });

  login = this.asyncHandler(async (req, res) => {
    const loginFlow = require('../../auth/login_playwright');
    loginFlow({ forceHeaded: true }).catch(err => logger.error('Login error:', err));
    return this.success(res, { message: 'Đã khởi động quy trình đăng nhập' });
  });

  sseEvents = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch (_) { clearInterval(ka); } }, 25000);
    req.on('close', () => clearInterval(ka));
    SyncManagerService.addSSEClient(res);
  });

  // ── Dashboard ──

  getDashboard = this.asyncHandler(async (req, res) => {
    await this.ensureInitialized();
    const data = await SyncStateRepository.getDashboardData();
    const labels = this.modelRegistry.getRegisteredLabels();
    
    // Filter entities based on registered models
    const filtered = {};
    labels.forEach(l => { if (data.entities && data.entities[l]) filtered[l] = data.entities[l]; });

    // Render initial rows and generate full HTML from template
    const initialRows = DashboardTemplate.renderServerRows(filtered, data.jobs);
    const html = DashboardTemplate.getDashboardTemplate(data, initialRows, labels);
    
    res.send(html);
  });
}

module.exports = new SyncManagerController();
