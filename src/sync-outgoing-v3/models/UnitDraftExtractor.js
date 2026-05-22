const BaseExtractor = require('../../sync-base/BaseExtractor');
const logger = require('../../../utils/logger');
const spService = require('../services/SharePointListService');

/**
 * UnitDraftExtractor - Extract draft documents from SharePoint List "Văn bản đi"
 * Supports multiple sites - only syncs sites that have data
 */
class UnitDraftExtractor extends BaseExtractor {
  constructor() {
    super({
      modelName: 'UNIT_DRAFT_EXTRACTOR',
      oldDbTable: 'SharePoint_List',
      oldDbSchema: null, // N/A for SharePoint
      stagingTableBaseName: 'draft_documents_unit_sync',
      partitionColumn: 'Modified'
    });

    // Sites configuration
    this.sites = this.parseSites();
    this.listName = process.env.UNIT_DRAFT_LIST_NAME || 'Văn bản đi';
    this.batchSize = parseInt(process.env.UNIT_DRAFT_BATCH_SIZE || '500', 10);
  }

  /**
   * Parse sites from environment variable
   * Format: https://site1,https://site2,https://site3
   */
  parseSites() {
    const sitesStr = process.env.UNIT_SITES;
    if (!sitesStr) {
      // Default sites if not configured
      return [
        { name: 'Tổng công ty', url: 'https://eoffice.saigonnewport.com.vn/vanbantct' },
        { name: 'Phòng Chính trị', url: 'https://eoffice.saigonnewport.com.vn/ct/vanban' },
        { name: 'Phòng Tham mưu', url: 'https://eoffice.saigonnewport.com.vn/qsbv/vanban' }
      ];
    }

    return sitesStr.split(',').map(s => {
      const url = s.trim();
      const name = url.split('/').pop() || url;
      return { name, url };
    });
  }

  /**
   * Get cursor direction - DESC (newer first)
   */
  getCursorDirection() {
    return 'DESC';
  }

  /**
   * Get sync time expression for SharePoint
   */
  getSyncTimeExpression() {
    // SharePoint: Modified datetime
    return 'Modified';
  }

  /**
   * Get total item count across all SharePoint sites
   */
  async getTotalCount(lastSyncTime, lastSyncId = 0) {
    let total = 0;
    for (const site of this.sites) {
      try {
        const count = await spService.getListItemCount(site.url, this.listName);
        total += Number(count || 0);
      } catch (error) {
        logger.warn(`[${this.modelName}] getTotalCount error for site ${site.name}: ${error.message}`);
      }
    }
    return total;
  }

  /**
   * Check if a site has data
   */
  async checkSiteHasData(site) {
    try {
      const count = await spService.getListItemCount(site.url, this.listName);
      return { hasData: count > 0, itemCount: count };
    } catch (error) {
      logger.warn(`[${this.modelName}] Cannot check ${site.name}: ${error.message}`);
      return { hasData: false, itemCount: 0, error: error.message };
    }
  }

