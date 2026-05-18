const logger = require('../../utils/logger');
const SyncHandlerModel = require('./SyncHandlerModel');

const OutGoingDocumentModel = require('../sync-outgoing-document/models/StreamOutgoingIncrementalModel');
const SyncOutgoingAdapter = require('./SyncOutgoingAdapter'); // v2 adapter with instance staging tables
const SyncOutgoingV3Adapter = require('./SyncOutgoingV3Adapter'); // v3 adapter with batch processing
const SyncIncomingAdapter = require('./SyncIncomingAdapter'); // NEW: v2 adapter for incoming documents
const SyncDraftDocumentAdapter = require('./SyncDraftDocumentAdapter'); // NEW: draft document adapter
const SyncUnitDraftAdapter = require('./SyncUnitDraftAdapter'); // Unit draft from SharePoint List
const StreamUserMigrationModel = require('../sync-user-copy/migrate/StreamUserMigrationModel');
const StreamTaskInIncrementalModel = require('../sync-tasks-van-ban-den/models/StreamTaskInIncrementalModel');
const StreamTaskOutIncrementalModel = require('../sync-tasks-van-ban-di/models/StreamTaskOutIncrementalModel');
const StreamMeetingMigrationModel = require('../sync-meeting/migrate/StreamMeetingMigrationModel');
const IncomingDocumentModel = require('../sync-incoming-document/models/StreamIncomingIncrementalModel');
const StreamDepartmentMigrationModel = require('../sync-department/migrate/StreamDepartmentMigrationModel');
const StreamNewsAspxPageIncrementalModel = require('../sync-news-aspx-page/models/StreamNewsAspxPageIncrementalModel');
const SyncTaskSharePointAdapter = require('./SyncTaskSharePointAdapter');

// 5 Specialized Sync Modules
const StreamMeetingCopyMigrationModel = require('../sync-meeting copy/migrate/StreamMeetingMigrationModel');
const StreamEventMigrationModel = require('../sync-event/migrate/StreamEventMigrationModel');
const StreamTgdScheduleMigrationModel = require('../sync-tgd-schedule/migrate/StreamTgdScheduleMigrationModel');
const StreamMissionMigrationModel = require('../sync-mission-schedule/migrate/StreamMissionMigrationModel');
const StreamCarBookingMigrationModel = require('../sync-car-booking/migrate/StreamCarBookingMigrationModel');
const StreamPassportMigrationModel = require('../sync-passport/migrate/StreamPassportMigrationModel');

const MODEL_DEFINITIONS = [
  // {
  //   key: 'STREAM_OUTGOING_INCREMENTAL',
  //   label: 'Đồng bộ văn bản đi',
  //   section: 'realtime',
  //   ModelClass: OutGoingDocumentModel
  // },
  {
    key: 'STREAM_OUTGOING_V2',
    label: 'Đồng bộ văn bản đi v2',
    section: 'realtime',
    ModelClass: SyncOutgoingAdapter
  },
  {
    key: 'STREAM_OUTGOING_V3',
    label: 'Đồng bộ văn bản đi v3 (Batch)',
    section: 'realtime',
    ModelClass: SyncOutgoingV3Adapter
  },
  {
    key: 'STREAM_DRAFT_DOCUMENT',
    label: 'Đồng bộ văn bản dự thảo',
    section: 'realtime',
    ModelClass: SyncDraftDocumentAdapter
  },
  {
    key: 'STREAM_UNIT_DRAFT',
    label: 'Đồng bộ văn bản đi đơn vị (SharePoint)',
    section: 'realtime',
    ModelClass: SyncUnitDraftAdapter
  },
  {
    key: 'STREAM_DEPARTMENT_MIGRATION',
    label: 'Đồng bộ phòng ban',
    section: 'realtime',
    ModelClass: StreamDepartmentMigrationModel,
  },
  {
    key: 'STREAM_USER_COPY_MIGRATION',
    label: 'Đồng bộ người dùng',
    section: 'realtime',
    ModelClass: StreamUserMigrationModel
  },
  {
    key: 'STREAM_TASK_INCOMING_INCREMENTAL',
    label: 'Đồng bộ công việc đến',
    section: 'realtime',
    ModelClass: StreamTaskInIncrementalModel,
  },
  {
    key: 'STREAM_TASK_OUTGOING_INCREMENTAL',
    label: 'Đồng bộ công việc đi',
    section: 'realtime',
    ModelClass: StreamTaskOutIncrementalModel,
  },
  {
    key: 'STREAM_NEWS_ASPX_PAGE_INCREMENTAL',
    label: 'Đồng bộ tin tức',
    section: 'realtime',
    ModelClass: StreamNewsAspxPageIncrementalModel
  },
  {
    key: 'STREAM_INCOMING_INCREMENTAL',
    label: 'Đồng bộ văn bản đến v2',
    section: 'realtime',
    ModelClass: SyncIncomingAdapter,
  },
  {
    key: 'STREAM_MEETING_COPY_MIGRATION',
    label: 'Đồng bộ lịch họp',
    section: 'realtime',
    ModelClass: StreamMeetingCopyMigrationModel,
  },
  {
    key: 'STREAM_EVENT_MIGRATION',
    label: 'Đồng bộ lịch sự kiện',
    section: 'realtime',
    ModelClass: StreamEventMigrationModel,
  },
  {
    key: 'STREAM_TGD_SCHEDULE_MIGRATION',
    label: 'Đồng bộ lịch trực ban TGĐ',
    section: 'realtime',
    ModelClass: StreamTgdScheduleMigrationModel,
  },
  {
    key: 'STREAM_MISSION_MIGRATION',
    label: 'Đồng bộ lịch công tác',
    section: 'realtime',
    ModelClass: StreamMissionMigrationModel,
  },
  {
    key: 'STREAM_CAR_BOOKING_MIGRATION',
    label: 'Đồng bộ lịch đặt xe',
    section: 'realtime',
    ModelClass: StreamCarBookingMigrationModel,
  },
  {
    key: 'STREAM_PASSPORT_MIGRATION',
    label: 'Đồng bộ phiếu mượn hộ chiếu',
    section: 'realtime',
    ModelClass: StreamPassportMigrationModel,
  },
  {
    key: 'STREAM_TASK_SHAREPOINT',
    label: 'Đồng bộ công việc (SharePoint API)',
    section: 'realtime',
    ModelClass: SyncTaskSharePointAdapter
  },
];

