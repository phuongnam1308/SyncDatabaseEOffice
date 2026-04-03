const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
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

/** Maps TaskVBDenPermission → task_users (9 columns with id_user_bak) */
class StreamTaskUsersModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_TASK_USERS_MODEL' });
    this.newDbName = process.env.NEW_DB_NAME;
    this.oldDbSchema = 'dbo';
    this.oldDbTable = 'TaskVBDiPermission';
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
      // Generate fake ID if missing (id_user_bak is only for tracking, generates UUID if undefined)
      const userBackupId = String(stagingRow.ID || this._generateUUID()).trim();

      // 1. Map bản ghi (all 8 columns)
      const mapped = await this.mapSingleRecord(stagingRow, userBackupId);

      // CRITICAL: Validate required field: task_id (prevent orphaned records)
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

        let result;
        try {
          result = await this.queryNewDbTx(insertQuery, {
            taskId: mapped.task_id,
            processId: mapped.process_id,
            processName: mapped.process_name,
            role: mapped.role,
            type: mapped.type,
            idUserBak: mapped.id_user_bak,
            updateAt: mapped.update_at,
            createdAt: mapped.created_at
          }, transaction);
        } catch (insertErr) {
          logger.error(`[StreamTaskUsersModel] INSERT FAILED for user ID=${userBackupId}: ${insertErr.message}`, insertErr);
          throw insertErr;
        }

        // Verify INSERT success
        const newId = result && result.length > 0 ? result[0].id : null;
        if (!newId) {
          const msg = `Insert failed: SCOPE_IDENTITY returned null for user ID=${userBackupId}`;
          logger.error(`[StreamTaskUsersModel] ${msg}`);
          throw new Error(msg);
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
  async mapSingleRecord(rawRecord, userBackupIdOverride = null) {
    if (!rawRecord) {
      throw new Error('rawRecord is required');
    }

    // CRITICAL FIX: Use UserType to check existence, but parse Type for value
    let typeValue = null;
    if (rawRecord.UserType !== undefined && rawRecord.UserType !== null) {
      typeValue = parseInt(rawRecord.UserType, 10);
      if (isNaN(typeValue)) typeValue = null;
    }
    
    const processId = await this.helper.mapUserName(rawRecord.UserId) || null;
    const processName = await this.helper.getUserDisplayName(processId) || null;
    const roleRaw = await this.helper.getUserFieldName(rawRecord.UserFieldId) || null;
    const mapPriority = (val) => {
      const key = String(val || '').trim();
      return ({
        'AssignedTo': 'assigner',
        'NguoiPhanViec': 'assigner',
        'Xem': 'viewer',
        'NguoiDanhGia': 'director',
        'ToChucThucHien': 'director',
        'NguoiSoanThao': 'assigner',
        'NguoiNhanDeBiet': 'viewer',
        'NguoiNhanDeBaoCao': 'director',
        'NguoiNhan': 'director',
        'NguoiDuocYKien': 'director',
        'NguoiDanhGia': 'director',
        'Attendees': 'supporter',
      }[key] || 'assigner');
    };
    const role = mapPriority(roleRaw);
    // Use provided override or try to extract from rawRecord, fallback to generated ID
    const userBackupId = userBackupIdOverride || String(rawRecord.ID || '').trim() || this._generateUUID();

    // Safely parse all date fields - convert to ISO string or null
    const createdAtParsed = safeDateParse(rawRecord.createdAt, 'createdAt');
    const modifiedAtParsed = safeDateParse(rawRecord.Modified, 'Modified');

    return {
      id_user_bak: userBackupId,
      task_id: rawRecord.newTaskId ? parseInt(rawRecord.newTaskId, 10) : null,
      process_id: processId,
      process_name: processName,
      role: role,
      type: typeValue,
      created_at: createdAtParsed || new Date().toISOString(),
      update_at: modifiedAtParsed || new Date().toISOString()
    };
  }

  /** Generate UUID v4 (improved with crypto fallback) */
  _generateUUID() {
    // Try using crypto if available (Node.js 15.7.0+)
    try {
      const crypto = require('crypto');
      if (crypto.randomUUID) {
        return crypto.randomUUID();
      }
    } catch (e) {
      // Fallback
    }
    
    // Fallback to Math.random() based UUID (less ideal but works)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}

module.exports = StreamTaskUsersModel;