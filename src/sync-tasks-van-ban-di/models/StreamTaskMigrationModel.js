const BaseModel = require('../../../models/BaseModel');
const MigrationHelper = require('../../helpers/MigrationHelper');
const logger = require('../../../utils/logger');

/**
 * Safely parse dates, treating 'NULL' string as null
 */
function safeDateParse(dateValue, fieldName = '') {
  if (dateValue === undefined || dateValue === null) return null;
  const raw = String(dateValue).trim();
  if (!raw || raw.toUpperCase() === 'NULL') return null;

  try {
    if (typeof dateValue?.getTime === 'function' && !Number.isNaN(dateValue.getTime())) {
      return dateValue.toISOString();
    }
  } catch (e) {
    if (fieldName) logger.warn(`[safeDateParse] Failed to convert ${fieldName}: ${e.message}`);
  }

  const sqlLike = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?)?$/
  );
  if (sqlLike) {
    const [, y, mo, d, hh = '00', mi = '00', ss = '00', ms = '000'] = sqlLike;
    return `${y}-${mo}-${d}T${hh}:${mi}:${ss}.${String(ms).padEnd(3, '0').slice(0, 3)}Z`;
  }

  const compact = raw.replace(/\s+/g, ' ').replace(/(\d)(AM|PM)$/i, '$1 $2');
  const textLike = compact.match(
    /^([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i
  );
  if (textLike) {
    const monthMap = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
    };
    const mon = monthMap[textLike[1].slice(0, 3).toLowerCase()];
    if (mon) {
      const day = String(Number(textLike[2])).padStart(2, '0');
      const year = textLike[3];
      let hour = Number(textLike[4]);
      const minute = textLike[5];
      const ap = textLike[6].toUpperCase();
      if (ap === 'AM') {
        if (hour === 12) hour = 0;
      } else if (hour < 12) {
        hour += 12;
      }
      return `${year}-${mon}-${day}T${String(hour).padStart(2, '0')}:${minute}:00.000Z`;
    }
  }

  const fallback = new Date(raw);
  if (!Number.isNaN(fallback.getTime())) {
    return fallback.toISOString();
  }

  if (fieldName) logger.warn(`[safeDateParse] Invalid ${fieldName}: ${raw}`);
  return null;
}

function normalizeLegacyDateString(value) {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (!raw || raw.toUpperCase() === 'NULL') return null;
  return raw;
}

const TX_RETRY_MAX = 3;
const TX_RETRY_BASE_DELAY_MS = 250;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableTxError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return (
    err?.number === 1205 || // deadlock
    err?.number === 1222 || // lock timeout
    err?.code === 'ETIMEOUT' ||
    msg.includes('deadlock') ||
    msg.includes('lock request time out') ||
    msg.includes('timeout')
  );
}

/** Maps TaskVBDen → task (35 columns with id_task_bak) */
class StreamTaskMigrationModel extends BaseModel {
  constructor() {
    super();
    this.newDbName = process.env.NEW_DB_NAME;
    this.newDbSchema = 'dbo';
    this.newTableSync = 'task_sync_out';
    this.newDbTable = 'task';

    this.helper = new MigrationHelper(
      this.queryNewDbTx.bind(this),
      this.queryOldDb.bind(this)
    );
  }

  /** Initialize model */
  async initialize() {
    await super.initialize();
    await this.ensureTaskTableColumns();
    await this.ensureTaskTableIndexes();
    logger.info('[StreamTaskMigrationModel] Initialized');
  }

