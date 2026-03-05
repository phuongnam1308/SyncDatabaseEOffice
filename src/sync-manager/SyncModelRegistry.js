const logger = require('../../utils/logger');
const SyncHandlerModel = require('./SyncHandlerModel');

const OutGoingDocumentModel = require('../sync-outgoing-document/models/StreamOutgoingIncrementalModel');
const StreamUserMigrationModel = require('../sync-user-copy/migrate/StreamUserMigrationModel');
const StreamTaskMigrationModel = require('../sync-tasks/migrate/StreamTaskMigrationModel');
const StreamSocialMigrationModel = require('../sync-social-resource/migrate/StreamSocialMigrationModel');
const SyncIncomingDocumentModel = require('../sync-incoming-document/migrate/SyncIncomingDocumentModel');
const StreamMeetingMigrationModel = require('../sync-meeting/migrate/StreamMeetingMigrationModel');
const InCommingDocumentModel = require('../sync-incoming-document/migrate/StreamIncomingIncrementalModel');
const StreamDepartmentMigrationModel = require('../sync-department/migrate/StreamDepartmentMigrationModel');
const MODEL_DEFINITIONS = [
  {
    key: 'UNIT_TEST_STREAM_OUTGOING_INCREMENTAL',
    label: 'Đồng bộ văn bản đi',
    section: 'realtime',
    ModelClass: OutGoingDocumentModel
  },
  // {
  //   key: '2_file',
  //   label: 'Đồng bộ file tài liệu',
  //   section: 'realtime',
  //   ModelClass: SyncFileModel,
  // },
    {
    key: 'UNIT_TEST_STREAM_DEPARTMENT_MIGRATION',
    label: 'Đồng bộ phòng ban',
    section: 'realtime',
    ModelClass: StreamDepartmentMigrationModel,
  },
  {
    key: 'UNIT_TEST_STREAM_USER_COPY_MIGRATION111',
    label: 'Đồng bộ cơ sở dữ liệu cũ: người dùng ',
    section: 'realtime',
    ModelClass: StreamUserMigrationModel
  },
  {
    key: 'UNIT_TEST_STREAM_TASK_MIGRATION',
    label: 'Đồng bộ công việc từ văn bản đến',
    section: 'realtime',
    ModelClass: StreamTaskMigrationModel,
  },
  {
    key: 'UNIT_TEST_STREAM_SOCIAL_RESOURCE_MIGRATION1',
    label: 'Đồng bộ tin tức ',
    section: 'realtime',
    ModelClass: StreamSocialMigrationModel,
    // ModelClass: StreamUserMigrationModel
  },
  {
    key: '3_incoming',
    label: 'Đồng bộ văn bản đến',
    section: 'realtime',
    ModelClass: InCommingDocumentModel,
  },
  {
    key: 'UNIT_TEST_STREAM_MEETING_MIGRATION',
    label: 'Đồng bộ Lịch họp ',
    section: 'realtime',
    ModelClass: StreamMeetingMigrationModel,
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
   * Initializes one model definition and stores it in registry.
   * @param {{key:string,label:string,ModelClass:any}} def
   * @param {import('./SyncManagerService')} syncManagerService
   * @param {import('./SyncStateRepository')} syncStateRepository
   * @returns {Promise<void>}
   */
  async _initializeSingle(def, syncManagerService, syncStateRepository) {
    const { key, label, ModelClass } = def;

    try {
      logger.debug(`[SyncModelRegistry] Init: ${key}`);

      const instance = new ModelClass();
      await instance.initialize();

      const handler = new SyncHandlerModel(instance);
      await handler.registerHandlers(syncManagerService, label);

      if (syncStateRepository) {
        await syncStateRepository.ensureModel(label);
      }

      this._registry.set(key, {
        definition: def,
        instance,
        handler
      });

      logger.debug(`[SyncModelRegistry] ok ${key}`);
    } catch (error) {
      logger.error(`[SyncModelRegistry] fail ${key}: ${error.message}`);
      throw error;
    }
  }
}

module.exports = SyncModelRegistry;
