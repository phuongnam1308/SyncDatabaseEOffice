const BaseModel = require('../../../models/BaseModel');
const MigrationHelper = require('../../helpers/MigrationHelper');
const logger = require('../../../utils/logger');

/**
 * Safely parse dates, treating 'NULL' string as null
 */
function safeDateParse(dateValue, fieldName = '') {
  if (!dateValue) return null;
  if (typeof dateValue === 'string' && dateValue.toUpperCase() === 'NULL') return null;
  
  try {
    if (typeof dateValue.getTime === 'function' && !isNaN(dateValue.getTime())) {
      return dateValue.toISOString();
    }
  } catch (e) {
    if (fieldName) logger.warn(`[safeDateParse] Failed to convert ${fieldName}: ${e.message}`);
  }
  return null;
}

/** Maps TaskVBDen → task (35 columns with id_task_bak) */
class StreamTaskMigrationModel extends BaseModel {
  constructor() {
    super();
    this.newDbName = process.env.NEW_DB_NAME;
    this.newDbSchema = 'dbo';
    this.newTableSync = 'task_sync';
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
    logger.info('[StreamTaskMigrationModel] Initialized');
  }

  /**
   * Ensure id_task_bak column exists, add if missing
   */
  async ensureTaskTableColumns() {
    try {
      const targetTable = `${this.newDbName}.${this.newDbSchema}.${this.newDbTable}`;
      
      // Check if id_task_bak column exists
      const checkColQuery = `
        SELECT 1 FROM ${this.newDbName}.INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = '${this.newDbSchema}'
          AND TABLE_NAME = '${this.newDbTable}'
          AND COLUMN_NAME = 'id_task_bak'
      `;
      
      const existing = await this.queryNewDb(checkColQuery, {});
      
      if (!existing || existing.length === 0) {
        // Column doesn't exist - ADD it
        const alterQuery = `
          ALTER TABLE ${targetTable}
          ADD id_task_bak NVARCHAR(255) NULL
        `;
        
        await this.queryNewDb(alterQuery, {});
        logger.info('Added id_task_bak column to task table');
      }
    } catch (err) {
      logger.error('ensureTaskTableColumns failed:', err.message);
      throw err;
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
      
      const existing = await this.queryNewDbTx(existQuery, {
        idTaskBak: backupId
      }, transaction);
      
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
              update_at = GETDATE()
          WHERE id_task_bak = @idTaskBak
        `;
        
        const result = await this.queryNewDbTx(updateQuery, {
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
          idTaskBak: backupId
        }, transaction);
        
        logger.info(`[StreamTaskMigrationModel.processSingleRecord] Updated task ${backupId}`);
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
           GETDATE(), GETDATE());
          SELECT SCOPE_IDENTITY() as id
        `;
        
        let result;
        try {
          result = await this.queryNewDbTx(insertQuery, {
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
            idTaskBak: backupId
          }, transaction);
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
        
        logger.info(`[StreamTaskMigrationModel.processSingleRecord] Inserted task ${backupId} with new ID ${newId}`);
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

    const createdBy = await this.helper.mapUserName(rawRecord.CreatedBy) || null;
    const modifiedBy = await this.helper.mapUserName(rawRecord.ModifiedBy) || null;

    // Parse dates from helper, then apply safeDateParse
    const startDateRaw = this.helper.parseDate(rawRecord.StartDate);
    const endDateRaw = this.helper.parseDate(rawRecord.DueDate);
    const completedDateRaw = this.helper.parseDate(rawRecord.CompletedDate);
    const createdAtRaw = this.helper.parseDate(rawRecord.Created);
    const updatedAtRaw = this.helper.parseDate(rawRecord.Modified);

    // Multiple layers of safety: convert to ISO string or null
    const startDate = safeDateParse(startDateRaw, 'StartDate');
    const endDate = safeDateParse(endDateRaw, 'DueDate');
    const completedDate = safeDateParse(completedDateRaw, 'CompletedDate');
    const createdAt = safeDateParse(createdAtRaw, 'Created');
    const updatedAt = safeDateParse(updatedAtRaw, 'Modified');

    // log debug data bẩn
    if (!startDate && rawRecord.StartDate) {
      logger.warn(`[mapSingleRecord] Invalid StartDate: ${rawRecord.StartDate} ID=${rawRecord.ID}`);
    }

    if (!endDate && rawRecord.DueDate) {
      logger.warn(`[mapSingleRecord] Invalid DueDate: ${rawRecord.DueDate} ID=${rawRecord.ID}`);
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

    const parentRaw = rawRecord.ParentId ? String(rawRecord.ParentId).trim() : null;

    const docLookup = await this.helper.findDocumentIdByOldId(rawRecord.VBId, 'IncommingDocument', transaction);
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
      parent: parentRaw,
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
}

module.exports = StreamTaskMigrationModel;
