/**
 * SyncGroupService
 * -----------------
 * Quản lý việc chạy tuần tự nhiều model cùng baseKey.
 *
 * Trạng thái group (tổng hợp từ các child):
 *   - IDLE       → tất cả child đều idle/completed/failed
 *   - RUNNING    → ít nhất 1 child đang chạy
 *   - PAUSED     → đã pause, queue đã xóa
 *   - COMPLETED  → tất cả child completed
 *   - FAILED     → ít nhất 1 child failed (đã chạy hết queue)
 *   - PARTIAL    → một số completed, một số chưa chạy
 *
 * Sequential flow:
 *   startGroup('audit-migration')
 *     → queue = [ATPC, XYZ, ABC]  (bỏ qua những cái đã completed nếu skipCompleted=true)
 *     → chạy ATPC, đợi 'completed' hoặc 'failed'
 *     → chạy XYZ, đợi ...
 *     → chạy ABC, đợi ...
 *     → emit groupUpdate
 */

'use strict';

const EventEmitter = require('events');
const logger       = require('../../utils/logger');

class SyncGroupService extends EventEmitter {
  constructor() {
    super();

    /**
     * Map<baseKey, GroupState>
     * GroupState = {
     *   baseKey:      string,
     *   label:        string,        — label group (không có {table})
     *   tableKeys:    string[],      — full keys: ['audit-migration:ATPC', ...]
     *   queue:        string[],      — các key chưa chạy trong phiên hiện tại
     *   activeKey:    string | null, — key đang chạy
     *   activeJobId:  string | null,
     *   status:       GroupStatus,
     *   results:      Map<key, 'completed'|'failed'|'skipped'|'pending'>,
     *   startedAt:    Date | null,
     *   finishedAt:   Date | null,
     * }
     */
    this._groups = new Map();
  }

  // ── Public ────────────────────────────────────────────────────

  /**
   * Đăng ký một group. Idempotent — gọi nhiều lần an toàn.
   *
   * @param {string}   baseKey    — 'audit-migration'
   * @param {string}   groupLabel — label group hiển thị
   * @param {string[]} tableKeys  — ['audit-migration:ATPC', ...]
   */
  registerGroup(baseKey, groupLabel, tableKeys) {
    if (this._groups.has(baseKey)) return;

    this._groups.set(baseKey, {
      baseKey,
      label:       groupLabel,
      tableKeys:   [...tableKeys],
      queue:       [],
      activeKey:   null,
      activeJobId: null,
      status:      'IDLE',
      results:     new Map(),
      startedAt:   null,
      finishedAt:  null,
    });

    logger.info(`[SyncGroupService] Đăng ký group "${baseKey}" với ${tableKeys.length} bảng`);
  }

  /**
   * Bắt đầu chạy tuần tự tất cả bảng trong group.
   *
   * @param {string}  baseKey
   * @param {object}  syncManagerService
   * @param {object}  opts
   * @param {boolean} opts.reset         — reset từng model trước khi chạy
   * @param {boolean} opts.skipCompleted — bỏ qua bảng đã completed (default: true)
   */
  async startGroup(baseKey, syncManagerService, opts = {}) {
    const group = this._groups.get(baseKey);
    if (!group) throw new Error(`[SyncGroupService] Group "${baseKey}" chưa được đăng ký`);

    if (group.status === 'RUNNING') {
      logger.warn(`[SyncGroupService] Group "${baseKey}" đang chạy, bỏ qua lệnh start`);
      return { alreadyRunning: true };
    }

    const { reset = false, skipCompleted = true } = opts;

    // Build queue
    let queue = [...group.tableKeys];
    if (skipCompleted && !reset) {
      queue = queue.filter((key) => group.results.get(key) !== 'completed');
    }

    if (queue.length === 0) {
      logger.info(`[SyncGroupService] Group "${baseKey}" — tất cả đã completed`);
      this._setGroupStatus(group, 'COMPLETED');
      return { allDone: true };
    }

    group.queue      = queue;
    group.startedAt  = new Date();
    group.finishedAt = null;
    if (reset) group.results.clear();

    logger.info(`[SyncGroupService] Bắt đầu group "${baseKey}", queue: [${queue.join(', ')}]`);

    // Chạy bất đồng bộ
    this._runQueue(group, syncManagerService).catch((err) => {
      logger.error(`[SyncGroupService] Group "${baseKey}" lỗi: ${err.message}`);
      this._setGroupStatus(group, 'FAILED');
      this._emitUpdate(group);
    });

    return { started: true, queue };
  }

