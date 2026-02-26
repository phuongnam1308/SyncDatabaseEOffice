'use strict';

const logger           = require('../../utils/logger');
const SyncHandlerModel = require('./SyncHandlerModel');
const SyncGroupService = require('./SyncGroupService');

const SyncOutgoingModel            = require('../sync-outgoing-document/apply/SyncOutgoingModel');
const StreamOutgoingMigrationModel = require('../sync-outgoing-document/migrate/StreamOutgoingMigrationModel');
const SyncAuditModel               = require('../sync-audit/apply/SyncAuditModel');
const SyncCommentModel             = require('../sync-document-comment/apply/SyncCommentModel');
const SyncFileModel                = require('../sync-file/apply/SyncFileModel');

/**
 * MODEL_DEFINITIONS
 * ─────────────────────────────────────────────────────────────────
 *
 * Thay đổi so với phiên bản cũ:
 *
 *   ❌ LOẠI BỎ:
 *      - 'audit-migration'   (group) — không còn chạy standalone
 *      - 'comment-migration' (group) — không còn chạy standalone
 *        Lý do: audit và comment giờ được đồng bộ lẻ từng record
 *        bên trong StreamOutgoingMigrationModel.processSingleDocument()
 *
 *   ✅ GIỮ NGUYÊN:
 *      - 'outgoing'  — apply: outgoing_documents_sync → outgoing_documents
 *      - 'audit'     — apply: audit_sync → audit  (vẫn hữu dụng để re-apply thủ công)
 *      - 'comment'   — apply: document_comments_sync → document_comments (idem)
 *      - 'file'      — apply: file_sync → file
 *      - 'outgoing-migration' — migrate + apply document-centric (document kéo theo audit/comment)
 */
const MODEL_DEFINITIONS = [
  // ── Apply models (sync table → main table) ─────────────────────
  {
    key: 'outgoing',
    label: 'Đồng bộ văn bản đi',
    ModelClass: SyncOutgoingModel,
  },
  {
    key: 'audit',
    label: 'Đồng bộ nhật kí thao tác văn bản',
    ModelClass: SyncAuditModel,
  },
  {
    key: 'comment',
    label: 'Đồng bộ bình luận văn bản',
    ModelClass: SyncCommentModel,
  },
  {
    key: 'file',
    label: 'Đồng bộ file tài liệu',
    ModelClass: SyncFileModel,
  },

  // ── Migration model (old DB → sync + main, document-centric) ──
  {
    key: 'outgoing-migration',
    label: 'Đồng bộ cơ sở dữ liệu cũ: văn bản đi',
    ModelClass: StreamOutgoingMigrationModel,
    // Không có 'tables' → không tạo group, chạy như single model
    // StreamOutgoingMigrationModel.initialize() tự quản lý tất cả bảng audit/comment bên trong
  },
];

class SyncModelRegistry {
  constructor() {
    this._registry = new Map();
    this._initialized = false;
    this._groupKeys = new Set();
  }