  /**
   * Override fetchBatchFromOldDb - fetch from SharePoint API
   */
  async fetchBatchFromOldDb(lastSyncTime, lastSyncId = 0, batchSize = 1000, offset = 0) {
    const allItems = [];
    const defaultSyncTime = '2999-12-31T23:59:59.999Z';

    // Validate lastSyncTime
    const lastSyncDate = new Date(lastSyncTime);
    const isDateValid = !isNaN(lastSyncDate.getTime());
    const isValidTime = lastSyncTime &&
                        lastSyncTime !== '1970-01-01T00:00:00.000Z' &&
                        isDateValid &&
                        lastSyncDate.getFullYear() > 2000;

    const effectiveSyncTime = isValidTime ? lastSyncTime : defaultSyncTime;

    logger.info(`[${this.modelName}] Fetching batch: lastSyncTime=${effectiveSyncTime}, lastSyncId=${lastSyncId}, limit=${batchSize}, offset=${offset}`);

    // Iterate through all sites
    for (const site of this.sites) {
      try {
        // Build OData filter
        let filter = `Modified lt datetime'${effectiveSyncTime}'`;

        // Add site-specific filter if lastSyncId is being used
        // Note: SharePoint doesn't have ID comparison with datetime in same filter cleanly
        // So we rely on Modified for primary filtering

        logger.info(`[${this.modelName}] Fetching from ${site.name}: ${site.url}`);

        const result = await spService.getListItems(site.url, this.listName, {
          $select: this.getSelectColumns().join(','),
          $expand: this.getExpandColumns().join(','),
          $filter: filter,
          $orderby: 'Modified desc',
          $top: batchSize,
          $skip: offset
        });

        // Add site metadata to each item and process lookup fields
        const itemsWithMeta = result.items.map(item => {
          const processedItem = { ...item };

          // List of lookup fields to flatten (extract Title)
          const lookupFields = ['Approver', 'ApproverByStep', 'Author', 'Editor', 'LoaiVanBan'];
          
          for (const field of lookupFields) {
            if (processedItem[field] && typeof processedItem[field] === 'object') {
              processedItem[field] = processedItem[field].Title || null;
            }
          }

          // Special handling for DonVi (Cross-site lookup, cannot expand Title)
          if (!processedItem.DonVi && processedItem.DonViId) {
            processedItem.DonVi = String(processedItem.DonViId);
          }

          return {
            ...processedItem,
            __source_table: `SharePoint:${site.name}`,
            __site_name: site.name,
            __site_url: site.url,
            __sync_time: item.Modified ? new Date(item.Modified).toISOString() : effectiveSyncTime,
            __sync_id: item.ID
          };
        });

        allItems.push(...itemsWithMeta);
        logger.info(`[${this.modelName}] ${site.name}: fetched ${result.items.length} items`);

      } catch (error) {
        logger.error(`[${this.modelName}] Error fetching from ${site.name}: ${error.message}`);
        // Continue with other sites
      }
    }

    // Sort by Modified desc to match cursor logic
    allItems.sort((a, b) => {
      const timeA = new Date(a.__sync_time || 0);
      const timeB = new Date(b.__sync_time || 0);
      if (timeB - timeA !== 0) return timeB - timeA;
      return (b.ID || 0) - (a.ID || 0);
    });

    // Apply limit
    const limitedItems = allItems.slice(0, batchSize);

    logger.info(`[${this.modelName}] Total fetched: ${limitedItems.length} items across ${this.sites.length} sites`);

    return limitedItems;
  }

  getSelectColumns() {
    // We use * to get all standard fields, and specifically select /Title for Lookup/Person fields
    return [
      '*',
      'Approver/Title',
      'ApproverByStep/Title',
      'Author/Title',
      'Editor/Title',
      'LoaiVanBan/Title'
      // LoaiBanHanh/Title - Removed because it doesn't exist on some sites
      // DonVi/Title - Removed because it's a cross-site lookup
    ];
  }

  /**
   * Get columns to expand (lookup fields)
   */
  getExpandColumns() {
    return ['Approver', 'ApproverByStep', 'Author', 'Editor', 'LoaiVanBan'];
  }

  /**
   * Override ensureStagingTableExists
   * Create staging table with SharePoint-sourced columns
   */
  async ensureStagingTableExists(instanceId) {
    if (process.env.DISABLE_ENSURE_SCHEMA === 'true') {
      logger.info(`[${this.modelName}] Skipping ensureStagingTableExists (disabled via environment variable)`);
      return;
    }
    const stagingTable = this.getStagingTableName(instanceId);

    const query = `
      IF OBJECT_ID('${stagingTable}', 'U') IS NULL
      BEGIN
        CREATE TABLE ${stagingTable} (
          -- Source ID (SharePoint Item ID)
          ID                          BIGINT           NOT NULL,
          -- Source metadata
          Title                       NVARCHAR(500),
          Modified                    DATETIME,
          Created                     DATETIME,
          -- Document fields
          SoVaKyHieu                  NVARCHAR(255),
          TrichYeu                    NVARCHAR(MAX),
          NoiDung                     NVARCHAR(MAX),
          Status                      NVARCHAR(100),
          TrangThai                   NVARCHAR(100),
          LoaiBanHanh                 NVARCHAR(255),
          LoaiVanBan                  NVARCHAR(255),
          DonVi                       NVARCHAR(255),
          NgayBanHanh                 DATETIME,
          SoVBBH                      NVARCHAR(255),
          Step                        INT,
          Approver                    NVARCHAR(255),
          ApproverByStep              NVARCHAR(255),
          ApprovedDate                DATETIME,
          Author                      NVARCHAR(255),
          Editor                      NVARCHAR(255),
          AuthorId                    INT,
          EditorId                    INT,
          -- SharePoint metadata columns
          ContentTypeId               NVARCHAR(500),
          FileLeafRef                 NVARCHAR(500),
          FileRef                     NVARCHAR(500),
          FileDirRef                  NVARCHAR(500),
          -- Site metadata
          __source_table              NVARCHAR(100),
          __site_name                 NVARCHAR(100),
          __site_url                  NVARCHAR(500),
          -- Sync metadata
          MigrateFlg                  INT,
          MigrateErrFlg               INT,
          MigrateErrMess              NVARCHAR(MAX),
          __sync_time                 DATETIME2,
          __sync_id                   BIGINT,
          CONSTRAINT PK_${stagingTable}_ID PRIMARY KEY (ID)
        );
      END
    `;

    await this.newPool.request().query(query);
    
    // Ensure all required columns exist in case the table was created by an older version
    const checkColumnsQuery = `
      IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('${stagingTable}') AND name = 'Author')
      BEGIN
        ALTER TABLE ${stagingTable} ADD Author NVARCHAR(255);
      END
      IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('${stagingTable}') AND name = 'Editor')
      BEGIN
        ALTER TABLE ${stagingTable} ADD Editor NVARCHAR(255);
      END
    `;
    await this.newPool.request().query(checkColumnsQuery);

    logger.info(`[${this.modelName}] Staging table ${stagingTable} ensured and schema verified`);
  }

