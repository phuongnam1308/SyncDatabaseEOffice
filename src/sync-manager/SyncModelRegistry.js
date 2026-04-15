const logger = require('../../utils/logger');
const SyncHandlerModel = require('./SyncHandlerModel');
const partitionHelper = require('../helpers/partitionHelper');

const OutGoingDocumentModel = require('../sync-outgoing-document/models/StreamOutgoingIncrementalModel');
const StreamUserMigrationModel = require('../sync-user-copy/migrate/StreamUserMigrationModel');
const StreamTaskInIncrementalModel = require('../sync-tasks-van-ban-den/models/StreamTaskInIncrementalModel');
const StreamTaskOutIncrementalModel = require('../sync-tasks-van-ban-di/models/StreamTaskOutIncrementalModel');
const StreamMeetingMigrationModel = require('../sync-meeting/migrate/StreamMeetingMigrationModel');
const IncomingDocumentModel = require('../sync-incoming-document/models/StreamIncomingIncrementalModel');
const StreamDepartmentMigrationModel = require('../sync-department/migrate/StreamDepartmentMigrationModel');
const StreamNewsAspxPageIncrementalModel = require('../sync-news-aspx-page/models/StreamNewsAspxPageIncrementalModel');

// 5 Specialized Sync Modules
const StreamMeetingCopyMigrationModel = require('../sync-meeting copy/migrate/StreamMeetingMigrationModel');
const StreamEventMigrationModel = require('../sync-event/migrate/StreamEventMigrationModel');
const StreamTgdScheduleMigrationModel = require('../sync-tgd-schedule/migrate/StreamTgdScheduleMigrationModel');
const StreamMissionMigrationModel = require('../sync-mission-schedule/migrate/StreamMissionMigrationModel');
const StreamCarBookingMigrationModel = require('../sync-car-booking/migrate/StreamCarBookingMigrationModel');
const StreamPassportMigrationModel = require('../sync-passport/migrate/StreamPassportMigrationModel');

const MODEL_DEFINITIONS = [
  {
    key: 'STREAM_OUTGOING_INCREMENTAL',
    label: 'Đồng bộ văn bản đi',
    section: 'realtime',
    ModelClass: OutGoingDocumentModel
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
    label: 'Đồng bộ văn bản đến',
    section: 'realtime',
    ModelClass: IncomingDocumentModel,
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
];

class SyncModelRegistry {
  /**
   * Keeps initialized model instances and their handler wrappers.
   */
  constructor() {
    this._registry = new Map();
    this._initialized = false;
  }

  /**
   * Initializes all configured models and registers them to sync manager once.
   * @param {import('./SyncManagerService')} syncManagerService
   * @param {import('./SyncStateRepository')} syncStateRepository
   * @returns {Promise<void>}
   */
  async initializeAll(syncManagerService, syncStateRepository) {
    if (this._initialized) {
      logger.warn('[SyncModelRegistry] Already initialized, skip.');
      return;
    }

    logger.info(`[SyncModelRegistry] Initializing ${MODEL_DEFINITIONS.length} models...`);

    const results = await Promise.allSettled(
      MODEL_DEFINITIONS.map((def) =>
        this._initializeSingle(def, syncManagerService, syncStateRepository)
      )
    );

    const ok = results.filter((result) => result.status === 'fulfilled').length;
    const err = results.filter((result) => result.status === 'rejected').length;

    if (err > 0) {
      results.forEach((result, idx) => {
        if (result.status === 'rejected') {
          logger.error(
            `[SyncModelRegistry] x ${MODEL_DEFINITIONS[idx]?.key}: ${result.reason?.message}`
          );
        }
      });
    }

    this._initialized = true;
    logger.info(`[SyncModelRegistry] Done: ${ok}/${MODEL_DEFINITIONS.length} models.`);
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
      if (entry.label === keyOrLabel || entry.definition.label === keyOrLabel) {
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
      label: entry.label,
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
        label: entry.label
      });
    }

    return { sections };
  }

  /**
   * Returns a list of all labels currently in the registry.
   * @returns {string[]}
   */
  getRegisteredLabels() {
    return [...this._registry.values()].map((entry) => entry.label);
  }

  /**
   * Initializes one model definition and stores it in registry.
   * @param {{key:string,label:string,ModelClass:any}} def
   * @param {import('./SyncManagerService')} syncManagerService
   * @param {import('./SyncStateRepository')} syncStateRepository
   * @returns {Promise<void>}
   */
  async _initializeSingle(def, syncManagerService, syncStateRepository) {
    const { key, ModelClass } = def;
    const labelSuffix = partitionHelper.getLabelSuffix();
    const label = (def.label || key) + labelSuffix;

    try {
      logger.debug(`[SyncModelRegistry] Init: ${key} (${label})`);

      const instance = new ModelClass();
      await instance.initialize();

      const handler = new SyncHandlerModel(instance);
      
      // [QUY TRÌNH SỬA LỖI] Đổi tên key kỹ thuật thành Label Tiếng Việt trong DB nếu tồn tại
      // Thử đổi tên từ cả key hiện tại và key UNIT_TEST cũ để đảm bảo không mất dữ liệu trên Dashboard
      if (syncStateRepository) {
        await syncStateRepository.renameModel(key, label);
        if (key.startsWith('STREAM_')) {
          const legacyKey = 'UNIT_TEST_' + key.replace('STREAM_', '');
          // Special case for typo fix
          const typoKey = legacyKey.includes('INCOMING') ? legacyKey.replace('INCOMING', 'INCOMMING') : legacyKey;
          await syncStateRepository.renameModel(typoKey, label);
        }
        await syncStateRepository.ensureModel(label);
      }

      await handler.registerHandlers(syncManagerService, label);

      this._registry.set(key, {
        definition: def,
        instance,
        handler,
        label
      });

      logger.debug(`[SyncModelRegistry] ok ${key}`);
    } catch (error) {
      logger.error(`[SyncModelRegistry] fail ${key}: ${error.message}`);
      throw error;
    }
  }
}

module.exports = SyncModelRegistry;