  async initializeAll(syncManagerService, syncStateRepository) {
    if (this._initialized) {
      logger.warn('[SyncModelRegistry] Đã khởi tạo, bỏ qua.');
      return;
    }

    const resolved = this._expandDefinitions(MODEL_DEFINITIONS);
    logger.info(`[SyncModelRegistry] Khởi tạo ${resolved.length} instances...`);

    const results = await Promise.allSettled(
      resolved.map((def) =>
        this._initializeSingle(def, syncManagerService, syncStateRepository),
      ),
    );

    this._registerGroups(MODEL_DEFINITIONS);
    this._bridgeJobUpdates(syncManagerService);

    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const err = results.filter((r) => r.status === 'rejected').length;

    if (err > 0) {
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          logger.error(`[SyncModelRegistry] ✗ ${resolved[i]?.key}: ${r.reason?.message}`);
        }
      });
    }

    this._initialized = true;
    logger.info(`[SyncModelRegistry] Hoàn tất: ${ok}/${resolved.length} instances, ${this._groupKeys.size} groups.`);
  }

  get(keyOrLabel) {
    if (this._registry.has(keyOrLabel)) return this._registry.get(keyOrLabel);
    for (const [, entry] of this._registry) {
      if (entry.definition.label === keyOrLabel) return entry;
    }
    return null;
  }

  getByBaseKey(baseKey) {
    const results = [];
    for (const [key, entry] of this._registry) {
      if (key === baseKey || key.startsWith(`${baseKey}:`)) {
        results.push({ key, ...entry });
      }
    }
    return results;
  }

  isGroup(baseKey) {
    return this._groupKeys.has(baseKey);
  }

  keys()      { return [...this._registry.keys()]; }
  groupKeys() { return [...this._groupKeys]; }

  getGroupMemberLabels() {
    const labels = new Set();
    for (const [, entry] of this._registry) {
      const def = entry.definition;
      if (def.baseKey && this._groupKeys.has(def.baseKey) && def.baseKey !== def.key) {
        labels.add(def.label);
      }
    }
    return labels;
  }

  getDashboardMeta() {
    const groups = SyncGroupService.getAllGroups();
    const singles = [];

    for (const [key, entry] of this._registry) {
      const def = entry.definition;
      if (!def.baseKey || def.baseKey === key) {
        if (!this._groupKeys.has(key)) {
          singles.push({ key, label: def.label });
        }
      }
    }

    return { singles, groups };
  }

  entries() {
    return [...this._registry.entries()].map(([key, entry]) => ({
      key,
      label:   entry.definition.label,
      baseKey: entry.definition.baseKey || key,
      table:   entry.definition.table   || null,
      isGroup: this._groupKeys.has(entry.definition.baseKey || key),
      instance: entry.instance,
      handler:  entry.handler,
    }));
  }

  _expandDefinitions(definitions) {
    const resolved = [];
    for (const def of definitions) {
      if (def.tables?.length > 0) {
        for (const tableName of def.tables) {
          resolved.push({
            ...def,
            key:             `${def.key}:${tableName}`,
            label:           def.label.replace('{table}', tableName),
            constructorArgs: [tableName],
            baseKey:         def.key,
            table:           tableName,
          });
        }
      } else {
        resolved.push({ ...def, baseKey: def.key });
      }
    }
    return resolved;
  }

  _registerGroups(definitions) {
    for (const def of definitions) {
      if (!def.tables?.length) continue;

      this._groupKeys.add(def.key);

      const tableKeys = def.tables.map((t) => `${def.key}:${t}`);
      const groupLabel =
        def.groupLabel ||
        def.label.replace(' — {table}', '').replace(': {table}', '');

      SyncGroupService.registerGroup(def.key, groupLabel, tableKeys);
    }
  }

  _bridgeJobUpdates(syncManagerService) {
    if (typeof syncManagerService.on === 'function') {
      syncManagerService.on('jobUpdate', (label, jobState) => {
        SyncGroupService.onJobUpdate(label, jobState);
      });
      return;
    }

    setInterval(() => {
      const groups = SyncGroupService.getAllGroups();
      const hasRunning = Object.values(groups).some((g) => g.status === 'RUNNING');
      if (!hasRunning) return;

      for (const group of Object.values(groups)) {
        if (!group.activeJobId) continue;
        const job = syncManagerService.getJob(group.activeJobId);
        if (job) {
          SyncGroupService.onJobUpdate(job.modelName, job);
        }
      }
    }, 2000);
  }

  async _initializeSingle(def, syncManagerService, syncStateRepository) {
    const { key, label, ModelClass, constructorArgs = [] } = def;
    try {
      logger.debug(`[SyncModelRegistry] Khởi tạo: ${key}`);
      const instance = new ModelClass(...constructorArgs);
      await instance.initialize();

      const handler = new SyncHandlerModel(instance);
      await handler.registerHandlers(syncManagerService, label);

      if (syncStateRepository) {
        await syncStateRepository.ensureModel(label);
      }

      this._registry.set(key, { definition: def, instance, handler });
      logger.debug(`[SyncModelRegistry] ✓ ${key}`);
    } catch (err) {
      logger.error(`[SyncModelRegistry] ✗ ${key}: ${err.message}`);
      throw err;
    }
  }
}

module.exports = SyncModelRegistry;