  /**
   * Ensure necessary columns exist in the main task table, add if missing.
   */
  async ensureTaskTableColumns() {
    try {
      const targetTable = `${this.newDbName}.${this.newDbSchema}.${this.newDbTable}`;
      const dbName = this.newDbName;
      const tableName = this.newDbTable;

      // Danh sách các cột quan trọng cần có trong bảng [task]
      const requiredColumns = [
        { name: 'id_task_bak',            type: 'NVARCHAR(255)' },
        { name: 'code',                   type: 'NVARCHAR(255)' },
        { name: 'name',                   type: 'NVARCHAR(MAX)' },
        { name: 'start_date',             type: 'DATETIME2'     },
        { name: 'end_date',               type: 'DATETIME2'     },
        { name: 'bpmn_id',                type: 'NVARCHAR(255)' },
        { name: 'priority',               type: 'NVARCHAR(50)'  },
        { name: 'reminder_time',          type: 'INT'           },
        { name: 'topic',                  type: 'NVARCHAR(MAX)' },
        { name: 'note',                   type: 'NVARCHAR(MAX)' },
        { name: 'repetitive_task',        type: 'BIT'           },
        { name: 'month',                  type: 'INT'           },
        { name: 'repetitive_start',       type: 'DATETIME2'     },
        { name: 'repetitive_end',         type: 'DATETIME2'     },
        { name: 'parent',                 type: 'NVARCHAR(255)' },
        { name: 'path',                   type: 'NVARCHAR(MAX)' },
        { name: 'progress',               type: 'INT'           },
        { name: 'process_status',         type: 'NVARCHAR(50)'  },
        { name: 'status',                 type: 'INT'           },
        { name: 'approval_status',        type: 'NVARCHAR(50)'  },
        { name: 'created_by',             type: 'NVARCHAR(255)' },
        { name: 'updated_by',             type: 'NVARCHAR(255)' },
        { name: 'recurring_from_id',      type: 'INT'           },
        { name: 'type_task',              type: 'NVARCHAR(50)'  },
        { name: 'doc_id',                 type: 'INT'           },
        { name: 'meeting_id',             type: 'INT'           },
        { name: 'meeting_conclusion_id',  type: 'INT'           },
        { name: 'week_days',              type: 'NVARCHAR(255)' },
        { name: 'project_id',             type: 'INT'           },
        { name: 'type_task_meeting',      type: 'NVARCHAR(50)'  },
        { name: 'template_id',            type: 'INT'           },
        { name: 'dependent_task_id',      type: 'INT'           },
        { name: 'is_confidential',        type: 'BIT'           }
      ];

      for (const col of requiredColumns) {
        const checkColQuery = `
          SELECT 1 FROM ${dbName}.INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = '${tableName}' AND COLUMN_NAME = '${col.name}'
        `;
        const existing = await this.queryNewDb(checkColQuery, {});

        if (!existing || existing.length === 0) {
          const alterQuery = `
            ALTER TABLE ${targetTable}
            ADD [${col.name}] ${col.type} NULL
          `;
          await this.queryNewDb(alterQuery, {});
          logger.info(`Added missing column ${col.name} to ${tableName} table`);
        }
      }
    } catch (err) {
      logger.error('ensureTaskTableColumns failed:', err.message);
      throw err;
    }
  }

  async ensureTaskTableIndexes() {
    try {
      const targetTable = `${this.newDbName}.${this.newDbSchema}.${this.newDbTable}`;
      const dbName = this.newDbName;
      const indexName = 'IX_task_id_task_bak';

      const sqlEnsureIndex = `
        IF NOT EXISTS (
          SELECT 1
          FROM ${dbName}.sys.indexes
          WHERE name = '${indexName}'
            AND object_id = OBJECT_ID('${targetTable}')
        )
        BEGIN
          CREATE NONCLUSTERED INDEX ${indexName}
          ON ${targetTable} (id_task_bak)
          WHERE id_task_bak IS NOT NULL;
        END
      `;
      await this.queryNewDb(sqlEnsureIndex);
      logger.info(`[StreamTaskMigrationModel] Verified index ${indexName} on ${targetTable}`);
    } catch (err) {
      logger.warn(`[StreamTaskMigrationModel] ensureTaskTableIndexes failed: ${err.message}`);
    }
  }

