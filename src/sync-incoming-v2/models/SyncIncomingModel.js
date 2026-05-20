const logger = require('../../../utils/logger');
const dbUtils = require('../../../utils/dbUtils');
const dbConnection = require('../../../db/connection');
const BaseSyncModel = require('../../sync-base/BaseSyncModel');
const Extractor = require('./Extractor');
const Loader = require('./Loader');

/**
 * Sync model for incoming documents.
 * Coordinates Extract (VanBanDen → Staging) and Load (Staging → incomming_documents).
 *
 * KEY DIFFERENCES vs SyncOutgoingModel:
 * - Source: VanBanDen (not VanBanBanHanh)
 * - Cursor direction: ASC (start from 1753-01-01, go forward)
 * - Partition column: NgayDen
 * - Staging table: incomming_documents_sync_{instanceId}
 * - Main table: incomming_documents
 * - normalizeSyncTime: caps future dates (guards against runaway cursor)
 * - isCursorAhead: ASC comparison (newer = ahead)
 */
class SyncIncomingModel extends BaseSyncModel {
  constructor() {
    const extractor = new Extractor();

    super({
      modelName: 'SYNC_INCOMING',
      extractor,
      loader: null
    });

    this.oldPool = null;
    this.newPool = null;
    this.loader = null;
    this.instanceId = null;
    this.isRunning = false;
    this.shouldStop = false;

    // Configuration
    this.extractBatchSize = Number(process.env.EXTRACT_BATCH_SIZE || 1000);
    this.extractParallelBatches = Number(process.env.EXTRACT_PARALLEL_BATCHES || 3);
    this.heartbeatIntervalMs = Number(process.env.HEARTBEAT_INTERVAL_MS || 300_000); // 5 min
    this.staleMinutes = Number(process.env.STAGING_STALE_MINUTES || 30);

    // ASC cursor: start from oldest possible time
    this._defaultSyncTime = '1753-01-01T00:00:00.000Z';
    this._syncMinDate = null; // resolved in initialize()
  }

  // ──────────────────────────────────────────────
  // INITIALIZE
  // ──────────────────────────────────────────────

  async initialize(instanceId) {
    this.instanceId = instanceId;

    await dbConnection.connectAll();
    this.oldPool = dbConnection.getOldPool();
    this.newPool = dbConnection.getNewPool();

    this.extractor.oldPool = this.oldPool;
    this.extractor.newPool = this.newPool;

    // Ensure staging table exists for this instance
    await this.extractor.ensureStagingTableExists(instanceId);

    // Ensure main table has required columns (self-healing)
    await this._ensureMainTableSchema();

    // Initialize loader
    this.loader = new Loader(this.newPool, this.oldPool);
    await this.loader.initialize();

    logger.info(`[${this.modelName}] Initialized with instanceId=${instanceId}`);
  }

  async _ensureMainTableSchema() {
    try {
      await this.newPool.request().query(`
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'incomming_documents')
        BEGIN
          CREATE TABLE dbo.incomming_documents (
            document_id NVARCHAR(50) PRIMARY KEY,
            status_code NVARCHAR(10) NULL
          );
        END

        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'incomming_documents' AND COLUMN_NAME = 'stage_status')
          ALTER TABLE dbo.incomming_documents ADD stage_status NVARCHAR(50) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'incomming_documents' AND COLUMN_NAME = 'table_backups')
          ALTER TABLE dbo.incomming_documents ADD table_backups NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'incomming_documents' AND COLUMN_NAME = 'id_incoming_bak')
        BEGIN
          ALTER TABLE dbo.incomming_documents ADD id_incoming_bak NVARCHAR(255) NULL;
          IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_id_incoming_bak_v2' AND object_id = OBJECT_ID('dbo.incomming_documents'))
            CREATE INDEX idx_id_incoming_bak_v2 ON dbo.incomming_documents(id_incoming_bak);
        END
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'incomming_documents' AND COLUMN_NAME = 'tb_bak')
          ALTER TABLE dbo.incomming_documents ADD tb_bak INT DEFAULT 0;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'incomming_documents' AND COLUMN_NAME = 'to_book_text_symbols')
          ALTER TABLE dbo.incomming_documents ADD to_book_text_symbols NVARCHAR(MAX) NULL;
      `);
      logger.info(`[${this.modelName}] Main table schema verified/healed`);
    } catch (err) {
      logger.warn(`[${this.modelName}] Failed to auto-heal main table schema: ${err.message}`);
    }
  }

  // ──────────────────────────────────────────────
  // CURSOR HELPERS (ASC direction)
  // ──────────────────────────────────────────────

