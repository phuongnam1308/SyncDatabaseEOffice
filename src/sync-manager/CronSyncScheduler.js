const BaseModel = require('../../models/BaseModel');
const logger = require('../../utils/logger');
const SyncManagerService = require('./SyncManagerService');
const SyncManagerController = require('./SyncManagerController');

const GLOBAL_QUEUE_KEY = '__cronSyncQueue__';
const GLOBAL_MARK_KEY = '__cronSyncMarks__';

/**
 * Đảm bảo một `Set` toàn cục tồn tại cho khóa chỉ định và trả về nó.
 * `global` được dùng như không gian lưu trữ trong tiến trình để giữ hàng đợi
 * và các dấu đã xử lý giữa các lần gọi. Hàm này sẽ tạo Set mới nếu chưa có.
 * @param {string} key - Tên thuộc tính trên đối tượng `global`.
 * @returns {Set<string>} - Tập hợp chuỗi liên quan đến khóa.
 */
function getGlobalSet(key) {
  if (!(global[key] instanceof Set)) {
    global[key] = new Set();
  }
  return global[key];
}

/**
 * Bộ lập lịch chạy theo kiểu "cron" dùng để khởi động tuần tự các module đồng
 * bộ định kỳ.
 *
 * Hoạt động với hai chu kỳ:
 * 1. `scanDueModules`: đọc cấu hình từ bảng SQL, xác định module đến hạn và thêm
 *    vào hàng đợi cục bộ.
 * 2. `consumeQueue`: lấy module từ hàng đợi và gọi `SyncManagerService` để bắt
 *    đầu đồng bộ nếu module không bận.
 *
 * Các hàm tiện ích phụ trợ như `parseMinuteOfDay`, `buildMarkKey`, và
 * `getTodayToken` giúp xử lý thời gian và tránh đẩy trùng module trong cùng
 * ô lịch.
 */
class CronSyncScheduler extends BaseModel {
  /**
   * Tạo một CronSyncScheduler mới và thiết lập giá trị mặc định.
   * - `tableRef` tham chiếu tới bảng cấu hình trong DB mới.
   * - `scanIntervalMs`/`executeIntervalMs` điều khiển tần suất quét và tiêu thụ.
   * - `scanTimer`/`executeTimer` là các handle của setInterval.
   * - `executing`/`started` là cờ trạng thái nội bộ.
   */
  constructor() {
    super();
    this.tableRef = `${process.env.NEW_DB_NAME || 'camunda'}.dbo.cron_sync_config`;
    this.scanIntervalMs = Number(process.env.CRON_SYNC_SCAN_INTERVAL_MS || 10_000);
    this.executeIntervalMs = Number(process.env.CRON_SYNC_EXEC_INTERVAL_MS || 15_000);
    this.scanTimer = null;
    this.executeTimer = null;
    this.executing = false;
    this.started = false;
  }

  /**
   * Khởi động bộ lập lịch: kết nối DB (qua BaseModel.initialize), đảm bảo
   * `SyncManagerController` đã sẵn sàng, và đặt hai timer để chạy định kỳ
   * `scanDueModules` và `consumeQueue`.
   * Gọi lại nhiều lần không gây lỗi (idempotent) nhờ kiểm tra `started`.
   * @returns {Promise<void>}
   */
  async start() {
    if (this.started) return;

    await this.initialize();
    await SyncManagerController.ensureInitialized();

    this.scanTimer = setInterval(() => {
      this.scanDueModules().catch((error) => {
        logger.error('[CronSyncScheduler] scan failed:', error.message);
      });
    }, this.scanIntervalMs);

    this.executeTimer = setInterval(() => {
      this.consumeQueue().catch((error) => {
        logger.error('[CronSyncScheduler] execute failed:', error.message);
      });
    }, this.executeIntervalMs);

    this.started = true;
    logger.info(
      `[CronSyncScheduler] started scan=${this.scanIntervalMs}ms execute=${this.executeIntervalMs}ms`
    );
  }

