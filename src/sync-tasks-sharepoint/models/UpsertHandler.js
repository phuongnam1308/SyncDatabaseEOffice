const logger = require('../../../utils/logger');
const dbUtils = require('../../../utils/dbUtils');
const TaskMapper = require('../mappers/TaskMapper');

class UpsertHandler {
  constructor(newPool, oldPool) {
    this.newPool = newPool;
    this.oldPool = oldPool;
    this.mapper = new TaskMapper(
      this.queryNewDbTx.bind(this),
      this.queryOldDb.bind(this)
    );
    this.newDbName = process.env.NEW_DB_NAME;
  }

  async initialize() {
    logger.info('[SharePointTaskUpsertHandler] Initialized');
  }

  async queryNewDbTx(query, params, transaction) {
    const request = transaction ? transaction.request() : this.newPool.request();
    for (const [key, value] of Object.entries(params || {})) {
      request.input(key, value);
    }
    const result = await request.query(query);
    return result.recordset;
  }

  async queryOldDb(query, params) {
    const request = this.oldPool.request();
    for (const [key, value] of Object.entries(params || {})) {
      request.input(key, value);
    }
    const result = await request.query(query);
    return result.recordset;
  }

  /**
   * Batch processing optimized like sync-outgoing-v3
   */
  async processBatch(records) {
    if (!records || records.length === 0) return { successIds: [], failedRecords: [] };

    const successIds = [];
    const failedRecords = [];

    // Process entire batch in one transaction for performance
    try {
      await dbUtils.withTransactionRetry(this.newPool, async (transaction) => {
        for (const record of records) {
          await this._processSingleRecord(record, transaction);
          successIds.push(record.ID);
        }
      });
    } catch (batchError) {
      logger.warn(`[SharePointTaskUpsertHandler] Batch failed, falling back to sequential: ${batchError.message}`);
      // Fallback to sequential
      for (const record of records) {
        try {
          await dbUtils.withTransactionRetry(this.newPool, async (transaction) => {
            await this._processSingleRecord(record, transaction);
          });
          successIds.push(record.ID);
        } catch (singleError) {
          logger.error(`[SharePointTaskUpsertHandler] Failed to process record ID=${record.ID}:`, singleError);
          failedRecords.push({ id: record.ID, error: singleError.message });
        }
      }
    }

    return { successIds, failedRecords };
  }

  async _processSingleRecord(stagingRow, transaction) {
    const mapped = await this.mapper.mapRecord(stagingRow);

    // 1. Map Creator and Updater using Username matching
    const createdBy = await this.mapper.mapUser(mapped.author_name, mapped.author_ad, transaction);
    const updatedBy = await this.mapper.mapUser(mapped.editor_name, mapped.editor_ad, transaction);

    // 2. Upsert Task
    const taskId = await this._upsertTask({ ...mapped, createdBy, updatedBy }, transaction);

    // 3. Process Users (Assigned To)
    if (mapped.assigned_to_names) {
      const users = this._parseRawUserIds(mapped.assigned_to_names);
      for (const u of users) {
        // Tương thích ngược: hỗ trợ cả kiểu Object cũ [{Title, Name}] và kiểu String ["Name"]
        const title = typeof u === 'object' && u ? u.Title : u;
        const name = typeof u === 'object' && u ? u.Name : null;
        if (title) {
          await this._upsertTaskUser(taskId, title, name, 'director', transaction, mapped.created_at, 2);
        }
      }
    }

    // 4. Process Followers (TheoDoiCongViec)
    if (mapped.followers_names) {
      const followers = this._parseRawUserIds(mapped.followers_names);
      for (const f of followers) {
        const title = typeof f === 'object' && f ? f.Title : f;
        const name = typeof f === 'object' && f ? f.Name : null;
        if (title) {
          await this._upsertTaskUser(taskId, title, name, 'viewer', transaction, mapped.created_at, 4);
        }
      }
    }

    // 5. Create System Log
    await this._createSystemLog(taskId, mapped, transaction);

    return taskId;
  }