  async runTxWithRetry(fn, label = '', options = {}) {
    let attempt = 0;
    const tx = options?.transaction || null;
    while (true) {
      try {
        return await fn();
      } catch (err) {
        attempt += 1;
        const txValid = !tx || (tx._acquiredConnection && !tx._aborted);
        if (!txValid) {
          throw err;
        }
        if (isRetryableTxError(err) && attempt <= TX_RETRY_MAX) {
          const delay = TX_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          logger.warn(`[StreamTaskMigrationModel] Retry ${attempt}/${TX_RETRY_MAX} for ${label} after ${delay}ms: ${err.message}`);
          await sleep(delay);
          continue;
        }
        throw err;
      }
    }
  }

  /** Process single task: map & insert/update all 35 columns */
  async processSingleRecord(stagingRow, transaction = null) {
    try {
      if (!stagingRow || !stagingRow.ID) {
        throw new Error('stagingRow với ID là bắt buộc');
      }

      const targetTable = `${this.newDbName}.${this.newDbSchema}.${this.newDbTable}`;
      const backupId = String(stagingRow.ID).trim();
      
      const mapped = await this.mapSingleRecord(stagingRow, transaction);

      // Validate required field: name
      if (!mapped.name || String(mapped.name).trim() === '') {
        throw new Error(`Task name is required for ID=${backupId}`);
      }

      const existQuery = `
        SELECT TOP 1 id FROM ${targetTable}
        WHERE id_task_bak = @idTaskBak
      `;
      
      const existing = await this.runTxWithRetry(
        () => this.queryNewDbTx(existQuery, { idTaskBak: backupId }, transaction),
        `check-existing id_task_bak=${backupId}`,
        { transaction }
      );
      
      if (Array.isArray(existing) && existing.length > 0) {
        // 3a. Update existing - WITH ALL COLUMNS
        const updateQuery = `
          UPDATE ${targetTable}
          SET code = @code,
              name = @name,
              start_date = @startDate,
              end_date = @endDate,
              bpmn_id = @bpmnId,
              priority = @priority,
              reminder_time = @reminderTime,
              topic = @topic,
              note = @note,
              repetitive_task = @repetitiveTask,
              month = @month,
              repetitive_start = @repetitiveStart,
              repetitive_end = @repetitiveEnd,
              parent = @parent,
              path = @path,
              progress = @progress,
              process_status = @processStatus,
              status = @status,
              approval_status = @approvalStatus,
              created_by = @createdBy,
              updated_by = @updatedBy,
              recurring_from_id = @recurringFromId,
              type_task = @typeTask,
              doc_id = @docId,
              meeting_id = @meetingId,
              meeting_conclusion_id = @meetingConclusionId,
              week_days = @weekDays,
              project_id = @projectId,
              type_task_meeting = @typeTaskMeeting,
              template_id = @templateId,
              dependent_task_id = @dependentTaskId,
              is_confidential = @isConfidential,
              created_at = @createdAt,
              update_at = @updateAt
          WHERE id_task_bak = @idTaskBak
        `;
        
        const updateParams = {
          code: mapped.code,
          name: mapped.name,
          startDate: mapped.start_date,
          endDate: mapped.end_date,
          bpmnId: mapped.bpmn_id,
          priority: mapped.priority,
          reminderTime: mapped.reminder_time,
          topic: mapped.topic,
          note: mapped.note,
          repetitiveTask: mapped.repetitive_task,
          month: mapped.month,
          repetitiveStart: mapped.repetitive_start,
          repetitiveEnd: mapped.repetitive_end,
          parent: mapped.parent,
          path: mapped.path,
          progress: mapped.progress,
          processStatus: mapped.process_status,
          status: mapped.status,
          approvalStatus: mapped.approval_status,
          createdBy: mapped.created_by,
          updatedBy: mapped.updated_by,
          recurringFromId: mapped.recurring_from_id,
          typeTask: mapped.type_task,
          docId: mapped.doc_id,
          meetingId: mapped.meeting_id,
          meetingConclusionId: mapped.meeting_conclusion_id,
          weekDays: mapped.week_days,
          projectId: mapped.project_id,
          typeTaskMeeting: mapped.type_task_meeting,
          templateId: mapped.template_id,
          dependentTaskId: mapped.dependent_task_id,
          isConfidential: mapped.is_confidential,
          createdAt: mapped.created_at,
          updateAt: mapped.update_at,
          idTaskBak: backupId
        };

        await this.runTxWithRetry(
          () => this.queryNewDbTx(updateQuery, updateParams, transaction),
          `update-task id_task_bak=${backupId}`,
          { transaction }
        );
        
        const currentTaskId = Number(existing[0].id);
        // logger.info(`[StreamTaskMigrationModel.processSingleRecord] Updated task ${backupId}`);
        return { action: 'updated', idTaskBak: backupId, newTaskId: existing[0].id };
      } else {
        // 3b. Insert new - WITH ALL COLUMNS + SCOPE_IDENTITY VERIFICATION
        const insertQuery = `
          INSERT INTO ${targetTable}
          (code, name, start_date, end_date, bpmn_id, priority, reminder_time, topic, note,
           repetitive_task, month, repetitive_start, repetitive_end, parent, path, progress,
           process_status, status, approval_status, created_by, updated_by, recurring_from_id,
           type_task, doc_id, meeting_id, meeting_conclusion_id, week_days, project_id,
           type_task_meeting, template_id, dependent_task_id, is_confidential, id_task_bak,
           created_at, update_at)
          VALUES
          (@code, @name, @startDate, @endDate, @bpmnId, @priority, @reminderTime, @topic, @note,
           @repetitiveTask, @month, @repetitiveStart, @repetitiveEnd, @parent, @path, @progress,
           @processStatus, @status, @approvalStatus, @createdBy, @updatedBy, @recurringFromId,
           @typeTask, @docId, @meetingId, @meetingConclusionId, @weekDays, @projectId,
           @typeTaskMeeting, @templateId, @dependentTaskId, @isConfidential, @idTaskBak,
           @createdAt, @updateAt);
          SELECT SCOPE_IDENTITY() as id
        `;
        
        let result;
        try {
          result = await this.runTxWithRetry(() => this.queryNewDbTx(insertQuery, {
            code: mapped.code,
            name: mapped.name,
            startDate: mapped.start_date,
            endDate: mapped.end_date,
            bpmnId: mapped.bpmn_id,
            priority: mapped.priority,
            reminderTime: mapped.reminder_time,
            topic: mapped.topic,
            note: mapped.note,
            repetitiveTask: mapped.repetitive_task,
            month: mapped.month,
            repetitiveStart: mapped.repetitive_start,
            repetitiveEnd: mapped.repetitive_end,
            parent: mapped.parent,
            path: mapped.path,
            progress: mapped.progress,
            processStatus: mapped.process_status,
            status: mapped.status,
            approvalStatus: mapped.approval_status,
            createdBy: mapped.created_by,
            updatedBy: mapped.updated_by,
            recurringFromId: mapped.recurring_from_id,
            typeTask: mapped.type_task,
            docId: mapped.doc_id,
            meetingId: mapped.meeting_id,
            meetingConclusionId: mapped.meeting_conclusion_id,
            weekDays: mapped.week_days,
            projectId: mapped.project_id,
            typeTaskMeeting: mapped.type_task_meeting,
            templateId: mapped.template_id,
            dependentTaskId: mapped.dependent_task_id,
            isConfidential: mapped.is_confidential,
            createdAt: mapped.created_at,
            updateAt: mapped.update_at,
            idTaskBak: backupId
          }, transaction), `insert-task id_task_bak=${backupId}`, { transaction });
        } catch (insertErr) {
          logger.error(`[StreamTaskMigrationModel] INSERT FAILED for ID=${backupId}: ${insertErr.message}`, insertErr);
          throw insertErr;
        }
        
        // CRITICAL: Verify SCOPE_IDENTITY was captured
        const newId = result && result.length > 0 ? result[0].id : null;
        if (!newId) {
          const msg = `Insert failed: SCOPE_IDENTITY returned null for ID=${backupId}`;
          logger.error(`[StreamTaskMigrationModel] ${msg}`);
          throw new Error(msg);
        }
        
        // logger.info(`[StreamTaskMigrationModel.processSingleRecord] Inserted task ${backupId} with new ID ${newId}`);
        return { action: 'inserted', idTaskBak: backupId, newTaskId: newId, createdBy: mapped.created_by, createdAt: mapped.created_at };
      }
    } catch (error) {
      logger.error(`[StreamTaskMigrationModel.processSingleRecord] FAILED ID=${stagingRow?.ID}: ${error.message}`, error);
      throw error;
    }
  }