  /**
   * Dừng group: pause job đang chạy, xóa queue còn lại.
   * Sau khi bảng hiện tại xong sẽ không chạy tiếp.
   *
   * @param {string} baseKey
   * @param {object} syncManagerService
   */
  pauseGroup(baseKey, syncManagerService) {
    const group = this._groups.get(baseKey);
    if (!group) return null;

    const prevQueue   = [...group.queue];
    group.queue       = []; // Xóa queue → không chạy tiếp sau job hiện tại

    if (group.activeJobId) {
      try { syncManagerService.pauseJob(group.activeJobId); } catch (_) {}
    }

    this._setGroupStatus(group, 'PAUSED');
    this._emitUpdate(group);

    logger.info(`[SyncGroupService] Pause group "${baseKey}", còn ${prevQueue.length} bảng chưa chạy`);
    return { paused: true, activeKey: group.activeKey, remainingQueue: prevQueue };
  }

  /**
   * Tiếp tục group sau khi pause.
   * Sẽ chạy lại từ bảng còn dở (nếu có) + các bảng chưa completed.
   *
   * @param {string} baseKey
   * @param {object} syncManagerService
   * @param {object} opts
   * @param {boolean} opts.skipCompleted — bỏ qua bảng đã completed (default: true)
   */
  async resumeGroup(baseKey, syncManagerService, opts = {}) {
    const group = this._groups.get(baseKey);
    if (!group) throw new Error(`[SyncGroupService] Group "${baseKey}" chưa được đăng ký`);

    if (group.status === 'RUNNING') {
      logger.warn(`[SyncGroupService] Group "${baseKey}" đang chạy, bỏ qua lệnh resume`);
      return { alreadyRunning: true };
    }

    const { skipCompleted = true } = opts;

    // Rebuild queue từ các bảng chưa hoàn thành
    let queue = [...group.tableKeys];
    if (skipCompleted) {
      queue = queue.filter((key) => group.results.get(key) !== 'completed');
    }

    if (queue.length === 0) {
      this._setGroupStatus(group, 'COMPLETED');
      return { allDone: true };
    }

    group.queue      = queue;
    group.finishedAt = null;

    logger.info(`[SyncGroupService] Resume group "${baseKey}", queue: [${queue.join(', ')}]`);

    this._runQueue(group, syncManagerService).catch((err) => {
      logger.error(`[SyncGroupService] Group "${baseKey}" lỗi khi resume: ${err.message}`);
      this._setGroupStatus(group, 'FAILED');
      this._emitUpdate(group);
    });

    return { resumed: true, queue };
  }

  /**
   * Kích hoạt một bảng đơn lẻ trong group (bỏ qua sequential flow).
   * Dùng khi muốn chạy lại / debug một bảng cụ thể.
   *
   * @param {string} tableKey        — 'audit-migration:ATPC'
   * @param {object} syncManagerService
   * @param {object} opts
   * @param {boolean} opts.reset
   */
  triggerTable(tableKey, syncManagerService, opts = {}) {
    const baseKey = tableKey.split(':')[0];
    const group   = this._groups.get(baseKey);
    if (!group) throw new Error(`[SyncGroupService] Group "${baseKey}" không tồn tại`);
    if (!group.tableKeys.includes(tableKey)) {
      throw new Error(`[SyncGroupService] Bảng "${tableKey}" không thuộc group "${baseKey}"`);
    }

    const label = this._tableKeyToLabel(tableKey, group);
    const result = syncManagerService.startModel(label, { reset: opts.reset === true });

    logger.info(`[SyncGroupService] Trigger table "${tableKey}" (ngoài queue)`);
    return result;
  }

  /**
   * Lấy trạng thái của một group.
   * @returns {object|null}
   */
  getGroup(baseKey) {
    const group = this._groups.get(baseKey);
    return group ? this._buildGroupState(group) : null;
  }

  /**
   * Lấy tất cả groups.
   * @returns {Record<string, object>}
   */
  getAllGroups() {
    const result = {};
    for (const [key, group] of this._groups) {
      result[key] = this._buildGroupState(group);
    }
    return result;
  }

  /**
   * Được gọi bởi SyncManagerService (hoặc bridge) khi job của 1 model thay đổi trạng thái.
   *
   * @param {string} modelLabel — label đầy đủ của model (VD: 'Đồng bộ cơ sở dữ liệu cũ: nhật kí — LuanChuyenVanBan_ATPC')
   * @param {object} jobState   — { jobId, status, ... }
   */
  onJobUpdate(modelLabel, jobState) {
    for (const [, group] of this._groups) {
      const matchKey = group.tableKeys.find(
        (k) => this._tableKeyToLabel(k, group) === modelLabel
      );
      if (matchKey) {
        this._handleJobUpdate(group, matchKey, jobState);
        return;
      }
    }
  }

  // ── Private ───────────────────────────────────────────────────