// ═══════════════════════════════════════════════════════════════════
// MODULE-LEVEL SINGLETON GUARD
// Đảm bảo initializeAll() chỉ chạy đúng 1 lần dù có bao nhiêu
// instance SyncModelRegistry được tạo ra (do Express route handler).
// ═══════════════════════════════════════════════════════════════════
let _globalInitPromise = null;   // Promise duy nhất của quá trình init
let _globalInitDone = false;     // Cờ "đã xong" để fast-path skip

class SyncModelRegistry {
  /**
   * Keeps initialized model instances and their handler wrappers.
   */
  constructor() {
    this._registry = new Map();
  }

  /**
   * Initializes all configured models and registers them to sync manager once.
   * Module-level Singleton — dù gọi bao nhiêu lần từ bao nhiêu instance,
   * chỉ chạy đúng 1 lần thực sự.
   */
  async initializeAll(syncManagerService, syncStateRepository) {
    // Fast-path: đã xong rồi
    if (_globalInitDone) {
      logger.debug('[SyncModelRegistry] Đã init xong từ trước. Skip.');
      return;
    }

    // In-flight guard: đang có init chạy, các caller khác được Promise cũ
    if (_globalInitPromise) {
      logger.info('[SyncModelRegistry] Đang init, chờ kết quả...');
      return _globalInitPromise;
    }

    // Caller đầu tiên: tạo Promise và đăng ký toàn cục ngay
    _globalInitPromise = this._doInitializeAll(syncManagerService, syncStateRepository)
      .then(() => {
        _globalInitDone = true;
        logger.info('[SyncModelRegistry] ✅ Singleton init hoàn tất.');
      })
      .catch((err) => {
        _globalInitPromise = null; // Reset để cho phép retry nếu xảy ra lỗi
        logger.error('[SyncModelRegistry] ❌ Init thất bại:', err.message);
        throw err;
      });

    return _globalInitPromise;
  }

  /**
   * Thực thi khởi tạo (nội bộ): chạy tuần tự từng model để tránh deadlock.
   * (Promise.allSettled song song khi nhiều model cùng ALTER TABLE gây deadlock)
   */
  async _doInitializeAll(syncManagerService, syncStateRepository) {
    logger.info(`[SyncModelRegistry] Bắt đầu khởi tạo ${MODEL_DEFINITIONS.length} models (tuần tự)...`);

    let ok = 0;
    let failed = 0;

    for (const def of MODEL_DEFINITIONS) {
      try {
        await this._initializeSingle(def, syncManagerService, syncStateRepository);
        ok++;
        logger.debug(`[SyncModelRegistry] ✅ ${def.key}`);
      } catch (err) {
        failed++;
        logger.error(`[SyncModelRegistry] ❌ ${def.key}: ${err.message}`);
        // Tiếp tục model tiếp theo, không throw để tránh block toàn bộ startup
      }
    }

    logger.info(`[SyncModelRegistry] Hoàn tất: ${ok} thành công, ${failed} lỗi / tổng ${MODEL_DEFINITIONS.length} models.`);

    if (ok === 0) {
      throw new Error('Tất cả model đều thất bại khởi tạo. Kiểm tra kết nối DB.');
    }
  }

  /**
   * Gets one registry entry by key, or by display label.
   * @param {string} keyOrLabel
   * @returns {object|null}
   */
  get(keyOrLabel) {
    if (this._registry.has(keyOrLabel)) {
      return this._registry.get(keyOrLabel);
    }

    for (const [, entry] of this._registry) {
      if (entry.definition.label === keyOrLabel) {
        return entry;
      }
    }

    return null;
  }