  /** Map TaskVBDen → task (12 mapped + 23 defaults) */
  async mapSingleRecord(rawRecord, transaction = null) {
    if (!rawRecord) {
      throw new Error('rawRecord is required');
    }

    // TEMP: force creator/updater để đồng nhất với luồng CV đến.
    // TODO (logic chuẩn): bật lại map user từ dữ liệu cũ:
    // const createdBy = await this.helper.mapUserName(rawRecord.CreatedBy) || null;
    // const modifiedBy = await this.helper.mapUserName(rawRecord.ModifiedBy) || null;
    const forcedActorId =
      process.env.TASK_TEMP_CREATED_BY_ID ||
      process.env.VANTHU_USER_ID ||
      'b23406e3-5c75-41d3-91e0-1654293ae6b2';
    const createdBy = forcedActorId;
    const modifiedBy = forcedActorId;

    // CV đi: dùng raw staging values để giữ nguyên format legacy kiểu "Nov 28 2024  8:46AM".
    // Không dùng helper.parseDate ở đây vì có thể làm mất format trước khi safeDateParse xử lý.
    const startDateRaw = rawRecord.StartDate;
    const endDateRaw = rawRecord.DueDate;
    const completedDateRaw = rawRecord.CompletedDate;
    const createdAtRaw = rawRecord.Created;
    const updatedAtRaw = rawRecord.Modified;

    // Multiple layers of safety: convert to ISO string or null
    const startDate = safeDateParse(startDateRaw, 'StartDate');
    const endDate = safeDateParse(endDateRaw, 'DueDate');
    const completedDate = safeDateParse(completedDateRaw, 'CompletedDate');
    // Keep legacy date string format from old table (e.g. "Aug 6 2014 4:36PM")
    // to map directly into task.created_at / task.update_at.
    const createdAt = normalizeLegacyDateString(createdAtRaw);
    const updatedAt = normalizeLegacyDateString(updatedAtRaw);

    // log debug data bẩn
    if (!startDate && rawRecord.StartDate) {
      logger.warn(
        `[mapSingleRecord] Invalid StartDate: raw="${rawRecord.StartDate}" parsed="${startDate}" ID=${rawRecord.ID}`
      );
    }

    if (!endDate && rawRecord.DueDate) {
      logger.warn(
        `[mapSingleRecord] Invalid DueDate: raw="${rawRecord.DueDate}" parsed="${endDate}" ID=${rawRecord.ID}`
      );
    }
    const typeTask = 'form_doc';
    const progress = rawRecord.Percent ? parseInt(rawRecord.Percent, 10) : null;

    const mapProcessStatus = (val) => {
      const key = String(val || '').trim();
      return ({
        'Chưa bắt đầu': '1',
        'Đang thực hiện': '2',
        'Chờ phê duyệt': '3',
        'Hoàn tất': '4',
        'Từ chối phê duyệt': '5',
        'Điều chỉnh': '6',
        'Từ chối điều chỉnh': '7',
        'Huỷ': '8'
      }[key] || '1');
    };
    const processStatus = mapProcessStatus(rawRecord.TrangThai);

    const mapPriority = (val) => {
      const key = String(val || '').trim();
      return ({
        '0': 'binhthuong',
        '1': 'gap'
      }[key] || 'binhthuong');
    };
    const priority = mapPriority(rawRecord.TrangThai);

    const parentCandidate = rawRecord.ParentId ? String(rawRecord.ParentId).trim() : '';
    const parentRaw = (!parentCandidate || parentCandidate === '0') ? null : parentCandidate;
    const parentResolved = await this.resolveParentIdByBakId(parentRaw, transaction);

    const docLookup = await this.helper.findDocumentIdByOldId(rawRecord.VBId, 'OutgoingDocument', transaction);
    const docId = docLookup?.document_id || null;

    return {
      id_task_bak: String(rawRecord.ID || '').trim() || null,
      name: rawRecord.Title || null,
      doc_id: docId,

      start_date: startDate,
      end_date: endDate || completedDate || startDate,

      status: 1,
      priority: priority,
      note: rawRecord.YKienChiDao || null,

      created_by: createdBy,
      updated_by: modifiedBy,

      created_at: createdAt || new Date().toISOString(),
      update_at: updatedAt || new Date().toISOString(),

      code: null,
      bpmn_id: null,
      reminder_time: null,
      topic: null,
      repetitive_task: null,
      month: null,
      repetitive_start: null,
      repetitive_end: null,
      // If parent old-id has already been migrated, store mapped new task.id immediately.
      // Otherwise keep old parent id temporarily, it will be backfilled later.
      parent: parentResolved ?? parentRaw,
      path: null,
      progress: progress,
      process_status: processStatus,
      approval_status: null,
      recurring_from_id: null,
      type_task: typeTask,
      meeting_id: null,
      meeting_conclusion_id: null,
      week_days: null,
      project_id: null,
      type_task_meeting: null,
      template_id: null,
      dependent_task_id: null,
      is_confidential: 0
    };
  }