  /**
   * Chạy queue tuần tự.
   * @private
   */
  async _runQueue(group, syncManagerService) {
    this._setGroupStatus(group, 'RUNNING');
    this._emitUpdate(group);

    while (group.queue.length > 0) {
      const tableKey = group.queue.shift();
      group.activeKey = tableKey;
      this._emitUpdate(group);

      logger.info(`[SyncGroupService] Chạy: ${tableKey}`);

      try {
        await this._runSingleAndWait(tableKey, group, syncManagerService);
        group.results.set(tableKey, 'completed');
        logger.info(`[SyncGroupService] Hoàn thành: ${tableKey}`);
      } catch (err) {
        group.results.set(tableKey, 'failed');
        logger.error(`[SyncGroupService] Lỗi bảng ${tableKey}: ${err.message}`);
        // Tiếp tục với bảng tiếp theo dù có lỗi
      }

      this._emitUpdate(group);
    }

    group.activeKey   = null;
    group.activeJobId = null;
    group.finishedAt  = new Date();

    const allCompleted = group.tableKeys.every((k) => group.results.get(k) === 'completed');
    const anyFailed    = group.tableKeys.some((k)  => group.results.get(k) === 'failed');

    this._setGroupStatus(group, allCompleted ? 'COMPLETED' : anyFailed ? 'FAILED' : 'PARTIAL');
    this._emitUpdate(group);

    logger.info(`[SyncGroupService] Group "${group.baseKey}" kết thúc: ${group.status}`);
  }

  /**
   * Chạy 1 bảng và đợi kết quả (Promise-based).
   * Resolve khi completed, reject khi failed/crashed/timeout.
   * @private
   */
  _runSingleAndWait(tableKey, group, syncManagerService) {
    return new Promise((resolve, reject) => {
      let settled = false;

      const finish = (fn) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.removeListener('_tableResult', onUpdate);
        fn();
      };

      const onUpdate = (updatedKey, result) => {
        if (updatedKey !== tableKey) return;
        if (result === 'completed') {
          finish(resolve);
        } else if (result === 'failed' || result === 'crashed') {
          finish(() => reject(new Error(`Table ${tableKey} ${result}`)));
        }
      };

      this.on('_tableResult', onUpdate);

      // Safety timeout: 2 giờ
      const timeout = setTimeout(() => {
        finish(() => reject(new Error(`Timeout sau 2h: ${tableKey}`)));
      }, 2 * 60 * 60 * 1000);

      // Bắt đầu chạy model
      const label = this._tableKeyToLabel(tableKey, group);
      try {
        const startResult   = syncManagerService.startModel(label, { reset: false });
        group.activeJobId   = startResult?.jobId || null;
        this._emitUpdate(group);
      } catch (err) {
        finish(() => reject(err));
      }
    });
  }

  /**
   * Xử lý job update cho một bảng trong group.
   * @private
   */
  _handleJobUpdate(group, tableKey, jobState) {
    const { status, jobId } = jobState;

    if (tableKey === group.activeKey && jobId) {
      group.activeJobId = jobId;
    }

    if (status === 'COMPLETED') {
      group.results.set(tableKey, 'completed');
      this.emit('_tableResult', tableKey, 'completed');
    } else if (status === 'FAILED' || status === 'CRASHED') {
      this.emit('_tableResult', tableKey, status.toLowerCase());
    }

    this._emitUpdate(group);
  }

  _setGroupStatus(group, status) {
    group.status = status;
  }

  _emitUpdate(group) {
    this.emit('groupUpdate', this._buildGroupState(group));
  }

  /**
   * Build state object để gửi ra ngoài.
   * @private
   */
  _buildGroupState(group) {
    const tableResults = {};
    for (const key of group.tableKeys) {
      tableResults[key] = group.results.get(key) || 'pending';
    }

    const completed = group.tableKeys.filter((k) => group.results.get(k) === 'completed').length;
    const failed    = group.tableKeys.filter((k) => group.results.get(k) === 'failed').length;
    const total     = group.tableKeys.length;

    return {
      baseKey:      group.baseKey,
      label:        group.label,
      tableKeys:    group.tableKeys,
      activeKey:    group.activeKey,
      activeJobId:  group.activeJobId,
      status:       group.status,
      tableResults,
      summary: {
        total,
        completed,
        failed,
        pending:  total - completed - failed,
        percent:  total > 0 ? Math.round((completed / total) * 100) : 0,
      },
      startedAt:   group.startedAt,
      finishedAt:  group.finishedAt,
    };
  }

  /**
   * Chuyển tableKey → label model đầy đủ.
   * 'audit-migration:LuanChuyenVanBan_ATPC' → 'Đồng bộ cơ sở dữ liệu cũ: nhật kí — LuanChuyenVanBan_ATPC'
   * @private
   */
  _tableKeyToLabel(tableKey, group) {
    const parts     = tableKey.split(':');
    const tableName = parts.slice(1).join(':');
    return group.label.includes('{table}')
      ? group.label.replace('{table}', tableName)
      : `${group.label} — ${tableName}`;
  }
}

module.exports = new SyncGroupService();