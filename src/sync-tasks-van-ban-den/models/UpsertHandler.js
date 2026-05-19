const logger = require('../../../utils/logger');
const dbUtils = require('../../../utils/dbUtils');
const StreamTaskMigrationModel = require('./StreamTaskMigrationModel');
const StreamTaskUsersModel = require('./StreamTaskUsersModel');
const StreamSystemLogTasksModel = require('./StreamSystemLogTasksModel');

/**
 * Handler class for upserting incoming task aggregates.
 * Contains business logic for task + task_users + system_log_tasks.
 */
class UpsertHandler {
  constructor(newPool, oldPool) {
    this.newPool = newPool;
    this.oldPool = oldPool;

    this.taskModel = null;
    this.taskUsersModel = null;
    this.systemLogsModel = null;
  }

  async initialize() {
    this.taskModel = new StreamTaskMigrationModel();
    await this.taskModel.initialize();

    this.taskUsersModel = new StreamTaskUsersModel();
    await this.taskUsersModel.initialize();

    this.systemLogsModel = new StreamSystemLogTasksModel();
    await this.systemLogsModel.initialize();

    logger.info('[TaskIncomingUpsertHandler] Initialized');
  }

  async queryOldDb(query, params = {}) {
    const request = this.oldPool.request();
    for (const [key, value] of Object.entries(params)) {
      request.input(key, value);
    }
    const result = await request.query(query);
    return result.recordset || [];
  }

  async processRecord(stagingRow) {
    if (!stagingRow) {
      return { success: false, error: 'No record provided' };
    }

    const taskId = String(stagingRow.ID || '').trim();
    try {
      const result = await dbUtils.withTransactionRetry(this.newPool, async (transaction) => {
        let affected = 0;

        const taskResult = await this.taskModel.processSingleRecord(stagingRow, transaction);
        if (!taskResult?.newTaskId) {
          throw new Error(`Task upsert failed for ID=${taskId}`);
        }
        affected += 1;

        const newTaskId = taskResult.newTaskId;
        const createdAt = taskResult.createdAt || stagingRow.Created || new Date().toISOString();

        const permissionRows = await this.queryOldDb(
          `SELECT * FROM dbo.TaskVBDenPermission WHERE TaskId = @taskId`,
          { taskId: String(stagingRow.ID) }
        );

        let firstUserId = null;
        for (const userRow of permissionRows) {
          try {
            const userResult = await this.taskUsersModel.processSingleRecord(
              { ...userRow, newTaskId, createdAt },
              transaction
            );
            if (!firstUserId && userRow?.UserId) {
              firstUserId = userRow.UserId;
            }
            if (userResult && userResult.action !== 'skipped') {
              affected += 1;
            }
          } catch (userErr) {
            logger.warn(
              `[TaskIncomingUpsertHandler] task_users sync failed task=${taskId}, user=${userRow?.ID}: ${userErr.message}`
            );
          }
        }

        const createdBy =
          firstUserId ||
          taskResult?.createdBy ||
          stagingRow.CreatedBy ||
          null;

        try {
          const oldDocumentId = stagingRow?.VBId ? String(stagingRow.VBId).trim() : null;
          const historyResult = oldDocumentId
            ? await this.systemLogsModel.syncFullHistoryForTask(
              {
                idTask: newTaskId,
                oldDocumentId,
                createdAt,
                userInfo: createdBy
              },
              null // Run outside main transaction to prevent deadlocks
            )
            : { success: true, inserted: 0, updated: 0, total: 0 };

          if (historyResult?.success && Number(historyResult.total || 0) > 0) {
            affected += Number(historyResult.inserted || 0) + Number(historyResult.updated || 0);
          } else {
            await this.systemLogsModel.createLogForTask(
              {
                idTask: newTaskId,
                createdAt,
                userInfo: createdBy,
                note: `Auto sync from TaskVBDen ID=${taskId}`
              },
              null // Run outside main transaction to prevent deadlocks
            );
            affected += 1;
          }
        } catch (logErr) {
          logger.warn(`[TaskIncomingUpsertHandler] system log sync failed task=${taskId}: ${logErr.message}`);
        }

        return {
          action: taskResult.action || 'upserted',
          newTaskId,
          affected
        };
      }, { maxRetries: 5 });

      return {
        success: true,
        error: null,
        ...result
      };
    } catch (error) {
      logger.error(`[TaskIncomingUpsertHandler] Failed task ID=${taskId}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

module.exports = UpsertHandler;
