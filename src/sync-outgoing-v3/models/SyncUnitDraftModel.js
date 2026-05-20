const logger = require('../../../utils/logger');
const dbConnection = require('../../../db/connection');
const BaseSyncModel = require('../../sync-base/BaseSyncModel');
const UnitDraftExtractor = require('./UnitDraftExtractor');
const spService = require('../services/SharePointListService');

/**
 * Sync model for Unit Draft Documents from SharePoint List.
 * Source: SharePoint List "Văn bản đi" (multiple sites)
 * Target: draft_documents_unit_sync_{instanceId} staging table
 */
class SyncUnitDraftModel extends BaseSyncModel {
  constructor() {
    const extractor = new UnitDraftExtractor();

    super({
      modelName: 'SYNC_UNIT_DRAFT',
      extractor,
      loader: null
    });

    this.oldPool = null;
    this.newPool = null;
    this.instanceId = null;
    this.isRunning = false;
    this.shouldStop = false;

    // Configuration
    this.extractBatchSize = Number(process.env.UNIT_DRAFT_BATCH_SIZE || 500);
    this.heartbeatIntervalMs = Number(process.env.HEARTBEAT_INTERVAL_MS || 30000);

    // Stats
    this.stats = {
      sitesChecked: 0,
      sitesWithData: 0,
      sitesSkipped: 0,
      totalExtracted: 0,
      errors: []
    };
  }

  /**
   * Initialize the sync model
   * @param {string} instanceId
   */
  async initialize(instanceId) {
    this.instanceId = instanceId;

    // Initialize database pool (new DB for staging)
    await dbConnection.connectAll();
    this.newPool = dbConnection.getNewPool();

    // Set pools on extractor
    this.extractor.newPool = this.newPool;

    // Ensure staging table exists
    // await this.extractor.ensureStagingTableExists(instanceId);

    logger.info(`[${this.modelName}] Initialized with instanceId=${instanceId}`);
    logger.info(`[${this.modelName}] Sites configured:`, this.extractor.sites.map(s => s.name).join(', '));
  }

  /**
   * Check which sites have data before extraction
   * @returns {Promise<Array>} List of sites with data
   */
  async checkSitesWithData() {
    const sitesWithData = [];
    const sitesWithoutData = [];

    for (const site of this.extractor.sites) {
      this.stats.sitesChecked++;
      logger.info(`[${this.modelName}] Checking ${site.name}...`);

      try {
        const health = await spService.checkSiteHealth(site.url, this.extractor.listName);

        if (health.reachable && health.itemCount > 0) {
          sitesWithData.push({ ...site, itemCount: health.itemCount });
          this.stats.sitesWithData++;
          logger.info(`[${this.modelName}] ${site.name}: ${health.itemCount} items`);
        } else {
          sitesWithoutData.push({ ...site, reason: health.error || 'No items' });
          this.stats.sitesSkipped++;
          logger.info(`[${this.modelName}] ${site.name}: No data (${health.error || '0 items'})`);
        }
      } catch (error) {
        sitesWithoutData.push({ ...site, reason: error.message });
        this.stats.sitesSkipped++;
        this.stats.errors.push({ site: site.name, error: error.message });
        logger.error(`[${this.modelName}] ${site.name}: Error - ${error.message}`);
      }
    }

    logger.info(`[${this.modelName}] Sites summary: ${sitesWithData.length} with data, ${sitesWithoutData.length} without data`);

    return { sitesWithData, sitesWithoutData };
  }

  /**
   * Run the extract phase (SharePoint List → Staging)
   * @returns {Promise<{extractedCount: number, sitesSynced: number}>}
   */
  async runExtract() {
    logger.info(`[${this.modelName}] Starting extract phase...`);

    // First check which sites have data
    const { sitesWithData, sitesWithoutData } = await this.checkSitesWithData();

    if (sitesWithData.length === 0) {
      logger.warn(`[${this.modelName}] No sites have data to sync. Skipping extraction.`);
      logger.info(`[${this.modelName}] Sites checked:`, sitesWithoutData.map(s => `${s.name} (${s.reason})`).join(', '));
      return { extractedCount: 0, sitesSynced: 0 };
    }

    let totalExtracted = 0;
    let lastSyncTime = '2999-12-31T23:59:59.999Z';
    let lastSyncId = 0;
    let hasMore = true;

    // Update extractor to only use sites with data
    this.extractor.sites = sitesWithData;
    logger.info(`[${this.modelName}] Will sync from:`, sitesWithData.map(s => `${s.name} (${s.itemCount})`).join(', '));

    while (hasMore && !this.shouldStop) {
      try {
        const batch = await this.extractor.fetchBatchFromOldDb(
          lastSyncTime,
          lastSyncId,
          this.extractBatchSize
        );

        if (!batch || batch.length === 0) {
          hasMore = false;
          break;
        }

        await this.extractor.syncBatchToStaging(batch, this.instanceId);
        totalExtracted += batch.length;

        // Update cursor to last row in batch
        const lastRow = batch[batch.length - 1];
        lastSyncTime = lastRow.__sync_time;
        lastSyncId = lastRow.ID;

        logger.info(`[${this.modelName}] Extracted ${totalExtracted} records...`);

        if (batch.length < this.extractBatchSize) {
          hasMore = false;
        }
      } catch (error) {
        logger.error(`[${this.modelName}] Extract error: ${error.message}`);
        this.stats.errors.push({ phase: 'extract', error: error.message });
        hasMore = false;
      }
    }

    this.stats.totalExtracted = totalExtracted;
    logger.info(`[${this.modelName}] Extract phase complete. Total: ${totalExtracted} from ${sitesWithData.length} sites`);

    return { extractedCount: totalExtracted, sitesSynced: sitesWithData.length };
  }

  /**
   * Get staging table record count
   */
  async getStagingStats() {
    const stagingTable = this.extractor.getStagingTableName(this.instanceId);

    try {
      const query = `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN MigrateFlg = 1 THEN 1 ELSE 0 END) as success,
          SUM(CASE WHEN MigrateFlg = 0 THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN MigrateFlg = 3 THEN 1 ELSE 0 END) as failed
        FROM ${stagingTable}
      `;

      const result = await this.newPool.request().query(query);
      return result.recordset[0];
    } catch (error) {
      logger.error(`[${this.modelName}] Failed to get staging stats: ${error.message}`);
      return null;
    }
  }

  /**
   * Run the full sync process (Extract only - Load is separate)
   */
  async run() {
    this.isRunning = true;
    this.shouldStop = false;

    try {
      // Extract phase
      const extractResult = await this.runExtract();

      // Get staging stats
      const stagingStats = await this.getStagingStats();

      return {
        sitesChecked: this.stats.sitesChecked,
        sitesWithData: this.stats.sitesWithData,
        sitesSkipped: this.stats.sitesSkipped,
        extractedCount: extractResult.extractedCount,
        sitesSynced: extractResult.sitesSynced,
        stagingStats,
        errors: this.stats.errors
      };
    } catch (error) {
      logger.error(`[${this.modelName}] Run error: ${error.message}`);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Request graceful stop
   */
  stop() {
    this.shouldStop = true;
    logger.info(`[${this.modelName}] Stop requested`);
  }

  /**
   * Get current progress
   */
  async getProgress() {
    return {
      isRunning: this.isRunning,
      instanceId: this.instanceId,
      stats: this.stats
    };
  }
}

module.exports = SyncUnitDraftModel;