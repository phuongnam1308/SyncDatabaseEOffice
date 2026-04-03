const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const MigrationHelper = require('../../helpers/MigrationHelper');
const logger = require('../../../utils/logger');

/** Maps TaskVBDenPermission → task_users (9 columns with id_user_bak) */
class StreamTaskUsersModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_TASK_USERS_MODEL' });
    this.newDbName = process.env.NEW_DB_NAME;
    this.oldDbSchema = 'dbo';
    this.oldDbTable = 'TaskVBDenPermission';
    this.newDbSchema = 'dbo';
    this.newDbTable = 'task_users';

    this.helper = new MigrationHelper(
      this.queryNewDbTx.bind(this),
      this.queryOldDb.bind(this)
    );
  }

  /** Initialize model */
  async initialize() {
    await super.initialize();
    await this.ensureTaskUsersTableColumns();
    logger.info('[StreamTaskUsersModel] Initialized - no staging table');
  }

  /**
   * Ensure id_user_bak column exists, add if missing
   */
  async ensureTaskUsersTableColumns() {
    try {
      const targetTable = `${this.newDbName}.${this.newDbSchema}.${this.newDbTable}`;
      
      // Check if id_user_bak column exists
      const checkColQuery = `
        SELECT 1 FROM ${this.newDbName}.INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = '${this.newDbSchema}'
          AND TABLE_NAME = '${this.newDbTable}'
          AND COLUMN_NAME = 'id_user_bak'
      `;
      
      const existing = await this.queryNewDb(checkColQuery, {});
      
      if (!existing || existing.length === 0) {
        // Column doesn't exist - ADD it
        const alterQuery = `
          ALTER TABLE ${targetTable}
          ADD id_user_bak NVARCHAR(255) NULL
        `;
        
        await this.queryNewDb(alterQuery, {});
        logger.info('Added id_user_bak column to task_users table');
      }
    } catch (err) {
      logger.error('ensureTaskUsersTableColumns failed:', err.message);
      throw err;
    }
  }

  /** Process single task user: map & insert/update all 8 columns */
  async processSingleRecord(stagingRow, transaction) {
    try {
      if (!stagingRow) {
        throw new Error('stagingRow is required');
      }

      const targetTable = `${this.newDbName}.${this.newDbSchema}.${this.newDbTable}`;
      const userBackupId = String(stagingRow.ID || '').trim();

      // 1. Map bản ghi (all 8 columns)
      const mapped = await this.mapSingleRecord(stagingRow);

      // CRITICAL: Validate required fields
      if (!userBackupId) {
        throw new Error('User ID is required for task_users');
      }
      if (!mapped.task_id || mapped.task_id === null) {
        throw new Error(`Task ID is required (orphaned user detection) for user ID=${userBackupId}`);
      }

      // 2. Check tồn tại bằng id_user_bak
      const existQuery = `
        SELECT TOP 1 id FROM ${targetTable}
        WHERE id_user_bak = @idUserBak
      `;

      const existing = await this.queryNewDbTx(existQuery, { idUserBak: mapped.id_user_bak }, transaction);
      
      if (Array.isArray(existing) && existing.length > 0) {
        // 3a. Update existing - WITH ALL 8 COLUMNS
        const updateQuery = `
          UPDATE ${targetTable}
          SET task_id = @taskId,
              process_id = @processId,
              process_name = @processName,
              role = @role,
              type = @type,
              update_at = @updateAt
          WHERE id_user_bak = @idUserBak
        `;

        await this.queryNewDbTx(updateQuery, {
          taskId: mapped.task_id,
          processId: mapped.process_id,
          processName: mapped.process_name,
          role: mapped.role,
          type: mapped.type,
          idUserBak: mapped.id_user_bak,
          updateAt: mapped.update_at
        }, transaction);

        logger.info(`[StreamTaskUsersModel] Updated task_user ${mapped.id_user_bak}`);
        return { action: 'updated', id_user_bak: mapped.id_user_bak, taskId: mapped.task_id };
      } else {
        // 3b. Insert new - WITH ALL 8 COLUMNS
        const insertQuery = `
          INSERT INTO ${targetTable}
          (task_id, process_id, process_name, role, type, id_user_bak, created_at, update_at)
          VALUES
          (@taskId, @processId, @processName, @role, @type, @idUserBak, @createdAt, @updateAt);
          SELECT SCOPE_IDENTITY() as id
        `;

        const result = await this.queryNewDbTx(insertQuery, {
          taskId: mapped.task_id,
          processId: mapped.process_id,
          processName: mapped.process_name,
          role: mapped.role,
          type: mapped.type,
          idUserBak: mapped.id_user_bak,
          updateAt: mapped.update_at,
          createdAt: mapped.created_at
        }, transaction);

        // Verify INSERT success
        const newId = result && result.length > 0 ? result[0].id : null;
        if (!newId) {
          throw new Error(`Insert failed: SCOPE_IDENTITY returned null for user ID=${userBackupId}`);
        }

        logger.info(`[StreamTaskUsersModel] Inserted task_user ${mapped.id_user_bak} with id=${newId}`);
        return { action: 'inserted', id_user_bak: mapped.id_user_bak, taskId: mapped.task_id, newId };
      }
    } catch (error) {
      logger.error(`[StreamTaskUsersModel.processSingleRecord] FAILED ID=${stagingRow?.ID}: ${error.message}`, error);
      throw error;
    }
  }

  /** Map TaskVBDenPermission → task_users (all 8 columns) */
  async mapSingleRecord(rawRecord) {
    if (!rawRecord) {
      throw new Error('rawRecord is required');
    }

    // CRITICAL FIX: Use UserType to check existence, but parse Type for value
    let typeValue = null;
    if (rawRecord.Type !== undefined && rawRecord.Type !== null) {
      typeValue = parseInt(rawRecord.Type, 10);
      if (isNaN(typeValue)) typeValue = null;
    }
    
    const processId = await this.helper.mapUserName(rawRecord.UserId) || null;
    // const processName = await this.helper.getUserame(processId) || null; // todo
    // const role = await this.helper.getRoleTask(rawRecord.UserFieldId) || null; // todo

    // Safe date conversion with validation
    const safeISODate = (dateValue) => {
      if (!dateValue) return new Date().toISOString();
      try {
        const dateObj = new Date(dateValue);
        if (!isNaN(dateObj.getTime())) {
          return dateObj.toISOString();
        }
      } catch (e) {
        logger.warn(`[mapSingleRecord] Failed to convert date: ${e.message}`);
      }
      return new Date().toISOString();
    };

    // CRITICAL FIX: No fallback to '1' - require valid ID
    const userBackupId = String(rawRecord.ID || '').trim();
    if (!userBackupId) {
      throw new Error('Missing user ID - cannot map task_users record');
    }

    return {
      id_user_bak: userBackupId,
      task_id: rawRecord.newTaskId ? parseInt(rawRecord.newTaskId, 10) : null,
      process_id: processId,
      process_name: processId,
      role: rawRecord.UserFieldId || null,
      type: typeValue,
      created_at: safeISODate(rawRecord.createdAt),
      update_at: safeISODate(rawRecord.Modified)
    };
  }
}

module.exports = StreamTaskUsersModel;