  /**
   * Normalize cursor for ASC direction.
   * Guard: reject future dates (incoming must not skip present data).
   */
  _normalizeSyncTime(value) {
    if (!value || value === '2100-01-01T00:00:00.000Z') return this._defaultSyncTime;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return this._defaultSyncTime;
    if (d.getFullYear() <= 1753) return this._defaultSyncTime;

    // Guard: cap at now+8h to prevent skipping live data
    const maxAllowed = new Date(Date.now() + 8 * 60 * 60 * 1000);
    if (d > maxAllowed) {
      logger.warn(`[${this.modelName}] Future cursor reset to default: ${value}`);
      return this._defaultSyncTime;
    }

    return d.toISOString();
  }

  /**
   * ASC: newer record = cursor is "ahead"
   */
  _isCursorAhead(aTime, aId, bTime, bId) {
    const ta = new Date(aTime || this._defaultSyncTime).getTime();
    const tb = new Date(bTime || this._defaultSyncTime).getTime();
    if (ta > tb) return true;
    if (ta < tb) return false;
    return Number(aId || 0) > Number(bId || 0);
  }

  _extractRowSyncTime(row) {
    const raw = row?.__sync_time || row?.Modified || row?.Created || null;
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  _extractRowSyncId(row) {
    return Number(row?.__sync_id || row?.ID || 0);
  }

  // ──────────────────────────────────────────────
  // EXTRACT PHASE (VanBanDen → Staging)
  // ──────────────────────────────────────────────

  async runExtract() {
    logger.info(`[${this.modelName}] Starting extract phase (ASC)...`);

    // Cleanup stale records before extracting
    await this._cleanupStaleRecords();

    // Get last sync cursor from staging table to support incremental resume (ASC)
    const lastCursor = await this.extractor.getLastSyncCursor(this.instanceId);
    let lastSyncTime = this._normalizeSyncTime(lastCursor.time || this.extractor.getInitialSyncTime());
    let lastSyncId = lastCursor.id || 0;
    let totalExtracted = 0;
    let hasMore = true;

    logger.info(`[${this.modelName}] Resuming extraction from cursor: time=${lastSyncTime}, id=${lastSyncId}`);

    while (hasMore && !this.shouldStop) {
      // Parallel batching
      const batchPromises = [];
      for (let p = 0; p < this.extractParallelBatches && hasMore; p++) {
        batchPromises.push(
          this.extractor.fetchBatchFromOldDb(
            lastSyncTime,
            lastSyncId,
            this.extractBatchSize,
            p * this.extractBatchSize
          )
        );
      }

      const batchResults = await Promise.all(batchPromises);
      let anyRows = false;

      for (const batch of batchResults) {
        if (!batch || batch.length === 0) continue;
        anyRows = true;

        await this.extractor.syncBatchToStaging(batch, this.instanceId);
        totalExtracted += batch.length;

        const lastRow = batch[batch.length - 1];
        const rowTime = this._extractRowSyncTime(lastRow);
        const rowId = this._extractRowSyncId(lastRow);

        if (rowTime && this._isCursorAhead(rowTime, rowId, lastSyncTime, lastSyncId)) {
          lastSyncTime = rowTime;
          lastSyncId = rowId;
        }
      }

      if (!anyRows) hasMore = false;
      logger.info(`[${this.modelName}] Extracted ${totalExtracted} records so far...`);
    }

    logger.info(`[${this.modelName}] Extract complete. Total: ${totalExtracted}`);
    return { extractedCount: totalExtracted };
  }

  async _cleanupStaleRecords() {
    const stagingTable = this.extractor.getStagingTableName(this.instanceId);
    const startDate = process.env.SYNC_START_DATE || null;
    const endDate   = process.env.SYNC_END_DATE   || null;

    try {
      const result = await this.newPool.request()
        .input('staleMinutes', this.staleMinutes)
        .input('startDate', startDate)
        .input('endDate', endDate)
        .query(`
          UPDATE ${stagingTable}
          SET MigrateFlg              = 0,
              MigrateErrMess          = 'Reset from stale processing',
              processing_owner        = NULL,
              processing_started_at   = NULL,
              processing_heartbeat_at = NULL
          WHERE MigrateFlg = 2
            AND processing_started_at < DATEADD(MINUTE, -@staleMinutes, SYSUTCDATETIME())
            AND (NgayDen >= @startDate OR @startDate IS NULL)
            AND (NgayDen <= @endDate   OR @endDate IS NULL)
        `);

      const count = result.rowsAffected?.[0] || 0;
      if (count > 0) {
        logger.info(`[${this.modelName}] Reset ${count} stale records (>${this.staleMinutes}min)`);
      }
    } catch (err) {
      logger.warn(`[${this.modelName}] Cleanup stale records failed: ${err.message}`);
    }
  }

  // ──────────────────────────────────────────────
  // LOAD PHASE (Staging → incomming_documents)
  // ──────────────────────────────────────────────

  async runLoad() {
    logger.info(`[${this.modelName}] Starting load phase...`);
    let totalProcessed = 0;
    let totalSuccess   = 0;
    let totalFailed    = 0;

    let heartbeatTimer = null;
    let currentRowId   = null;

    const startHeartbeat = (rowId) => {
      currentRowId = rowId;
      heartbeatTimer = setInterval(async () => {
        if (currentRowId) {
          await this.loader.updateHeartbeat(this.instanceId, currentRowId);
        }
      }, this.heartbeatIntervalMs);
    };

    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      currentRowId = null;
    };

    try {
      while (!this.shouldStop) {
        const row = await this.loader.fetchOneFromStaging(this.instanceId);
        if (!row) break;

        totalProcessed++;
        startHeartbeat(row.ID);

        try {
          const result = await this.loader.processRecord(row);

          if (result.success) {
            await this.loader.markSuccess(this.instanceId, row.ID);
            totalSuccess++;
          } else {
            await this.loader.markFailed(this.instanceId, row.ID, result.error);
            totalFailed++;
          }
        } catch (error) {
          await this.loader.markFailed(this.instanceId, row.ID, error.message);
          totalFailed++;
          logger.error(`[${this.modelName}] Failed row ID=${row.ID}: ${error.message}`);
        }

        stopHeartbeat();

        if (totalProcessed % 100 === 0) {
          const stats = await this.loader.getStats(this.instanceId);
          logger.info(
            `[${this.modelName}] Progress: processed=${totalProcessed}, ` +
            `pending=${stats.pending}, success=${stats.success}, failed=${stats.failed}`
          );
        }
      }
    } finally {
      stopHeartbeat();
    }

    // Finalize cursor after all staging is done
    await this._finalizeProcessingCursor();

    logger.info(
      `[${this.modelName}] Load complete. ` +
      `Total=${totalProcessed}, Success=${totalSuccess}, Failed=${totalFailed}`
    );
    return { processedCount: totalProcessed, successCount: totalSuccess, failedCount: totalFailed };
  }

