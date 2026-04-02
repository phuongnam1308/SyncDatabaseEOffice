const BaseIncrementalSyncInterface = require('../../../sync-manager/BaseIncrementalSyncInterface');
const MigrationHelper = require('../../../helpers/MigrationHelper');
const logger = require('../../../utils/logger');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

/**
 * Task users table INSERT/UPDATE operations
 * Maps TaskVBDenPermission (old) → task_users (new): 9 columns including id_user_bak marking
 */
class StreamTaskUsersModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_TASK_USERS_MODEL' });
    this.newDbName = process.env.NEW_DB_NAME;
    this.oldDbSchema = 'dbo';
    this.oldDbTable = 'TaskVBDenPermission';
    this.newDbSchema = 'dbo';
    this.newTableSync = 'task_users_sync';
    this.newDbTable = 'task_users';

    this.helper = new MigrationHelper(
      this.queryNewDbTx.bind(this),
      this.queryOldDb.bind(this)
    );
  }

  /**
   * Initialize model
   * @returns {Promise<void>}
   */
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
      
      const existing = await this.queryNewDb(checkColQuery);
      
      if (!existing || existing.length === 0) {
        // Column doesn't exist - ADD it
        const alterQuery = `
          ALTER TABLE ${targetTable}
          ADD id_user_bak NVARCHAR(255) NULL
        `;
        
        await this.queryNewDb(alterQuery);
        logger.info('✅ Added id_user_bak column to task_users table');
      }
    } catch (err) {
      logger.error('❌ ensureTaskUsersTableColumns failed:', err.message);
      throw err;
    }
  }

  /**
   * Process một bản ghi task user - INSERT/UPDATE với ĐẦY ĐỦ tất cả 8 columns
   * 
   * @param {Object} stagingRow - Row { ID, TaskId, UserFieldId, PermissionID, PermissionName, Type, CreatedAt, UpdatedAt }
   * @param {Object} transaction - MSSQL transaction object (optional)
   * @returns {Promise<{action: string, id_user_bak: string, taskId: number}>}
   */
  async processSingleRecord(stagingRow, transaction) {
    try {
      if (!stagingRow) {
        throw new Error('stagingRow is required');
      }

      const targetTable = `${this.newDbName}.${this.newDbSchema}.${this.newDbTable}`;

      // 1. Map bản ghi (all 8 columns)
      const mapped = await this.mapSingleRecord(stagingRow);

      // 2. Check tồn tại bằng id_user_bak
      const existQuery = `
        SELECT TOP 1 id FROM ${targetTable}
        WHERE id_user_bak = @idUserBak
      `;

      const existing = await this.queryNewDb(existQuery, { idUserBak: mapped.id_user_bak });
      
      if (Array.isArray(existing) && existing.length > 0) {
        // 3a. Update existing - WITH ALL 8 COLUMNS
        const updateQuery = `
          UPDATE ${targetTable}
          SET task_id = @taskId,
              process_id = @processId,
              process_name = @processName,
              role = @role,
              type = @type,
              update_at = GETDATE()
          WHERE id_user_bak = @idUserBak
        `;

        await this.queryNewDb(updateQuery, {
          taskId: mapped.task_id,
          processId: mapped.process_id,
          processName: mapped.process_name,
          role: mapped.role,
          type: mapped.type,
          idUserBak: mapped.id_user_bak
        });

        logger.info(`[StreamTaskUsersModel] Updated task_user ${mapped.id_user_bak}`);
        return { action: 'updated', id_user_bak: mapped.id_user_bak, taskId: mapped.task_id };
      } else {
        // 3b. Insert new - WITH ALL 8 COLUMNS
        const insertQuery = `
          INSERT INTO ${targetTable}
          (task_id, process_id, process_name, role, type, id_user_bak, created_at, update_at)
          VALUES
          (@taskId, @processId, @processName, @role, @type, @idUserBak, GETDATE(), GETDATE())
        `;

        await this.queryNewDb(insertQuery, {
          taskId: mapped.task_id,
          processId: mapped.process_id,
          processName: mapped.process_name,
          role: mapped.role,
          type: mapped.type,
          idUserBak: mapped.id_user_bak
        });

        logger.info(`[StreamTaskUsersModel] Inserted task_user ${mapped.id_user_bak}`);
        return { action: 'inserted', id_user_bak: mapped.id_user_bak, taskId: mapped.task_id };
      }
    } catch (error) {
      logger.error('[StreamTaskUsersModel.processSingleRecord]', error);
      throw error;
    }
  }

  /**
   * Map record: TaskVBDenPermission (8 fields) → task_users (9 columns)
   * All fields mapped directly from old DB
   */
  async mapSingleRecord(rawRecord) {
    if (!rawRecord) {
      throw new Error('rawRecord is required');
    }

    let typeValue = null;
    if (rawRecord.Type) {
      typeValue = parseInt(rawRecord.Type, 10);
      if (isNaN(typeValue)) typeValue = null;
    }

    return {
      id_user_bak: String(rawRecord.ID || '').trim() || null,
      task_id: rawRecord.TaskId ? parseInt(rawRecord.TaskId, 10) : null,
      process_id: rawRecord.UserFieldId || null,
      process_name: rawRecord.PermissionName || null,
      role: rawRecord.PermissionID || null,
      type: typeValue,
      created_at: rawRecord.CreatedAt ? new Date(rawRecord.CreatedAt).toISOString() : new Date().toISOString(),
      update_at: rawRecord.UpdatedAt ? new Date(rawRecord.UpdatedAt).toISOString() : new Date().toISOString()
    };
  }

  /**
   * Drop và recreate - NO-OP (không có staging table cho task_users)
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async cleanupStagingTable() {
    try {
      logger.debug('[StreamTaskUsersModel] cleanupStagingTable - NO-OP (no staging table)');
      return {
        success: true,
        message: 'No staging table for task_users (direct INSERT/UPDATE)',
        table: this.newDbTable
      };
    } catch (error) {
      logger.error('[StreamTaskUsersModel.cleanupStagingTable]', error);
      throw error;
    }
  }
}

module.exports = StreamTaskUsersModel;