  /**
   * Dừng các bộ timer nếu đang chạy và đưa trạng thái về ban đầu.
   * Không xóa nội dung hàng đợi; chỉ đơn thuần tắt quét và tiêu thụ.
   */
  stop() {
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.executeTimer) clearInterval(this.executeTimer);
    this.scanTimer = null;
    this.executeTimer = null;
    this.started = false;
  }

  /**
   * Chuyển chuỗi thời gian `HH:mm` hoặc `HH:mm:ss` thành số phút trong ngày
   * (0..1439). Trả về `null` nếu chuỗi không hợp lệ.
   * @param {string} timeValue
   * @returns {number|null}
   */
  parseMinuteOfDay(timeValue) {
    if (!timeValue || typeof timeValue !== 'string') return null;
    const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(timeValue.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
  }

  /**
   * Xác định xem `cronTime` đã đến hạn tại thời điểm thực thi hay chưa. Hàm
   * mở rộng kiểm tra thêm một vài phút phía trước (`lookBackMinutes`) để bảo
   * đảm không bỏ lỡ khi khoảng quét lớn hơn 1 phút.
   * @param {string} cronTime
   * @returns {boolean}
   */
  isDueNow(cronTime) {
    const targetMinute = this.parseMinuteOfDay(cronTime);
    if (targetMinute == null) return false;

    const now = new Date();
    const nowMinute = now.getHours() * 60 + now.getMinutes();
    const lookBackMinutes = Math.max(0, Math.ceil(this.scanIntervalMs / 60_000));

    for (let i = 0; i <= lookBackMinutes; i += 1) {
      const checkedMinute = (nowMinute - i + 1440) % 1440;
      if (checkedMinute === targetMinute) return true;
    }
    return false;
  }

  /**
   * Tạo chuỗi đánh dấu duy nhất cho một module và slot thời gian trong ngày.
   * Mẫu: `moduleKey|YYYY-MM-DD|mmmm`.
   * @param {string} moduleKey
   * @param {string} cronTime
   * @returns {string}
   */
  buildMarkKey(moduleKey, cronTime) {
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const minute = String(this.parseMinuteOfDay(cronTime)).padStart(4, '0');
    return `${moduleKey}|${day}|${minute}`;
  }

  /**
   * Lấy chuỗi đại diện cho ngày hiện tại theo định dạng YYYY-MM-DD. Dùng để
   * lọc các mark cũ không thuộc ngày hôm nay.
   * @returns {string}
   */
  getTodayToken() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * Đọc bảng cấu hình và thêm vào hàng đợi các module đến hạn. Quy trình:
   * 1. Truy vấn cột `module_name`, `cron_time` từ DB.
   * 2. Kiểm tra và loại bỏ các mark cũ không phải của ngày hôm nay.
   * 3. Với mỗi hàng hợp lệ, nếu thời gian đã tới và chưa có mark, thêm module
   *    vào hàng đợi và tạo mark mới.
   *
   * @returns {Promise<void>}
   */
  async scanDueModules() {
    const rows = await this.queryNewDb(
      `
      SELECT module_name, cron_time
      FROM ${this.tableRef}
      WHERE module_name IS NOT NULL
        AND LTRIM(RTRIM(module_name)) <> ''
        AND cron_time IS NOT NULL
        AND LTRIM(RTRIM(cron_time)) <> ''
      `
    );
    if (!Array.isArray(rows) || rows.length === 0) return;

    const queue = getGlobalSet(GLOBAL_QUEUE_KEY);
    const marks = getGlobalSet(GLOBAL_MARK_KEY);
    const today = this.getTodayToken();

    for (const oldMark of [...marks]) {
      if (!String(oldMark).includes(`|${today}|`)) {
        marks.delete(oldMark);
      }
    }

    for (const row of rows) {
      const moduleKey = String(row.module_name || '').trim();
      const cronTime = String(row.cron_time || '').trim();
      if (!moduleKey || !cronTime) continue;
      if (!this.isDueNow(cronTime)) continue;

      const markKey = this.buildMarkKey(moduleKey, cronTime);
      if (marks.has(markKey)) continue;

      queue.add(moduleKey);
      marks.add(markKey);
      logger.info(`[CronSyncScheduler] queued module=${moduleKey} time=${cronTime}`);
    }
  }

  /**
   * Lấy `label` của mô-đun tương ứng với `moduleKey` trong registry của tiền
   * xử lý. Trả về `null` nếu không tìm thấy, giúp phương thức `consumeQueue`
   * biết nên ghi cảnh báo.
   * @param {string} moduleKey
   * @returns {string|null}
   */
  getModelLabelFromKey(moduleKey) {
    const entry = SyncManagerController.modelRegistry?.get(moduleKey);
    if (!entry?.definition?.label) return null;
    return entry.definition.label;
  }

  /**
   * Lấy module tiếp theo từ hàng đợi và khởi chạy đồng bộ thông qua
   * SyncManagerService.
   * - Bỏ qua nếu có module đang chạy (`executing` flag).
   * - Nếu `moduleKey` không có trong registry, ghi log cảnh báo.
   * - Nếu module bận, thêm lại vào hàng đợi và ghi log thông tin.
   * - Phá vỡ cờ `executing` trong `finally` để đảm bảo vòng tiếp theo có thể
   *   chạy.
   * @returns {Promise<void>}
   */
  async consumeQueue() {
    if (this.executing) return;

    const queue = getGlobalSet(GLOBAL_QUEUE_KEY);
    const moduleKey = queue.values().next().value;
    if (!moduleKey) return;

    this.executing = true;
    queue.delete(moduleKey);

    try {
      const modelLabel = this.getModelLabelFromKey(moduleKey);
      if (!modelLabel) {
        logger.warn(`[CronSyncScheduler] invalid module_name (not found key): ${moduleKey}`);
        return;
      }

      const modelState = SyncManagerService.getModelState(modelLabel);
      if (SyncManagerService.isModelBusy(modelState)) {
        queue.add(moduleKey);
        logger.info(`[CronSyncScheduler] module busy, requeue: ${moduleKey}`);
        return;
      }

      const result = SyncManagerService.startModel(modelLabel, { reset: false, resumeIfPaused: true });
      const action = result.status === 'RESUMING' ? 'resumed' : 'started';
      logger.info(
        `[CronSyncScheduler] ${action} module=${moduleKey} jobId=${result.jobId} status=${result.status}`
      );
    } catch (error) {
      logger.error(`[CronSyncScheduler] start failed module=${moduleKey}:`, error.message);
    } finally {
      this.executing = false;
    }
  }
}

module.exports = new CronSyncScheduler();
