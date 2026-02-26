const logger           = require('../../utils/logger');
const SyncHandlerModel = require('./SyncHandlerModel');

const SyncOutgoingModel = require('../sync-outgoing-document/apply/SyncOutgoingModel');
const SyncFileModel     = require('../sync-file/apply/SyncFileModel');
const OutGoingDocumentModel = require('../sync-outgoing-document/OutGoingDocumentModel');
const StreamUserMigrationModel = require('../sync-user-copy/migrate/StreamUserMigrationModel');

const MODEL_DEFINITIONS = [
  {
    key:     '1_outgoing',
    label:   'Đồng bộ văn bản đi',
    section: 'realtime',
    ModelClass: OutGoingDocumentModel,
  },
  {
    key:     '2_file',
    label:   'Đồng bộ file tài liệu',
    section: 'realtime',
    ModelClass: SyncFileModel,
  },
  {
    key:     'UNIT_TEST_STREAM_USER_COPY_MIGRATION1',
    label:   'Đồng bộ cơ sở dữ liệu cũ: người dùng (user copy)',
    section: 'realtime',
    ModelClass: StreamUserMigrationModel,
  },
];

class SyncModelRegistry {
  constructor() {
    this._registry = new Map();
    this._initialized = false;
  }

  async initializeAll(syncManagerService, syncStateRepository) {
    if (this._initialized) {
      logger.warn('[SyncModelRegistry] Đã khởi tạo, bỏ qua.');
      return;
    }

    logger.info(`[SyncModelRegistry] Khởi tạo ${MODEL_DEFINITIONS.length} models...`);

    const results = await Promise.allSettled(
      MODEL_DEFINITIONS.map((def) =>
        this._initializeSingle(def, syncManagerService, syncStateRepository),
      ),
    );

    const ok  = results.filter(r => r.status === 'fulfilled').length;
    const err = results.filter(r => r.status === 'rejected').length;

    if (err > 0) {
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          logger.error(
            `[SyncModelRegistry] ✗ ${MODEL_DEFINITIONS[i]?.key}: ${r.reason?.message}`
          );
        }
      });
    }

    this._initialized = true;

    logger.info(
      `[SyncModelRegistry] Hoàn tất: ${ok}/${MODEL_DEFINITIONS.length} models.`
    );
  }

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

  keys() {
    return [...this._registry.keys()];
  }

  entries() {
    return [...this._registry.entries()].map(([key, entry]) => ({
      key,
      label: entry.definition.label,
      section: entry.definition.section,
      instance: entry.instance,
      handler: entry.handler,
    }));
  }

  /**
   * Dashboard metadata
   */
  getDashboardMeta() {
    const sections = {
      realtime: [],
    };

    for (const [key, entry] of this._registry) {
      sections.realtime.push({
        key,
        label: entry.definition.label,
      });
    }

    return { sections };
  }

  async _initializeSingle(def, syncManagerService, syncStateRepository) {
    const { key, label, ModelClass } = def;

    try {
      logger.debug(`[SyncModelRegistry] Khởi tạo: ${key}`);

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
        handler,
      });

      logger.debug(`[SyncModelRegistry] ✓ ${key}`);
    } catch (err) {
      logger.error(`[SyncModelRegistry] ✗ ${key}: ${err.message}`);
      throw err;
    }
  }
}

module.exports = SyncModelRegistry;