  /**
   * Deferred cursor: set last_sync_time = MAX(Modified) of successfully processed rows.
   * Called once at end of load phase (not per-record, to avoid premature cursor advance).
   */
  async _finalizeProcessingCursor() {
    const stagingTable = this.extractor.getStagingTableName(this.instanceId);
    const startDate = process.env.SYNC_START_DATE || null;
    const endDate   = process.env.SYNC_END_DATE   || null;

    try {
      const res = await this.newPool.request()
        .input('startDate', startDate)
        .input('endDate', endDate)
        .query(`
          SELECT
            MAX(TRY_CONVERT(datetime2, Modified)) AS maxTime,
            MAX(TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(ID)), ''))) AS maxId
          FROM ${stagingTable}
          WHERE ISNULL(MigrateFlg, 0) = 1
            AND (NgayDen >= @startDate OR @startDate IS NULL)
            AND (NgayDen <= @endDate   OR @endDate IS NULL)
        `);

      const maxTime = res.recordset?.[0]?.maxTime;
      if (maxTime) {
        logger.info(`[${this.modelName}] Cursor finalized: maxTime=${maxTime}`);
      } else {
        logger.info(`[${this.modelName}] No processed records in partition — cursor unchanged`);
      }
    } catch (err) {
      logger.warn(`[${this.modelName}] finalizeProcessingCursor error: ${err.message}`);
    }
  }

  // ──────────────────────────────────────────────
  // RUN (Extract + Load)
  // ──────────────────────────────────────────────

  async run() {
    this.isRunning  = true;
    this.shouldStop = false;

    try {
      const extractResult = await this.runExtract();
      const loadResult    = await this.runLoad();

      return {
        extractedCount: extractResult.extractedCount,
        processedCount: loadResult.processedCount,
        successCount:   loadResult.successCount,
        failedCount:    loadResult.failedCount
      };
    } finally {
      this.isRunning = false;
    }
  }

  stop() {
    this.shouldStop = true;
    logger.info(`[${this.modelName}] Stop requested`);
  }

  async getProgress() {
    if (!this.loader) {
      return { isRunning: this.isRunning, instanceId: this.instanceId };
    }
    const stats = await this.loader.getStats(this.instanceId);
    return { isRunning: this.isRunning, instanceId: this.instanceId, ...stats };
  }
}

module.exports = SyncIncomingModel;
