const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const logger = require('../../../utils/logger');
const sql = require('mssql');
const StreamTaskMigrationModel = require('./StreamTaskMigrationModel');
const StreamTaskUsersModel = require('./StreamTaskUsersModel');
const StreamSystemLogTasksModel = require('./StreamSystemLogTasksModel');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

/** Task sync orchestrator (transaction-based: fetch → stage → process with atomic multi-table handling) */
class StreamTaskOutIncrementalModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_TASK_INCREMENTAL' });
    this.newDbName = process.env.NEW_DB_NAME;
    this.oldDbSchema = 'dbo';
    this.oldDbTable = 'TaskVBDen';
    this.newDbSchema = 'dbo';
    this.newTableSync = 'task_sync';

    // Internal data models
    this.taskModel = null;
    this.taskUsersModel = null;
    this.systemLogsModel = null;
  }

  /** Initialize all models and staging tables */
  async initialize() {
    await super.initialize();
    
    try {
      this.taskModel = new StreamTaskMigrationModel();
      await this.taskModel.initialize();

      this.taskUsersModel = new StreamTaskUsersModel();
      await this.taskUsersModel.initialize();

      this.systemLogsModel = new StreamSystemLogTasksModel();
      await this.systemLogsModel.initialize();

      await this.ensureStagingTableExists();

      logger.info('[StreamTaskOutIncrementalModel] Initialized with transaction-based aggregate processing');
    } catch (error) {
      logger.error('[StreamTaskOutIncrementalModel.initialize]', error);
      throw error;
    }
  }

  /** Create task_sync staging table — stores ALL columns from TaskVBDen */
  async ensureStagingTableExists() {
    try {
      const tableRef = `${this.newDbName}.${this.newDbSchema}.${this.newTableSync}`;

      const query = `
      IF NOT EXISTS (
          SELECT 1
          FROM ${this.newDbName}.sys.tables t
          JOIN ${this.newDbName}.sys.schemas s ON t.schema_id = s.schema_id
          WHERE t.name = '${this.newTableSync}'
          AND s.name = '${this.newDbSchema}'
      )
      BEGIN
          CREATE TABLE ${tableRef} (
              SY_SyncId              INT IDENTITY(1,1) PRIMARY KEY,
              __sync_time            DATETIME2     NULL,
              __sync_id_num          BIGINT        NULL,
              id_task_bak            NVARCHAR(MAX) NULL,
              ID                     NVARCHAR(MAX) NULL,
              VBId                   NVARCHAR(MAX) NULL,
              DepartmentId           NVARCHAR(MAX) NULL,
              ParentId               NVARCHAR(MAX) NULL,
              Title                  NVARCHAR(MAX) NULL,
              DanhGia                NVARCHAR(MAX) NULL,
              DeBaoCao               NVARCHAR(MAX) NULL,
              DeBiet                 NVARCHAR(MAX) NULL,
              DeThucHien             NVARCHAR(MAX) NULL,
              DuocHuy                NVARCHAR(MAX) NULL,
              DiemChatLuong          NVARCHAR(MAX) NULL,
              DiemThoiGian           NVARCHAR(MAX) NULL,
              DiemDanhGia            NVARCHAR(MAX) NULL,
              StartDate              NVARCHAR(MAX) NULL,
              DueDate                NVARCHAR(MAX) NULL,
              CompletedDate          NVARCHAR(MAX) NULL,
              HoanTatTuDong          NVARCHAR(MAX) NULL,
              HoSoDuThaoId           NVARCHAR(MAX) NULL,
              HoSoDuThaoUrl          NVARCHAR(MAX) NULL,
              HoSoXuLyUrl            NVARCHAR(MAX) NULL,
              [Percent]              NVARCHAR(MAX) NULL,
              TrangThai              NVARCHAR(MAX) NULL,
              Priority               NVARCHAR(MAX) NULL,
              YKienCuaNguoiGiaiQuyet NVARCHAR(MAX) NULL,
              YKienChiDao            NVARCHAR(MAX) NULL,
              ModuleId               NVARCHAR(MAX) NULL,
              SiteName               NVARCHAR(MAX) NULL,
              ListName               NVARCHAR(MAX) NULL,
              ItemId                 NVARCHAR(MAX) NULL,
              Modified               NVARCHAR(MAX) NULL,
              Created                NVARCHAR(MAX) NULL,
              ModifiedBy             NVARCHAR(MAX) NULL,
              CreatedBy              NVARCHAR(MAX) NULL,
              MigrateFlg             NVARCHAR(MAX) NULL,
              MigrateErrFlg          NVARCHAR(MAX) NULL,
              MigrateErrMess         NVARCHAR(MAX) NULL,
              ParentTaskID           NVARCHAR(MAX) NULL
          )
      END
      `;

      await this.queryNewDb(query, {});
      logger.info('[StreamTaskOutIncrementalModel] task_sync ready');
    } catch (err) {
      logger.error('[StreamTaskOutIncrementalModel.ensureStagingTableExists]', err.message);
      throw err;
    }
  }

  /** Fetch from old DB: ALL columns of TaskVBDen with limit (100 rows, sorted by Modified cursor) */
  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0) {
    try {
      const query = `
        SELECT TOP 100 *
        FROM ${this.oldDbSchema}.${this.oldDbTable}
        WHERE Modified > @lastSyncTime OR (Modified = @lastSyncTime AND ID > @lastSyncId)
        ORDER BY Modified ASC, ID ASC
      `;
      
      const rows = await this.queryOldDb(query, {
        lastSyncTime: new Date(lastSyncTime),
        lastSyncId: Number(lastSyncId || 0)
      });
      
      return {
        rows: Array.isArray(rows) ? rows : [],
        totalCount: (Array.isArray(rows) ? rows.length : 0),
        lastSyncTime
      };
    } catch (error) {
      logger.error('[StreamTaskOutIncrementalModel.fetchListFromOldDb]', error);
      throw error;
    }
  }

  /** Stage tasks into task_sync — stores ALL columns from TaskVBDen */
  async syncOldToStaging(rows, { transaction } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { stagedCount: 0, inserted: 0, updated: 0 };
    }
    
    try {
      let inserted = 0;
      let updated = 0;
      const stagingRef = `${this.newDbName}.${this.newDbSchema}.${this.newTableSync}`;
      
      for (const row of rows) {
        const existing = await this.queryNewDbTx(
          `SELECT TOP 1 SY_SyncId FROM ${stagingRef} WHERE ID = @id`,
          { id: row.ID }, transaction
        );
        
        if (Array.isArray(existing) && existing.length > 0) {
          await this.queryNewDbTx(`
            UPDATE ${stagingRef}
            SET VBId                   = @vbId,
                DepartmentId           = @departmentId,
                ParentId               = @parentId,
                Title                  = @title,
                DanhGia                = @danhGia,
                DeBaoCao               = @deBaoCao,
                DeBiet                 = @deBiet,
                DeThucHien             = @deThucHien,
                DuocHuy                = @duocHuy,
                DiemChatLuong          = @diemChatLuong,
                DiemThoiGian           = @diemThoiGian,
                DiemDanhGia            = @diemDanhGia,
                StartDate              = @startDate,
                DueDate                = @dueDate,
                CompletedDate          = @completedDate,
                HoanTatTuDong          = @hoanTatTuDong,
                HoSoDuThaoId           = @hoSoDuThaoId,
                HoSoDuThaoUrl          = @hoSoDuThaoUrl,
                HoSoXuLyUrl            = @hoSoXuLyUrl,
                [Percent]              = @percent,
                TrangThai              = @trangThai,
                Priority               = @priority,
                YKienCuaNguoiGiaiQuyet = @yKienCuaNguoiGiaiQuyet,
                YKienChiDao            = @yKienChiDao,
                ModuleId               = @moduleId,
                SiteName               = @siteName,
                ListName               = @listName,
                ItemId                 = @itemId,
                Modified               = @modified,
                Created                = @created,
                ModifiedBy             = @modifiedBy,
                CreatedBy              = @createdBy,
                MigrateFlg             = @migrateFlg,
                MigrateErrFlg          = @migrateErrFlg,
                MigrateErrMess         = @migrateErrMess,
                ParentTaskID           = @parentTaskId,
                __sync_time            = @syncTime
            WHERE ID = @id
          `, {
            vbId:                   row.VBId,
            departmentId:           row.DepartmentId,
            parentId:               row.ParentId,
            title:                  row.Title,
            danhGia:                row.DanhGia,
            deBaoCao:               row.DeBaoCao,
            deBiet:                 row.DeBiet,
            deThucHien:             row.DeThucHien,
            duocHuy:                row.DuocHuy,
            diemChatLuong:          row.DiemChatLuong,
            diemThoiGian:           row.DiemThoiGian,
            diemDanhGia:            row.DiemDanhGia,
            startDate:              row.StartDate,
            dueDate:                row.DueDate,
            completedDate:          row.CompletedDate,
            hoanTatTuDong:          row.HoanTatTuDong,
            hoSoDuThaoId:           row.HoSoDuThaoId,
            hoSoDuThaoUrl:          row.HoSoDuThaoUrl,
            hoSoXuLyUrl:            row.HoSoXuLyUrl,
            percent:                row.Percent,
            trangThai:              row.TrangThai,
            priority:               row.Priority,
            yKienCuaNguoiGiaiQuyet: row.YKienCuaNguoiGiaiQuyet,
            yKienChiDao:            row.YKienChiDao,
            moduleId:               row.ModuleId,
            siteName:               row.SiteName,
            listName:               row.ListName,
            itemId:                 row.ItemId,
            modified:               row.Modified,
            created:                row.Created,
            modifiedBy:             row.ModifiedBy,
            createdBy:              row.CreatedBy,
            migrateFlg:             row.MigrateFlg,
            migrateErrFlg:          row.MigrateErrFlg,
            migrateErrMess:         row.MigrateErrMess,
            parentTaskId:           row.ParentTaskID,
            syncTime:               new Date().toISOString(),
            id:                     row.ID
          }, transaction);
          updated++;
        } else {
          await this.queryNewDbTx(`
            INSERT INTO ${stagingRef}
            (ID, VBId, DepartmentId, ParentId, Title, DanhGia, DeBaoCao, DeBiet, DeThucHien,
             DuocHuy, DiemChatLuong, DiemThoiGian, DiemDanhGia, StartDate, DueDate, CompletedDate,
             HoanTatTuDong, HoSoDuThaoId, HoSoDuThaoUrl, HoSoXuLyUrl, [Percent], TrangThai,
             Priority, YKienCuaNguoiGiaiQuyet, YKienChiDao, ModuleId, SiteName, ListName, ItemId,
             Modified, Created, ModifiedBy, CreatedBy, MigrateFlg, MigrateErrFlg, MigrateErrMess,
             ParentTaskID, __sync_time, id_task_bak)
            VALUES
            (@id, @vbId, @departmentId, @parentId, @title, @danhGia, @deBaoCao, @deBiet, @deThucHien,
             @duocHuy, @diemChatLuong, @diemThoiGian, @diemDanhGia, @startDate, @dueDate, @completedDate,
             @hoanTatTuDong, @hoSoDuThaoId, @hoSoDuThaoUrl, @hoSoXuLyUrl, @percent, @trangThai,
             @priority, @yKienCuaNguoiGiaiQuyet, @yKienChiDao, @moduleId, @siteName, @listName, @itemId,
             @modified, @created, @modifiedBy, @createdBy, @migrateFlg, @migrateErrFlg, @migrateErrMess,
             @parentTaskId, @syncTime, @idBak)
          `, {
            id:                     row.ID,
            vbId:                   row.VBId,
            departmentId:           row.DepartmentId,
            parentId:               row.ParentId,
            title:                  row.Title,
            danhGia:                row.DanhGia,
            deBaoCao:               row.DeBaoCao,
            deBiet:                 row.DeBiet,
            deThucHien:             row.DeThucHien,
            duocHuy:                row.DuocHuy,
            diemChatLuong:          row.DiemChatLuong,
            diemThoiGian:           row.DiemThoiGian,
            diemDanhGia:            row.DiemDanhGia,
            startDate:              row.StartDate,
            dueDate:                row.DueDate,
            completedDate:          row.CompletedDate,
            hoanTatTuDong:          row.HoanTatTuDong,
            hoSoDuThaoId:           row.HoSoDuThaoId,
            hoSoDuThaoUrl:          row.HoSoDuThaoUrl,
            hoSoXuLyUrl:            row.HoSoXuLyUrl,
            percent:                row.Percent,
            trangThai:              row.TrangThai,
            priority:               row.Priority,
            yKienCuaNguoiGiaiQuyet: row.YKienCuaNguoiGiaiQuyet,
            yKienChiDao:            row.YKienChiDao,
            moduleId:               row.ModuleId,
            siteName:               row.SiteName,
            listName:               row.ListName,
            itemId:                 row.ItemId,
            modified:               row.Modified,
            created:                row.Created,
            modifiedBy:             row.ModifiedBy,
            createdBy:              row.CreatedBy,
            migrateFlg:             row.MigrateFlg,
            migrateErrFlg:          row.MigrateErrFlg,
            migrateErrMess:         row.MigrateErrMess,
            parentTaskId:           row.ParentTaskID,
            syncTime:               new Date().toISOString(),
            idBak:                  row.ID
          }, transaction);
          inserted++;
        }
      }
      
      logger.info(`[StreamTaskOutIncrementalModel.syncOldToStaging] ${inserted} new, ${updated} updated`);
      
      return {
        stagedCount: rows.length,
        inserted,
        updated
      };
    } catch (error) {
      logger.error('[StreamTaskOutIncrementalModel.syncOldToStaging]', error);
      throw error;
    }
  }

  /** Fetch list: orchestrate fetch from old DB + stage in new DB */
  async getList(lastSyncTime = DEFAULT_SYNC_TIME, syncJobId = null, lastSyncId = 0) {
    try {
      const fetchResult = await this.fetchListFromOldDb(lastSyncTime, lastSyncId);
      const { rows, totalCount } = fetchResult;
      
      if (totalCount === 0) {
        return {
          lastSyncTime,
          totalCount: 0,
          stagedCount: 0,
          message: 'No new tasks'
        };
      }
      
      const stagingResult = await this.syncOldToStaging(rows);
      
      logger.info(`[StreamTaskOutIncrementalModel.getList] Fetched ${totalCount}, staged ${stagingResult.stagedCount}`);
      
      return {
        lastSyncTime,
        totalCount,
        stagedCount: stagingResult.stagedCount,
        inserted: stagingResult.inserted,
        updated: stagingResult.updated,
        message: `Staged ${stagingResult.stagedCount} tasks`
      };
    } catch (error) {
      logger.error('[StreamTaskOutIncrementalModel.getList]', error);
      throw error;
    }
  }

  /** Fetch one task from staging — all columns */
  async fetchOneFromStaging() {
    try {
      const stagingRef = `${this.newDbName}.${this.newDbSchema}.${this.newTableSync}`;
      const query = `
        SELECT TOP 1 *
        FROM ${stagingRef}
        ORDER BY SY_SyncId ASC
      `;
      
      const rows = await this.queryNewDb(query, {});
      return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    } catch (error) {
      logger.error('[StreamTaskOutIncrementalModel.fetchOneFromStaging]', error);
      throw error;
    }
  }

  /** Process one: fetch from staging → execute in transaction → delete from staging */
  async processOne(syncJobId = null) {
    const transaction = new sql.Transaction(this.newPool);
    
    try {
      await transaction.begin();

      const stagingRow = await this.fetchOneFromStaging();

      if (!stagingRow) {
        await transaction.commit();
        return {
          syncJobId,
          processed: false,
          done: true
        };
      }

      const result = await this.processRowData(stagingRow, { transaction });
      
      // Delete processed row from staging
      try {
        const stagingRef = `${this.newDbName}.${this.newDbSchema}.${this.newTableSync}`;
        await this.queryNewDb(
          `DELETE FROM ${stagingRef} WHERE SY_SyncId = @syncId`,
          { syncId: stagingRow.SY_SyncId }
        );
      } catch (delErr) {
        logger.warn('[StreamTaskOutIncrementalModel] Delete from staging error:', delErr.message);
      }

      await transaction.commit();

      return {
        syncJobId,
        processed: true,
        done: false,
        rowId: stagingRow.ID || null,
        result
      };
    } catch (error) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        logger.error('[StreamTaskOutIncrementalModel.processOne] Rollback failed:', rollbackError);
      }
      logger.error('[StreamTaskOutIncrementalModel.processOne]', error);
      throw error;
    }
  }

  /** Process row data: coordinates task + task_users + system_logs in aggregate */
  async processRowData(rowData, { transaction } = {}) {
    if (!rowData) {
      throw new Error('rowData is required');
    }

    const backupId = String(rowData.ID || '').trim();
    if (!backupId) {
      throw new Error('Invalid task ID from staging');
    }

    const res = await this.upsertTaskAggregateById(rowData, { transaction });
    const affected = Number(res?.affected || 0);

    if (affected === 0) {
      throw new Error(`Task was not inserted or updated for ID=${backupId}`);
    }

    return {
      action: res?.action || 'upsert',
      idTaskBak: backupId,
      affected
    };
  }

  /** Upsert task aggregate: main coordination (task + task_users + system_logs in ONE transaction) */
  async upsertTaskAggregateById(stagingRow, { transaction } = {}) {
    if (!stagingRow) {
      return { action: 'none', affected: 0 };
    }

    const taskId = String(stagingRow.ID || '').trim();
    const createdAt = stagingRow.Created || new Date().toISOString();
    let totalAffected = 0;

    try {

      const taskResult = await this.taskModel.processSingleRecord(stagingRow, transaction);

      if (!taskResult || !taskResult.newTaskId) {
        logger.warn(`[StreamTaskOutIncrementalModel] Task not inserted for ID ${taskId}`);
        return { action: 'none', affected: 0 };
      }

      const createdBy = taskResult?.createdBy || stagingRow.CreatedBy || null;
      logger.info(`[AggregateSync][Task] taskId=${taskId} newTaskId=${taskResult.newTaskId} action=${taskResult.action}`);
      totalAffected += 1;

      const newTaskId = taskResult.newTaskId;


      try {
        const taskUsersQuery = `
          SELECT *
          FROM ${this.oldDbSchema}.TaskVBDenPermission
          WHERE TaskId = @taskId
        `;

        const taskUsersRows = await this.queryOldDb(taskUsersQuery, {
          taskId: String(stagingRow.ID)
        });

        if (Array.isArray(taskUsersRows) && taskUsersRows.length > 0) {
          for (const userRow of taskUsersRows) {
            try {
              const userResult = await this.taskUsersModel.processSingleRecord({ ...userRow, newTaskId, createdAt}, transaction);
              if (userResult && userResult.action !== 'skipped') {
                totalAffected += 1;
              }
              logger.info(`[AggregateSync][TaskUser] taskId=${taskId} userId=${userRow.ID} action=${userResult?.action}`);
            } catch (userErr) {
              logger.warn(`[upsertTaskAggregateById] TaskUser process failed for ${userRow.ID}: ${userErr.message}`);
            }
          }
        }
      } catch (userError) {
        logger.warn(`[upsertTaskAggregateById] TaskUsers sync failed: ${userError.message}`);
      }

      try {
        const logResult = await this.systemLogsModel.createLogForTask(
          { idTask: newTaskId, userInfo: createdBy, createdAt: createdAt },
          transaction
        );
        
        if (logResult.success) {
          logger.info(`[AggregateSync][SystemLog] taskId=${newTaskId} logCreated=true`);
          totalAffected += 1;
        }
      } catch (logErr) {
        logger.warn(`[upsertTaskAggregateById] System log creation failed: ${logErr.message}`);
      }

      return {
        action: taskResult.action,
        idTaskBak: taskId,
        newTaskId,
        affected: Math.max(1, totalAffected)
      };
    } catch (error) {
      logger.error('[StreamTaskOutIncrementalModel.upsertTaskAggregateById]', error);
      throw error;
    }
  }

  /** Get sync job state */
  async getSyncJobState(syncJobId) {
    try {
      const query = `
        SELECT total_to_sync, total_processed, status, last_sync_time
        FROM ${this.newDbName}.${this.newDbSchema}.sync_jobs
        WHERE job_id = @jobId
      `;
      
      const rows = await this.queryNewDb(query, { jobId: syncJobId });
      
      if (Array.isArray(rows) && rows.length > 0) {
        return {
          total_to_sync: rows[0].total_to_sync || 0,
          total_processed: rows[0].total_processed || 0,
          status: rows[0].status || 'pending',
          last_sync_time: rows[0].last_sync_time || null
        };
      }
      
      return {
        total_to_sync: 0,
        total_processed: 0,
        status: 'not_found',
        last_sync_time: null
      };
    } catch (error) {
      logger.error('[StreamTaskOutIncrementalModel.getSyncJobState]', error);
      throw error;
    }
  }

  /**
   * Full async processing of all staged tasks
   * @param {string} syncJobId - Job ID (optional)
   * @returns {Promise<{status, processed, failedCount, cleanup}>}
   */
  async processAllAsync(syncJobId = null) {
    try {
      logger.info(`[StreamTaskOutIncrementalModel.processAllAsync] Starting job ${syncJobId}`);

      // 1. Fetch + stage
      const listResult = await this.getList(DEFAULT_SYNC_TIME, syncJobId);
      logger.info(`[StreamTaskOutIncrementalModel] Staged ${listResult.stagedCount} tasks`);

      // 2. Process all
      let processed = 0;
      let failedCount = 0;
      while (true) {
        try {
          const result = await this.processOne(syncJobId);
          if (!result.processed) break;
          processed++;
        } catch (procErr) {
          logger.error('[StreamTaskOutIncrementalModel.processAllAsync]', procErr);
          failedCount++;
        }
      }

      // 3. Cleanup
      logger.info('[StreamTaskOutIncrementalModel] Cleanup staging tables');
      const cleanupResults = {
        taskSync: await this.taskModel.cleanupStagingTable(),
        taskUsersSync: await this.taskUsersModel.cleanupStagingTable?.()
      };

      logger.info(`[StreamTaskOutIncrementalModel.processAllAsync] Completed: ${processed} processed, ${failedCount} failed`);

      return {
        status: 'success',
        processed,
        failedCount,
        cleanup: cleanupResults,
        message: `Synced ${processed} tasks (${failedCount} failed)`
      };
    } catch (error) {
      logger.error('[StreamTaskOutIncrementalModel.processAllAsync]', error);
      throw error;
    }
  }

  /**
   * Cleanup all staging tables
   * @returns {Promise<{success, message}>}
   */
  async cleanupStagingTable() {
    try {
      const taskCleanup = await this.taskModel.cleanupStagingTable();
      const userCleanup = await this.taskUsersModel.cleanupStagingTable?.();

      return {
        success: taskCleanup.success,
        message: 'All staging tables cleaned',
        details: {
          task: taskCleanup,
          taskUsers: userCleanup
        }
      };
    } catch (error) {
      logger.error('[StreamTaskOutIncrementalModel.cleanupStagingTable]', error);
      throw error;
    }
  }
}

module.exports = StreamTaskOutIncrementalModel;