  /** Cleanup staging table */
  async cleanupStagingTable() {
    try {
      const stagingRef = `${this.newDbName}.${this.newDbSchema}.${this.newTableSync}`;
      const truncateQuery = `TRUNCATE TABLE ${stagingRef}`;
      
      await this.queryNewDb(truncateQuery, {});
      
      logger.info(`[StreamTaskMigrationModel.cleanupStagingTable] Cleaned up ${this.newTableSync}`);
      return {
        success: true,
        message: `Truncated ${this.newTableSync}`,
        table: this.newTableSync
      };
    } catch (error) {
      logger.error('[StreamTaskMigrationModel.cleanupStagingTable]', error);
      return {
        success: false,
        message: `Failed: ${error.message}`,
        table: this.newTableSync,
        error: error.message
      };
    }
  }

  async resolveParentRelation(transaction) {
    const targetTable = `${this.newDbName}.${this.newDbSchema}.${this.newDbTable}`;

    const query = `
      UPDATE child
      SET parent = parent.id
      FROM ${targetTable} child
      INNER JOIN ${targetTable} parent
        ON child.parent = parent.id_task_bak
      WHERE child.parent IS NOT NULL AND child.id_task_bak <> child.parent
    `;

    await this.queryNewDbTx(query, {}, transaction);

    logger.info('[resolveParentRelation] Parent mapping completed');
  }

  async resolveParentIdByBakId(parentBakId, transaction = null) {
    if (!parentBakId) return null;
    const targetTable = `${this.newDbName}.${this.newDbSchema}.${this.newDbTable}`;
    const rows = await this.queryNewDbTx(
      `
        SELECT TOP 1 id
        FROM ${targetTable}
        WHERE id_task_bak = @parentBakId
      `,
      { parentBakId: String(parentBakId) },
      transaction
    );
    if (!Array.isArray(rows) || !rows.length) return null;
    const resolved = Number(rows[0].id);
    return Number.isNaN(resolved) ? null : resolved;
  }

  async resolveParentBackfillByBakId(parentBakId, parentNewId, transaction = null) {
    if (!parentBakId || !parentNewId) return;
    const targetTable = `${this.newDbName}.${this.newDbSchema}.${this.newDbTable}`;
    await this.queryNewDbTx(
      `
        UPDATE ${targetTable}
        SET parent = @parentNewId
        WHERE parent = @parentBakId
      `,
      {
        parentNewId: Number(parentNewId),
        parentBakId: String(parentBakId)
      },
      transaction
    );
  }
}

module.exports = StreamTaskMigrationModel;