  async _upsertTask(mapped, transaction) {
    const table = `task`;
    
    const existQuery = `SELECT id FROM ${table} WHERE id_task_bak = @id_task_bak AND type_task = 'general' `;
    const existing = await this.queryNewDbTx(existQuery, { id_task_bak: mapped.id_task_bak }, transaction);

    if (existing && existing.length > 0) {
      const query = `
        UPDATE ${table} SET
          name = @name,
          note = @note,
          start_date = @start_date,
          end_date = @end_date,
          progress = @progress,
          process_status = @process_status,
          priority = @priority,
          update_at = @update_at,
          updated_by = @updatedBy,
          created_by = ISNULL(created_by, @createdBy)
        WHERE id = @id
      `;
      await this.queryNewDbTx(query, {
        id: existing[0].id,
        name: mapped.name,
        note: mapped.note,
        start_date: mapped.start_date,
        end_date: mapped.end_date,
        progress: mapped.progress,
        process_status: mapped.process_status,
        priority: mapped.priority,
        update_at: mapped.update_at,
        updatedBy: mapped.updatedBy,
        createdBy: mapped.createdBy
      }, transaction);
      return existing[0].id;
    } else {
      const query = `
        INSERT INTO ${table} (
          name, note, start_date, end_date, progress, 
          process_status, priority, id_task_bak, created_at, update_at, 
          status, type_task, created_by, updated_by
        ) VALUES (
          @name, @note, @start_date, @end_date, @progress,
          @process_status, @priority, @id_task_bak, @created_at, @update_at, 
          @status, @type_task, @createdBy, @updatedBy
        );
        SELECT SCOPE_IDENTITY() AS id;
      `;
      const result = await this.queryNewDbTx(query, {
        name: mapped.name,
        note: mapped.note,
        start_date: mapped.start_date,
        end_date: mapped.end_date,
        progress: mapped.progress,
        process_status: mapped.process_status,
        priority: mapped.priority,
        id_task_bak: mapped.id_task_bak,
        created_at: mapped.created_at,
        update_at: mapped.update_at,
        status: mapped.status,
        type_task: mapped.type_task,
        createdBy: mapped.createdBy,
        updatedBy: mapped.updatedBy
      }, transaction);
      return result[0].id;
    }
  }

  async _upsertTaskUser(taskId, fullname, adName, role, transaction, createdAt, typeValue) {
    // Tìm kiếm GUID của người dùng theo tài khoản AD/họ tên chuẩn hóa
    const userId = await this.mapper.mapUser(fullname, adName, transaction);
    if (!userId) return;

    const idUserBak = require('crypto').randomUUID();
    const query = `
      IF NOT EXISTS (SELECT 1 FROM task_users WHERE task_id = @taskId AND process_id = @userId AND role = @role)
      BEGIN
        -- Nếu chưa tồn tại bản ghi phân công/theo dõi nào, thêm mới
        INSERT INTO task_users (task_id, process_id, process_name, role, type, id_user_bak, created_at, update_at)
        VALUES (@taskId, @userId, @processName, @role, @typeValue, @idUserBak, @createdAt, @createdAt)
      END
      ELSE
      BEGIN
        -- Nếu đã có tên hiển thị nhưng process_id lệch (do lệch ID cũ), cập nhật lại
        UPDATE task_users 
        SET process_id = @userId, update_at = @createdAt
        WHERE task_id = @taskId 
          AND role = @role 
          AND LTRIM(RTRIM(process_name)) = LTRIM(RTRIM(@processName))
          AND process_id != @userId
      END
    `;
    await this.queryNewDbTx(query, {
      taskId,
      userId,
      processName: fullname,
      role, // 'director', 'viewer'
      typeValue, // 2, 4
      idUserBak,
      createdAt: createdAt || new Date(),
    }, transaction);
  }

  async _createSystemLog(taskId, mapped, transaction) {
    const id = require('crypto').randomUUID();
    const idLogBak = require('crypto').randomUUID();
    const createdAt = mapped.created_at || new Date();

    const query = `
      IF NOT EXISTS (SELECT 1 FROM system_log_tasks WHERE task_id = @taskId)
      BEGIN
        INSERT INTO system_log_tasks (id, actions, details, user_info, timestamps, created_at, updated_at, task_id, note, id_log_bak)
        VALUES (@id, 'POST', @details, @userInfo, @timestamps, @createdAt, @createdAt, @taskId, @note, @idLogBak)
      END
      ELSE
      BEGIN
        -- Cập nhật thông tin tài khoản log nếu log cũ chưa liên kết đúng user_info mới
        UPDATE system_log_tasks 
        SET user_info = @userInfo, updated_at = @createdAt 
        WHERE task_id = @taskId AND (user_info != @userInfo OR user_info IS NULL)
      END
    `;
    await this.queryNewDbTx(query, {
      id,
      details: 'Tạo công việc',
      userInfo: mapped.createdBy || null,
      timestamps: createdAt,
      createdAt,
      taskId,
      note: `Migrated from SharePoint Task ID ${mapped.id_task_bak}`,
      idLogBak
    }, transaction);
  }

  _parseRawUserIds(raw) {
    if (!raw) return [];
    try {
      if (typeof raw === 'string') {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [parsed];
      }
      return Array.isArray(raw) ? raw : [raw];
    } catch (e) {
      return [];
    }
  }
}

// Cải tiến xuất Class thay vì instance trực tiếp để đảm bảo khởi tạo độc lập
module.exports = UpsertHandler;
