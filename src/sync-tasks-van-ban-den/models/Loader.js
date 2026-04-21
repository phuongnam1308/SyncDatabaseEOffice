const BaseLoader = require('../../sync-base/BaseLoader');
const logger = require('../../../utils/logger');
const UpsertHandler = require('./UpsertHandler');

/**
 * Loader for incoming tasks (task_sync -> task aggregate tables).
 * Same pattern as sync-outgoing-v2 loader.
 */
class Loader extends BaseLoader {
  constructor(newPool, oldPool) {
    super({
      modelName: 'TASK_INCOMING_LOADER',
      stagingTableBaseName: 'task_sync',
      mainTableName: 'task',
      partitionColumn: 'Created'
    });

    this.newPool = newPool;
    this.oldPool = oldPool;
    this.upsertHandler = null;
    this.newDbName = process.env.NEW_DB_NAME;
  }

  async initialize() {
    this.upsertHandler = new UpsertHandler(this.newPool, this.oldPool);
    await this.upsertHandler.initialize();
    logger.info(`[${this.modelName}] Initialized with UpsertHandler`);
  }

  getStagingTableName() {
    return `${this.newDbName}.dbo.task_sync`;
  }

  async fetchOneFromStaging() {
    const stagingTable = this.getStagingTableName();

    const selectQuery = `
      SELECT TOP (1) *
      FROM ${stagingTable}
      WHERE ISNULL(MigrateFlg, 0) = 0
        AND ISNULL(MigrateErrFlg, 0) = 0
        AND (${this.partitionColumn} >= @startDate OR @startDate IS NULL)
        AND (${this.partitionColumn} <= @endDate OR @endDate IS NULL)
      ORDER BY TRY_CONVERT(datetime2, Modified) DESC,
               TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), ID))), '')) DESC
    `;

    const rows = await this.newPool.request()
      .input('startDate', process.env.SYNC_START_DATE || null)
      .input('endDate', process.env.SYNC_END_DATE || null)
      .query(selectQuery);

    if (!rows.recordset?.length) {
      return null;
    }

    const row = rows.recordset[0];
    const claimQuery = `
      UPDATE ${stagingTable} WITH (ROWLOCK)
      SET MigrateFlg = 2,
          MigrateErrMess = 'Processing...',
          processing_owner = @owner,
          processing_started_at = SYSUTCDATETIME(),
          processing_heartbeat_at = SYSUTCDATETIME()
      WHERE ID = @ID AND ISNULL(MigrateFlg, 0) = 0
    `;

    const claimResult = await this.newPool.request()
      .input('ID', row.ID)
      .input('owner', `pid_${process.pid}`)
      .query(claimQuery);

    if (claimResult.rowsAffected[0] === 0) {
      return this.fetchOneFromStaging();
    }

    return row;
  }

  async processRecord(row) {
    return this.upsertHandler.processRecord(row);
  }
}

module.exports = Loader;