  /**
   * Sync batch to staging table
   */
  async syncBatchToStaging(rows, instanceId, transaction = null) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { stagedCount: 0 };
    }

    const stagingTable = this.getStagingTableName(instanceId);
    
    // Whitelist columns that exist in the staging table
    const allowedColumns = new Set([
      'ID', 'Title', 'Modified', 'Created',
      'SoVaKyHieu', 'TrichYeu', 'NoiDung', 'Status', 'TrangThai',
      'LoaiBanHanh', 'LoaiVanBan', 'DonVi',
      'NgayBanHanh', 'SoVBBH', 'Step',
      'Approver', 'ApproverByStep', 'ApprovedDate',
      'Author', 'Editor', 'AuthorId', 'EditorId',
      'ContentTypeId', 'FileLeafRef', 'FileRef', 'FileDirRef',
      '__source_table', '__site_name', '__site_url', '__sync_time', '__sync_id'
    ]);

    const columns = Object.keys(rows[0] || {}).filter(col => allowedColumns.has(col));
    if (!columns.length) {
      return { stagedCount: 0 };
    }

    if (!columns.includes('ID')) {
      throw new Error('Staging sync requires source column "ID"');
    }

    const safeColumns = columns.map(col => this.sanitizeColumnName(col));
    const nonIdColumns = columns.filter(col => col !== 'ID');
    const safeNonIdColumns = nonIdColumns.map(col => this.sanitizeColumnName(col));

    const request = transaction || this.newPool.request();

    for (const row of rows) {
      const rawId = row?.ID;
      if (rawId == null || String(rawId).trim() === '') {
        throw new Error('Row ID is required for staging');
      }

      const updateClause = safeNonIdColumns
        .map((columnName, idx) => `${columnName} = @${nonIdColumns[idx]}`)
        .join(', ');

      const query = `
        IF EXISTS (SELECT 1 FROM ${stagingTable} WHERE ID = @ID)
        BEGIN
          ${nonIdColumns.length > 0 ? `
          UPDATE ${stagingTable}
          SET ${updateClause},
              MigrateFlg = 0,
              MigrateErrFlg = 0,
              MigrateErrMess = NULL
          WHERE ID = @ID;` : `
          UPDATE ${stagingTable}
          SET MigrateFlg = 0,
              MigrateErrFlg = 0,
              MigrateErrMess = NULL
          WHERE ID = @ID;`}
        END
        ELSE
        BEGIN
          INSERT INTO ${stagingTable} (${safeColumns.join(', ')})
          VALUES (${columns.map((column) => `@${column}`).join(', ')});
        END
      `;

      const subRequest = transaction ? transaction.request() : this.newPool.request();
      for (const column of columns) {
        subRequest.input(column, row[column]);
      }

      await subRequest.query(query);
    }

    logger.info(`[${this.modelName}] Synced ${rows.length} rows to staging table ${stagingTable}`);
    return { stagedCount: rows.length };
  }

  /**
   * Get list of sites that have data
   * Useful for reporting and debugging
   */
  async getSitesWithData() {
    const results = [];

    for (const site of this.sites) {
      const check = await this.checkSiteHasData(site);
      results.push({
        ...site,
        hasData: check.hasData,
        itemCount: check.itemCount,
        error: check.error
      });
    }

    return results;
  }
}

module.exports = UnitDraftExtractor;