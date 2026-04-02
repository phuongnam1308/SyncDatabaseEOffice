const BaseModel = require('../../../models/BaseModel');
const MigrationHelper = require('../../helpers/MigrationHelper');
const logger = require('../../../utils/logger');

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
      
      const existing = await this.queryNewDb(checkColQuery);
      
      if (!existing || existing.length === 0) {
        // Column doesn't exist - ADD it
        const alterQuery = `
          ALTER TABLE ${targetTable}
          ADD id_task_bak NVARCHAR(255) NULL
        `;
        
        await this.queryNewDb(alterQuery);
        logger.info('✅ Added id_task_bak column to task table');
      }
    } catch (err) {
      logger.error('❌ ensureTaskTableColumns failed:', err.message);
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
      
      const mapped = await this.mapSingleRecord(stagingRow, transaction);

      const existQuery = `
        SELECT TOP 1 id FROM ${targetTable}
        WHERE id_task_bak = @idTaskBak
      `;
      
      const existing = await this.queryNewDb(existQuery, {
        idTaskBak: String(stagingRow.ID)
      });
      
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
        
        await this.queryNewDb(updateQuery, {
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
          idTaskBak: String(stagingRow.ID)
        });
        
        logger.info(`[StreamTaskMigrationModel.processSingleRecord] Updated task ${stagingRow.ID}`);
        return { action: 'updated', idTaskBak: String(stagingRow.ID), newTaskId: existing[0].id };
      } else {
        // 3b. Insert new - WITH ALL COLUMNS
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
        
        const result = await this.queryNewDb(insertQuery, {
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
          idTaskBak: String(stagingRow.ID)
        });
        
        const newId = result && result.length > 0 ? result[0].id : null;
        
        logger.info(`[StreamTaskMigrationModel.processSingleRecord] Inserted task ${stagingRow.ID} with new ID ${newId}`);
        return { action: 'inserted', idTaskBak: String(stagingRow.ID), newTaskId: newId };
      }
    } catch (error) {
      logger.error('[StreamTaskMigrationModel.processSingleRecord]', error);
      throw error;
    }
  }

  /** Map TaskVBDen → task (12 mapped + 23 defaults) */
  async mapSingleRecord(rawRecord, transaction = null) {
    if (!rawRecord) {
      throw new Error('rawRecord is required');
    }

    return {
      // Mapping từ old DB
      id_task_bak: String(rawRecord.ID || '').trim() || null,
      name: rawRecord.Title || null,
      doc_id: String(rawRecord.VBId || '').trim() || null,
      start_date: rawRecord.StartDate ? new Date(rawRecord.StartDate).toISOString() : null,
      end_date: rawRecord.DueDate ? new Date(rawRecord.DueDate).toISOString() : null,
      status: rawRecord.TrangThai ? parseInt(rawRecord.TrangThai, 10) : 1,
      priority: rawRecord.Priority || null,
      note: rawRecord.Content || null,
      created_by: rawRecord.CreatedBy || null,
      updated_by: rawRecord.ModifiedBy || null,
      created_at: rawRecord.Created ? new Date(rawRecord.Created).toISOString() : new Date().toISOString(),
      update_at: rawRecord.Modified ? new Date(rawRecord.Modified).toISOString() : new Date().toISOString(),

      // Default values cho columns không map từ old DB
      code: null,
      bpmn_id: null,
      reminder_time: null,
      topic: null,
      repetitive_task: null,
      month: null,
      repetitive_start: null,
      repetitive_end: null,
      parent: null,
      path: null,
      progress: null,
      process_status: null,
      approval_status: null,
      recurring_from_id: null,
      type_task: null,
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
      
      await this.queryNewDb(truncateQuery);
      
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
}

module.exports = StreamTaskMigrationModel;