  /**
   * Returns all registered module keys.
   * @returns {string[]}
   */
  keys() {
    return [...this._registry.keys()];
  }

  /**
   * Returns normalized registry entries for dashboard/meta use.
   * @returns {Array<{key:string,label:string,section:string,instance:any,handler:any}>}
   */
  entries() {
    return [...this._registry.entries()].map(([key, entry]) => ({
      key,
      label: entry.definition.label,
      section: entry.definition.section,
      instance: entry.instance,
      handler: entry.handler
    }));
  }

  /**
   * Builds dashboard section metadata from current registry.
   * @returns {{sections:{realtime:Array<{key:string,label:string}>}}}
   */
  getDashboardMeta() {
    const sections = { realtime: [] };

    for (const [key, entry] of this._registry) {
      sections.realtime.push({
        key,
        label: entry.definition.label
      });
    }

    return { sections };
  }

  /**
   * Returns a list of all labels currently in the registry.
   * @returns {string[]}
   */
  getRegisteredLabels() {
    return [...this._registry.values()].map((entry) => entry.definition.label);
  }

  /**
   * Initializes one model definition and stores it in registry.
   * @param {{key:string,label:string,ModelClass:any}} def
   * @param {import('./SyncManagerService')} syncManagerService
   * @param {import('./SyncStateRepository')} syncStateRepository
   * @returns {Promise<void>}
   */
  async _initializeSingle(def, syncManagerService, syncStateRepository) {
    let { key, label, ModelClass } = def;
    const instanceId = process.env.SYNC_INSTANCE_ID || process.env.INSTANCE_ID;
    const isPrimaryInstance = !instanceId || instanceId === '3021' || instanceId === '1';

    // Các module hỗ trợ chạy song song (đa instance)
    const parallelModules = [
      'STREAM_INCOMING_INCREMENTAL',
      'STREAM_OUTGOING_INCREMENTAL',
      'STREAM_TASK_INCOMING_INCREMENTAL',
      'STREAM_TASK_OUTGOING_INCREMENTAL',
      'STREAM_OUTGOING_V2',
      'STREAM_OUTGOING_V3',
      'STREAM_DRAFT_DOCUMENT',
      'STREAM_UNIT_DRAFT',
      'STREAM_TASK_SHAREPOINT'
    ];
    const isParallelModule = parallelModules.includes(key);

    if (instanceId && isParallelModule && instanceId !== '1' && instanceId !== '3021') {
      label = `${label} (${instanceId})`;
    }

    // Always register to display on Dashboard, even on secondary instances.
    // The execution safety (not running same non-parallel job twice) is handled by the Job Manager or manual start.
    if (!isPrimaryInstance && !isParallelModule) {
      logger.info(`[SyncModelRegistry] Registering "${key}" on secondary instance ${instanceId} for monitoring.`);
    }

    // ── BƯỚC 1: Đảm bảo model luôn có record trong DB TRƯỚC khi init ──────────
    // Ngay cả khi initialize() thất bại, model vẫn xuất hiện trên dashboard.
    if (syncStateRepository) {
      try {
        if (!instanceId) {
          // [QUY TRÌNH SỬA LỖI] Đổi tên key kỹ thuật thành Label Tiếng Việt
          await syncStateRepository.renameModel(key, label, 'default');
          if (key.startsWith('STREAM_')) {
            const legacyKey = 'UNIT_TEST_' + key.replace('STREAM_', '');
            const typoKey = legacyKey.includes('INCOMING') ? legacyKey.replace('INCOMING', 'INCOMMING') : legacyKey;
            await syncStateRepository.renameModel(typoKey, label, 'default');
          }
          await syncStateRepository.ensureModel(label, 'default');
        } else {
          await syncStateRepository.ensureModel(label, instanceId);
        }
      } catch (dbErr) {
        logger.warn(`[SyncModelRegistry] ensureModel failed for ${key}: ${dbErr.message}`);
      }
    }

    // ── BƯỚC 2: Khởi tạo model và đăng ký handler ────────────────────────────
    try {
      logger.info(`[SyncModelRegistry] 🔄 Đang khởi tạo module: ${key} (${label})`);

      const instance = new ModelClass();
      
      // Store in registry early (even if initialize fails later)
      // This ensures it shows up on the dashboard.
      this._registry.set(key, {
        definition: { ...def, key, label },
        instance,
        handler: null // Will be set if registration succeeds
      });

      if (typeof instance.initialize === 'function') {
        await instance.initialize();
      }

      const handler = new SyncHandlerModel(instance);
      await handler.registerHandlers(syncManagerService, label);

      // Update registry with the successful handler
      this._registry.get(key).handler = handler;

      logger.info(`[SyncModelRegistry] ✅ Khởi tạo thành công: ${key}`);
    } catch (error) {
      logger.error(`[SyncModelRegistry] ❌ Khởi tạo THẤT BẠI: ${key}. Lỗi: ${error.message}`);
      // Don't re-throw, so other models can continue
      // and this one stays in registry (added above) to be visible on dashboard.
    }
  }
}

module.exports = SyncModelRegistry;
