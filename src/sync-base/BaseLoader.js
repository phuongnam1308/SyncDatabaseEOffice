const logger = require('../../utils/logger');
const dbUtils = require('../../utils/dbUtils');

/**
 * Base class for loading data from staging table to main table.
 * Handles fetching pending records and marking them as success/failed.
 */
class BaseLoader {
  /**
   * @param {object} config
   * @param {string} config.modelName - Name of the model
   * @param {string} config.stagingTableBaseName - Base name for staging table
   * @param {string} config.mainTableName - Main destination table name
   */
  constructor(config) {
    this.modelName = config.modelName || 'BASE_LOADER';
    this.stagingTableBaseName = config.stagingTableBaseName;
    this.mainTableName = config.mainTableName;
    this.partitionColumn = config.partitionColumn || 'Created';

    this.newPool = null;
  }

  /**
   * Initialize database pool
   */
  async initialize() {
    const dbConnection = require('../../db/connection');
    this.newPool = await dbConnection.connectNewDb();
  }

  /**
   * Get staging table name with instance suffix
   * @param {string} instanceId
   * @returns {string}
   */
  getStagingTableName(instanceId) {
    return `${this.stagingTableBaseName}_${instanceId}`;
  }

  /**
   * Fetch one pending record from staging (simple approach - no complex UPDLOCK)
   * @param {string} instanceId
   * @returns {Promise<object|null>}
   */
  async fetchOneFromStaging(instanceId) {
    const stagingTable = this.getStagingTableName(instanceId);
    const startDate = process.env.SYNC_START_DATE || null;
    const endDate = process.env.SYNC_END_DATE || null;

    try {
      // Count available records first
      const countQuery = `
        SELECT COUNT(1) AS cnt
        FROM ${stagingTable}
        WHERE ISNULL(MigrateFlg, 0) = 0
          AND ISNULL(MigrateErrFlg, 0) = 0
      `;
      const countResult = await this.newPool.request().query(countQuery);
      const availableCount = Number(countResult?.recordset?.[0]?.cnt || 0);

      if (availableCount === 0) {
        return null;
      }

      // Simple approach: SELECT TOP 1 then UPDATE with RowLock
      // Since each instance has its own staging table, no need for complex locking
      const selectQuery = `
        SELECT TOP (1) *
        FROM ${stagingTable}
        WHERE ISNULL(MigrateFlg, 0) = 0
          AND ISNULL(MigrateErrFlg, 0) = 0
        ORDER BY Modified DESC, ID DESC
      `;

      const rows = await this.newPool.request().query(selectQuery);
      if (!rows.recordset?.length) {
        return null;
      }

      const row = rows.recordset[0];

      // Mark as processing
      const updateQuery = `
        UPDATE ${stagingTable} WITH (ROWLOCK)
        SET MigrateFlg = 2,
            MigrateErrMess = 'Processing...',
            processing_owner = @owner,
            processing_started_at = SYSUTCDATETIME(),
            processing_heartbeat_at = SYSUTCDATETIME()
        WHERE ID = @ID AND ISNULL(MigrateFlg, 0) = 0
      `;

      const updateResult = await this.newPool.request()
        .input('ID', row.ID)
        .input('owner', `pid_${process.pid}_${instanceId}`)
        .query(updateQuery);

      // If no rows affected, another process got it - fetch another
      if (updateResult.rowsAffected[0] === 0) {
        return this.fetchOneFromStaging(instanceId);
      }

      logger.info(`[${this.modelName}] Fetched staging row ID=${row.ID}`);
      return row;
    } catch (error) {
      logger.error(`[${this.modelName}] Failed to fetch from staging: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update heartbeat for a processing record (prevents stale detection)
   * @param {string} instanceId
   * @param {number} rowId
   */
  async updateHeartbeat(instanceId, rowId) {
    const stagingTable = this.getStagingTableName(instanceId);
    const query = `
      UPDATE ${stagingTable} WITH (ROWLOCK)
      SET processing_heartbeat_at = SYSUTCDATETIME()
      WHERE ID = @ID AND MigrateFlg = 2
    `;

    await this.newPool.request()
      .input('ID', rowId)
      .query(query);
  }

  /**
   * Mark a staging record as successfully processed
   * @param {string} instanceId
   * @param {number} rowId
   */
  async markSuccess(instanceId, rowId) {
    const stagingTable = this.getStagingTableName(instanceId);
    const query = `
      UPDATE ${stagingTable} WITH (ROWLOCK)
      SET MigrateFlg = 1,
          MigrateErrFlg = 0,
          MigrateErrMess = NULL,
          processing_owner = NULL,
          processing_heartbeat_at = NULL
      WHERE ID = @ID
    `;

    await this.newPool.request()
      .input('ID', rowId)
      .query(query);

    logger.info(`[${this.modelName}] Marked success for staging row ID=${rowId}`);
  }

  /**
   * Mark a staging record as failed
   * @param {string} instanceId
   * @param {number} rowId
   * @param {string} errorMessage
   */
  async markFailed(instanceId, rowId, errorMessage) {
    const stagingTable = this.getStagingTableName(instanceId);
    const query = `
      UPDATE ${stagingTable} WITH (ROWLOCK)
      SET MigrateFlg = 0,
          MigrateErrFlg = 1,
          MigrateErrMess = @errorMessage,
          processing_owner = NULL,
          processing_heartbeat_at = NULL
      WHERE ID = @ID
    `;

    await this.newPool.request()
      .input('ID', rowId)
      .input('errorMessage', errorMessage)
      .query(query);

    logger.info(`[${this.modelName}] Marked failed for staging row ID=${rowId}: ${errorMessage}`);
  }

  /**
   * Reset all processing records for this instance (cleanup on startup)
   * @param {string} instanceId
   */
  async resetProcessingRecords(instanceId) {
    const stagingTable = this.getStagingTableName(instanceId);
    const query = `
      UPDATE ${stagingTable} WITH (ROWLOCK)
      SET MigrateFlg = 0,
          MigrateErrFlg = 0,
          MigrateErrMess = NULL,
          processing_owner = NULL,
          processing_started_at = NULL,
          processing_heartbeat_at = NULL
      WHERE MigrateFlg = 2
    `;

    const result = await this.newPool.request().query(query);
    if (result.rowsAffected[0] > 0) {
      logger.info(`[${this.modelName}] Reset ${result.rowsAffected[0]} processing records`);
    }
  }

  /**
   * Get processing statistics for this instance
   * @param {string} instanceId
   * @returns {Promise<{pending: number, processing: number, success: number, failed: number}>}
   */
  async getStats(instanceId) {
    const stagingTable = this.getStagingTableName(instanceId);
    const query = `
      SELECT
        SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 0 THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 2 THEN 1 ELSE 0 END) AS processing,
        SUM(CASE WHEN ISNULL(MigrateFlg, 0) = 1 THEN 1 ELSE 0 END) AS success,
        SUM(CASE WHEN ISNULL(MigrateErrFlg, 0) = 1 THEN 1 ELSE 0 END) AS failed
      FROM ${stagingTable}
    `;

    const result = await this.newPool.request().query(query);
    const row = result.recordset?.[0] || {};
    return {
      pending: Number(row.pending || 0),
      processing: Number(row.processing || 0),
      success: Number(row.success || 0),
      failed: Number(row.failed || 0)
    };
  }

  /**
   * Cleanup stale records that have been processing too long
   * @param {string} instanceId
   * @param {number} staleMinutes
   */
  async cleanupStaleRecords(instanceId, staleMinutes = 30) {
    const stagingTable = this.getStagingTableName(instanceId);
    const query = `
      UPDATE ${stagingTable} WITH (ROWLOCK)
      SET MigrateFlg = 0,
          MigrateErrFlg = 0,
          MigrateErrMess = 'Stale - auto reset',
          processing_owner = NULL,
          processing_heartbeat_at = NULL
      WHERE MigrateFlg = 2
        AND DATEDIFF(MINUTE, ISNULL(processing_heartbeat_at, processing_started_at), SYSUTCDATETIME()) > @staleMinutes
    `;

    const result = await this.newPool.request()
      .input('staleMinutes', staleMinutes)
      .query(query);

    if (result.rowsAffected[0] > 0) {
      logger.info(`[${this.modelName}] Cleaned ${result.rowsAffected[0]} stale records`);
    }
  }
}

module.exports = BaseLoader;
